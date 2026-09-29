/**
 * The cost breakdown, under the canvas cost chip: totals by category (and by
 * cloud when there are several), a sortable row per resource — a click selects
 * it — and the assumptions every number rests on.
 */
import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { restoreFocus, useLayer } from '@/components/ui';
import { PROVIDER_NAME } from '@/cost/estimate';
import { approx, describeLines, usd } from '@/cost/format';
import type { CostKind, ProjectCost, ResourceCost } from '@/cost/types';
import { canvasApi } from '@/features/editor/canvasApi';
import { useEditor } from '@/features/editor/store';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/resources/icons';
import { getDef } from '@/resources/registry';
import { CATEGORY_LABELS, type Category } from '@/resources/types';

type SortKey = 'cost' | 'name' | 'category';

const KIND_ORDER: Record<CostKind, number> = { fixed: 0, usage: 1, unknown: 2, free: 3 };
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'cost', label: 'Cost' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
];

const categoryLabel = (c: Category | 'other') => (c === 'other' ? 'Other' : CATEGORY_LABELS[c]);
const categoryColor = (c: Category | 'other') => (c === 'other' ? '#64748b' : CATEGORY_COLORS[c].solid);

function sortItems(items: ResourceCost[], key: SortKey): ResourceCost[] {
  const byName = (a: ResourceCost, b: ResourceCost) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
  const out = [...items];
  if (key === 'name') return out.sort(byName);
  if (key === 'category') return out.sort((a, b) => categoryLabel(a.category).localeCompare(categoryLabel(b.category)) || (b.monthly ?? -1) - (a.monthly ?? -1) || byName(a, b));
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.monthly ?? 0) - (a.monthly ?? 0) || byName(a, b));
}

/** "usage-based" / "not estimated" instead of a number */
export function KindBadge({ kind }: { kind: Exclude<CostKind, 'fixed'> }) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-1.5 py-px text-[10.5px] font-semibold leading-4',
        kind === 'usage' && 'border-primary/30 bg-primary-soft text-primary',
        kind === 'unknown' && 'border-warning/35 bg-warning/10 text-warning',
        kind === 'free' && 'border-border text-faint',
      )}
    >
      {kind === 'usage' ? 'usage-based' : kind === 'unknown' ? 'not estimated' : 'no charge'}
    </span>
  );
}

function Row({ item, onPick }: { item: ResourceCost; onPick(id: string): void }) {
  const def = getDef(item.type);
  const detail = item.kind === 'fixed' ? describeLines(item.breakdown) : item.note;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(item.id)}
        title={detail}
        className="group/row flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: categoryColor(item.category) }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-[12px] font-semibold text-foreground">{item.name}</span>
            <span className="shrink-0 text-[10.5px] text-faint">{def?.shortName ?? item.type}</span>
          </span>
          {detail ? <span className="block truncate text-[10.5px] leading-snug text-faint">{detail}</span> : null}
        </span>
        {item.count > 1 ? <span className="shrink-0 text-[10.5px] font-semibold text-muted">×{item.count}</span> : null}
        {item.kind === 'fixed' ? (
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-foreground">{usd(item.monthly ?? 0)}</span>
        ) : (
          <KindBadge kind={item.kind} />
        )}
        <ChevronRight className="h-3 w-3 shrink-0 text-faint opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100" aria-hidden="true" />
      </button>
    </li>
  );
}

function Bars({ title, groups }: { title: string; groups: Array<{ key: string; label: string; color: string; monthly: number; note?: string; text?: string }> }) {
  const most = Math.max(...groups.map((g) => g.monthly), 0.01);
  return (
    <section>
      <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{title}</h3>
      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_72px_auto] items-center gap-2 text-[11.5px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color }} aria-hidden="true" />
              <span className="truncate text-foreground">{g.label}</span>
              {g.note ? <span className="shrink-0 text-[10.5px] text-faint">{g.note}</span> : null}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              {g.monthly > 0 ? <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (g.monthly / most) * 100)}%`, background: g.color }} /> : null}
            </span>
            {g.text ? (
              <span className="text-right text-[10.5px] text-faint">{g.text}</span>
            ) : (
              <span className="text-right font-semibold tabular-nums text-foreground">{usd(g.monthly)}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CostPopover({ cost, anchor, onClose }: { cost: ProjectCost; anchor: RefObject<HTMLElement | null>; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [sort, setSort] = useState<SortKey>('cost');
  const [showFree, setShowFree] = useState(false);
  const [shift, setShift] = useState(0);
  const [viewport, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const close = (refocus: boolean) => {
    onClose();
    if (refocus) restoreFocus(anchor.current);
  };
  useLayer(true, () => close(true), { kind: 'popup', node: ref });

  // click outside closes; the chip toggles on its own
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [anchor, onClose]);

  // centered under the chip, nudged to stay inside the canvas (which clips it)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canvas = (el.closest('.react-flow') ?? document.body).getBoundingClientRect();
    const min = Math.max(canvas.left, 0) + 8;
    const max = Math.min(canvas.right, window.innerWidth) - 8;
    const r = el.getBoundingClientRect();
    const left = r.left - shift;
    const right = left + r.width;
    const next = left < min ? min - left : right > max ? Math.max(min - left, max - right) : 0;
    if (Math.abs(next - shift) > 0.5) setShift(next);
  }, [shift, viewport]);

  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, []);

  const pick = (id: string) => {
    useEditor.getState().setSelection(id, 'canvas');
    canvasApi()?.focusNode(id);
    onClose();
  };

  const rows = useMemo(() => sortItems(cost.items, sort), [cost.items, sort]);
  const charged = rows.filter((i) => i.kind !== 'free');
  const freeRows = rows.filter((i) => i.kind === 'free');
  const categories = cost.byCategory
    .filter((g) => g.monthly > 0)
    .map((g) => ({ key: g.key, label: categoryLabel(g.key), color: categoryColor(g.key), monthly: g.monthly }));
  const clouds = cost.byProvider.filter((g) => g.key !== 'other');
  const { counts } = cost;
  const extras = [counts.usage ? `${counts.usage} usage-based` : '', counts.unknown ? `${counts.unknown} not estimated` : ''].filter(Boolean);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      data-testid="cost-popover"
      // `translate` (not `transform`, which the pop-in animation owns) centers it
      className="bp-pop-in nowheel nodrag nopan absolute left-1/2 top-full z-20 mt-2 flex max-h-[min(72vh,640px)] w-[360px] max-w-[calc(100vw-16px)] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border bg-surface-1 text-left shadow-xl"
      style={{ marginLeft: shift }}
      onBlur={(e) => {
        // Tab out of the popover (to something that isn't the chip) closes it
        const next = e.relatedTarget as Node | null;
        if (next && !ref.current?.contains(next) && !anchor.current?.contains(next)) onClose();
      }}
    >
      <header className="border-b px-4 pb-3 pt-3.5">
        <h2 id={titleId} className="text-[10.5px] font-bold uppercase tracking-wider text-faint">
          Estimated monthly cost
        </h2>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[22px] font-bold leading-none tracking-tight tabular-nums text-foreground">
            {counts.fixed ? approx(cost.total) : '$0'}
          </span>
          <span className="text-[12px] text-muted">/ month</span>
        </p>
        <p className="mt-1 text-[11.5px] leading-snug text-muted">
          {counts.fixed ? `${usd(cost.total)} for ${counts.fixed} priced resource${counts.fixed === 1 ? '' : 's'}` : 'Nothing here has a fixed monthly price'}
          {extras.length ? `, plus ${extras.join(' and ')}` : ''}.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {categories.length ? (
          <div className="px-1">
            <Bars title="By category" groups={categories} />
          </div>
        ) : null}
        {clouds.length > 1 ? (
          <div className="px-1">
            <Bars
              title="By cloud"
              groups={clouds.map((g) => ({
                key: g.key,
                label: PROVIDER_NAME[g.key],
                note: g.region,
                color: g.key === 'aws' ? '#ff9900' : g.key === 'azure' ? '#0078d4' : '#4285f4',
                monthly: g.monthly,
                text: g.priced ? undefined : 'no fixed price',
              }))}
            />
          </div>
        ) : null}

        <section aria-label="Resources">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-faint">Resources</h3>
            <div className="flex rounded-md border bg-surface-2 p-0.5" role="group" aria-label="Sort resources by">
              {SORTS.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={sort === s.key}
                  data-autofocus={i === 0 ? '' : undefined}
                  onClick={() => setSort(s.key)}
                  className={cn(
                    'h-5 rounded-[4px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary',
                    sort === s.key ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-px" data-testid="cost-rows">
            {charged.map((item) => (
              <Row key={item.id} item={item} onPick={pick} />
            ))}
          </ul>
          {freeRows.length ? (
            <>
              <button
                type="button"
                aria-expanded={showFree}
                onClick={() => setShowFree((v) => !v)}
                className="mt-1 flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[11.5px] text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', showFree && 'rotate-90')} aria-hidden="true" />
                <span className="shrink-0">{freeRows.length} with no charge of their own</span>
                <span className="min-w-0 truncate text-faint">{[...new Set(freeRows.map((i) => getDef(i.type)?.shortName ?? i.type))].join(', ')}</span>
              </button>
              {showFree ? (
                <ul className="space-y-px">
                  {freeRows.map((item) => (
                    <Row key={item.id} item={item} onPick={pick} />
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <footer className="border-t bg-surface-2/60 px-4 py-2.5">
        <ul className="space-y-0.5 text-[10.5px] leading-snug text-faint">
          {cost.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
          <li className="font-medium text-muted">An estimate, not a quote — check the provider's pricing calculator before you commit.</li>
        </ul>
      </footer>
    </div>
  );
}
