/**
 * "~$27/mo" next to the canvas stats pill: the project's estimated monthly
 * cost at on-demand list prices. Click it for the breakdown.
 */
import { CircleDollarSign, Info, Loader2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { approx } from '@/cost/format';
import type { ProjectCost } from '@/cost/types';
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor, useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { useEditor } from '@/features/editor/store';
import { CostPopover } from './CostPopover';
import { costUiMessages } from './messages';
import { useProjectCost } from './useCost';

/** what the chip says, and the longer sentence for its tooltip / accessible name */
export function chipText(cost: ProjectCost, locale: Locale = currentLocale()): { label: string; muted: boolean; tip: string } {
  const m = messagesFor(costUiMessages, locale);
  const { counts, total } = cost;
  const extra = m.extras([counts.usage ? m.usageBased(counts.usage) : '', counts.unknown ? m.notEstimated(counts.unknown) : ''].filter(Boolean));
  if (counts.fixed === 0) {
    return { label: `${approx(0, locale)}${m.perMonthShort}`, muted: true, tip: m.chipZeroTip(extra) };
  }
  return {
    label: `${approx(total, locale)}${m.perMonthShort}${counts.usage ? m.plusUsage : ''}`,
    muted: false,
    tip: m.chipTip(approx(total, locale).replace('~', ''), extra),
  };
}

export function CostChip() {
  const m = useMessages(costUiMessages);
  const rootResources = useEditor((s) => s.rootIr.resources.length > 0);
  const { cost, failed, retry } = useProjectCost();
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const tipId = useId();
  // resources of its own, or inside its local modules
  if (!rootResources && !cost?.modules?.some((x) => x.counts.fixed + x.counts.usage + x.counts.unknown + x.counts.free > 0)) return null;

  const text = cost ? chipText(cost) : null;
  const label = failed ? m.unavailable : text ? text.label : m.estimating;
  const tip = failed ? m.loadFailed : text ? text.tip : m.loading;
  const muted = !text || text.muted || failed;
  const Icon = !cost && !failed ? Loader2 : muted ? Info : CircleDollarSign;

  return (
    <span className="group relative">
      <button
        ref={chip}
        type="button"
        data-testid="cost-chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={m.chipLabel(label)}

        aria-describedby={tipId}
        aria-busy={!cost && !failed}
        onClick={() => {
          if (failed) retry();
          else if (cost) setOpen((v) => !v);
        }}
        className={cn(
          'flex items-center gap-1 whitespace-nowrap rounded-full border bg-surface-1/85 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums shadow-xs backdrop-blur-md transition-colors',
          'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          muted ? 'font-medium text-faint hover:text-muted' : 'text-foreground',
          open && 'border-border-strong',
        )}
      >
        <Icon className={cn('h-3 w-3 shrink-0', !cost && !failed && 'animate-spin', !muted && 'text-success')} aria-hidden="true" />
        {label}
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-[8px] border bg-surface-1 px-2.5 py-1.5 text-center text-[11px] leading-snug text-muted opacity-0 shadow-md transition-opacity',
          !open && 'group-hover:opacity-100 group-hover:delay-300 group-has-[:focus-visible]:opacity-100',
        )}
      >
        {tip}
      </span>
      {open && cost ? <CostPopover cost={cost} anchor={chip} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}
