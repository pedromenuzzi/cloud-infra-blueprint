/**
 * A Terraform CLI that runs in the browser: `init`, `validate`, `plan`,
 * `apply` and `destroy` over a lesson's files and the simulated state of
 * its last apply. Nothing reaches a cloud: ids, ARNs and IPs are made up
 * (deterministically, ./catalog.ts), and what an apply would compute is
 * `(known after apply)` until it "runs".
 *
 * The plan is a real diff of the configuration against the state: create,
 * update in place, replace (when an argument that forces it changes, or
 * depends on a replaced resource's new id), destroy; `count` and `for_each`
 * expanded to instance addresses; local modules planned resource by
 * resource (`module.net.aws_vpc.this`), Registry ones left out with a note.
 * Pure: the same files and state always print the same thing.
 */
import { lineColOf, parseFile, parseProject } from '@/hcl/parser';
import { collectRefs, refTargetAddress, scanTraversals } from '@/ir/expr';
import { moduleTarget } from '@/ir/localModules';
import { instanceAddress, localValue, repeatOf } from '@/ir/repeat';
import type { Expression, IR, ModuleNode, ResourceNode, Trivia } from '@/ir/types';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { constraintAllows } from '@/schema/versions';
import type { Files, PlanSummary, SimCommand, SimState } from '../types';
import { computedOf, createSeconds, forcesNew, makeAttr, makeId, readData, type Fake } from './catalog';
import { evaluate, evaluateRecord, hasUnknown, instanceEnv, isObject, Opaque, UNKNOWN, type Scope, type Val } from './eval';
import {
  changeLines,
  decode,
  line,
  outputChangeLines,
  outputValueLines,
  problemLines,
  serialize,
  type ChangeAction,
  type Line,
  type OutputChange,
  type Problem,
  type ResourceChange,
} from './render';

export type { Line, Tone } from './render';

export interface SimContext {
  /** `terraform init` ran for these providers and modules (see `initFingerprint`) */
  initialized: boolean;
  /** `-auto-approve`: apply and destroy don't stop to ask */
  autoApprove?: boolean;
}

export interface SimResult {
  ok: boolean;
  lines: Line[];
  /** what apply and destroy leave behind (destroy: null); undefined when the state didn't change */
  state?: SimState | null;
  /** the resource changes plan, apply and destroy worked out */
  plan?: PlanSummary;
  /** apply / destroy without `-auto-approve`: the index of the `Enter a value: yes` line (Terraform asks there) */
  confirmAt?: number;
}

const REGION = 'us-east-1';
const META = new Set(['count', 'for_each', 'depends_on', 'provider', 'lifecycle', 'provisioner', 'connection']);
const MODULE_META = new Set(['source', 'version', 'count', 'for_each', 'depends_on', 'providers']);
const RESOURCE_ROOT = /^(aws|azurerm|azuread|google|random|null|tls|local|time|archive|http|kubernetes|helm)_/;

/* ------------------------------------------------------------------ providers */

/** provider releases the simulated registry offers, newest first */
const RELEASES: Record<string, string[]> = {
  'hashicorp/aws': ['6.66.0', '5.100.0', '4.67.0', '3.76.1'],
  'hashicorp/azurerm': ['5.7.0', '4.40.0', '3.117.1'],
  'hashicorp/azuread': ['3.5.0', '2.53.1'],
  'hashicorp/google': ['8.4.0', '7.12.0', '6.50.0', '5.45.2'],
  'hashicorp/random': ['3.7.2', '2.3.1'],
  'hashicorp/null': ['3.2.4'],
  'hashicorp/tls': ['4.1.0', '3.4.0'],
  'hashicorp/local': ['2.5.3'],
  'hashicorp/time': ['0.13.1'],
  'hashicorp/archive': ['2.7.1'],
  'hashicorp/http': ['3.5.0'],
  'hashicorp/kubernetes': ['2.38.0'],
  'hashicorp/helm': ['3.0.2'],
};

export interface ProviderReq {
  /** the name the configuration uses (`aws`) */
  local: string;
  /** `hashicorp/aws` */
  source: string;
  constraint?: string;
}

const tfFiles = (files: Files): Files => Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith('.tf')));

/** the providers a configuration needs: `required_providers`, provider blocks, and the prefixes of its types */
export function requiredProviders(files: Files): ProviderReq[] {
  const { ir } = parseProject(tfFiles(files));
  const out = new Map<string, ProviderReq>();
  for (const extra of ir.extras) {
    const at = extra.text.search(/\brequired_providers\s*\{/);
    if (at === -1) continue;
    const body = /\{([\s\S]*)/.exec(extra.text.slice(at))?.[1] ?? '';
    for (const m of body.matchAll(/(?:^|\s)([A-Za-z][\w-]*)\s*=\s*(\{[^{}]*\}|"[^"]*")/g)) {
      const [, local, value] = m;
      const source = (/\bsource\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? `hashicorp/${local}`).replace(/^registry\.terraform\.io\//, '');
      const constraint = value.startsWith('"') ? value.slice(1, -1) : /\bversion\s*=\s*"([^"]+)"/.exec(value)?.[1];
      out.set(local, { local, source: source.includes('/') ? source : `hashicorp/${source}`, constraint });
    }
  }
  const implied = (local: string) => {
    if (!out.has(local)) out.set(local, { local, source: `hashicorp/${local}` });
  };
  for (const p of ir.providers) implied(p.name);
  const types = (x: IR) => [...x.resources, ...x.data].map((r) => r.type.split('_')[0]);
  for (const t of types(ir)) implied(t);
  for (const m of ir.modules) {
    const target = moduleTarget(files, m);
    if (target.kind === 'local' && target.module) for (const t of types(target.module.ir)) implied(t);
  }
  return [...out.values()].sort((a, b) => a.source.localeCompare(b.source));
}

/** what `init` installs: when it changes (a provider added, a version constraint, a module), Terraform asks for `init` again */
export function initFingerprint(files: Files): string {
  const { ir } = parseProject(tfFiles(files));
  return JSON.stringify([
    requiredProviders(files).map((p) => [p.source, p.constraint ?? '']),
    ir.modules.map((m) => [m.name, exprString(m.args.source)]),
  ]);
}

const exprString = (e: Expression | undefined) => (e?.kind === 'literal' ? String(e.value) : '');

/* ------------------------------------------------------------------ diagnostics */

/** where a problem is: the argument's line (else the block header), the block, the source line */
function at(files: Files, node: { trivia: Trivia }, field?: string, offset?: number): Pick<Problem, 'file' | 'line' | 'block' | 'source'> {
  const file = node.trivia.sourceFile ?? 'main.tf';
  const spans = node.trivia.spans;
  const text = files[file] ?? '';
  if (!spans) return { file };
  const entry = field === undefined ? undefined : spans.body.entries.find((e) => e.key === field);
  const lineNo = offset !== undefined ? lineColOf(text, offset).line : (entry?.line ?? spans.line);
  const lines = text.split('\n');
  return {
    file,
    line: lineNo,
    block: lines[spans.line - 1]?.replace(/\s*\{.*$/, '').trim(),
    source: lines[lineNo - 1] ?? '',
  };
}

/**
 * What `terraform validate` finds: parse errors, references to things
 * that aren't declared, required arguments left out (errors); and, with
 * `warnings`, the editor's own validation warnings.
 */
function diagnose(files: Files, ir: IR, parseDiagnostics: ReturnType<typeof parseProject>['diagnostics'], warnings: boolean): Problem[] {
  const out: Problem[] = [];
  for (const d of parseDiagnostics) {
    const source = d.start ? (files[d.file] ?? '').split('\n')[d.start.line - 1] : undefined;
    out.push({ severity: d.severity, summary: d.message, file: d.file, line: d.start?.line, source });
  }
  if (out.some((p) => p.severity === 'error')) return out;

  const vars = new Set(ir.variables.map((v) => v.name));
  const data = new Set(ir.data.map((d) => d.id));
  const modules = new Set(ir.modules.map((m) => m.name));
  const resources = new Set(ir.resources.map((r) => r.id));
  const types = new Set(ir.resources.map((r) => r.type));
  const seen = new Set<string>();
  const blocks = [...ir.resources, ...ir.data, ...ir.modules, ...ir.outputs, ...ir.providers, ...ir.extras.filter((x) => /^\s*locals\s*\{/.test(x.text))];
  for (const b of blocks) {
    const text = b.trivia.sourceText;
    const start = b.trivia.rawTextRange?.start;
    if (text === undefined || start === undefined) continue;
    for (const t of scanTraversals(text)) {
      const [root, second, third] = t.path.split('.').map((s) => s.replace(/\[.*$/, ''));
      let problem: Pick<Problem, 'summary' | 'detail'> | undefined;
      if (root === 'var' && !vars.has(second)) {
        problem = {
          summary: 'Reference to undeclared input variable',
          detail: `An input variable with the name "${second}" has not been declared. This variable can be\ndeclared with a variable "${second}" {} block.`,
        };
      } else if (root === 'local' && !localValue(ir, second)) {
        problem = { summary: 'Reference to undeclared local value', detail: `A local value with the name "${second}" has not been declared.` };
      } else if (root === 'module' && !modules.has(second)) {
        problem = { summary: 'Reference to undeclared module', detail: `No module call named "${second}" is declared in the root module.` };
      } else if (root === 'data' && third !== undefined && !data.has(`data.${second}.${third}`)) {
        problem = { summary: 'Reference to undeclared resource', detail: `A data resource "${second}" "${third}" has not been declared in the root module.` };
      } else if ((RESOURCE_ROOT.test(root) || types.has(root)) && second !== undefined && !resources.has(`${root}.${second}`)) {
        problem = { summary: 'Reference to undeclared resource', detail: `A managed resource "${root}" "${second}" has not been declared in the root module.` };
      }
      if (!problem) continue;
      const where = at(files, b, undefined, start + t.start);
      const key = `${where.file}:${where.line}:${t.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ severity: 'error', ...problem, ...where });
    }
  }
  for (const r of ir.resources) {
    for (const field of getDef(r.type)?.fields ?? []) {
      if (!field.required || r.args[field.name] !== undefined) continue;
      out.push({
        severity: 'error',
        summary: 'Missing required argument',
        detail: `The argument "${field.name}" is required, but no definition was found.`,
        ...at(files, r),
      });
    }
  }
  if (warnings) {
    const errorLines = new Set(out.map((p) => `${p.file}:${p.line}`));
    for (const d of validateProject(ir, getDef)) {
      if (d.severity !== 'warning' || errorLines.has(`${d.file}:${d.start?.line}`)) continue;
      const source = d.start ? (files[d.file] ?? '').split('\n')[d.start.line - 1] : undefined;
      out.push({ severity: 'warning', summary: d.message, file: d.file, line: d.start?.line, source });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ the walk */

interface Engine {
  files: Files;
  previous: SimState | null;
  /** the apply pass: ids and computed attributes are made */
  apply: boolean;
  /** the serial this apply writes: the seed of the ids it makes */
  gen: number;
  /** the apply pass follows the plan's actions */
  actions?: Map<string, ChangeAction>;
  /** every instance planned, in the order it was reached (dependencies first) */
  changes: ResourceChange[];
  /** each instance's values: its arguments and attributes */
  values: Map<string, Record<string, Val>>;
  reads: Line[];
  notes: Line[];
  problems: Problem[];
  regions: Map<string, string>;
}

interface Mod {
  /** `''`, `module.net.`, `module.net[0].` */
  prefix: string;
  ir: IR;
  /** its folder (`''`: the root module) */
  dir: string;
  vars: Map<string, Val>;
  locals: Map<string, Val>;
  /** `aws_vpc.main`, `data.aws_ami.x`, `module.net` → its value (an instance, or a list / map of them) */
  blocks: Map<string, Val>;
  /** attributes read from each block anywhere in the module: `aws_vpc.main` → {id, arn} */
  reads: Map<string, Set<string>>;
}

function scopeOf(mod: Mod, eng: Engine): Scope {
  const declared = (key: string, list: Array<{ id: string }>) => mod.blocks.get(key) ?? (list.some((x) => x.id === key) ? UNKNOWN : undefined);
  const scope: Scope = {
    ref(root, name) {
      switch (root) {
        case 'var':
          return mod.vars.get(name);
        case 'local': {
          if (mod.locals.has(name)) return mod.locals.get(name);
          const e = localValue(mod.ir, name);
          if (!e) return undefined;
          mod.locals.set(name, UNKNOWN); // a local that reads itself stays unknown
          const v = evaluate(e, scope);
          mod.locals.set(name, v);
          return v;
        }
        case 'path':
          return name === 'module' ? mod.dir || '.' : name === 'root' || name === 'cwd' ? '.' : undefined;
        case 'terraform':
          return name === 'workspace' ? 'default' : undefined;
        case 'data':
          return declared(`data.${name}`, mod.ir.data);
        case 'module':
          return declared(`module.${name}`, mod.ir.modules);
        default:
          return declared(`${root}.${name}`, mod.ir.resources);
      }
    },
    file: (path) => eng.files[mod.dir ? `${mod.dir}/${path}` : path],
  };
  return scope;
}

/** the block a reference points at: `aws_vpc.main`, `data.aws_ami.x`, `module.net` */
function blockKey(path: string): string | null {
  const segs = path.split('.').map((s) => s.replace(/\[.*$/, ''));
  if (segs[0] === 'data') return segs.length >= 3 ? `data.${segs[1]}.${segs[2]}` : null;
  if (segs[0] === 'module') return segs.length >= 2 ? `module.${segs[1]}` : null;
  return refTargetAddress(path);
}

/** the blocks `args` depend on, through `local.x` values too */
function depsOf(args: Record<string, Expression>, ir: IR, seen = new Set<string>()): Set<string> {
  const refs: Array<{ field: string; path: string }> = [];
  for (const e of Object.values(args)) collectRefs(e, '', refs);
  const out = new Set<string>();
  for (const { path } of refs) {
    const key = blockKey(path);
    if (key) out.add(key);
    const local = /^local\.([A-Za-z_][\w-]*)/.exec(path)?.[1];
    if (local && !seen.has(local)) {
      seen.add(local);
      const e = localValue(ir, local);
      if (e) for (const k of depsOf({ v: e }, ir, seen)) out.add(k);
    }
  }
  return out;
}

/** the attributes the module reads from each of its blocks (`aws_vpc.main.arn` → arn) */
function readsOf(ir: IR): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const note = (path: string) => {
    const key = blockKey(path);
    // the path goes on from the block's address: `[0].id`, `.arn`
    const attr = key && path.startsWith(key) ? /^(?:\[[^\]]*\])*\.([A-Za-z_][\w-]*)/.exec(path.slice(key.length))?.[1] : undefined;
    if (!key || !attr) return;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(attr);
  };
  for (const b of [...ir.resources, ...ir.data, ...ir.modules, ...ir.outputs]) {
    const refs: Array<{ field: string; path: string }> = [];
    for (const e of Object.values(b.args)) collectRefs(e, '', refs);
    refs.forEach((r) => note(r.path));
  }
  for (const x of ir.extras) if (/^\s*locals\s*\{/.test(x.text)) scanTraversals(x.text).forEach((t) => note(t.path));
  return out;
}

interface Lifecycle {
  createFirst: boolean;
  preventDestroy: boolean;
  /** argument names whose changes are ignored (`all`: every one) */
  ignore: Set<string> | 'all';
}

function lifecycleOf(r: ResourceNode): Lifecycle {
  const body = r.args.lifecycle?.kind === 'block' ? r.args.lifecycle.body : {};
  const flag = (e: Expression | undefined) => e?.kind === 'literal' && e.value === true;
  const ignore = body.ignore_changes;
  return {
    createFirst: flag(body.create_before_destroy),
    preventDestroy: flag(body.prevent_destroy),
    ignore:
      ignore?.kind === 'raw' && ignore.hcl.trim() === 'all'
        ? 'all'
        : new Set(ignore?.kind === 'list' ? ignore.items.map((i) => (i.kind === 'ref' ? i.path : i.kind === 'literal' ? String(i.value) : '')) : []),
  };
}

interface Instance {
  /** the full address (`module.net.aws_subnet.a[0]`) */
  address: string;
  env: Map<string, Val>;
  key?: string | number;
}

/** a block's instances (`count`, `for_each`), or null when how many can't be known now */
function expand(node: { id: string; args: Record<string, Expression>; trivia: Trivia }, mod: Mod, eng: Engine): { instances: Instance[]; kind?: 'count' | 'for_each' } | null {
  const scope = scopeOf(mod, eng);
  const fail = (meta: 'count' | 'for_each', unknown: boolean) => {
    const detail = unknown
      ? meta === 'count'
        ? 'The "count" value depends on resource attributes that cannot be determined until apply,\nso Terraform cannot predict how many instances will be created.'
        : 'The "for_each" map includes keys derived from resource attributes that cannot be\ndetermined until apply, and so Terraform cannot determine the full set of keys that\nwill identify the instances of this resource.'
      : `The given "${meta}" argument value is unsuitable: ${meta === 'count' ? 'a whole number is required' : 'the "for_each" argument must be a map, or set of strings'}.`;
    eng.problems.push({ severity: 'error', summary: `Invalid ${meta} argument`, detail, ...at(eng.files, node, meta) });
    return null;
  };
  if (node.args.count) {
    let n = evaluate(node.args.count, scope);
    if (n instanceof Opaque) n = repeatOf(node, mod.ir)?.size ?? n;
    if (n === UNKNOWN) return fail('count', true);
    const count = typeof n === 'number' ? n : typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : NaN;
    if (!Number.isInteger(count) || count < 0) return fail('count', false);
    return {
      kind: 'count',
      instances: Array.from({ length: count }, (_, i) => ({ address: mod.prefix + instanceAddress(node.id, 'count', i), env: instanceEnv(i), key: i })),
    };
  }
  if (node.args.for_each) {
    const v = evaluate(node.args.for_each, scope);
    if (v === UNKNOWN) return fail('for_each', true);
    let pairs: Array<[string, Val]>;
    if (isObject(v)) pairs = Object.keys(v).map((k) => [k, v[k]]);
    // ponytail: a list is taken as a set of strings; real Terraform wants `toset()` around it
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || x === UNKNOWN)) {
      if (v.includes(UNKNOWN)) return fail('for_each', true);
      pairs = [...new Set(v as string[])].map((k) => [k, k]);
    } else return fail('for_each', false);
    pairs.sort(([a], [b]) => a.localeCompare(b));
    return {
      kind: 'for_each',
      instances: pairs.map(([key, value]) => ({ address: mod.prefix + instanceAddress(node.id, 'for_each', key), env: instanceEnv(undefined, { key, value }), key })),
    };
  }
  return { instances: [{ address: mod.prefix + node.id, env: new Map() }] };
}

/** the value a repeated block stands for: a list (`count`) or a map (`for_each`) of its instances */
function gather(kind: 'count' | 'for_each' | undefined, values: Array<[string | number | undefined, Val]>): Val {
  if (kind === 'count') return values.map(([, v]) => v);
  if (kind === 'for_each') return Object.fromEntries(values.map(([k, v]) => [String(k), v]));
  return values[0]?.[1] ?? null;
}

const nonNull = (record: Record<string, Val>) => Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null));

function findById(eng: Engine, id: string): Record<string, Val> | undefined {
  for (const v of eng.values.values()) if (v.id === id) return v;
  return undefined;
}

function regionOf(eng: Engine, r: ResourceNode, config: Record<string, Val>): string {
  if (typeof config.location === 'string') return config.location;
  const alias = r.args.provider?.kind === 'ref' ? r.args.provider.path.split('.')[1] : undefined;
  return eng.regions.get(alias ?? '') ?? eng.regions.get('') ?? REGION;
}

function visitResource(eng: Engine, mod: Mod, r: ResourceNode) {
  const expanded = expand(r, mod, eng);
  if (!expanded) return void mod.blocks.set(r.id, UNKNOWN);
  const scope = scopeOf(mod, eng);
  const life = lifecycleOf(r);
  const args = Object.fromEntries(Object.entries(r.args).filter(([k]) => !META.has(k)));
  const blocks = new Set(Object.entries(args).filter(([, e]) => e.kind === 'block' || e.kind === 'blocks').map(([k]) => k));
  const values: Array<[string | number | undefined, Val]> = [];
  for (const inst of expanded.instances) {
    const config = nonNull(evaluateRecord(args, scope, inst.env));
    const prev = eng.previous?.resources[inst.address];
    const computed = [...new Set(['id', ...computedOf(r.type), ...(mod.reads.get(r.id) ?? [])])].filter((k) => !(k in config));
    // arguments left out that the provider keeps (they're computed, or the ones that would force a replacement)
    const kept = Object.keys(prev ?? {}).filter((k) => !(k in config) && (computed.includes(k) || forcesNew(r.type, k)));
    let action: ChangeAction;
    let forced = new Set<string>();
    if (eng.actions) action = eng.actions.get(inst.address) ?? 'create';
    else if (!prev) action = 'create';
    else {
      const ignored = (k: string) => life.ignore === 'all' || life.ignore.has(k);
      const changed = Object.entries(config)
        .filter(([k, v]) => !ignored(k) && (hasUnknown(v) || prev[k] !== serialize(v)))
        .map(([k]) => k);
      for (const k of Object.keys(prev)) if (!(k in config) && !kept.includes(k) && !ignored(k)) changed.push(k);
      forced = new Set(changed.filter((k) => k in config && forcesNew(r.type, k)));
      action = forced.size > 0 ? 'replace' : changed.length > 0 ? 'update' : 'noop';
      if (action === 'replace' && life.preventDestroy) {
        eng.problems.push({
          severity: 'error',
          summary: 'Instance cannot be destroyed',
          detail: `Resource ${inst.address} has lifecycle.prevent_destroy set, but the plan calls for this\nresource to be destroyed. To avoid this error and continue with the plan, either disable\nlifecycle.prevent_destroy or reduce the scope of the plan using the -target flag.`,
          ...at(eng.files, r),
        });
      }
    }
    const fresh = action === 'create' || action === 'replace';
    const value: Record<string, Val> = {};
    const fake: Omit<Fake, 'id'> = {
      type: r.type,
      name: r.name,
      seed: `${inst.address}@${eng.gen}`,
      config,
      region: regionOf(eng, r, config),
      byId: (id) => findById(eng, id),
    };
    const id = eng.apply && fresh ? makeId(fake) : undefined;
    for (const k of [...computed, ...kept]) {
      if (!fresh && prev?.[k] !== undefined) value[k] = decode(prev[k]);
      else if (!eng.apply) value[k] = UNKNOWN;
      else value[k] = k === 'id' ? (id ?? makeId(fake)) : makeAttr(k, { ...fake, id: id ?? String(value.id ?? prev?.id ?? '') });
    }
    Object.assign(value, config);
    eng.values.set(inst.address, value);
    eng.changes.push({
      address: inst.address,
      type: r.type,
      name: r.name,
      action,
      before: prev,
      after: value,
      blocks,
      forced,
      createFirst: life.createFirst,
    });
    values.push([inst.key, value]);
  }
  mod.blocks.set(r.id, gather(expanded.kind, values));
}

function visitData(eng: Engine, mod: Mod, d: IR['data'][number]) {
  const expanded = expand(d, mod, eng);
  if (!expanded) return void mod.blocks.set(d.id, UNKNOWN);
  const scope = scopeOf(mod, eng);
  const args = Object.fromEntries(Object.entries(d.args).filter(([k]) => !META.has(k)));
  const values: Array<[string | number | undefined, Val]> = [];
  for (const inst of expanded.instances) {
    const config = nonNull(evaluateRecord(args, scope, inst.env));
    const reads = mod.reads.get(d.id) ?? new Set<string>();
    let value: Record<string, Val>;
    if (hasUnknown(config)) {
      // it reads something an apply creates: Terraform reads it during the apply
      value = { ...config, id: UNKNOWN, ...Object.fromEntries([...reads].filter((k) => !(k in config)).map((k) => [k, UNKNOWN])) };
    } else {
      const region = typeof config.region === 'string' ? config.region : (eng.regions.get('') ?? REGION);
      value = { ...config, ...readData(d.type, { type: d.type, name: d.name, seed: inst.address, config, region, byId: (id) => findById(eng, id) }, reads) };
      if (!eng.apply) {
        eng.reads.push(line(`${inst.address}: Reading...`, undefined, true), line(`${inst.address}: Read complete after 0s [id=${String(value.id)}]`));
      }
    }
    values.push([inst.key, value]);
  }
  mod.blocks.set(d.id, gather(expanded.kind, values));
}

function visitModule(eng: Engine, mod: Mod, m: ModuleNode) {
  const target = moduleTarget(eng.files, m);
  const source = exprString(m.args.source);
  // a module that (through others) calls itself stops here
  if (mod.prefix.split('module.').length > 8) return void mod.blocks.set(m.id, UNKNOWN);
  if (target.kind !== 'local' || !target.module || target.module.broken) {
    if (!eng.apply) {
      const why = target.kind === 'remote' ? 'its code is downloaded by a real "terraform init"' : `the folder of "${source}" isn't in this project`;
      eng.notes.push(line(`  # ${mod.prefix}${m.id}: not simulated (${why}), so its resources are left out of this plan.`, 'muted'));
    }
    return void mod.blocks.set(m.id, UNKNOWN);
  }
  const child = target.module;
  const expanded = expand(m, mod, eng);
  if (!expanded) return void mod.blocks.set(m.id, UNKNOWN);
  const scope = scopeOf(mod, eng);
  const inputs = Object.fromEntries(Object.entries(m.args).filter(([k]) => !MODULE_META.has(k)));
  const values: Array<[string | number | undefined, Val]> = [];
  for (const inst of expanded.instances) {
    const given = evaluateRecord(inputs, scope, inst.env);
    const vars = new Map<string, Val>();
    const none: Scope = { ref: () => undefined };
    for (const v of child.ir.variables) {
      if (v.name in given) vars.set(v.name, given[v.name]);
      else if (v.args.default) vars.set(v.name, evaluate(v.args.default, none));
      else {
        vars.set(v.name, UNKNOWN);
        if (!eng.apply) {
          eng.problems.push({
            severity: 'error',
            summary: 'Missing required argument',
            detail: `The argument "${v.name}" is required, but no definition was found.`,
            ...at(eng.files, m),
          });
        }
      }
    }
    const inner: Mod = { prefix: `${inst.address}.`, ir: child.ir, dir: target.dir, vars, locals: new Map(), blocks: new Map(), reads: readsOf(child.ir) };
    walk(eng, inner);
    const innerScope = scopeOf(inner, eng);
    values.push([inst.key, Object.fromEntries(child.ir.outputs.map((o) => [o.name, o.args.value ? evaluate(o.args.value, innerScope) : null]))]);
  }
  mod.blocks.set(m.id, gather(expanded.kind, values));
}

/** every block of a module, dependencies first */
function walk(eng: Engine, mod: Mod) {
  type Item = { key: string; visit: () => void; deps: Set<string> };
  const items: Item[] = [
    ...mod.ir.resources.map((r) => ({ key: r.id, visit: () => visitResource(eng, mod, r), deps: depsOf(r.args, mod.ir) })),
    ...mod.ir.data.map((d) => ({ key: d.id, visit: () => visitData(eng, mod, d), deps: depsOf(d.args, mod.ir) })),
    ...mod.ir.modules.map((m) => ({ key: m.id, visit: () => visitModule(eng, mod, m), deps: depsOf(m.args, mod.ir) })),
  ];
  const keys = new Set(items.map((i) => i.key));
  const done = new Set<string>();
  let pending = items;
  while (pending.length > 0) {
    const ready = pending.filter((i) => [...i.deps].every((d) => d === i.key || !keys.has(d) || done.has(d)));
    if (ready.length === 0) {
      if (!eng.apply) eng.problems.push({ severity: 'error', summary: `Cycle: ${pending.map((i) => mod.prefix + i.key).join(', ')}` });
      ready.push(...pending);
    }
    for (const item of ready) {
      item.visit();
      done.add(item.key);
    }
    pending = pending.filter((i) => !done.has(i.key));
  }
}

/* ------------------------------------------------------------------ plan */

interface Planned {
  problems: Problem[];
  /** instances in dependency order, deletes included (last) */
  changes: ResourceChange[];
  outputs: OutputChange[];
  /** each root output's value, for the Outputs section */
  outputValues: Map<string, { value: Val; sensitive: boolean }>;
  values: Map<string, Record<string, Val>>;
  reads: Line[];
  notes: Line[];
}

/** tfvars files: `terraform.tfvars` and `*.auto.tfvars` */
function tfvars(files: Files): Record<string, Val> {
  const out: Record<string, Val> = {};
  const none: Scope = { ref: () => undefined };
  for (const [file, text] of Object.entries(files)) {
    if (file.includes('/') || !(file === 'terraform.tfvars' || file.endsWith('.auto.tfvars'))) continue;
    const [block] = parseFile(file, `output "tfvars" {\n${text}\n}\n`).blocks;
    if (block?.kind === 'labeled') Object.assign(out, evaluateRecord(block.args, none));
  }
  return out;
}

function run(files: Files, previous: SimState | null, actions?: Map<string, ChangeAction>): Planned {
  const parsed = parseProject(tfFiles(files));
  const { ir } = parsed;
  const problems = diagnose(files, ir, parsed.diagnostics, false).filter((p) => p.severity === 'error');
  const eng: Engine = {
    files,
    previous,
    apply: actions !== undefined,
    gen: (previous?.serial ?? 0) + 1,
    actions,
    changes: [],
    values: new Map(),
    reads: [],
    notes: [],
    problems,
    regions: new Map(),
  };
  if (problems.length > 0) return { problems, changes: [], outputs: [], outputValues: new Map(), values: eng.values, reads: [], notes: [] };

  const given = tfvars(files);
  const vars = new Map<string, Val>();
  const none: Scope = { ref: () => undefined };
  for (const v of ir.variables) {
    if (v.name in given) vars.set(v.name, given[v.name]);
    else if (v.args.default) vars.set(v.name, evaluate(v.args.default, none));
    else {
      vars.set(v.name, UNKNOWN);
      problems.push({
        severity: 'error',
        summary: 'No value for required variable',
        detail: `The root module input variable "${v.name}" is not set, and has no default value. Use a\n-var or -var-file command line argument to provide a value for this variable.`,
        ...at(files, v),
      });
    }
  }
  const root: Mod = { prefix: '', ir, dir: '', vars, locals: new Map(), blocks: new Map(), reads: readsOf(ir) };
  const scope = scopeOf(root, eng);
  for (const p of ir.providers) {
    const region = p.args.region ? evaluate(p.args.region, scope) : undefined;
    const alias = p.args.alias ? evaluate(p.args.alias, scope) : '';
    if (typeof region === 'string' && typeof alias === 'string') eng.regions.set(alias, region);
  }
  walk(eng, root);

  // what the state holds that the configuration doesn't any more
  const planned = new Set(eng.changes.map((c) => c.address));
  const declared = new Set(ir.resources.map((r) => r.id));
  for (const [address, before] of Object.entries(previous?.resources ?? {})) {
    if (planned.has(address)) continue;
    const base = address.replace(/\[[^\]]*\]$/, '');
    const key = /\[([^\]]*)\]$/.exec(address)?.[1];
    const [type, name] = base.split('.').slice(-2);
    const because =
      key !== undefined && declared.has(base)
        ? /^\d+$/.test(key)
          ? `index [${key}] is out of range for count`
          : `key [${key}] is not in for_each map`
        : `${/^module\./.test(address) ? address.split('.').slice(0, 2).join('.') : base} is not in configuration`;
    eng.changes.push({ address, type, name, action: 'delete', before, blocks: new Set(), because });
  }

  // root outputs
  const outputValues = new Map<string, { value: Val; sensitive: boolean }>();
  const outputs: OutputChange[] = [];
  for (const o of ir.outputs) {
    const value = o.args.value ? evaluate(o.args.value, scope) : null;
    const sensitive = o.args.sensitive?.kind === 'literal' && o.args.sensitive.value === true;
    outputValues.set(o.name, { value, sensitive });
    const before = previous?.outputs[o.name];
    if (before === undefined || hasUnknown(value) || before !== serialize(value)) outputs.push({ name: o.name, before, after: value, sensitive });
  }
  for (const [name, before] of Object.entries(previous?.outputs ?? {})) {
    if (!outputValues.has(name)) outputs.push({ name, before });
  }
  outputs.sort((a, b) => a.name.localeCompare(b.name));
  return { problems, changes: eng.changes, outputs, outputValues, values: eng.values, reads: eng.reads, notes: eng.notes };
}

const byAddress = (a: { address: string }, b: { address: string }) => a.address.localeCompare(b.address, 'en', { numeric: true });

/** the changes as the canvas and the lesson read them */
function summary(changes: ResourceChange[]): PlanSummary {
  const real = changes.filter((c) => c.action !== 'noop').sort(byAddress);
  const text = (v: Val | undefined) => (v === undefined || v === null || v === UNKNOWN || v instanceof Opaque ? null : serialize(v));
  return {
    changes: real.map((c) => {
      const before = c.before ?? {};
      const after = c.after ?? {};
      const keys = c.action === 'delete' ? Object.keys(before) : Object.keys(after).filter((k) => c.action === 'create' || before[k] !== text(after[k]));
      return {
        address: c.address,
        action: c.action as PlanSummary['changes'][number]['action'],
        attributes: Object.fromEntries(keys.sort().map((k) => [k, [before[k] ?? null, c.action === 'delete' ? null : text(after[k])]])),
      };
    }),
    add: real.filter((c) => c.action === 'create' || c.action === 'replace').length,
    change: real.filter((c) => c.action === 'update').length,
    destroy: real.filter((c) => c.action === 'delete' || c.action === 'replace').length,
  };
}

const LEGEND: Record<string, Line> = {
  create: line('  + create', 'add'),
  update: line('  ~ update in-place', 'change'),
  delete: line('  - destroy', 'destroy'),
  replace: line('-/+ destroy and then create replacement', 'replace'),
  createFirst: line('+/- create replacement and then destroy', 'replace'),
};

/** the plan as Terraform prints it, from the refresh to the summary (and the output changes) */
function planLines(p: Planned, previous: SimState | null): { lines: Line[]; empty: boolean } {
  const out: Line[] = [];
  for (const [address, attrs] of Object.entries(previous?.resources ?? {})) {
    out.push(line(`${address}: Refreshing state... [id=${attrs.id ?? ''}]`, undefined, true));
  }
  out.push(...p.reads);
  if (out.length > 0) out.push(line());
  const real = p.changes.filter((c) => c.action !== 'noop').sort(byAddress);
  if (real.length === 0 && p.outputs.length === 0) {
    out.push(
      line('No changes. Your infrastructure matches the configuration.', 'success'),
      line(),
      line('Terraform has compared your real infrastructure against your configuration'),
      line('and found no differences, so no changes are needed.'),
    );
    if (p.notes.length > 0) out.push(line(), ...p.notes);
    return { lines: out, empty: true };
  }
  if (real.length > 0) {
    out.push(
      line('Terraform used the selected providers to generate the following execution'),
      line('plan. Resource actions are indicated with the following symbols:'),
    );
    const used = new Set(real.map((c) => (c.action === 'replace' && c.createFirst ? 'createFirst' : c.action)));
    for (const k of ['create', 'update', 'delete', 'replace', 'createFirst'] as const) if (used.has(k)) out.push(LEGEND[k]);
    out.push(line(), line('Terraform will perform the following actions:'), line());
    for (const c of real) out.push(...changeLines(c));
    if (p.notes.length > 0) out.push(...p.notes, line());
    const s = summary(p.changes);
    out.push(line(`Plan: ${s.add} to add, ${s.change} to change, ${s.destroy} to destroy.`, 'strong'));
  } else if (p.notes.length > 0) out.push(...p.notes, line());
  if (p.outputs.length > 0) {
    if (real.length > 0) out.push(line());
    out.push(line('Changes to Outputs:'), ...outputChangeLines(p.outputs));
    if (real.length === 0) {
      out.push(
        line(),
        line('You can apply this plan to save these new output values to the Terraform'),
        line('state, without changing any real infrastructure.'),
      );
    }
  }
  return { lines: out, empty: false };
}

const RULE = '─'.repeat(77);

/** Go's duration format, as Terraform prints elapsed times: `9s`, `1m35s` */
const duration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`);

function confirmLines(destroying: boolean): Line[] {
  return destroying
    ? [
        line(),
        line('Do you really want to destroy all resources?', 'strong'),
        line('  Terraform will destroy all your managed infrastructure, as shown above.'),
        line('  There is no undo. Only \'yes\' will be accepted to confirm.'),
        line(),
        line('  Enter a value: yes', 'strong'),
      ]
    : [
        line(),
        line('Do you want to perform these actions?', 'strong'),
        line('  Terraform will perform the actions described above.'),
        line('  Only \'yes\' will be accepted to approve.'),
        line(),
        line('  Enter a value: yes', 'strong'),
      ];
}

function destroyLines(address: string, id: string, type: string, deposed?: string): Line[] {
  const who = deposed ? `${address} (deposed object ${deposed})` : address;
  return [line(`${who}: Destroying... [id=${id}]`, undefined, true), line(`${who}: Destruction complete after ${duration(Math.max(1, Math.round(createSeconds(type) / 2)))}`)];
}

function createLines(address: string, id: string, type: string): Line[] {
  const seconds = createSeconds(type);
  const out = [line(`${address}: Creating...`, undefined, true)];
  for (let s = 10; s < seconds; s += 10) out.push(line(`${address}: Still creating... [${duration(s)} elapsed]`, undefined, true));
  out.push(line(`${address}: Creation complete after ${duration(seconds)} [id=${id}]`));
  return out;
}

function outputsSection(values: Planned['outputValues']): Line[] {
  if (values.size === 0) return [];
  const out = [line(), line('Outputs:', 'success'), line()];
  for (const name of [...values.keys()].sort()) {
    const { value, sensitive } = values.get(name)!;
    out.push(...outputValueLines(name, value, sensitive));
  }
  return out;
}

/* ------------------------------------------------------------------ commands */

function notInitialized(files: Files, command: SimCommand): SimResult {
  const sources = requiredProviders(files).map((p) => p.source);
  const detail =
    command === 'validate'
      ? `This configuration requires provider registry.terraform.io/${sources[0] ?? 'hashicorp/aws'}, but that provider\nisn't available. You may be able to install it automatically by running:\n  terraform init`
      : [
          'The following dependency selections recorded in the lock file are inconsistent with the',
          'current configuration:',
          ...sources.map((s) => `  - provider registry.terraform.io/${s}: required by this configuration but no version is selected`),
          '',
          'To make the initial dependency selections that will initialize the dependency lock file, run:',
          '  terraform init',
        ].join('\n');
  return {
    ok: false,
    lines: problemLines({ severity: 'error', summary: command === 'validate' ? 'Missing required provider' : 'Inconsistent dependency lock file', detail }),
  };
}

function init(files: Files, initialized: boolean): SimResult {
  const parsed = parseProject(tfFiles(files));
  const out: Line[] = [line('Initializing the backend...', 'strong')];
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (Object.keys(tfFiles(files)).length === 0 || Object.values(tfFiles(files)).every((t) => t.trim() === '')) {
    return {
      ok: true,
      lines: [
        line('Terraform initialized in an empty directory!', 'success'),
        line(),
        line('The directory has no Terraform configuration files. You may begin working'),
        line('with Terraform immediately by creating Terraform configuration files.'),
      ],
    };
  }
  if (errors.length > 0) {
    out.push(
      line('Terraform encountered problems during initialisation, including problems', 'error'),
      line('with the configuration, described below.', 'error'),
      line(),
      line('The Terraform configuration must be valid before initialization so that'),
      line('Terraform can determine which modules and providers need to be installed.'),
    );
    for (const p of diagnose(files, parsed.ir, errors, false)) out.push(...problemLines(p));
    return { ok: false, lines: out };
  }
  if (parsed.ir.modules.length > 0) {
    out.push(line('Initializing modules...', 'strong'));
    for (const m of parsed.ir.modules) {
      const target = moduleTarget(files, m);
      const source = exprString(m.args.source);
      if (target.kind === 'local') out.push(line(`- ${m.name} in ${target.dir}`));
      else {
        const version = exprString(m.args.version);
        out.push(line(`Downloading registry.terraform.io/${source}${version ? ` ${version.replace(/^[~>=<! ]+/, '')}` : ''} for ${m.name}...`, undefined, true), line(`- ${m.name} in .terraform/modules/${m.name}`));
      }
    }
  }
  out.push(line('Initializing provider plugins...', 'strong'));
  for (const p of requiredProviders(files)) {
    const releases = RELEASES[p.source];
    const version = releases?.find((v) => !p.constraint || constraintAllows(p.constraint, v));
    if (!version) {
      out.push(
        ...problemLines({
          severity: 'error',
          summary: 'Failed to query available provider packages',
          detail: releases
            ? `Could not retrieve the list of available versions for provider ${p.source}: no available\nreleases match the given constraints ${p.constraint}`
            : `Could not retrieve the list of available versions for provider ${p.source}: provider\nregistry.terraform.io/${p.source} was not found in any of the search locations`,
        }),
      );
      return { ok: false, lines: out };
    }
    if (initialized) {
      out.push(line(`- Reusing previous version of ${p.source} from the dependency lock file`), line(`- Using previously-installed ${p.source} v${version}`));
    } else {
      out.push(
        line(p.constraint ? `- Finding ${p.source} versions matching "${p.constraint}"...` : `- Finding latest version of ${p.source}...`, undefined, true),
        line(`- Installing ${p.source} v${version}...`, undefined, true),
        line(`- Installed ${p.source} v${version} (signed by HashiCorp)`),
      );
    }
  }
  if (!initialized) {
    out.push(
      line('Terraform has created a lock file .terraform.lock.hcl to record the provider'),
      line('selections it made above. Include this file in your version control repository'),
      line('so that Terraform can guarantee to make the same selections by default when'),
      line('you run "terraform init" in the future.'),
    );
  }
  out.push(
    line(),
    line('Terraform has been successfully initialized!', 'success'),
    line(),
    line('You may now begin working with Terraform. Try running "terraform plan" to see'),
    line('any changes that are required for your infrastructure. All Terraform commands'),
    line('should now work.'),
    line(),
    line('If you ever set or change modules or backend configuration for Terraform,'),
    line('rerun this command to reinitialize your working directory. If you forget, other'),
    line('commands will detect it and remind you to do so if necessary.'),
  );
  return { ok: true, lines: out };
}

function validate(files: Files): SimResult {
  const parsed = parseProject(tfFiles(files));
  const problems = diagnose(files, parsed.ir, parsed.diagnostics, true);
  const out = problems.flatMap(problemLines);
  const failed = problems.some((p) => p.severity === 'error');
  if (failed) return { ok: false, lines: out };
  if (problems.length > 0) {
    out.push(line(), line('Success! The configuration is valid, but there were some', 'success'), line('validation warnings as shown above.', 'success'));
  } else out.push(line('Success! The configuration is valid.', 'success'));
  return { ok: true, lines: out };
}

function plan(files: Files, previous: SimState | null): SimResult {
  const p = run(files, previous);
  if (p.problems.length > 0) return { ok: false, lines: p.problems.flatMap(problemLines) };
  const { lines, empty } = planLines(p, previous);
  if (!empty) {
    lines.push(
      line(),
      line(RULE, 'muted'),
      line(),
      line('Note: You didn\'t use the -out option to save this plan, so Terraform can\'t', 'muted'),
      line('guarantee to take exactly these actions if you run "terraform apply" now.', 'muted'),
    );
  }
  return { ok: true, lines, plan: summary(p.changes) };
}

function apply(files: Files, previous: SimState | null, autoApprove: boolean): SimResult {
  const p = run(files, previous);
  if (p.problems.length > 0) return { ok: false, lines: p.problems.flatMap(problemLines) };
  const { lines, empty } = planLines(p, previous);
  let confirmAt: number | undefined;
  if (!empty && !autoApprove) {
    lines.push(...confirmLines(false));
    confirmAt = lines.length - 1;
  }
  if (!empty) lines.push(line());

  // the apply itself: the plan's actions, with ids made as each instance is created
  const actions = new Map(p.changes.map((c) => [c.address, c.action]));
  const done = run(files, previous, actions);
  const old = previous?.resources ?? {};
  const deletes = p.changes.filter((c) => c.action === 'delete');
  const replaced = p.changes.filter((c) => c.action === 'replace');
  for (const c of [...deletes].reverse()) lines.push(...destroyLines(c.address, old[c.address].id ?? '', c.type));
  for (const c of [...replaced].reverse()) if (!c.createFirst) lines.push(...destroyLines(c.address, old[c.address].id ?? '', c.type));
  for (const c of done.changes) {
    const id = String(c.after?.id ?? '');
    if (c.action === 'create' || c.action === 'replace') lines.push(...createLines(c.address, id, c.type));
    else if (c.action === 'update') {
      lines.push(line(`${c.address}: Modifying... [id=${id}]`, undefined, true), line(`${c.address}: Modifications complete after 1s [id=${id}]`));
    }
  }
  for (const c of replaced) if (c.createFirst) lines.push(...destroyLines(c.address, old[c.address].id ?? '', c.type, hashShort(c.address)));

  const s = summary(p.changes);
  lines.push(line());
  lines.push(line(`Apply complete! Resources: ${s.add} added, ${s.change} changed, ${s.destroy} destroyed.`, 'success'));
  lines.push(...outputsSection(done.outputValues));

  const resources: SimState['resources'] = {};
  for (const c of done.changes) {
    if (c.action === 'delete' || !c.after) continue;
    resources[c.address] = Object.fromEntries(Object.entries(c.after).map(([k, v]) => [k, serialize(v)]));
  }
  const outputs = Object.fromEntries([...done.outputValues].map(([k, { value }]) => [k, serialize(value)]));
  const changed = !empty;
  const state: SimState = { serial: changed ? (previous?.serial ?? 0) + 1 : (previous?.serial ?? 1), resources, outputs };
  return { ok: true, lines, state, plan: s, confirmAt };
}

const hashShort = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').slice(0, 8);

function destroy(files: Files, previous: SimState | null, autoApprove: boolean): SimResult {
  const parsed = parseProject(tfFiles(files));
  const problems = diagnose(files, parsed.ir, parsed.diagnostics, false).filter((p) => p.severity === 'error');
  if (problems.length > 0) return { ok: false, lines: problems.flatMap(problemLines) };
  const entries = Object.entries(previous?.resources ?? {});
  if (entries.length === 0) {
    return {
      ok: true,
      state: null,
      plan: { changes: [], add: 0, change: 0, destroy: 0 },
      lines: [
        line('No changes. No objects need to be destroyed.', 'success'),
        line(),
        line('Either you have not created any objects yet or the existing objects were'),
        line('already deleted outside of Terraform.'),
        line(),
        line('Destroy complete! Resources: 0 destroyed.', 'success'),
      ],
    };
  }
  for (const r of parsed.ir.resources) {
    if (!lifecycleOf(r).preventDestroy) continue;
    const held = entries.find(([a]) => a === r.id || a.startsWith(`${r.id}[`));
    if (!held) continue;
    return {
      ok: false,
      lines: problemLines({
        severity: 'error',
        summary: 'Instance cannot be destroyed',
        detail: `Resource ${held[0]} has lifecycle.prevent_destroy set, but the plan calls for this\nresource to be destroyed. To avoid this error and continue with the plan, either disable\nlifecycle.prevent_destroy or reduce the scope of the plan using the -target flag.`,
        ...at(files, r),
      }),
    };
  }
  const changes: ResourceChange[] = entries.map(([address, before]) => {
    const [type, name] = address.replace(/\[[^\]]*\]$/, '').split('.').slice(-2);
    return { address, type, name, action: 'delete', before, blocks: new Set() };
  });
  const out: Line[] = entries.map(([address, a]) => line(`${address}: Refreshing state... [id=${a.id ?? ''}]`, undefined, true));
  out.push(
    line(),
    line('Terraform used the selected providers to generate the following execution'),
    line('plan. Resource actions are indicated with the following symbols:'),
    LEGEND.delete,
    line(),
    line('Terraform will perform the following actions:'),
    line(),
  );
  for (const c of [...changes].sort(byAddress)) out.push(...changeLines(c));
  out.push(line(`Plan: 0 to add, 0 to change, ${changes.length} to destroy.`, 'strong'));
  const outputs = Object.entries(previous?.outputs ?? {}).map(([name, before]) => ({ name, before }));
  if (outputs.length > 0) out.push(line(), line('Changes to Outputs:'), ...outputChangeLines(outputs.sort((a, b) => a.name.localeCompare(b.name))));
  let confirmAt: number | undefined;
  if (!autoApprove) {
    out.push(...confirmLines(true));
    confirmAt = out.length - 1;
  }
  out.push(line());
  for (const [address, a] of [...entries].reverse()) out.push(...destroyLines(address, a.id ?? '', changes.find((c) => c.address === address)!.type));
  out.push(line(), line(`Destroy complete! Resources: ${changes.length} destroyed.`, 'success'));
  return { ok: true, lines: out, state: null, plan: summary(changes), confirmAt };
}

/**
 * Run a Terraform command over `files`, from the state `previous` left
 * (null: nothing applied yet). Before `init`, every other command fails as
 * the real CLI does (unless the configuration needs no provider at all).
 */
export function simulate(command: SimCommand, files: Files, previous: SimState | null, ctx: SimContext = { initialized: true }): SimResult {
  if (command === 'init') return init(files, ctx.initialized);
  if (!ctx.initialized && requiredProviders(files).length > 0) return notInitialized(files, command);
  switch (command) {
    case 'validate':
      return validate(files);
    case 'plan':
      return plan(files, previous);
    case 'apply':
      return apply(files, previous, ctx.autoApprove === true);
    case 'destroy':
      return destroy(files, previous, ctx.autoApprove === true);
  }
}

/** the root module's instance addresses the configuration declares (to tell which deletes have no node left) */
export function declaredBlocks(files: Files): Set<string> {
  const { ir } = parseProject(tfFiles(files));
  return new Set([...ir.resources.map((r) => r.id), ...ir.modules.map((m) => m.id)]);
}
