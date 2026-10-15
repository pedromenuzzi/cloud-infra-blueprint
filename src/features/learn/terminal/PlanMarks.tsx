/**
 * The last `terraform plan` drawn on the canvas: a ring and a badge on each
 * node that changes (green create, amber update, red destroy, red and green
 * replace), and a list of what will be destroyed without a node to mark.
 * Both read ./planMarks.ts, empty outside a lesson.
 */
import { Trash2 } from 'lucide-react';
import { useMessages } from '@/i18n/messages';
import type { PlanAction } from '@/learn/types';
import { usePlanMarks } from './planMarks';
import { terminalMessages } from './terminal.messages';

/** Terraform's own symbols */
export const PLAN_SYMBOL: Record<PlanAction, string> = { create: '+', update: '~', replace: '-/+', delete: '-' };

/** the ring (decorative, lighter) and the badge (white text at AA contrast) */
const RING: Record<PlanAction, string> = { create: '#10b981', update: '#f59e0b', replace: '#f43f5e', delete: '#ef4444' };
const BADGE: Record<PlanAction, string> = {
  create: '#047857',
  update: '#b45309',
  replace: 'linear-gradient(90deg, #dc2626, #047857)',
  delete: '#dc2626',
};

/** a node's plan mark; `round` is the node's corner radius */
export function PlanMark({ id, round = 12 }: { id: string; round?: number }) {
  const mark = usePlanMarks((s) => s.nodes[id]);
  const m = useMessages(terminalMessages);
  if (!mark) return null;
  const ring = RING[mark.action];
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-[5px] animate-[bp-node-in_260ms_cubic-bezier(0.2,0.8,0.2,1)_backwards] border-2"
        style={{
          borderRadius: round + 5,
          borderColor: ring,
          borderStyle: mark.action === 'replace' ? 'dashed' : 'solid',
          boxShadow: `0 0 0 4px color-mix(in srgb, ${ring} 16%, transparent), 0 10px 26px -10px color-mix(in srgb, ${ring} 70%, transparent)`,
          background:
            mark.action === 'delete'
              ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${ring} 12%, transparent) 0 6px, transparent 6px 12px)`
              : undefined,
        }}
      />
      <span
        data-plan-mark={mark.action}
        title={m.markTitle[mark.action]}
        className="absolute -top-[11px] left-3 z-10 inline-flex h-[19px] items-center gap-1 rounded-full px-2 text-[10.5px] font-bold leading-none text-white shadow-sm ring-2 ring-(--canvas-bg)"
        style={{ background: BADGE[mark.action] }}
      >
        <span className="font-mono" translate="no">
          {PLAN_SYMBOL[mark.action]}
        </span>
        {m.mark[mark.action]}
        {mark.count > 1 ? <span className="font-semibold opacity-85">×{mark.count}</span> : null}
      </span>
    </>
  );
}

/** what will be destroyed though it's no longer in the code (so not on the canvas) */
export function PlanGone() {
  const gone = usePlanMarks((s) => s.gone);
  const m = useMessages(terminalMessages);
  if (gone.length === 0) return null;
  const shown = gone.slice(0, 6);
  return (
    <div
      data-testid="plan-gone"
      className="w-max max-w-[min(360px,100%)] animate-[bp-node-in_260ms_cubic-bezier(0.2,0.8,0.2,1)_backwards] rounded-[10px] border border-danger/40 bg-surface-1/90 px-3 py-2 text-[11.5px] shadow-sm backdrop-blur-md"
    >
      <div className="flex items-center gap-1.5">
        <Trash2 className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
        <span className="font-semibold text-danger">{m.gone}</span>
        <span className="text-muted">{m.goneWhy}</span>
      </div>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-foreground" translate="no">
        {shown.map((address) => (
          <li key={address} className="truncate">
            <span className="mr-1.5 font-bold text-danger">-</span>
            {address}
          </li>
        ))}
        {gone.length > shown.length ? <li className="text-muted">+{gone.length - shown.length}</li> : null}
      </ul>
    </div>
  );
}
