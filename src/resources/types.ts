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
}

export type Category =
  | 'compute'
  | 'storage'
  | 'network'
  | 'database'
  | 'containers'
  | 'identity'
  | 'edge';

export const CATEGORY_ORDER: Category[] = [
  'compute',
  'storage',
  'network',
  'database',
  'containers',
  'identity',
  'edge',
];

export const CATEGORY_LABELS: Record<Category, string> = {
  compute: 'Compute',
  storage: 'Storage',
  network: 'Network',
  database: 'Database',
  containers: 'Containers',
  identity: 'Identity',
  edge: 'Edge & DNS',
};

/** What happens when the user draws an edge from this resource to a target. */
export interface ConnectionRule {
  targetTypes: string[];
  arg: string;
  attr: string;
  mode: 'set' | 'append';
}

export interface ResourceDef {
  type: string;
  provider: Provider;
  category: Category;
  displayName: string;
  /** short title shown on the canvas node (e.g. "EC2") */
  shortName: string;
  description?: string;
  fields: FieldDef[];
  defaults?: Record<string, Expression>;
  /** renders as a dashed group that other nodes can live inside */
  container?: boolean;
  containment?: ContainmentRule[];
  connections?: ConnectionRule[];
  subtitle?: (args: Record<string, Expression>) => string | undefined;
}

export function defineResource(def: ResourceDef): ResourceDef {
  return def;
}
