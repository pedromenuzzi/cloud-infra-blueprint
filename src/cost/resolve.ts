/**
 * Reading the values a price depends on out of the IR: literals, variable
 * defaults, arguments of nested blocks, `count`, and the region a resource
 * runs in.
 *
 * Variables follow the rule of the PDF's provider summary (archDoc.ts): a
 * `var.x` counts as its literal default. That module is not imported here —
 * it is the lazy PDF chunk — and its private helper only returns strings;
 * prices.test.ts checks both read the same AWS and Azure regions from every
 * template (for Google Cloud the estimate also reads `location` and `zone`).
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import type { Expression, IR, ProviderBlock, ResourceNode } from '@/ir/types';
import { costMessages } from './messages';

export type Scalar = string | number | boolean;

/** `type.name.attr` — an attribute of another resource */
const RESOURCE_ATTR = /^([a-z][a-z0-9_]*)\.([A-Za-z_][\w-]*)\.([a-z_][a-z0-9_]*)$/;

/**
 * Literal value of `e`: a literal, a variable's literal default, or an
 * attribute of another resource that is itself a literal argument there
 * (`azurerm_resource_group.main.location`). Anything else is unknown.
 */
export function resolveScalar(e: Expression | undefined, ir: IR, depth = 0): Scalar | undefined {
  if (!e || depth > 4) return undefined;
  if (e.kind === 'literal') return e.value === null ? undefined : e.value;
  if (e.kind !== 'ref') return undefined;
  if (e.path.startsWith('var.')) {
    const v = ir.variables.find((d) => d.name === e.path.slice(4));
    return resolveScalar(v?.args.default, ir, depth + 1);
  }
  const m = RESOURCE_ATTR.exec(e.path);
  if (!m) return undefined;
  const target = ir.resources.find((r) => r.type === m[1] && r.name === m[2]);
  return target ? resolveScalar(target.args[m[3]], ir, depth + 1) : undefined;
}

export function resolveString(e: Expression | undefined, ir: IR): string | undefined {
  const v = resolveScalar(e, ir);
  return v === undefined || typeof v === 'boolean' ? undefined : String(v);
}

/** numbers, and numeric strings (`cpu = "256"`) */
export function resolveNumber(e: Expression | undefined, ir: IR): number | undefined {
  const v = resolveScalar(e, ir);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(v)) return Number(v);
  return undefined;
}

export function resolveBool(e: Expression | undefined, ir: IR): boolean | undefined {
  const v = resolveScalar(e, ir);
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'false') return v === 'true';
  return undefined;
}

/** the body of a nested block (`root_block_device { … }`), or an object value; the first of repeated blocks */
export function blockBody(e: Expression | undefined): Record<string, Expression> | undefined {
  if (!e) return undefined;
  if (e.kind === 'block') return e.body;
  if (e.kind === 'object') return e.fields;
  if (e.kind === 'blocks') return e.items[0];
  if (e.kind === 'list' && e.items[0]?.kind === 'object') return e.items[0].fields;
  return undefined;
}

/** every body of a repeated nested block */
export function blockBodies(e: Expression | undefined): Array<Record<string, Expression>> {
  if (!e) return [];
  if (e.kind === 'blocks') return e.items;
  const one = blockBody(e);
  return one ? [one] : [];
}

/** the resource another one points at through `field` (`subnet_id = aws_subnet.a.id` → the subnet) */
export function referenced(r: ResourceNode, field: string, ir: IR): ResourceNode | undefined {
  const e = r.args[field];
  if (e?.kind !== 'ref') return undefined;
  const [type, name] = e.path.split('.');
  const bare = name?.replace(/\[.*$/, '');
  return ir.resources.find((x) => x.type === type && x.name === bare);
}

/** resources whose `field` points at `target` (EIPs of an instance…) */
export function referencing(target: ResourceNode, type: string, field: string, ir: IR): ResourceNode[] {
  return ir.resources.filter((r) => r.type === type && referenced(r, field, ir) === target);
}

export type Multiplicity = { n: number } | { unknown: string };

/** how many instances the resource stands for: a literal `count`, else 1; `for_each` / expressions are unknown (why, in `locale`) */
export function multiplicity(r: ResourceNode, ir: IR, locale: Locale = currentLocale()): Multiplicity {
  const m = messagesFor(costMessages, locale);
  if (r.args.for_each) return { unknown: m.forEach };
  const count = r.args.count;
  if (!count) return { n: 1 };
  const n = resolveNumber(count, ir);
  if (n === undefined || !Number.isInteger(n) || n < 0) return { unknown: m.countExpr };
  return { n };
}


// ------------------------------------------------------------------ regions

function providerBlock(ir: IR, source: string, alias?: string): ProviderBlock | undefined {
  const blocks = ir.providers.filter((p) => p.name === source);
  if (alias) return blocks.find((p) => resolveString(p.args.alias, ir) === alias);
  return blocks.find((p) => !p.args.alias) ?? blocks[0];
}

/** `provider = aws.west` → "west" */
function providerAlias(r: ResourceNode): string | undefined {
  const e = r.args.provider;
  return e?.kind === 'ref' ? e.path.split('.')[1] : undefined;
}

/** Azure accepts display names too: "East US" → "eastus" */
const azureRegion = (location: string) => location.toLowerCase().replace(/\s+/g, '');

/** "us-central1-a" → "us-central1"; regions and multi-regions ("US") unchanged */
export const gcpRegionOfZone = (zone: string) => (/^[a-z]+-[a-z]+\d+-[a-z]$/.test(zone) ? zone.slice(0, -2) : zone);

/**
 * The region a resource runs in, when the code says so: its provider block's
 * `region` (AWS), its `location` (Azure), its own region / location / zone or
 * the provider's (GCP).
 */
export function resourceRegion(r: ResourceNode, ir: IR): string | undefined {
  switch (r.provider) {
    case 'aws':
      return resolveString(providerBlock(ir, 'aws', providerAlias(r))?.args.region, ir);
    case 'azure': {
      const location = resolveString(r.args.location, ir);
      return location ? azureRegion(location) : undefined;
    }
    case 'gcp': {
      for (const key of ['region', 'location', 'zone']) {
        const v = resolveString(r.args[key], ir);
        if (v) return gcpRegionOfZone(v);
      }
      const block = providerBlock(ir, 'google', providerAlias(r));
      const region = resolveString(block?.args.region, ir) ?? resolveString(block?.args.zone, ir);
      return region ? gcpRegionOfZone(region) : undefined;
    }
    default:
      return undefined;
  }
}
