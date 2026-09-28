import { ChevronDown, Globe, Lock, ScanEye, ShieldCheck, ShieldQuestion, Sparkles, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { showToast } from '@/components/Toast';
import { Button } from '@/components/ui';
import { canvasApi } from '@/features/editor/canvasApi';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { cn } from '@/lib/utils';
import { ResourceIcon } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import { SEVERITY_ORDER, type Finding, type Severity } from '@/security/audit';
import { fixAllFindings, GRADE_COLORS, SEVERITY_COLORS, getAudit, useSecurityUi } from './securityStore';

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function nameOf(id: string) {
  return id.split('.').slice(1).join('.') || id;
}

const portList = (ports: string[]) => ports.map((p) => (/^\d/.test(p) ? `:${p}` : p)).join(', ');

function ResourceChip({ id, onClick }: { id: string; onClick(): void }) {
  const type = id.split('.')[0];
  const def = getDef(type);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show ${id} on the canvas`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-surface-2 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-foreground transition-colors hover:border-border-strong"
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

export function SecurityPanel() {
  const ir = useEditor((s) => s.ir);
  const applyCanvasOps = useEditor((s) => s.applyCanvasOps);
  const lens = useSecurityUi((s) => s.lens);
  const setLens = useSecurityUi((s) => s.setLens);
  const setPanel = useSecurityUi((s) => s.setPanel);
  const [expanded, setExpanded] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const audit = getAudit(ir);
  const exposed = [...audit.topology.exposure].filter(([, e]) => e.level === 'internet');
  const unknown = [...audit.topology.exposure].filter(([, e]) => e.level === 'unknown');
  const fixable = audit.findings.filter((f) => f.fix);

  // Esc closes the panel — unless something above it (a dialog, a menu, a field) takes the key,
  // or there is a selection / drawer for Esc to clear first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      const inPanel = panelRef.current?.contains(target) ?? false;
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      if (!inPanel && target.closest('input, textarea, select, [contenteditable], .monaco-editor')) return;
      if (!inPanel && (useEditor.getState().selection || useLayout.getState().drawer)) return;
      if (inPanel) e.stopPropagation();
      setPanel(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setPanel]);

  const show = (id: string) => {
    useEditor.getState().setSelection(id, 'canvas');
    requestAnimationFrame(() => canvasApi()?.focusNode(id));
  };

  const fix = (f: Finding) => {
    const ops = f.fix!.ops(useEditor.getState().ir);
    if (ops.length === 0) return;
    applyCanvasOps(ops);
    showToast(`Fixed — ${f.title.toLowerCase()}`, 'success');
  };

  return (
    // starts below the canvas's top-center stats pill so it never covers it
    <aside
      ref={panelRef}
      aria-label="Security"
      className="bp-drawer-left mt-10 flex w-full flex-col overflow-hidden rounded-[14px] border bg-surface-1 shadow-xl"
    >
      <div className="flex items-center gap-2 border-b px-3.5 py-3">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="flex-1 text-[13.5px] font-semibold">Security</h2>
        <button
          type="button"
          aria-label="Close security panel"
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
              {audit.grade === null
                ? 'Nothing to audit yet'
                : audit.findings.length === 0
                  ? 'No issues found'
                  : `${audit.findings.length} issue${audit.findings.length === 1 ? '' : 's'} to review`}
            </div>
            <div className="mt-0.5 text-[11.5px] text-faint">
              {audit.score !== null ? `Score ${audit.score} / 100` : 'Add networks, workloads or security groups'}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {SEVERITY_ORDER.filter((s) => audit.counts[s] > 0).map((s) => (
                <span
                  key={s}
                  className="rounded-full px-1.5 py-px text-[10.5px] font-semibold"
                  style={{ color: SEVERITY_COLORS[s], background: `color-mix(in srgb, ${SEVERITY_COLORS[s]} 12%, transparent)` }}
                >
                  {audit.counts[s]} {SEVERITY_LABEL[s].toLowerCase()}
                </span>
              ))}
            </div>
          </div>
        </section>

        <label className="mx-3.5 flex cursor-pointer items-center gap-3 rounded-[10px] border bg-surface-2/60 px-3 py-2.5">
          <ScanEye className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold">Security lens</span>
            <span className="block text-[11px] leading-snug text-faint">
              Show internet exposure and allowed traffic on the canvas
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={lens}
            onChange={(e) => setLens(e.target.checked)}
            className="bp-switch"
            aria-label="Security lens"
          />
        </label>

        <section className="px-3.5 pt-4">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
            <Globe className="h-3 w-3" /> Internet-facing
          </h3>
          {exposed.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[12px] text-muted">
              <Lock className="h-3.5 w-3.5 text-success" />{' '}
              {unknown.length ? 'Nothing is confirmed reachable from the internet.' : 'Nothing is reachable from the internet.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {exposed.map(([id, e]) => (
                <li key={id} className="flex items-center justify-between gap-2">
                  <ResourceChip id={id} onClick={() => show(id)} />
                  <span className="shrink-0 font-mono text-[11px] text-muted">{portList(e.ports)}</span>
                </li>
              ))}
            </ul>
          )}
          {unknown.length > 0 ? (
            <>
              <h3 className="mb-1.5 mt-3 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
                <ShieldQuestion className="h-3 w-3" /> Can't verify
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
            <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-faint">Findings</h3>
            {fixable.length > 1 ? (
              <button
                type="button"
                onClick={fixAllFindings}
                className="flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:text-primary-hover"
              >
                <Sparkles className="h-3 w-3" /> Fix all {fixable.length}
              </button>
            ) : null}
          </div>
          {audit.findings.length === 0 ? (
            <div className="rounded-[12px] border border-dashed px-4 py-6 text-center">
              <ShieldCheck className="mx-auto h-6 w-6 text-success" />
              <p className="mt-2 text-[12.5px] font-semibold">All checks pass</p>
              <p className="mt-0.5 text-[11.5px] text-faint">Open ports, public databases, encryption, IMDSv2, S3 access, unused groups.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {audit.findings.map((f) => {
                const open = expanded === f.id;
                return (
                  <li key={f.id} className="rounded-[10px] border bg-surface-1 p-2.5" data-severity={f.severity}>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : f.id)}
                      className="flex w-full items-start gap-2 text-left"
                      aria-expanded={open}
                    >
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLORS[f.severity] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold leading-snug">{f.title}</span>
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: SEVERITY_COLORS[f.severity] }}>
                          {SEVERITY_LABEL[f.severity]}
                        </span>
                      </span>
                      <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
                    </button>
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
