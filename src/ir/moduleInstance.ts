/**
 * What a call to a local module stands for: the module's blocks with the
 * call's inputs put in, so the cost estimate and the security audit read
 * them as Terraform would plan them.
 *
 * An input given as a literal at the call (or one the call leaves out, whose
 * default is a literal) replaces every `var.x` in the module (`var.x[0]` and
 * `var.x.key` too, when the value is a list or an object). An input given as
 * an expression stays `var.x`, without a default: the analyses then say they
 * can't tell, and `fromInputs` says where the value comes from. Providers
 * are inherited from the caller (`providers = { aws = aws.west }` honored).
 *
 * Pure: the child modules come from src/ir/localModules.ts (parsed once per
 * folder text).
 */
import { exprPreview } from './expr';
import { moduleTarget, type LocalModule } from './localModules';
import { moduleAddress, moduleInputs } from './modules';
import { repeatOf, type RepeatKind } from './repeat';
import type { Expression, IR, ModuleNode, ProviderBlock, VariableDecl } from './types';

export interface ModuleInstance {
  /** the call, in the module that makes it */
  call: ModuleNode;
  /** `module.network` */
  id: string;
  /** call names from the root module, outermost first */
  path: string[];
  /** the same calls with the folder each one opens (what the canvas's module view takes) */
  steps: Array<{ dir: string; name: string }>;
  /** `module.service › module.ecr` */
  label: string;
  /** project folder of the module */
  dir: string;
  child: LocalModule;
  /** the module's blocks with the inputs put in */
  ir: IR;
  /** inputs given as expressions at the call: name → as written (`local.cidrs`) */
  fromInputs: Map<string, string>;
  /** instances of the call: 1, a known `count` / `for_each` size, null when decided at plan time */
  count: number | null;
  repeat?: RepeatKind;
  /** the module calls inside it */
  nested: ModuleInstance[];
}

/** How a call path reads: `module.service › module.ecr`, then a block in it after another `›`. */
export const PATH_SEP = ' › ';
export const pathLabel = (path: string[]): string => path.map(moduleAddress).join(PATH_SEP);
export const inModuleLabel = (path: string[], id: string): string => `${pathLabel(path)}${PATH_SEP}${id}`;

const VAR_PATH = /^var\.([A-Za-z_][\w-]*)((?:\.[A-Za-z_][\w-]*|\[\d+\]|\["[^"]*"\])*)$/;
const STEP = /\.([A-Za-z_][\w-]*)|\[(\d+)\]|\["([^"]*)"\]/g;

/** a value made of literals only (lists and objects of them included) */
function isLiteralish(e: Expression | undefined): boolean {
  if (!e) return false;
  if (e.kind === 'literal') return true;
  if (e.kind === 'list') return e.items.every(isLiteralish);
  if (e.kind === 'object') return Object.values(e.fields).every(isLiteralish);
  return false;
}

/** `value` followed along `.key` / `[0]` steps; undefined when a step doesn't lead anywhere literal */
function walkInto(value: Expression, steps: string): Expression | undefined {
  let cur: Expression | undefined = value;
  for (const m of steps.matchAll(STEP)) {
    if (!cur) return undefined;
    const key = m[1] ?? m[3];
    if (key !== undefined) cur = cur.kind === 'object' ? cur.fields[key] : undefined;
    else cur = cur.kind === 'list' ? cur.items[Number(m[2])] : undefined;
  }
  return cur && isLiteralish(cur) ? cur : undefined;
}

/** `e` with the known variables put in (unchanged objects are kept, so untouched blocks stay shared) */
export function substituteVars(e: Expression, values: Map<string, Expression>): Expression {
  switch (e.kind) {
    case 'ref': {
      const m = VAR_PATH.exec(e.path);
      const value = m ? values.get(m[1]) : undefined;
      if (!m || !value) return e;
      return m[2] ? (walkInto(value, m[2]) ?? e) : value;
    }
    case 'list': {
      const items = e.items.map((x) => substituteVars(x, values));
      return items.every((x, i) => x === e.items[i]) ? e : { ...e, items };
    }
    case 'object': {
      const fields = substituteRecord(e.fields, values);
      return fields === e.fields ? e : { ...e, fields };
    }
    case 'block': {
      const body = substituteRecord(e.body, values);
      return body === e.body ? e : { ...e, body };
    }
    case 'blocks': {
      const items = e.items.map((x) => substituteRecord(x, values));
      return items.every((x, i) => x === e.items[i]) ? e : { ...e, items };
    }
    default:
      return e;
  }
}

export function substituteRecord(record: Record<string, Expression>, values: Map<string, Expression>): Record<string, Expression> {
  let out: Record<string, Expression> | null = null;
  for (const [k, v] of Object.entries(record)) {
    const next = substituteVars(v, values);
    if (next !== v) (out ??= { ...record })[k] = next;
  }
  return out ?? record;
}

/** the literal value of an input as given at the call (variables of the caller followed to their defaults) */
function literalAtCall(e: Expression, caller: IR, depth = 0): Expression | undefined {
  if (isLiteralish(e)) return e;
  if (depth > 4) return undefined;
  if (e.kind === 'ref') {
    const m = VAR_PATH.exec(e.path);
    const d = m ? caller.variables.find((v) => v.name === m[1])?.args.default : undefined;
    if (!m || !d) return undefined;
    return m[2] ? walkInto(d, m[2]) : literalAtCall(d, caller, depth + 1);
  }
  if (e.kind === 'list') {
    const items = e.items.map((x) => literalAtCall(x, caller, depth + 1));
    return items.every((x) => x !== undefined) ? { kind: 'list', items: items as Expression[] } : undefined;
  }
  if (e.kind === 'object') {
    const fields: Record<string, Expression> = {};
    for (const [k, v] of Object.entries(e.fields)) {
      const x = literalAtCall(v, caller, depth + 1);
      if (!x) return undefined;
      fields[k] = x;
    }
    return { kind: 'object', fields };
  }
  return undefined;
}

/** `providers = { aws = aws.west }`: the module's default `aws` is the caller's `aws.west` */
function inheritedProviders(call: ModuleNode, caller: IR): ProviderBlock[] {
  const mapping = call.args.providers;
  const remap = new Map<string, string>();
  if (mapping?.kind === 'object') {
    for (const [k, v] of Object.entries(mapping.fields)) if (v.kind === 'ref') remap.set(k, v.path);
  }
  const alias = (p: ProviderBlock) => (p.args.alias?.kind === 'literal' ? String(p.args.alias.value) : undefined);
  const defaults = caller.providers.filter((p) => alias(p) === undefined && !remap.has(p.name));
  const mapped: ProviderBlock[] = [];
  for (const [name, target] of remap) {
    const [source, as] = target.split('.');
    const p = caller.providers.find((x) => x.name === source && alias(x) === as) ?? caller.providers.find((x) => x.name === source);
    if (!p) continue;
    const args = { ...p.args };
    delete args.alias;
    mapped.push({ ...p, id: `provider.${name}`, name, args });
  }
  return [...defaults, ...mapped];
}

/**
 * The module's blocks (`child`, or another parse of the same folder such as
 * the opened module's view) with the call's inputs put in.
 */
export function instantiate(
  child: IR,
  call: ModuleNode,
  caller: IR,
): { ir: IR; fromInputs: Map<string, string> } {
  const passed = new Map(moduleInputs(call));
  const values = new Map<string, Expression>();
  const fromInputs = new Map<string, string>();
  const variables: VariableDecl[] = child.variables.map((v) => {
    const given = passed.get(v.name);
    if (given !== undefined) {
      const value = literalAtCall(given, caller);
      if (value) {
        values.set(v.name, value);
        return { ...v, args: { ...v.args, default: value } };
      }
      fromInputs.set(v.name, exprPreview(given));
      // the module's own default doesn't apply: the call gives something else
      const args = { ...v.args };
      delete args.default;
      return { ...v, args };
    }
    const own = v.args.default;
    if (own && isLiteralish(own)) values.set(v.name, own);
    return v;
  });
  const sub = <T extends { args: Record<string, Expression> }>(b: T): T => {
    const args = substituteRecord(b.args, values);
    return args === b.args ? b : { ...b, args };
  };
  return {
    ir: {
      ...child,
      variables,
      resources: child.resources.map(sub),
      outputs: child.outputs.map(sub),
      modules: child.modules.map(sub),
      providers: child.providers.length > 0 ? child.providers : inheritedProviders(call, caller),
    },
    fromInputs,
  };
}

/** How many instances a module call stands for. */
export function callCount(call: ModuleNode, caller: IR): { count: number | null; repeat?: RepeatKind } {
  const rep = repeatOf(call, caller);
  if (!rep) return { count: 1 };
  return { count: rep.size ?? null, repeat: rep.kind };
}

/** At most this deep: a module that (through others) calls itself stops here. */
const MAX_DEPTH = 8;

/**
 * Every call to a local module the project holds, from `ir` down (nested
 * calls inside each), instantiated. Registry / git modules, folders the
 * project doesn't have and modules with parse errors are left out.
 */
export function moduleInstances(
  ir: IR,
  files: Record<string, string>,
  steps: Array<{ dir: string; name: string }> = [],
): ModuleInstance[] {
  if (steps.length >= MAX_DEPTH) return [];
  const seen = steps.map((s) => s.dir);
  const out: ModuleInstance[] = [];
  for (const call of ir.modules) {
    const target = moduleTarget(files, call);
    if (target.kind !== 'local' || !target.module || target.module.broken || seen.includes(target.dir)) continue;
    const here = [...steps, { dir: target.dir, name: call.name }];
    const path = here.map((s) => s.name);
    const { ir: inst, fromInputs } = instantiate(target.module.ir, call, ir);
    out.push({
      call,
      id: call.id,
      path,
      steps: here,
      label: pathLabel(path),
      dir: target.dir,
      child: target.module,
      ir: inst,
      fromInputs,
      ...callCount(call, ir),
      nested: moduleInstances(inst, files, here),
    });
  }
  return out;
}

/** The instances, outermost first, each followed by the ones inside it. */
export function flattenInstances(list: ModuleInstance[]): ModuleInstance[] {
  return list.flatMap((m) => [m, ...flattenInstances(m.nested)]);
}

/**
 * The opened module reached through `path` (call names from the root), as
 * that chain of calls instantiates it, with `view` (another parse of the
 * module's folder: the canvas's, with its positions) as its blocks. Null
 * when a call of the path isn't there any more.
 */
export function instantiatePath(root: IR, files: Record<string, string>, path: string[], view: IR): IR | null {
  let caller = root;
  for (const [i, name] of path.entries()) {
    const call = caller.modules.find((m) => m.name === name);
    if (!call) return null;
    const target = moduleTarget(files, call);
    if (target.kind !== 'local' || !target.module) return null;
    const last = i === path.length - 1;
    caller = instantiate(last ? view : target.module.ir, call, caller).ir;
  }
  return caller;
}
