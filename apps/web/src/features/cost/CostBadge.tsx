import { cn } from '@blueprint/ui';
import { CircleHelp, DollarSign } from 'lucide-react';

import { bucketForMonthlyCost, type CostBucket } from './costSchema';

interface CostBadgeProps {
  /** Estimated monthly cost in USD. `null` ⇒ unsupported (renders "?"). */
  monthlyCost: number | null;
  /** Smaller, less padded variant for canvas overlays. */
  size?: 'md' | 'sm';
  /** Tooltip override. Defaults to a sensible currency-formatted string. */
  title?: string;
  className?: string;
}

const BUCKET_CLASS: Record<CostBucket, string> = {
  free: 'border-success/30 bg-success/10 text-success',
  low: 'border-success/30 bg-success/10 text-success',
  medium: 'border-warning/30 bg-warning/10 text-[hsl(var(--warning-foreground))] dark:text-warning',
  high: 'border-danger/30 bg-danger/10 text-danger',
};

const SIZE_CLASS = {
  md: 'h-6 px-2 text-[11px] gap-1',
  sm: 'h-5 px-1.5 text-[10px] gap-0.5',
} as const;

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

/**
 * Single resource cost badge — rendered as a canvas overlay on a node or
 * inline in the inspector. Color-coded by `bucketForMonthlyCost` so a
 * glance at the canvas reveals where money goes.
 *
 * Accessibility:
 *   - The visual `$` icon is decorative; the badge text has the value.
 *   - When the cost is unknown we show a "?" with a `<title>` so screen
 *     readers announce "Cost unavailable".
 */
export function CostBadge({ monthlyCost, size = 'md', title, className }: CostBadgeProps) {
  const sizeClass = SIZE_CLASS[size];
  if (monthlyCost === null) {
    return (
      <span
        title={title ?? 'Cost unavailable for this resource'}
        className={cn(
          'inline-flex items-center rounded-sm border border-border/60 bg-muted font-semibold text-muted-foreground',
          sizeClass,
          className,
        )}
      >
        <CircleHelp className={size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5'} aria-hidden />
        n/a
      </span>
    );
  }
  const bucket = bucketForMonthlyCost(monthlyCost);
  const label = monthlyCost === 0 ? 'Free' : `${formatter.format(monthlyCost)}/mo`;
  return (
    <span
      title={title ?? `${formatter.format(monthlyCost)} per month (estimated by Infracost)`}
      className={cn(
        'inline-flex items-center rounded-sm border font-semibold leading-none transition-colors',
        BUCKET_CLASS[bucket],
        sizeClass,
        className,
      )}
    >
      <DollarSign className={size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5'} aria-hidden />
      {label}
    </span>
  );
}

interface CostTotalBadgeProps {
  total: number;
  /** When true, render in a more prominent topbar-friendly variant. */
  prominent?: boolean;
  /** Override label text. */
  label?: string;
  className?: string;
}

/**
 * Larger sibling of `CostBadge` for "total project cost" displays in the
 * topbar or summary cards. Uses the same color buckets so the visual
 * language stays consistent.
 */
export function CostTotalBadge({
  total,
  prominent = false,
  label = 'Estimated monthly cost',
  className,
}: CostTotalBadgeProps) {
  const bucket = bucketForMonthlyCost(total);
  return (
    <span
      title={`${label}: ${formatter.format(total)}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-semibold',
        BUCKET_CLASS[bucket],
        prominent ? 'h-8 px-3 text-xs' : 'h-7 px-2.5 text-[11px]',
        className,
      )}
    >
      <DollarSign className={prominent ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden />
      {formatter.format(total)}
      <span className="font-normal opacity-70">/ mo</span>
    </span>
  );
}
