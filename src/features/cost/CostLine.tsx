/**
 * The selected resource's estimate, in the inspector: the monthly amount and
 * how it's made up ("t3.micro 730 h × $0.0104 = $7.59"), or why there is no
 * number. Live: it follows every edit of the resource.
 */
import { CircleDollarSign } from 'lucide-react';
import { useState } from 'react';
import { usd } from '@/cost/format';
import { useMessages } from '@/i18n/messages';
import type { ResourceNode } from '@/ir/types';
import { cn } from '@/lib/utils';
import { KindBadge } from './CostPopover';
import { costUiMessages } from './messages';
import { useProjectCost } from './useCost';

export function CostLine({ node }: { node: ResourceNode }) {
  const m = useMessages(costUiMessages);
  const { cost } = useProjectCost();
  const [more, setMore] = useState(false);
  const item = cost?.items.find((i) => i.id === node.id);

  if (!item) {
    return (
      <div data-testid="cost-line" aria-busy="true" className="h-[34px] animate-pulse rounded-[10px] border bg-surface-2/60" />
    );
  }

  if (item.kind === 'free') {
    return (
      <p data-testid="cost-line" className="flex items-center gap-1.5 text-[11.5px] text-faint">
        <CircleDollarSign className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{m.noChargeOfItsOwn(item.note)}</span>
      </p>
    );
  }

  const assumptions = item.assumptions;
  const shown = more ? assumptions : assumptions.slice(0, 2);
  return (
    <section data-testid="cost-line" aria-label={m.costEstimate} className="rounded-[10px] border bg-surface-2/50 p-2.5">
      <div className="flex items-center gap-1.5">
        <CircleDollarSign className={cn('h-3.5 w-3.5 shrink-0', item.kind === 'fixed' ? 'text-success' : 'text-faint')} aria-hidden="true" />
        <h4 className="flex-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{m.estimatedCost}</h4>
        {item.kind === 'fixed' ? (
          <span className="text-[13px] font-bold tabular-nums text-foreground" data-testid="cost-line-total">
            ~{usd(item.monthly ?? 0)}
            <span className="text-[11px] font-medium text-muted">{m.perMonthShort}</span>
          </span>
        ) : (
          <KindBadge kind={item.kind} />
        )}
      </div>

      {item.breakdown.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {item.breakdown.map((line, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="min-w-0 text-foreground">
                <span className="font-medium">{line.label}</span>
                {line.detail ? <span className="text-muted"> {line.detail}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted">{usd(line.monthly)}</span>
            </li>
          ))}
          {item.count !== 1 && item.kind === 'fixed' ? (
            <li className="flex items-baseline justify-between gap-2 border-t pt-0.5 text-[11.5px]">
              <span className="text-muted">
                × {item.count} ({item.repeat ?? 'count'})
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">{usd(item.monthly ?? 0)}</span>
            </li>
          ) : null}
        </ul>
      ) : null}

      {item.note ? <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{item.note}</p> : null}

      {shown.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-snug text-faint">
          {shown.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
      {assumptions.length > 2 ? (
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="mt-0.5 text-[10.5px] font-medium text-primary hover:underline"
        >
          {more ? m.fewerDetails : m.moreAssumptions(assumptions.length - 2)}

        </button>
      ) : null}
    </section>
  );
}
