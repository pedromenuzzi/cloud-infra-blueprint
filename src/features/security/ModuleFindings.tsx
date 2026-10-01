/**
 * The security panel's findings inside local modules, grouped by module
 * call (`module.network`, `module.service › module.ecr`): what each says,
 * the inputs it depends on when the call gives them as expressions, and a
 * way into the module with the resource selected.
 */
import { Boxes, ChevronDown, CornerDownRight } from 'lucide-react';
import { useState } from 'react';
import { canvasApi } from '@/features/editor/canvasApi';
import { openModulePath } from '@/features/modules/moduleViewStore';
import { useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import type { ModuleFinding } from '@/security/modules';
import { ComplianceBadges } from './ComplianceBadges';
import { securityUiMessages } from './messages';
import { moduleFindingsMessages } from './ModuleFindings.messages';
import { SEVERITY_COLORS, SEVERITY_TEXT } from './securityStore';

/** Open the module where a finding is, with its resource selected. */
export function showModuleFinding(f: ModuleFinding) {
  openModulePath(f.module.steps, f.finding.resource);
  setTimeout(() => canvasApi()?.focusNode(f.finding.resource), 220);
}

export function ModuleFindings({ findings }: { findings: ModuleFinding[] }) {
  const m = useMessages(moduleFindingsMessages);
  const sm = useMessages(securityUiMessages);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (findings.length === 0) return null;
  const groups: Array<{ label: string; dir: string; items: ModuleFinding[] }> = [];
  for (const f of findings) {
    const last = groups[groups.length - 1];
    if (last?.label === f.module.label) last.items.push(f);
    else groups.push({ label: f.module.label, dir: f.module.dir, items: [f] });
  }
  return (
    <section className="px-3.5 pb-4" aria-label={m.title} data-testid="module-findings">
      <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.title}</h3>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.label}>
            <h4 className="mb-1 flex items-center gap-1.5 text-[11.5px]">
              <Boxes className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
              <code className="min-w-0 flex-1 truncate font-mono font-semibold" title={g.dir}>
                {g.label}
              </code>
              <span className="shrink-0 text-[10.5px] text-muted">{m.count(g.items.length)}</span>
            </h4>
            <ul className="space-y-1.5">
              {g.items.map((f) => {
                const open = expanded === f.key;
                return (
                  <li key={f.key} className="rounded-[10px] border bg-surface-1 p-2.5" data-severity={f.finding.severity} data-finding={f.key}>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : f.key)}
                      className="flex w-full items-start gap-2 text-left"
                      aria-expanded={open}
                    >
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLORS[f.finding.severity] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold leading-snug">{f.finding.title}</span>
                        <span className={cn('text-[10.5px] font-semibold uppercase tracking-wide', SEVERITY_TEXT[f.finding.severity])}>
                          {sm.severity(f.finding.severity)}
                        </span>
                      </span>
                      <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
                    </button>
                    <ComplianceBadges controls={f.finding.controls} className="mt-1.5 pl-4" />
                    {open ? (
                      <>
                        <p className="mt-1.5 pl-4 text-[11.5px] leading-relaxed text-muted">{f.finding.detail}</p>
                        {f.finding.fix ? <p className="mt-1 pl-4 text-[11px] leading-snug text-faint">{m.fixInside}</p> : null}
                      </>
                    ) : null}
                    {f.inputs.map((i) => (
                      <p key={i.name} className="mt-1.5 pl-4 text-[11px] leading-snug text-warning">
                        {i.note}
                      </p>
                    ))}
                    <div className="mt-2 pl-4">
                      <button
                        type="button"
                        onClick={() => showModuleFinding(f)}
                        title={m.open(f.label)}
                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] font-medium text-foreground transition-colors hover:border-border-strong"
                      >
                        <CornerDownRight className="h-3 w-3 shrink-0 text-faint" aria-hidden="true" />
                        <span className="truncate">{f.label}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
