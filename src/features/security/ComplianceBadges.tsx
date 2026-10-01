/**
 * Small per-framework badges for the controls a finding fails ("CIS AWS 5.2",
 * "FSBP EC2.13 · EC2.19"), with a tooltip that names each control. The badge
 * is a button so the tooltip also opens on focus and on tap; Esc closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { FRAMEWORKS, frameworkOf, type Control, type FrameworkId } from '@/security/compliance';

const TIP_WIDTH = 264;

/** `controls` come from an audit, their titles already in its language */
function ControlBadge({ framework, controls }: { framework: FrameworkId; controls: Control[] }) {
  const f = frameworkOf(framework);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const width = Math.min(TIP_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    // above when there is room, else below
    setPos(r.top > 120 ? { left, bottom: window.innerHeight - r.top + 6, width } : { left, top: r.bottom + 6, width });
  }, [open]);

  // Esc closes the tooltip only — not the panel or dialog around it (they check for [data-bp-tooltip])
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const label = `${f.short} ${controls.map((c) => c.id).join(' · ')}`;
  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-full items-center rounded-[5px] border bg-surface-2 px-1.5 font-mono text-[10px] font-semibold leading-[16px] text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <span className="truncate">{label}</span>
        <span className="sr-only">
          {' '}
          ({f.name} {f.version}): {controls.map((c) => `${c.id}, ${c.title}`).join('; ')}
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div
              aria-hidden="true"
              data-bp-tooltip=""
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
              className="bp-pop-in pointer-events-none fixed z-[90] rounded-[8px] bg-[#0f172a] px-2.5 py-2 text-left text-[11px] leading-snug text-[#f8fafc] shadow-lg dark:bg-[#f1f5f9] dark:text-[#0f172a]"
            >
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide opacity-75">
                {f.name} · {f.version}
              </span>
              {controls.map((c) => (
                <span key={c.id} className="mt-1 block first:mt-0">
                  <b className="font-mono">{c.id}</b> {c.title}
                </span>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** One badge per framework, in the table's order. */
export function ComplianceBadges({ controls, className }: { controls?: Control[]; className?: string }) {
  if (!controls?.length) return null;
  const groups = FRAMEWORKS.map((f) => ({ id: f.id, list: controls.filter((c) => c.framework === f.id) })).filter((g) => g.list.length);
  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)} data-testid="compliance-badges">
      {groups.map((g) => (
        <ControlBadge key={g.id} framework={g.id} controls={g.list} />
      ))}
    </span>
  );
}
