/**
 * A real `terraform show -json tfplan`, checked strictly (it's a file from
 * outside: every field the viewer reads is checked before it's used) and
 * read into what the canvas and the plan panel draw: one change per resource
 * instance, its canvas node, its attribute diff, and the risky ones.
 */
import { getDef } from '@/resources/registry';
import { indexSuffix, isObject, nodeIdFor, pathKey, SECRET_NAME, type Json, type JsonObject, type PathStep } from './json';

export type ChangeAction = 'create' | 'update' | 'replace' | 'delete' | 'read' | 'no-op' | 'forget';

export interface PlanChange {
  address: string;
  /** the canvas node it's drawn on (see nodeIdFor) */
  node: string;
  mode: 'managed' | 'data';
  type: string;
  name: string;
  index?: string | number;
  /** `module.net`, `module.net[0].module.sub` */
  module?: string;
  action: ChangeAction;
  /** a replacement that creates the new one before destroying the old (`create_before_destroy`) */
  createFirst: boolean;
  /** Terraform's `action_reason` (`replace_because_cannot_update`, `delete_because_no_resource_config`…) */
  reason?: string;
  /** the attributes that force the replacement */
  replacePaths: string[];
  /** brought under management by an `import` block (its id, when the plan says) */
  importing?: string;
  /** moved here from this address (a `moved` block) */
  previousAddress?: string;
  before: Json;
  after: Json;
  afterUnknown: Json;
  beforeSensitive: Json;
  afterSensitive: Json;
}

export interface RealPlan {
  terraformVersion?: string;
  changes: PlanChange[];
  /** outputs that change, with their action */
  outputs: Array<{ name: string; action: ChangeAction }>;
  /** Terraform hit errors while planning: what's here is only part of it */
  errored: boolean;
  /** false when the plan needs another one after it is applied (deferred changes, unknown `count`) */
  complete: boolean;
}

export type PlanError =
  | { code: 'not-object' | 'not-a-plan' | 'state-not-plan' | 'state-json-not-plan' | 'too-many' }
  | { code: 'format'; version: string }
  | { code: 'bad-change'; index: number };

export type PlanParse = { ok: true; plan: RealPlan } | { ok: false; error: PlanError };

/** more changes than this is not something one reads on a canvas */
export const MAX_CHANGES = 50_000;

const ACTIONS: Record<string, ChangeAction> = {
  create: 'create',
  update: 'update',
  'delete,create': 'replace',
  'create,delete': 'replace',
  delete: 'delete',
  read: 'read',
  'no-op': 'no-op',
  forget: 'forget',
};

const str = (v: unknown, max = 4096): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);
const json = (v: unknown): Json => (v === undefined ? null : (v as Json));

function readChange(raw: unknown): PlanChange | null {
  if (!isObject(raw) || !isObject(raw.change)) return null;
  const address = str(raw.address);
  const type = str(raw.type, 256);
  const name = str(raw.name, 256);
  const mode = raw.mode === 'data' ? 'data' : raw.mode === 'managed' || raw.mode === undefined ? 'managed' : null;
  const actions = raw.change.actions;
  if (!address || !type || !name || !mode || !Array.isArray(actions) || !actions.every((a) => typeof a === 'string')) return null;
  const action = ACTIONS[actions.join(',')];
  if (!action) return null;
  const index = typeof raw.index === 'string' || typeof raw.index === 'number' ? raw.index : undefined;
  const module = str(raw.module_address) ?? (address.startsWith('module.') ? /^(module\.[^.[]+(?:\[[^\]]*\])?(?:\.module\.[^.[]+(?:\[[^\]]*\])?)*)\./.exec(address)?.[1] : undefined);
  const paths = Array.isArray(raw.change.replace_paths) ? raw.change.replace_paths : [];
  const importing = isObject(raw.change.importing) ? (str(raw.change.importing.id) ?? '') : undefined;
  return {
    address,
    node: nodeIdFor({ mode, type, name, module }),
    mode,
    type,
    name,
    index,
    module,
    action,
    createFirst: actions[0] === 'create' && actions.length === 2,
    reason: str(raw.action_reason, 128),
    replacePaths: paths.filter((p): p is PathStep[] => Array.isArray(p) && p.every((s) => typeof s === 'string' || typeof s === 'number')).map(pathKey),
    importing,
    previousAddress: str(raw.previous_address),
    before: json(raw.change.before),
    after: json(raw.change.after),
    afterUnknown: json(raw.change.after_unknown),
    beforeSensitive: json(raw.change.before_sensitive),
    afterSensitive: json(raw.change.after_sensitive),
  };
}

/** Read the parsed JSON of `terraform show -json <planfile>`. */
export function parsePlan(value: unknown): PlanParse {
  if (!isObject(value)) return { ok: false, error: { code: 'not-object' } };
  if (!('resource_changes' in value) && !('planned_values' in value)) {
    if ('version' in value && 'resources' in value) return { ok: false, error: { code: 'state-not-plan' } };
    if ('values' in value && 'format_version' in value) return { ok: false, error: { code: 'state-json-not-plan' } };
    return { ok: false, error: { code: 'not-a-plan' } };
  }
  const format = typeof value.format_version === 'string' ? value.format_version : '';
  if (!/^1\.\d+$/.test(format)) return { ok: false, error: { code: 'format', version: format.slice(0, 16) } };
  const raw = value.resource_changes ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: { code: 'not-a-plan' } };
  if (raw.length > MAX_CHANGES) return { ok: false, error: { code: 'too-many' } };
  const changes: PlanChange[] = [];
  for (let i = 0; i < raw.length; i++) {
    const change = readChange(raw[i]);
    if (!change) return { ok: false, error: { code: 'bad-change', index: i } };
    changes.push(change);
  }
  const outputs: RealPlan['outputs'] = [];
  if (isObject(value.output_changes)) {
    for (const [name, c] of Object.entries(value.output_changes)) {
      const action = isObject(c) && Array.isArray(c.actions) ? ACTIONS[c.actions.join(',')] : undefined;
      if (action && action !== 'no-op') outputs.push({ name, action });
    }
  }
  return {
    ok: true,
    plan: {
      terraformVersion: str(value.terraform_version, 32),
      changes,
      outputs,
      errored: value.errored === true,
      complete: value.complete !== false,
    },
  };
}

/* ------------------------------------------------------------- summary */

export interface PlanCounts {
  create: number;
  update: number;
  replace: number;
  delete: number;
  imports: number;
  moved: number;
  /** Terraform's own "Plan: X to add, Y to change, Z to destroy." (a replacement counts in both) */
  add: number;
  change: number;
  destroy: number;
}

export function planCounts(changes: PlanChange[]): PlanCounts {
  const c: PlanCounts = { create: 0, update: 0, replace: 0, delete: 0, imports: 0, moved: 0, add: 0, change: 0, destroy: 0 };
  for (const x of changes) {
    if (x.mode !== 'managed') continue;
    if (x.action === 'create' || x.action === 'update' || x.action === 'replace' || x.action === 'delete') c[x.action]++;
    if (x.importing !== undefined) c.imports++;
    if (x.previousAddress) c.moved++;
  }
  c.add = c.create + c.replace;
  c.change = c.update;
  c.destroy = c.delete + c.replace;
  return c;
}

/** a change worth reading (a no-op only when it imports or moves something; reads are lookups) */
export const isNoteworthy = (c: PlanChange) =>
  c.mode === 'managed' && (c.action !== 'no-op' || c.importing !== undefined || c.previousAddress !== undefined);

// things that keep data: losing one loses what's in it
const STATEFUL =
  /(_db_|_rds_|database|_sql|dynamodb|_s3_bucket$|storage_(bucket|account|blob|share)|_ebs_volume|_volume$|_disk$|efs_file_system|elasticache|redis|memcache|redshift|docdb|neptune|opensearch|elasticsearch|_kms_key|key_vault$|secretsmanager_secret$|cosmosdb|bigtable|spanner|firestore|filestore|_backup_vault|_ecr_repository|_container_registry$|artifact_registry_repository)/;

/** Does destroying a resource of this type lose data? */
export function isStateful(type: string): boolean {
  const category = getDef(type)?.category;
  return category === 'database' || STATEFUL.test(type) || (category === 'storage' && !/policy|versioning|encryption|public_access|lifecycle|notification|cors|website|ownership|acl|logging/.test(type));
}

/** destroys and replacements of things that keep data: the plan's real risk */
export const riskyChanges = (changes: PlanChange[]) =>
  changes.filter((c) => c.mode === 'managed' && (c.action === 'delete' || c.action === 'replace') && isStateful(c.type));

type Drawn = 'create' | 'update' | 'replace' | 'delete';
const RANK: Record<Drawn, number> = { create: 0, update: 1, delete: 2, replace: 3 };

/**
 * What the canvas draws (the learning terminal's plan marks): per node, its
 * strongest change and how many of its instances change; the destroys whose
 * node isn't in `declared` (the code's node ids) listed apart.
 */
export function planMarks(changes: PlanChange[], declared: Set<string>): { nodes: Record<string, { action: Drawn; count: number }>; gone: string[] } {
  const nodes: Record<string, { action: Drawn; count: number }> = {};
  const gone: string[] = [];
  for (const c of changes) {
    if (c.mode !== 'managed' || !(c.action in RANK)) continue;
    const action = c.action as Drawn;
    if (!declared.has(c.node)) {
      if (action === 'delete') gone.push(c.address);
      continue;
    }
    const was = nodes[c.node];
    nodes[c.node] = { action: was && RANK[was.action] > RANK[action] ? was.action : action, count: (was?.count ?? 0) + 1 };
  }
  return { nodes, gone };
}

/* ------------------------------------------------------------- the diff */

export type DiffValue = { kind: 'value'; text: string } | { kind: 'unknown' } | { kind: 'sensitive' };

export interface DiffRow {
  path: string;
  before?: DiffValue;
  after?: DiffValue;
  status: 'added' | 'removed' | 'changed' | 'same';
  /** changing it is what forces the replacement */
  forces: boolean;
}

/** past this many rows a diff is cut (an attribute map can be huge) */
export const MAX_DIFF_ROWS = 400;

const isScalar = (v: unknown) => v === null || typeof v !== 'object';
const child = (mask: Json, key: string | number): Json => (Array.isArray(mask) || isObject(mask) ? ((mask as Record<string, Json>)[key] ?? null) : null);
const hasTrue = (mask: Json): boolean => mask === true || (Array.isArray(mask) ? mask.some(hasTrue) : isObject(mask) ? Object.values(mask).some(hasTrue) : false);

export function formatValue(v: Json): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
  if (isObject(v)) return `{${Object.entries(v).map(([k, x]) => ` ${k} = ${formatValue(x)}`).join(',')} }`;
  return String(v);
}

/** path → value of one side of a change, nulls left out (Terraform hides them too) */
function flatten(value: Json, unknown: Json, sensitive: Json, steps: PathStep[], out: Map<string, DiffValue>) {
  const key = pathKey(steps);
  const last = steps[steps.length - 1];
  // named like a secret: masked even when the provider didn't mark it
  if (sensitive === true || (typeof last === 'string' && SECRET_NAME.test(last) && typeof value === 'string')) {
    if (value !== null) out.set(key, { kind: 'sensitive' });
    return;
  }
  if (unknown === true) {
    out.set(key, { kind: 'unknown' });
    return;
  }
  if (Array.isArray(value) || (Array.isArray(unknown) && value === null)) {
    const items = (value ?? []) as Json[];
    if (items.every(isScalar) && !hasTrue(unknown) && !hasTrue(sensitive)) {
      if (value !== null) out.set(key, { kind: 'value', text: formatValue(items) });
      return;
    }
    const length = Math.max(items.length, Array.isArray(unknown) ? unknown.length : 0);
    for (let i = 0; i < length; i++) flatten(items[i] ?? null, child(unknown, i), child(sensitive, i), [...steps, i], out);
    return;
  }
  if (isObject(value) || (isObject(unknown) && value === null)) {
    const object = (value ?? {}) as JsonObject;
    const keys = new Set([...Object.keys(object), ...(isObject(unknown) ? Object.keys(unknown) : [])]);
    if (keys.size === 0 && steps.length > 0 && value !== null) out.set(key, { kind: 'value', text: '{}' });
    for (const k of [...keys].sort()) flatten(object[k] ?? null, child(unknown, k), child(sensitive, k), [...steps, k], out);
    return;
  }
  if (value !== null && steps.length > 0) out.set(key, { kind: 'value', text: formatValue(value) });
}

const same = (a: DiffValue, b: DiffValue) => a.kind === b.kind && (a.kind !== 'value' || a.text === (b as { text: string }).text);

/**
 * The change's attributes, before → after. A sensitive value is never in a
 * row (only that it is one, and whether it changed); an unknown one says
 * so. `truncated` when it had more than MAX_DIFF_ROWS.
 */
export function diffRows(change: PlanChange): { rows: DiffRow[]; truncated: boolean } {
  const before = new Map<string, DiffValue>();
  const after = new Map<string, DiffValue>();
  flatten(change.before, null, change.beforeSensitive, [], before);
  if (change.action !== 'delete') flatten(change.after, change.afterUnknown, change.afterSensitive, [], after);
  const rows: DiffRow[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path);
    const a = after.get(path);
    let status: DiffRow['status'] = !b ? 'added' : !a ? 'removed' : same(a, b) ? 'same' : 'changed';
    // sensitive on both sides: compare what's underneath, without ever showing it
    if (status === 'same' && a?.kind === 'sensitive') status = sensitiveChanged(change, path) ? 'changed' : 'same';
    const forces = change.replacePaths.some((p) => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`));
    rows.push({ path, before: b, after: a, status, forces });
  }
  // what changed first, in path order; forced ones on top
  const order = { changed: 0, added: 1, removed: 2, same: 3 };
  rows.sort((x, y) => Number(y.forces) - Number(x.forces) || order[x.status] - order[y.status] || x.path.localeCompare(y.path));
  return { rows: rows.slice(0, MAX_DIFF_ROWS), truncated: rows.length > MAX_DIFF_ROWS };
}

/** does the value under `path` differ between before and after (both sensitive, so neither is shown)? */
function sensitiveChanged(change: PlanChange, path: string): boolean {
  const pick = (root: Json): Json => {
    let v: Json = root;
    for (const m of path.matchAll(/([A-Za-z_][\w-]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/g)) {
      const key: string | number = m[1] ?? (m[2] !== undefined ? Number(m[2]) : JSON.parse(m[3]!));
      v = child(v, key);
    }
    return v;
  };
  return JSON.stringify(pick(change.before)) !== JSON.stringify(pick(change.after));
}

/** `aws_subnet.public[0]`, for a change read from parts (tests, the sample plan) */
export const changeAddress = (c: { mode?: string; type: string; name: string; index?: string | number; module?: string }) =>
  `${c.module ? `${c.module}.` : ''}${c.mode === 'data' ? 'data.' : ''}${c.type}.${c.name}${indexSuffix(c.index)}`;
