import { ChevronDown, Globe, Lock, ScanEye, ShieldCheck, ShieldQuestion, Sparkles, Wrench, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { showToast } from '@/components/Toast';
import { Button, hasOpenLayer } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { scrollBehavior } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useMessages } from '@/i18n/messages';
import { ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import type { AccessExplanation } from '@/security/access';
import { SEVERITY_ORDER, type Finding } from '@/security/audit';
import { FRAMEWORKS } from '@/security/compliance';
import { portText } from '@/security/model';
import type { Exposure } from '@/security/topology';
import { AccessPaths } from './AccessPaths';
import { ComplianceBadges } from './ComplianceBadges';
import { securityUiMessages } from './messages';
import { fixAllFindings, GRADE_COLORS, SEVERITY_COLORS, SEVERITY_TEXT, getAudit, useAudit, useSecurityUi } from './securityStore';

function nameOf(id: string) {
  return id.split('.').slice(1).join('.') || id;
}

/** ":443, :80, all TCP" — port labels as words in the UI language */
const portList = (ports: string[]) => ports.map((p) => (/^\d/.test(p) ? `:${p}` : portText(p))).join(', ');

function ResourceChip({ id, onClick }: { id: string; onClick(): void }) {
  const m = useMessages(securityUiMessages);
  const type = id.split('.')[0];
  const def = getDef(type);
  return (
    <button
      type="button"
      onClick={onClick}
      title={m.showOnCanvas(id)}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-surface-2 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-foreground transition-colors hover:border-border-strong"
    >
      <ResourceIcon category={def?.category ?? 'compute'} type={type} size={18} />
      <span className="truncate">{nameOf(id)}</span>
    </button>
  );
}

function GradeRing({ grade, score }: { grade: string | null; score: number | null }) {
  const color = grade ? GRADE_COLORS[grade] : 'var(--border-strong)';
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : score / 100;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          className="transition-[stroke-dasharray] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[24px] font-bold" style={{ color }}>
        {grade ?? '—'}
      </span>
    </div>
  );
}

/** An internet-facing resource; "Why?" opens the chain of controls for each of its ports. */
function ExposedRow({
  id,
  exposure,
  access,
  open,
  onToggle,
  onShow,
}: {
  id: string;
  exposure: Exposure;
  access?: AccessExplanation;
  open: boolean;
  onToggle(): void;
  onShow(): void;
}) {
  const m = useMessages(securityUiMessages);
  const pathsId = useId();
  return (
    <li data-exposed={id}>
      <div className="flex items-center gap-2">
        <ResourceChip id={id} onClick={onShow} />
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted" title={portList(exposure.ports)}>
          {portList(exposure.ports)}
        </span>
        {access?.open.length ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={pathsId}
            aria-label={m.whyReachable(nameOf(id))}
            onClick={onToggle}
            className="flex shrink-0 items-center gap-0.5 rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-semibold text-primary transition-colors hover:bg-surface-2 hover:text-primary-hover"
          >
            {m.why} <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </button>
        ) : null}
      </div>
      {open && access ? (
        <div id={pathsId} className="mb-2 mt-1.5">
          <AccessPaths access={access} openFirst bare />
        </div>
      ) : null}
    </li>
  );
}

export function SecurityPanel() {
  const m = useMessages(securityUiMessages);
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);
  const lens = useSecurityUi((s) => s.lens);
  const setLens = useSecurityUi((s) => s.setLens);
  const setPanel = useSecurityUi((s) => s.setPanel);
  const framework = useSecurityUi((s) => s.framework);
  const setFramework = useSecurityUi((s) => s.setFramework);
  const spotlight = useSecurityUi((s) => s.spotlight);
  const explaining = useSecurityUi((s) => s.explaining);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const audit = useAudit();
  const exposed = [...audit.topology.exposure].filter(([, e]) => e.level === 'internet');
  const unknown = [...audit.topology.exposure].filter(([, e]) => e.level === 'unknown');
  const fixable = audit.findings.filter((f) => f.fix);
  const frameworks = FRAMEWORKS.map((f) => ({
    ...f,
    count: audit.findings.filter((x) => x.controls?.some((c) => c.framework === f.id)).length,
  })).filter((f) => f.count > 0);
  const active = frameworks.some((f) => f.id === framework) ? framework : 'all';
  const shown = active === 'all' ? audit.findings : audit.findings.filter((f) => f.controls?.some((c) => c.framework === active));

  // Esc closes the panel — unless something above it (a dialog, a menu, a field, a tooltip) takes the key,
  // or there is a selection / drawer for Esc to clear first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      const inPanel = panelRef.current?.contains(target) ?? false;
      // a dialog, menu or popover (the Layout menu…) is the top layer: Esc is its alone
      if (hasOpenLayer(['modal', 'popup'])) return;
      if (document.querySelector('[aria-modal="true"], [role="menu"], [data-bp-tooltip]')) return;
      if (!inPanel && target.closest('input, textarea, select, [contenteditable], .monaco-editor')) return;
      if (!inPanel && (useEditor.getState().selection || useLayout.getState().drawer)) return;
      if (inPanel) e.stopPropagation();
      setPanel(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setPanel]);

  const reveal = (selector: string, focus = false) =>
    requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector(selector);
      target?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
      if (focus) target?.querySelector<HTMLElement>('button[aria-expanded]')?.focus({ preventScroll: true });
    });

  // "Show" on a security toast: open the finding it is about — and take focus there (the toast is gone)
  useEffect(() => {
    if (!spotlight) return;
    useSecurityUi.getState().setSpotlight(null);
    if (!getAudit(useEditor.getState().ir).findings.some((f) => f.id === spotlight)) return;
    setFramework('all');
    setExpanded(spotlight);
    setFlash(spotlight);
    reveal(`[data-finding="${CSS.escape(spotlight)}"]`, true);
  }, [spotlight, setFramework]);

  // the command palette's "Why is … reachable?"
  useEffect(() => {
    if (!explaining) return;
    useSecurityUi.getState().explain(null);
    setWhy(explaining);
    reveal(`[data-exposed="${CSS.escape(explaining)}"]`);
  }, [explaining]);

  const show = (id: string) => {
    useEditor.getState().setSelection(id, 'canvas');
    requestAnimationFrame(() => canvasApi()?.focusNode(id));
  };

  const fix = (f: Finding) => {
    const ops = f.fix!.ops(useEditor.getState().ir);
    if (ops.length === 0) return;
    applyCanvasOps(ops);
    showToast(m.fixed(f.title), 'success');
  };

  return (
    // starts below the canvas's top-center stats pill so it never covers it
    <aside
      ref={panelRef}
      aria-label={m.security}
      className="bp-drawer-left mt-10 flex w-full flex-col overflow-hidden rounded-[14px] border bg-surface-1 shadow-xl"
    >
      <div className="flex items-center gap-2 border-b px-3.5 py-3">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="flex-1 text-[13.5px] font-semibold">{m.security}</h2>
        <button
          type="button"
          aria-label={m.closePanel}
          onClick={() => setPanel(false)}
          className="rounded-[6px] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex items-center gap-3.5 px-3.5 py-3.5">
          <GradeRing grade={audit.grade} score={audit.score} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">
              {audit.grade === null ? m.nothingToAudit : audit.findings.length === 0 ? m.noIssues : m.issuesToReview(audit.findings.length)}
            </div>
            <div className="mt-0.5 text-[11.5px] text-faint">
              {audit.score !== null ? m.score(audit.score) : m.addSomething}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {SEVERITY_ORDER.filter((s) => audit.counts[s] > 0).map((s) => (
                <span
                  key={s}
                  className={cn('rounded-full px-1.5 py-px text-[10.5px] font-semibold', SEVERITY_TEXT[s])}
                  style={{ background: `color-mix(in srgb, ${SEVERITY_COLORS[s]} 12%, transparent)` }}
                >
                  {m.severityCount(audit.counts[s], s)}
                </span>
              ))}
            </div>
          </div>
        </section>

        <label className="mx-3.5 flex cursor-pointer items-center gap-3 rounded-[10px] border bg-surface-2/60 px-3 py-2.5">
          <ScanEye className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold">{m.lens}</span>
            <span className="block text-[11px] leading-snug text-faint">{m.lensHint}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={lens}
            onChange={(e) => setLens(e.target.checked)}
            className="bp-switch"
            aria-label={m.lens}
          />
        </label>

        <section className="px-3.5 pt-4">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
            <Globe className="h-3 w-3" /> {m.internetFacing}
          </h3>
          {exposed.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[12px] text-muted">
              <Lock className="h-3.5 w-3.5 text-success" />{' '}
              {unknown.length ? m.nothingConfirmed : m.nothingReachable}
            </p>
          ) : (
            <ul className="space-y-1">
              {exposed.map(([id, e]) => (
                <ExposedRow
                  key={id}
                  id={id}
                  exposure={e}
                  access={audit.topology.access.get(id)}
                  open={why === id}
                  onToggle={() => setWhy(why === id ? null : id)}
                  onShow={() => show(id)}
                />
              ))}
            </ul>
          )}
          {unknown.length > 0 ? (
            <>
              <h3 className="mb-1.5 mt-3 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
                <ShieldQuestion className="h-3 w-3" /> {m.cantVerify}
              </h3>
              <ul className="space-y-1">
                {unknown.map(([id, e]) => (
                  <li key={id} className="flex items-center gap-2" title={e.reason}>
                    <ResourceChip id={id} onClick={() => show(id)} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="px-3.5 pb-4 pt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.findings}</h3>
            {fixable.length > 1 ? (
              <button
                type="button"
                onClick={fixAllFindings}
                className="flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:text-primary-hover"
              >
                <Sparkles className="h-3 w-3" /> {m.fixAll(fixable.length)}
              </button>
            ) : null}
          </div>
          {frameworks.length > 0 ? (
            <div role="group" aria-label={m.filterByFramework} className="mb-2 flex flex-wrap gap-1">
              {[{ id: 'all' as const, short: m.all, name: m.allFindings, count: audit.findings.length }, ...frameworks].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active === f.id}
                  title={f.name}
                  onClick={() => setFramework(f.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold transition-colors',
                    active === f.id
                      ? 'border-primary/40 bg-primary-soft text-primary'
                      : 'bg-surface-1 text-muted hover:border-border-strong hover:text-foreground',
                  )}
                >
                  {f.short}
                  <span className="font-medium opacity-75">{f.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {audit.findings.length === 0 ? (
            <div className="rounded-[12px] border border-dashed px-4 py-6 text-center">
              <ShieldCheck className="mx-auto h-6 w-6 text-success" />
              <p className="mt-2 text-[12.5px] font-semibold">{m.allPass}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">{m.allPassHint}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.map((f) => {
                const open = expanded === f.id;
                return (
                  <li
                    key={f.id}
                    className={cn('rounded-[10px] border bg-surface-1 p-2.5', flash === f.id && 'animate-[bp-flash_1.6s_ease-out_both]')}
                    data-severity={f.severity}
                    data-finding={f.id}
                    onAnimationEnd={() => setFlash(null)}
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : f.id)}
                      className="flex w-full items-start gap-2 text-left"
                      aria-expanded={open}
                    >
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLORS[f.severity] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold leading-snug">{f.title}</span>
                        <span className={cn('text-[10.5px] font-semibold uppercase tracking-wide', SEVERITY_TEXT[f.severity])}>
                          {m.severity(f.severity)}

                        </span>
                      </span>
                      <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
                    </button>
                    <ComplianceBadges controls={f.controls} className="mt-1.5 pl-4" />
                    {open ? <p className="mt-1.5 pl-4 text-[11.5px] leading-relaxed text-muted">{f.detail}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-4">
                      <ResourceChip id={f.resource} onClick={() => show(f.resource)} />
                      {f.fix ? (
                        <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => fix(f)}>
                          <Wrench className="h-3 w-3" /> {f.fix.label}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
