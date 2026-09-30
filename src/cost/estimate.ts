/**
 * Monthly cost estimate of a project, from the static price tables.
 *
 * Pure: IR + price book in, numbers out. Each resource type has a rule
 * (./services) that turns its arguments into billed lines at the default
 * region's rates; this module scales them to the resource's region, applies
 * `count`, and sums the project. Nothing is guessed: a resource billed only by
 * usage is `usage`, anything the tables can't price is `unknown` — neither is
 * given a number.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import type { IR, Provider, ResourceNode } from '@/ir/types';
import { getDef } from '@/resources/registry';
import { CATEGORY_ORDER, type Category } from '@/resources/types';
import { HOURS_PER_MONTH, priceDate, usd } from './format';
import { costMessages } from './messages';
import { multiplicity, resourceRegion } from './resolve';
import { makeContext } from './services/common';
import { ruleFor } from './services';
import type { CloudProvider, CostKind, PriceBook, ProjectCost, ResourceCost } from './types';

/** "AWS", "Google Cloud", "Other" / "Outros" */
export const providerName = (p: Provider, locale: Locale = currentLocale()): string => messagesFor(costMessages, locale).providers[p];
/** the English names (tests, and code that isn't shown to people) */
const PROVIDER_NAME: Record<Provider, string> = messagesFor(costMessages, 'en').providers;
const PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'other'];

const isCloud = (p: Provider): p is CloudProvider => p !== 'other';

/** the multiplier for `region`, and what to tell the reader about it */
export function regionFactor(
  book: PriceBook,
  provider: Provider,
  region: string | undefined,
  locale: Locale = currentLocale(),
): { multiplier: number; region?: string; note?: string } {
  if (!isCloud(provider)) return { multiplier: 1, region };
  const t = messagesFor(costMessages, locale);
  const { meta, regions } = book[provider];
  if (!region) return { multiplier: 1, region: meta.region, note: t.noRegion(meta.region) };
  if (region === meta.region) return { multiplier: 1, region };
  const m = regions[region];
  if (m !== undefined) return { multiplier: m, region, note: t.regional(region, meta.region, m) };
  return { multiplier: 1, region, note: t.otherRegion(meta.region, region) };
}

/** One resource's estimate; every label, note and assumption in `locale`. */
export function estimateResource(r: ResourceNode, ir: IR, book: PriceBook, locale: Locale = currentLocale()): ResourceCost {
  const t = messagesFor(costMessages, locale);
  const category: Category | 'other' = getDef(r.type)?.category ?? 'other';
  const place = regionFactor(book, r.provider, resourceRegion(r, ir), locale);
  const result = ruleFor(r.type)(makeContext(r, ir, book, place.multiplier, locale));
  const many = multiplicity(r, ir, locale);
  const base = { id: r.id, type: r.type, name: r.name, provider: r.provider, category, region: place.region, multiplier: place.multiplier };

  switch (result.kind) {
    case 'free':
      return { ...base, kind: 'free', monthly: 0, breakdown: [], assumptions: [], note: result.note, count: 'n' in many ? many.n : 1 };
    case 'usage':
      return { ...base, kind: 'usage', monthly: null, breakdown: [], assumptions: result.assumptions ?? [], note: result.note, count: 'n' in many ? many.n : 1 };
    case 'unknown':
      return { ...base, kind: 'unknown', monthly: null, breakdown: [], assumptions: [], note: result.note, count: 'n' in many ? many.n : 1 };
  }

  const one = result.lines.reduce((sum, l) => sum + l.monthly, 0);
  const assumptions = [...(place.note ? [place.note] : []), ...(result.assumptions ?? [])];
  if ('unknown' in many) {
    return {
      ...base,
      kind: 'unknown',
      monthly: null,
      breakdown: result.lines,
      assumptions,
      note: t.oneCosts(many.unknown, usd(one, locale)),
      count: 1,
    };
  }
  if (many.n === 0) assumptions.unshift(t.notCreated);
  return { ...base, kind: 'fixed', monthly: one * many.n, breakdown: result.lines, assumptions, count: many.n };
}

/** The project's estimate, worded in `locale` (the numbers don't depend on it). */
export function estimateProject(ir: IR, book: PriceBook, locale: Locale = currentLocale()): ProjectCost {
  const t = messagesFor(costMessages, locale);
  const items = ir.resources.map((r) => estimateResource(r, ir, book, locale));
  const counts: Record<CostKind, number> = { fixed: 0, usage: 0, unknown: 0, free: 0 };
  for (const item of items) counts[item.kind]++;
  const total = items.reduce((sum, i) => sum + (i.kind === 'fixed' ? (i.monthly ?? 0) : 0), 0);

  const group = <K extends string>(keys: K[], keyOf: (i: ResourceCost) => K) =>
    keys
      .map((key) => {
        const members = items.filter((i) => keyOf(i) === key);
        return {
          key,
          monthly: members.reduce((sum, i) => sum + (i.kind === 'fixed' ? (i.monthly ?? 0) : 0), 0),
          resources: members.length,
          priced: members.filter((i) => i.kind === 'fixed').length,
        };
      })
      .filter((g) => g.resources > 0);

  const byCategory = group<Category | 'other'>([...CATEGORY_ORDER, 'other'], (i) => i.category);
  const byProvider = group(PROVIDERS, (i) => i.provider).map((g) =>
    isCloud(g.key) ? { ...g, region: book[g.key].meta.region, retrieved: book[g.key].meta.retrieved } : g,
  );

  const assumptions = [
    t.onDemand(HOURS_PER_MONTH),
    t.notIncluded,
    t.noDiscounts,
    ...byProvider
      .filter((g) => isCloud(g.key))
      .map((g) => {
        const meta = book[g.key as CloudProvider].meta;
        return t.pricesAsOf(providerName(g.key, locale), meta.region, priceDate(meta.retrieved, locale));
      }),
  ];
  return { items, total, counts, byCategory, byProvider, assumptions };
}

const cache = new WeakMap<IR, { book: PriceBook; locale: Locale; cost: ProjectCost }>();

/**
 * estimateProject, memoized per IR and language (the canvas chip and the
 * inspector share one result); a language switch re-words it.
 */
export function projectCost(ir: IR, book: PriceBook, locale: Locale = currentLocale()): ProjectCost {
  const hit = cache.get(ir);
  if (hit?.book === book && hit.locale === locale) return hit.cost;
  const cost = estimateProject(ir, book, locale);
  cache.set(ir, { book, locale, cost });
  return cost;
}


export { PROVIDER_NAME };
