/**
 * The cost of what's inside local modules: each call to a module of the
 * project is estimated with the inputs it gives (src/ir/moduleInstance.ts),
 * once per call — a module called twice is two groups — and counted × the
 * call's `count` / `for_each` when that's known. The project's totals,
 * groups and counts include them; registry and git modules stay out (their
 * contents aren't in the project).
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { moduleInstances, type ModuleInstance } from '@/ir/moduleInstance';
import type { IR } from '@/ir/types';
import { estimateResource, summarize, type WeightedItem } from './estimate';
import type { CostKind, ModuleCost, PriceBook, ProjectCost } from './types';

function moduleCost(m: ModuleInstance, book: PriceBook, locale: Locale): ModuleCost {
  const items = m.ir.resources.map((r) => estimateResource(r, m.ir, book, locale));
  const nested = m.nested.map((n) => moduleCost(n, book, locale));
  const own = items.reduce((sum, i) => sum + (i.kind === 'fixed' ? (i.monthly ?? 0) : 0), 0);
  const perCall = own + nested.reduce((sum, n) => sum + (n.monthly ?? 0), 0);
  const counts: Record<CostKind, number> = { fixed: 0, usage: 0, unknown: 0, free: 0 };
  for (const i of items) counts[i.kind]++;
  for (const n of nested) for (const k of Object.keys(counts) as CostKind[]) counts[k] += n.counts[k];
  return {
    id: m.id,
    label: m.label,
    steps: m.steps,
    dir: m.dir,
    count: m.count,
    ...(m.repeat ? { repeat: m.repeat } : {}),
    items,
    perCall,
    monthly: m.count === null ? null : perCall * m.count,
    counts,
    nested,
  };
}

/** Every item of the modules, weighted by the instances of the calls they sit in. */
function weighted(modules: ModuleCost[], factor: number | null, out: WeightedItem[] = []): WeightedItem[] {
  for (const m of modules) {
    const f = factor === null || m.count === null ? null : factor * m.count;
    for (const item of m.items) out.push({ item, factor: f });
    weighted(m.nested, f, out);
  }
  return out;
}

/**
 * The estimate of the module `ir` (the root module, or an opened one as its
 * calls make it) with what its local module calls hold. `steps`: the calls
 * that lead to `ir` from the root, when it isn't the root.
 */
export function estimateWithModules(
  ir: IR,
  files: Record<string, string>,
  book: PriceBook,
  locale: Locale = currentLocale(),
  steps: Array<{ dir: string; name: string }> = [],
): ProjectCost {
  const items = ir.resources.map((r) => estimateResource(r, ir, book, locale));
  const modules = moduleInstances(ir, files, steps).map((m) => moduleCost(m, book, locale));
  const all: WeightedItem[] = [...items.map((item) => ({ item, factor: 1 })), ...weighted(modules, 1)];
  return { items, ...summarize(all, book, locale), ...(modules.length > 0 ? { modules } : {}) };
}

const cache = new WeakMap<IR, { files: Record<string, string>; book: PriceBook; locale: Locale; key: string; cost: ProjectCost }>();

/** estimateWithModules, memoized per IR, files, price book, language and path (the chip, popover and inspector share it). */
export function projectCostWithModules(
  ir: IR,
  files: Record<string, string>,
  book: PriceBook,
  locale: Locale = currentLocale(),
  steps: Array<{ dir: string; name: string }> = [],
): ProjectCost {
  const key = steps.map((s) => `${s.dir}:${s.name}`).join('/');
  const hit = cache.get(ir);
  if (hit && hit.files === files && hit.book === book && hit.locale === locale && hit.key === key) return hit.cost;
  const cost = estimateWithModules(ir, files, book, locale, steps);
  cache.set(ir, { files, book, locale, key, cost });
  return cost;
}

/** The module calls of an estimate, outermost first, each followed by the ones inside it. */
export function flatModuleCosts(modules: ModuleCost[] | undefined): ModuleCost[] {
  return (modules ?? []).flatMap((m) => [m, ...flatModuleCosts(m.nested)]);
}
