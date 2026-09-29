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
import type { IR, Provider, ResourceNode } from '@/ir/types';
import { getDef } from '@/resources/registry';
import { CATEGORY_ORDER, type Category } from '@/resources/types';
import { HOURS_PER_MONTH, priceDate, usd } from './format';
import { multiplicity, resourceRegion } from './resolve';
import { makeContext } from './services/common';
import { ruleFor } from './services';
import type { CloudProvider, CostKind, PriceBook, ProjectCost, ResourceCost } from './types';

const PROVIDER_NAME: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', other: 'Other' };
const PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'other'];

const isCloud = (p: Provider): p is CloudProvider => p !== 'other';

/** the multiplier for `region`, and what to tell the reader about it */
export function regionFactor(book: PriceBook, provider: Provider, region: string | undefined): { multiplier: number; region?: string; note?: string } {
  if (!isCloud(provider)) return { multiplier: 1, region };
  const { meta, regions } = book[provider];
  if (!region) return { multiplier: 1, region: meta.region, note: `No region in the code — priced at ${meta.region}` };
  if (region === meta.region) return { multiplier: 1, region };
  const m = regions[region];
  if (m !== undefined) return { multiplier: m, region, note: `${region}: ${meta.region} prices × ${m.toFixed(2)} (regional multiplier)` };
  return { multiplier: 1, region, note: `Prices for ${meta.region} — ${region} may differ` };
}

export function estimateResource(r: ResourceNode, ir: IR, book: PriceBook): ResourceCost {
  const category: Category | 'other' = getDef(r.type)?.category ?? 'other';
  const place = regionFactor(book, r.provider, resourceRegion(r, ir));
  const result = ruleFor(r.type)(makeContext(r, ir, book, place.multiplier));
  const many = multiplicity(r, ir);
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
      note: `${many.unknown}. One costs about ${usd(one)} a month.`,
      count: 1,
    };
  }
  if (many.n === 0) assumptions.unshift('count = 0: not created');
  return { ...base, kind: 'fixed', monthly: one * many.n, breakdown: result.lines, assumptions, count: many.n };
}

export function estimateProject(ir: IR, book: PriceBook): ProjectCost {
  const items = ir.resources.map((r) => estimateResource(r, ir, book));
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
    `On-demand list prices, ${HOURS_PER_MONTH} hours a month.`,
    'Not included: tax, data transfer, support plans and usage-based charges (requests, stored data, LCUs…).',
    'No free tier, credits, reserved or savings-plan discounts are subtracted.',
    ...byProvider
      .filter((g) => isCloud(g.key))
      .map((g) => {
        const meta = book[g.key as CloudProvider].meta;
        return `${PROVIDER_NAME[g.key]}: ${meta.region} prices as of ${priceDate(meta.retrieved)}; other regions scaled by a regional multiplier.`;
      }),
  ];
  return { items, total, counts, byCategory, byProvider, assumptions };
}

const cache = new WeakMap<IR, { book: PriceBook; cost: ProjectCost }>();

/** estimateProject, memoized per IR (the canvas chip and the inspector share one result) */
export function projectCost(ir: IR, book: PriceBook): ProjectCost {
  const hit = cache.get(ir);
  if (hit?.book === book) return hit.cost;
  const cost = estimateProject(ir, book);
  cache.set(ir, { book, cost });
  return cost;
}

export { PROVIDER_NAME };
