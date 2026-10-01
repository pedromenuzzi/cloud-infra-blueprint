/**
 * Trim `terraform providers schema -json` output into the compact files the
 * app ships (see ./types.ts). Pure — the generator script does the I/O, the
 * unit tests feed it fixtures.
 */
import type { AttrData, BlockData, NestedData, NestingMode, SchemaData, SchemaProvider } from './types';

/* ------------------------------------------------ raw JSON (terraform ≥ 1.1) */

export interface RawAttribute {
  type?: unknown;
  nested_type?: RawNestedType;
  description?: string;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  sensitive?: boolean;
  deprecated?: boolean;
  write_only?: boolean;
}

export interface RawNestedType {
  attributes?: Record<string, RawAttribute>;
  nesting_mode?: string;
}

export interface RawBlock {
  attributes?: Record<string, RawAttribute>;
  block_types?: Record<string, RawBlockType>;
  description?: string;
  deprecated?: boolean;
}

export interface RawBlockType {
  nesting_mode: string;
  block: RawBlock;
  min_items?: number;
  max_items?: number;
}

export interface RawProviderSchema {
  resource_schemas?: Record<string, { version?: number; block: RawBlock }>;
  data_source_schemas?: Record<string, { version?: number; block: RawBlock }>;
}

export interface RawSchemas {
  format_version?: string;
  provider_schemas: Record<string, RawProviderSchema>;
}

export interface TrimOptions {
  provider: SchemaProvider;
  version: string;
  /**
   * `resources` (default) or `data`: the provider's data sources, for the
   * separate `<provider>.data.json` chunk. Data sources keep no help text
   * for the attributes they only expose (completion lists their names and
   * types; a description is only worth its bytes on what one writes).
   */
  section?: 'resources' | 'data';
  /** longest description kept (characters, before the ellipsis) */
  descriptionLength?: number;
  /** only these resource types (default: all of them) */
  include?: (type: string) => boolean;
  /**
   * keep the descriptions of this resource type (default: yes) — without,
   * it ships structure only; deprecation notes are always kept
   */
  help?: (type: string) => boolean;
}

export const DEFAULT_DESCRIPTION_LENGTH = 120;

/* ------------------------------------------------------------------ types */

/** cty JSON type (`"string"`, `["list","string"]`, `["object",{…}]`) → Terraform type expression */
export function typeExpression(type: unknown): string {
  if (typeof type === 'string') return type === 'dynamic' ? 'any' : type;
  if (!Array.isArray(type)) return 'any';
  const [kind, elem] = type as [string, unknown];
  switch (kind) {
    case 'list':
    case 'set':
    case 'map':
      return `${kind}(${typeExpression(elem)})`;
    case 'object': {
      const fields = Object.entries((elem ?? {}) as Record<string, unknown>)
        .map(([k, v]) => `${k} = ${typeExpression(v)}`)
        .join(', ');
      return fields ? `object({ ${fields} })` : 'object({})';
    }
    case 'tuple':
      return `tuple([${((elem ?? []) as unknown[]).map(typeExpression).join(', ')}])`;
    default:
      return 'any';
  }
}

/** a framework nested attribute (`nested_type`) is set with `=` like an object value */
function nestedTypeExpression(nested: RawNestedType): string {
  const fields = Object.entries(nested.attributes ?? {})
    .map(([k, a]) => `${k} = ${a.nested_type ? nestedTypeExpression(a.nested_type) : typeExpression(a.type)}`)
    .join(', ');
  const object = fields ? `object({ ${fields} })` : 'object({})';
  switch (nested.nesting_mode) {
    case 'list':
    case 'set':
    case 'map':
      return `${nested.nesting_mode}(${object})`;
    default:
      return object;
  }
}

/* ----------------------------------------------------------- descriptions */

/**
 * One short line of help: markdown links reduced to their text, the
 * "(Optional)" prefixes the docs repeat dropped, cut at a sentence end — or
 * at a word, with an ellipsis — so it fits `max` characters.
 */
export function shortDescription(text: string | undefined, max = DEFAULT_DESCRIPTION_LENGTH): string | undefined {
  if (!text) return undefined;
  let s = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\((?:Optional|Required|Computed|Deprecated)\)\s*/i, '')
    .replace(/^(?:Optional|Required|Output only)\.\s*/i, '')
    .replace(/^-\s*/, '');
  if (!s) return undefined;
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const sentence = cut.search(/[.!?](?=\s[A-Z(`'"])[^.!?]*$/);
  if (sentence >= Math.floor(max * 0.45)) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ', max);
  s = cut.slice(0, space > max * 0.5 ? space : max).replace(/[\s,;:(-]+$/, '');
  return `${s}…`;
}

/** the sentence of a description that explains the deprecation, when there is one */
export function deprecationNote(text: string | undefined, max = DEFAULT_DESCRIPTION_LENGTH): string {
  if (!text) return '';
  const flat = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  const sentences = flat.split(/(?<=[.!?])\s+/);
  const at = sentences.findIndex((s) => /deprecat|use .+ instead|removed in/i.test(s));
  if (at === -1) return '';
  // a bare "Deprecated." says little: keep the sentence that follows it too
  const note = sentences[at].length < 25 && sentences[at + 1] ? `${sentences[at]} ${sentences[at + 1]}` : sentences[at];
  return shortDescription(note, max) ?? '';
}

/* ------------------------------------------------------------------- trim */

const NESTING: Record<string, NestingMode> = { single: 'single', list: 'list', set: 'set', map: 'map', group: 'group' };

function attrFlags(a: RawAttribute): string {
  return (
    (a.required ? 'r' : '') +
    (a.optional ? 'o' : '') +
    (a.computed ? 'c' : '') +
    (a.sensitive ? 's' : '') +
    (a.deprecated ? 'd' : '') +
    (a.write_only ? 'w' : '')
  );
}

/** drop trailing `undefined`s so optional tuple slots don't serialize as `null` */
function compact<T extends unknown[]>(tuple: T): T {
  let n = tuple.length;
  while (n > 0 && tuple[n - 1] === undefined) n--;
  return tuple.slice(0, n) as T;
}

export function trimProviderSchema(raw: RawProviderSchema, options: TrimOptions): SchemaData {
  const max = options.descriptionLength ?? DEFAULT_DESCRIPTION_LENGTH;
  const blocks: BlockData[] = [];
  const index = new Map<string, number>();

  const intern = (body: BlockData): number => {
    const key = JSON.stringify(body);
    let i = index.get(key);
    if (i === undefined) {
      i = blocks.length;
      blocks.push(body);
      index.set(key, i);
    }
    return i;
  };

  const dataSources = options.section === 'data';
  let help = true;
  const trimBlock = (block: RawBlock, nested: boolean): number => {
    const body: BlockData = {};
    const attrs = Object.entries(block.attributes ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    if (attrs.length) {
      body.a = {};
      for (const [name, a] of attrs) {
        const type = a.nested_type ? nestedTypeExpression(a.nested_type) : typeExpression(a.type);
        // read-only values inside blocks are noise for editing; their help isn't worth the bytes
        const readOnly = a.computed && !a.optional && !a.required;
        const readOnlyNested = (nested || dataSources) && readOnly;
        const description = readOnlyNested || !help ? undefined : shortDescription(a.description, max);
        const note = a.deprecated ? deprecationNote(a.description, max) : '';
        body.a[name] = compact<AttrData>([type, attrFlags(a), note ? (description ?? '') : description, note || undefined]);
      }
    }
    const types = Object.entries(block.block_types ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    if (types.length) {
      body.b = {};
      for (const [name, bt] of types) {
        const child = trimBlock(bt.block, true);
        const description = help ? shortDescription(bt.block.description, max) : undefined;
        const deprecation = bt.block.deprecated ? deprecationNote(bt.block.description, max) : undefined;
        body.b[name] = compact<NestedData>([
          NESTING[bt.nesting_mode] ?? 'list',
          child,
          bt.min_items ?? 0,
          bt.max_items ?? 0,
          deprecation !== undefined ? (description ?? '') : description,
          deprecation,
        ]);
      }
    }
    return intern(body);
  };

  const resources: Record<string, number> = {};
  const deprecatedResources: Record<string, string> = {};
  const source = (dataSources ? raw.data_source_schemas : raw.resource_schemas) ?? {};
  const types = Object.keys(source)
    .filter((t) => options.include?.(t) ?? true)
    .sort();
  for (const type of types) {
    const { block } = source[type];
    help = options.help?.(type) ?? true;
    resources[type] = trimBlock(block, false);
    if (block.deprecated) deprecatedResources[type] = deprecationNote(block.description, max);
  }

  return {
    format: 1,
    provider: options.provider,
    ...(dataSources ? { kind: 'data' as const } : {}),
    version: options.version,
    resources,
    ...(Object.keys(deprecatedResources).length ? { deprecatedResources } : {}),
    blocks,
  };
}

/** `registry.terraform.io/hashicorp/aws` → the provider schema, or undefined */
export function providerEntry(raw: RawSchemas, provider: SchemaProvider): RawProviderSchema | undefined {
  return raw.provider_schemas[`registry.terraform.io/hashicorp/${provider}`];
}
