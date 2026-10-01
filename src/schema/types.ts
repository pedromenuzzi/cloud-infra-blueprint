/**
 * Trimmed provider schemas, as written by `scripts/generate-schema.ts` into
 * `src/schema/data/<provider>.json` (see ./README.md).
 *
 * The raw `terraform providers schema -json` output is ~32 MB for the three
 * providers. What ships is structural: every resource type with its attribute
 * types and flags, nested block nesting modes and bounds, and short
 * descriptions. Identical block bodies are stored once (`blocks`) and shared
 * by index — the WAFv2 statement tree and the QuickSight definitions repeat
 * the same subtrees thousands of times.
 */

/** Terraform provider source names we ship a schema for (resources in `<p>.json`, data sources in `<p>.data.json`). */
export type SchemaProvider = 'aws' | 'azurerm' | 'google';

export const SCHEMA_PROVIDERS: readonly SchemaProvider[] = ['aws', 'azurerm', 'google'];

/**
 * An attribute: `[type, flags, description?, deprecation?]`.
 *
 * - `type`: Terraform type expression, e.g. `string`, `list(string)`,
 *   `map(number)`, `object({ name = string })`
 * - `flags`: `r` required · `o` optional · `c` computed · `s` sensitive ·
 *   `d` deprecated · `w` write-only
 * - `deprecation`: the provider's deprecation note, when it has one
 */
export type AttrData = [type: string, flags: string, description?: string, deprecation?: string];

export type NestingMode = 'single' | 'list' | 'set' | 'map' | 'group';

/**
 * A nested block type: `[nesting, block, minItems, maxItems, description?, deprecation?]`
 * — `block` indexes `SchemaData.blocks`; `maxItems` 0 means unbounded. A
 * deprecated block has a `deprecation` (possibly empty) string.
 */
export type NestedData = [
  nesting: NestingMode,
  block: number,
  minItems: number,
  maxItems: number,
  description?: string,
  deprecation?: string,
];

/** A block body: its attributes and nested block types (both optional when empty). */
export interface BlockData {
  a?: Record<string, AttrData>;
  b?: Record<string, NestedData>;
}

export interface SchemaData {
  /** format version of this file */
  format: 1;
  provider: SchemaProvider;
  /**
   * `data`: a provider's data sources (`<provider>.data.json`): `resources`
   * then maps data source types (`aws_ami`) to their bodies. Absent: resources.
   */
  kind?: 'data';
  /** exact provider version the schema was read from, e.g. `6.66.0` */
  version: string;
  /** resource type → index of its body in `blocks` */
  resources: Record<string, number>;
  /** resource type → deprecation note, for deprecated resource types */
  deprecatedResources?: Record<string, string>;
  blocks: BlockData[];
}

/* ------------------------------------------------------ decoded (lookup) */

export interface SchemaAttribute {
  kind: 'attribute';
  name: string;
  /** Terraform type expression */
  type: string;
  required: boolean;
  optional: boolean;
  computed: boolean;
  sensitive: boolean;
  deprecated: boolean;
  writeOnly: boolean;
  description?: string;
  deprecation?: string;
}

export interface SchemaBlockType {
  kind: 'block';
  name: string;
  nesting: NestingMode;
  minItems: number;
  /** 0 = unbounded */
  maxItems: number;
  deprecated: boolean;
  description?: string;
  deprecation?: string;
  block: SchemaBlock;
}

export interface SchemaBlock {
  attributes: Record<string, SchemaAttribute>;
  blocks: Record<string, SchemaBlockType>;
}

export type SchemaEntry = SchemaAttribute | SchemaBlockType;
