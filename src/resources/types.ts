import type { Locale } from '@/i18n/locale';
import type { ContainmentRule } from '@/ir/graph';
import type { Expression, Provider } from '@/ir/types';

export type FieldType = 'string' | 'number' | 'boolean' | 'select' | 'tags' | 'list';

export interface FieldDef {
  name: string;
  label?: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  doc?: string;
  /** resource types this field usually references — inspector offers a picker */
  refTo?: string[];
  /** attribute used when referencing (default `id`) */
  refAttr?: string;
  /** number fields: smallest / largest accepted value (inclusive) */
  min?: number;
  max?: number;
}

export type Category =
  | 'compute'
  | 'storage'
  | 'network'
  | 'database'
  | 'containers'
  | 'integration'
  | 'identity'
  | 'edge';

export const CATEGORY_ORDER: Category[] = [
  'compute',
  'storage',
  'network',
  'database',
  'containers',
  'integration',
  'identity',
  'edge',
];

/** English source text — show `categoryLabel()` (./i18n.ts) to people */
export const CATEGORY_LABELS: Record<Category, string> = {
  compute: 'Compute',
  storage: 'Storage',
  network: 'Network',
  database: 'Database',
  containers: 'Containers',
  integration: 'Messaging & APIs',
  identity: 'Security & Identity',
  edge: 'Edge & DNS',
};

/** What happens when the user draws an edge from this resource to a target. */
export interface ConnectionRule {
  targetTypes: string[];
  arg: string;
  attr: string;
  mode: 'set' | 'append';
}

/** A connection whose argument lives inside a nested block, e.g. EKS `vpc_config { subnet_ids }`. */
export interface BlockConnectionRule extends ConnectionRule {
  /** the nested block (from the def's defaults) that holds `arg` */
  block: string;
}

/** How the cloud-side name is derived from the Terraform label (see ./naming.ts). */
export interface NamingRule {
  /**
   * `hyphen` (default): lowercase letters, digits and hyphens ·
   * `alnum`: lowercase letters and digits only ·
   * `underscore`: letters, digits and underscores ·
   * `dns`: a fully-qualified record name, `<label>.<domain>`
   */
  style?: 'hyphen' | 'alnum' | 'underscore' | 'dns';
  maxLength?: number;
  minLength?: number;
  /** `dns` style: the zone the name lives in (default `example.com.`) */
  domain?: string;
}

/**
 * A catalog entry. `displayName`, `shortName`, `description` and the fields'
 * `label` / `doc` are the English source text: screens show them through
 * ./i18n.ts (`resourceName`, `fieldHelp`…), which reads the Portuguese from
 * ./catalog.messages.ts. `T` is the literal type, so that table can require
 * an entry for every one.
 */
export interface ResourceDef<T extends string = string> {
  type: T;
  provider: Provider;
  category: Category;
  displayName: string;
  /** short title shown on the canvas node (e.g. "EC2") */
  shortName: string;
  description?: string;
  fields: FieldDef[];
  defaults?: Record<string, Expression>;
  /** argument prefilled with the Terraform resource name on creation (default `name`) */
  nameArg?: string;
  /** rules for the cloud-side name written into `nameArg` */
  naming?: NamingRule;
  /**
   * arguments copied by reference from the container the resource is dropped
   * into, when that container has the same argument — an Azure resource
   * dropped in a service plan takes its `location` and `resource_group_name`
   * (a resource group itself hands down `location`)
   */
  inherit?: string[];
  /**
   * subnets: the argument holding the range (a list for Azure) and the
   * container's argument with the network range — a new subnet takes the next
   * free /24 of its network instead of overlapping a sibling
   */
  subnetCidr?: { arg: string; parentArg: string };
  /** renders as a dashed group that other nodes can live inside */
  container?: boolean;
  containment?: ContainmentRule[];
  connections?: ConnectionRule[];
  /** connections into nested blocks — applied with `connectionOp` (./connect.ts) */
  blockConnections?: BlockConnectionRule[];
  /** the canvas node's second line, in `locale` (default: the UI language in effect) */
  subtitle?: (args: Record<string, Expression>, locale?: Locale) => string | undefined;
}

export function defineResource<const T extends string>(def: ResourceDef<T>): ResourceDef<T> {
  return def;
}
