import type {
  CanvasPosition,
  Expression,
  IR,
  IREdge,
  ModuleNode,
  Provider,
  ResourceNode,
  Trivia,
} from './types.js';

/**
 * Cheap, reasonably collision-resistant id generator. Replace with `crypto.randomUUID`
 * when running in a context where it is available (browser modern + node 19+).
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${ts}-${rnd}`;
}

const emptyTrivia = (): Trivia => ({ leadingComments: [], trailingComments: [] });

export const lit = (value: string | number | boolean | null): Expression => ({
  kind: 'literal',
  value,
});

export const list = (items: Expression[]): Expression => ({ kind: 'list', items });

export const obj = (fields: Record<string, Expression>): Expression => ({
  kind: 'object',
  fields,
});

export const ref = (path: string | { type: string; name: string; attr?: string }): Expression => {
  if (typeof path === 'string') return { kind: 'ref', path };
  const attr = path.attr ?? 'id';
  return { kind: 'ref', path: `${path.type}.${path.name}.${attr}` };
};

export const raw = (hcl: string): Expression => ({ kind: 'raw', hcl });

/**
 * Convert a JS value to an Expression heuristically. Strings, numbers, booleans
 * become literals; arrays become lists; plain objects become objects.
 *
 * `undefined` / `null` arguments are stripped at the call site (see `newResource`).
 */
export function toExpr(value: unknown): Expression {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return lit(value as string | number | boolean | null);
  }
  if (Array.isArray(value)) return list(value.map(toExpr));
  if (typeof value === 'object') {
    const fields: Record<string, Expression> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      fields[k] = toExpr(v);
    }
    return obj(fields);
  }
  // Fallback to raw for unsupported types (functions, symbols).
  return raw(String(value));
}

export interface NewResourceOptions {
  position?: CanvasPosition;
  parentId?: string;
  trivia?: Partial<Trivia>;
  provider?: Provider;
}

/**
 * Build a `ResourceNode` from a Terraform type, Terraform name and a plain
 * JS object of arguments. Auto-detects provider from the type prefix
 * (`aws_*`, `azurerm_*`, `google_*`).
 */
export function newResource(
  type: string,
  name: string,
  args: Record<string, unknown>,
  options: NewResourceOptions = {},
): ResourceNode {
  const provider = options.provider ?? inferProvider(type);
  const cleanArgs: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    cleanArgs[k] = v && typeof v === 'object' && 'kind' in v ? (v as Expression) : toExpr(v);
  }
  return {
    id: newId(),
    provider,
    type,
    name,
    args: cleanArgs,
    position: options.position ?? { x: 0, y: 0 },
    parentId: options.parentId,
    trivia: { ...emptyTrivia(), ...options.trivia },
  };
}

export function newModule(
  name: string,
  source: string,
  inputs: Record<string, unknown> = {},
  options: { version?: string; position?: CanvasPosition } = {},
): ModuleNode {
  const cleanInputs: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v === undefined) continue;
    cleanInputs[k] = v && typeof v === 'object' && 'kind' in v ? (v as Expression) : toExpr(v);
  }
  return {
    id: newId(),
    name,
    source,
    version: options.version,
    inputs: cleanInputs,
    position: options.position ?? { x: 0, y: 0 },
    trivia: emptyTrivia(),
  };
}

export function edge(
  from: ResourceNode | ModuleNode | string,
  to: ResourceNode | ModuleNode | string,
  kind: IREdge['kind'] = 'reference',
  label?: string,
): IREdge {
  return {
    id: newId(),
    fromNodeId: typeof from === 'string' ? from : from.id,
    toNodeId: typeof to === 'string' ? to : to.id,
    kind,
    label,
  };
}

export function emptyIR(): IR {
  return {
    version: 1,
    providers: {},
    variables: {},
    outputs: {},
    modules: [],
    resources: [],
    edges: [],
  };
}

export function inferProvider(type: string): Provider {
  if (type.startsWith('aws_')) return 'aws';
  if (type.startsWith('azurerm_') || type.startsWith('azuread_')) return 'azure';
  if (type.startsWith('google_')) return 'gcp';
  if (type.startsWith('kubernetes_') || type.startsWith('helm_')) return 'kubernetes';
  if (type.startsWith('random_')) return 'random';
  if (type.startsWith('tls_')) return 'tls';
  return 'aws';
}
