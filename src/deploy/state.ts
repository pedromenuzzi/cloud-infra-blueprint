/**
 * A `terraform.tfstate` (format version 4), checked strictly like a plan.
 * A state holds secrets (passwords, keys, the values of sensitive
 * variables): it's read into this tab's memory only, never stored, never
 * sent, and what it marks sensitive (or names like a secret) is masked
 * until someone asks to see it.
 */
import { indexSuffix, isObject, nodeIdFor, pathKey, SECRET_NAME, type JsonObject, type PathStep } from './json';

export interface StateInstance {
  key?: string | number;
  /** `aws_subnet.public[0]`, `module.net.aws_vpc.this` */
  address: string;
  attributes: JsonObject;
  /** paths of the attributes to mask (see isSensitivePath) */
  sensitive: string[];
}

export interface StateResource {
  /** without an instance key: `aws_subnet.public`, `module.net.aws_vpc.this` */
  address: string;
  node: string;
  mode: 'managed' | 'data';
  type: string;
  name: string;
  module?: string;
  instances: StateInstance[];
}

export interface ParsedState {
  terraformVersion?: string;
  serial?: number;
  lineage?: string;
  resources: StateResource[];
  outputs: string[];
}

export type StateError =
  | { code: 'not-object' | 'not-a-state' | 'plan-not-state' | 'state-json' | 'too-many' }
  | { code: 'version'; version: string }
  | { code: 'bad-resource'; index: number };

export type StateParse = { ok: true; state: ParsedState } | { ok: false; error: StateError };

/** resource instances past this aren't something one reads on a canvas */
export const MAX_INSTANCES = 100_000;

const str = (v: unknown, max = 1024): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);

/** `[[{type:'get_attr',value:'password'}]]` → `password`; unknown shapes are skipped (names still mask by SECRET_NAME) */
function sensitivePaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const path of raw) {
    const steps = (Array.isArray(path) ? path : [path]).map((s): PathStep | null => {
      if (!isObject(s)) return null;
      if (s.type === 'get_attr' && typeof s.value === 'string') return s.value;
      if (s.type === 'index') {
        const v = isObject(s.value) ? s.value.value : s.value;
        return typeof v === 'string' || typeof v === 'number' ? v : null;
      }
      return null;
    });
    if (steps.length > 0 && steps.every((s) => s !== null)) out.push(pathKey(steps as PathStep[]));
  }
  return out;
}

/** Is the value at `path` (or what holds it) a secret: marked sensitive by Terraform, or named like one? */
export function isSensitivePath(instance: StateInstance, path: string): boolean {
  if (instance.sensitive.some((p) => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`))) return true;
  return path.split(/[.[\]"]+/).some((step) => SECRET_NAME.test(step));
}

/** Read a parsed `terraform.tfstate`. */
export function parseState(value: unknown): StateParse {
  if (!isObject(value)) return { ok: false, error: { code: 'not-object' } };
  if ('resource_changes' in value || 'planned_values' in value) return { ok: false, error: { code: 'plan-not-state' } };
  if ('values' in value && 'format_version' in value) return { ok: false, error: { code: 'state-json' } };
  if (!('version' in value)) return { ok: false, error: { code: 'not-a-state' } };
  if (value.version !== 4) return { ok: false, error: { code: 'version', version: String(value.version).slice(0, 8) } };
  const raw = value.resources ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: { code: 'not-a-state' } };
  const resources: StateResource[] = [];
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const bad = { ok: false as const, error: { code: 'bad-resource' as const, index: i } };
    if (!isObject(r)) return bad;
    const type = str(r.type, 256);
    const name = str(r.name, 256);
    const mode = r.mode === 'managed' || r.mode === 'data' ? r.mode : null;
    const module = r.module === undefined ? undefined : str(r.module);
    if (!type || !name || !mode || (r.module !== undefined && !module?.startsWith('module.')) || !Array.isArray(r.instances)) return bad;
    const base = `${module ? `${module}.` : ''}${mode === 'data' ? 'data.' : ''}${type}.${name}`;
    const instances: StateInstance[] = [];
    for (const inst of r.instances) {
      if (!isObject(inst) || !isObject(inst.attributes)) return bad;
      const key = typeof inst.index_key === 'string' || typeof inst.index_key === 'number' ? inst.index_key : undefined;
      if (inst.index_key !== undefined && key === undefined) return bad;
      // a `create_before_destroy` leftover isn't the current object
      if (typeof inst.deposed === 'string') continue;
      instances.push({ key, address: `${base}${indexSuffix(key)}`, attributes: inst.attributes, sensitive: sensitivePaths(inst.sensitive_attributes) });
    }
    count += instances.length;
    if (count > MAX_INSTANCES) return { ok: false, error: { code: 'too-many' } };
    resources.push({ address: base, node: nodeIdFor({ mode, type, name, module }), mode, type, name, module, instances });
  }
  return {
    ok: true,
    state: {
      terraformVersion: str(value.terraform_version, 32),
      serial: typeof value.serial === 'number' ? value.serial : undefined,
      lineage: str(value.lineage, 64),
      resources,
      outputs: isObject(value.outputs) ? Object.keys(value.outputs) : [],
    },
  };
}

/** canvas node → its managed resources in the state */
export function stateByNode(state: ParsedState): Map<string, StateResource[]> {
  const out = new Map<string, StateResource[]>();
  for (const r of state.resources) {
    if (r.mode !== 'managed' || r.instances.length === 0) continue;
    const list = out.get(r.node) ?? [];
    list.push(r);
    out.set(r.node, list);
  }
  return out;
}
