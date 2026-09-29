/**
 * Synchronous lookups over a loaded provider schema: decode the compact file
 * format into attribute / block objects (memoized per shared block), walk
 * nested blocks, parse Terraform type expressions.
 */
import type {
  AttrData,
  BlockData,
  NestedData,
  SchemaAttribute,
  SchemaBlock,
  SchemaBlockType,
  SchemaData,
  SchemaEntry,
  SchemaProvider,
} from './types';

export class ProviderSchema {
  private readonly decoded = new Map<number, SchemaBlock>();

  constructor(readonly data: SchemaData) {}

  get provider(): SchemaProvider {
    return this.data.provider;
  }

  get version(): string {
    return this.data.version;
  }

  has(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data.resources, type);
  }

  types(): string[] {
    return Object.keys(this.data.resources);
  }

  /** the top-level body of a resource type */
  resource(type: string): SchemaBlock | undefined {
    return this.has(type) ? this.block(this.data.resources[type]) : undefined;
  }

  /** deprecation note of a resource type ('' when it has none); undefined when not deprecated */
  resourceDeprecation(type: string): string | undefined {
    return this.data.deprecatedResources?.[type];
  }

  private block(index: number): SchemaBlock {
    let block = this.decoded.get(index);
    if (block) return block;
    const raw: BlockData = this.data.blocks[index] ?? {};
    const attributes: Record<string, SchemaAttribute> = {};
    for (const [name, a] of Object.entries(raw.a ?? {})) attributes[name] = decodeAttribute(name, a);
    const blocks: Record<string, SchemaBlockType> = {};
    // children decode on first access: most lookups never go deeper than one level
    for (const [name, n] of Object.entries(raw.b ?? {})) blocks[name] = this.nested(name, n);
    block = { attributes, blocks };
    this.decoded.set(index, block);
    return block;
  }

  private nested(name: string, [nesting, index, minItems, maxItems, description, deprecation]: NestedData): SchemaBlockType {
    const self = this;
    return {
      kind: 'block',
      name,
      nesting,
      minItems,
      maxItems,
      deprecated: deprecation !== undefined,
      description: description || undefined,
      deprecation: deprecation || undefined,
      get block() {
        return self.block(index);
      },
    };
  }
}

export function decodeAttribute(name: string, [type, flags, description, deprecation]: AttrData): SchemaAttribute {
  return {
    kind: 'attribute',
    name,
    type,
    required: flags.includes('r'),
    optional: flags.includes('o'),
    computed: flags.includes('c'),
    sensitive: flags.includes('s'),
    deprecated: flags.includes('d'),
    writeOnly: flags.includes('w'),
    description: description || undefined,
    deprecation: deprecation || undefined,
  };
}

/* ------------------------------------------------------------- navigation */

export function entryOf(block: SchemaBlock, name: string): SchemaEntry | undefined {
  return Object.prototype.hasOwnProperty.call(block.attributes, name)
    ? block.attributes[name]
    : Object.prototype.hasOwnProperty.call(block.blocks, name)
      ? block.blocks[name]
      : undefined;
}

/** the block body reached by following nested block names from `root` */
export function blockAt(root: SchemaBlock, path: readonly string[]): SchemaBlock | undefined {
  let block: SchemaBlock | undefined = root;
  for (const name of path) {
    block = block && Object.prototype.hasOwnProperty.call(block.blocks, name) ? block.blocks[name].block : undefined;
    if (!block) return undefined;
  }
  return block;
}

/** can be written in configuration (not computed-only); `id` only when required */
export function isSettable(attr: SchemaAttribute): boolean {
  if (attr.name === 'id') return attr.required;
  return attr.required || attr.optional;
}

/** attributes and blocks a user writes in this block, required first, then by name */
export function settableEntries(block: SchemaBlock): SchemaEntry[] {
  const attrs = Object.values(block.attributes).filter(isSettable);
  const blocks = Object.values(block.blocks);
  return [...attrs, ...blocks].sort(
    (a, b) => Number(isRequired(b)) - Number(isRequired(a)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

export function isRequired(entry: SchemaEntry): boolean {
  return entry.kind === 'attribute' ? entry.required : entry.minItems > 0;
}

/**
 * What `aws_x.name.<attr>` can read: every top-level attribute (arguments
 * echo back too) and block — computed exports (`arn`, `id`, `endpoint`) first.
 */
export function exportedEntries(block: SchemaBlock): SchemaEntry[] {
  const rank = (e: SchemaEntry) =>
    e.kind === 'block' ? 3 : e.name === 'id' ? 0 : e.computed && !e.optional && !e.required ? 1 : 2;
  return [...Object.values(block.attributes), ...Object.values(block.blocks)].sort(
    (a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/* ------------------------------------------------------------------ types */

export type TypeNode =
  | { kind: 'string' | 'number' | 'bool' | 'any' }
  | { kind: 'list' | 'set' | 'map'; elem: TypeNode }
  | { kind: 'object'; fields: Record<string, TypeNode> }
  | { kind: 'tuple'; elems: TypeNode[] };

const ANY: TypeNode = { kind: 'any' };
const typeCache = new Map<string, TypeNode>();

/** parse a Terraform type expression (`list(object({ a = string }))`); unknown syntax → any */
export function parseType(expr: string): TypeNode {
  const cached = typeCache.get(expr);
  if (cached) return cached;
  let pos = 0;
  const ws = () => {
    while (pos < expr.length && /\s/.test(expr[pos])) pos++;
  };
  const ident = () => {
    ws();
    const m = /^[A-Za-z_][\w-]*/.exec(expr.slice(pos));
    if (!m) return '';
    pos += m[0].length;
    return m[0];
  };
  const eat = (c: string) => {
    ws();
    if (expr[pos] === c) {
      pos++;
      return true;
    }
    return false;
  };
  const node = (): TypeNode => {
    const name = ident();
    switch (name) {
      case 'string':
      case 'number':
      case 'bool':
      case 'any':
        return { kind: name };
      case 'list':
      case 'set':
      case 'map': {
        if (!eat('(')) return ANY;
        const elem = node();
        eat(')');
        return { kind: name, elem };
      }
      case 'object': {
        const fields: Record<string, TypeNode> = {};
        if (!eat('(') || !eat('{')) return ANY;
        while (!eat('}')) {
          const key = ident();
          if (!key || !eat('=')) return ANY;
          fields[key] = node();
          eat(',');
        }
        eat(')');
        return { kind: 'object', fields };
      }
      case 'tuple': {
        const elems: TypeNode[] = [];
        if (!eat('(') || !eat('[')) return ANY;
        while (!eat(']')) {
          elems.push(node());
          if (!eat(',') && expr[pos] !== ']') {
            ws();
            if (expr[pos] !== ']') return ANY;
          }
        }
        eat(')');
        return { kind: 'tuple', elems };
      }
      default:
        return ANY;
    }
  };
  const result = node();
  typeCache.set(expr, result);
  return result;
}

/** list/set of objects: SDKv2 lets these be written as repeated blocks ("attributes as blocks") */
export function acceptsBlockSyntax(type: TypeNode): boolean {
  return (type.kind === 'list' || type.kind === 'set') && type.elem.kind === 'object';
}

/* ------------------------------------------------------------ suggestions */

/** optimal string alignment distance (Levenshtein + adjacent transpositions) */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** the closest candidate, when it's close enough to be the likely intent */
export function closestName(name: string, candidates: Iterable<string>): string | undefined {
  const lower = name.toLowerCase();
  const limit = Math.max(1, Math.min(3, Math.floor(name.length / 3)));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    if (Math.abs(c.length - name.length) > limit) continue;
    const d = editDistance(lower, c.toLowerCase());
    if (d < bestDistance || (d === bestDistance && best !== undefined && c < best)) {
      best = c;
      bestDistance = d;
    }
  }
  return bestDistance <= limit ? best : undefined;
}
