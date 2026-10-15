/**
 * Predicates the repetition lessons (level 5) need on top of ../goals.ts.
 * What each instance will be is read from the simulated plan, so any style
 * that evaluates to the same thing passes (`count.index` in a template,
 * `cidrsubnet`, a list, a map, a variable). Also: `dynamic` blocks,
 * references that name an instance, and where `moved {}` blocks lead.
 */
import { movedBlocks, type MovedStatement } from '@/hcl/moved';
import { parseFile } from '@/hcl/parser';
import { collectRefs, refTargetAddress } from '@/ir/expr';
import { exprText, instanceAddress, isRepeatedNode, localValue, repeatOf } from '@/ir/repeat';
import type { Expression, ResourceNode } from '@/ir/types';
import { argAt, referencedAddresses, resourcesOf } from '../goals';
import { evaluate, isObject, type Scope } from '../sim/eval';
import { simulate } from '../sim/simulate';
import type { Files, LessonCtx } from '../types';

type Test = (ctx: LessonCtx) => boolean;
/** instance address → its attributes as a plan from nothing shows them (null: known after apply) */
type Planned = Map<string, Record<string, string | null>>;

const plans = new WeakMap<Files, Planned | null>();

/** what `terraform plan` would create from an empty state, per instance address (null when the plan fails) */
export function plannedOf(files: Files): Planned | null {
  let planned = plans.get(files);
  if (planned === undefined) {
    const result = simulate('plan', files, null);
    planned =
      result.ok && result.plan
        ? new Map(
            result.plan.changes.map((c) => [c.address, Object.fromEntries(Object.entries(c.attributes ?? {}).map(([k, [, after]]) => [k, after]))]),
          )
        : null;
    plans.set(files, planned);
  }
  return planned;
}

/** an instance address without its key: `aws_subnet.app[0]` → `aws_subnet.app` */
const baseOf = (address: string) => address.replace(/\[[^\]]*\]$/, '');
/** `aws_subnet` for `aws_subnet.app["web"]` */
const typeOf = (address: string) => baseOf(address).split('.').at(-2);

/** the planned instances of one repeated resource */
const instancesPlanned = (ctx: LessonCtx, r: ResourceNode) =>
  [...(plannedOf(ctx.files) ?? new Map<string, Record<string, string | null>>())].filter(([a]) => a.startsWith(`${r.id}[`));

/* ------------------------------------------------------------ count and for_each */

/** some resource of `type` repeats with `kind`, standing for at least `min` instances (known without running Terraform) */
export const repeats =
  (type: string, kind: 'count' | 'for_each', min = 1): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const rep = repeatOf(r, ctx.ir);
      return rep?.kind === kind && (rep.size ?? 0) >= min;
    });

/** some repeated resource of `type` plans at least `min` instances whose `attr` is known and different for each */
export const distinctPerInstance =
  (type: string, attr: string, min: number): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const values = instancesPlanned(ctx, r).map(([, attrs]) => attrs[attr]);
      return values.length >= min && values.every((v) => v != null) && new Set(values).size === values.length;
    });

/** how many instances of `type` the plan creates */
const plannedCount = (ctx: LessonCtx, type: string) =>
  [...(plannedOf(ctx.files)?.keys() ?? [])].filter((a) => typeOf(a) === type).length;

/** the plan creates exactly `n` instances of `type`, and none of them mentions `text` (in its address or attributes) */
export const plansWithout =
  (type: string, n: number, text: string): Test =>
  (ctx) => {
    const planned = plannedOf(ctx.files);
    if (!planned || plannedCount(ctx, type) !== n) return false;
    return ![...planned].some(
      ([address, attrs]) => typeOf(address) === type && (address.includes(text) || Object.values(attrs).some((v) => v?.includes(text))),
    );
  };

/** some resource of `type` has `path` written with an expression that matches (`each.key`, `count.index`) */
export const writes =
  (type: string, path: string, pattern: RegExp): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const e = argAt(r, path);
      return e !== undefined && pattern.test(exprText(e));
    });

/** an output that lists every instance of a repeated `type` (a splat, a `for` expression, `values()`) */
export const outputListsAll =
  (type: string): Test =>
  (ctx) =>
    ctx.ir.outputs.some((o) => {
      const value = o.args.value;
      if (!value) return false;
      const repeated = referencedAddresses(value).some((a) => resourcesOf(ctx, type).some((r) => r.id === a && isRepeatedNode(r)));
      return repeated && /\[\*\]|\bfor\b|\bvalues\s*\(/.test(exprText(value));
    });

/** the last apply left at least `min` instances of `type` with an index or a key */
export const appliedInstances =
  (type: string, min: number): Test =>
  (ctx) =>
    ctx.state !== null &&
    Object.keys(ctx.state.resources).filter((a) => a !== baseOf(a) && typeOf(a) === type).length >= min;

/** every `for_each` resource of `type` (and there is one) is in the state exactly by the keys the code gives it */
export const appliedByKeys =
  (type: string): Test =>
  (ctx) => {
    const state = ctx.state;
    const keyed = resourcesOf(ctx, type).filter((r) => repeatOf(r, ctx.ir)?.kind === 'for_each');
    return (
      state !== null &&
      keyed.length > 0 &&
      keyed.every((r) => {
        const keys = repeatOf(r, ctx.ir)?.keys;
        if (!keys) return false;
        const want = new Set(keys.map((k) => instanceAddress(r.id, 'for_each', k)));
        const have = Object.keys(state.resources).filter((a) => baseOf(a) === r.id);
        return have.length === want.size && have.every((a) => want.has(a));
      })
    );
  };

/* ------------------------------------------------------------ dynamic blocks */

interface Dynamic {
  forEach?: Expression;
  /** `ingress` in `ingress.value`: the block's label, or its `iterator` */
  iterator: string;
  content?: Record<string, Expression>;
}

/** the `dynamic "<field>"` blocks of a resource, read from their verbatim text */
function dynamicsOf(r: ResourceNode, field: string): Dynamic[] {
  return Object.entries(r.args).flatMap(([key, e]) => {
    if (!key.startsWith(`dynamic "${field}"`) || e.kind !== 'raw') return [];
    const [block] = parseFile('', e.hcl.replace(/^\s*dynamic\s+"[^"]*"\s*\{/, 'output "dynamic" {')).blocks;
    const args = block?.kind === 'labeled' ? block.args : {};
    const it = args.iterator;
    const iterator = it?.kind === 'ref' ? it.path : it?.kind === 'literal' ? String(it.value) : it?.kind === 'raw' ? it.hcl.trim() : field;
    const content = args.content;
    return [{ forEach: args.for_each, iterator, content: content?.kind === 'block' ? content.body : undefined }];
  });
}

/** how many items a collection holds, reading `var` defaults and locals (`toset(var.ports)`, a list of objects) */
function itemsIn(ctx: LessonCtx, e: Expression): number | undefined {
  let depth = 0;
  const scope: Scope = {
    ref(root, name) {
      const value =
        root === 'var' ? ctx.ir.variables.find((v) => v.name === name)?.args.default : root === 'local' ? localValue(ctx.ir, name) : undefined;
      return value && depth++ < 8 ? evaluate(value, scope) : undefined;
    },
  };
  const v = evaluate(e, scope);
  return Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : undefined;
}

/**
 * Some resource of `type` writes its `field` blocks with `dynamic`: over a
 * collection of at least `min` items, from a variable when `fromVar`, with a
 * `content` whose ports come from the iterator (`ingress.value`, `port.value.from`).
 */
export const dynamicBlocks =
  (type: string, field: string, opts: { min?: number; fromVar?: boolean; ports?: boolean } = {}): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) =>
      dynamicsOf(r, field).some((d) => {
        if (!d.forEach || !d.content) return false;
        if (opts.min !== undefined && (itemsIn(ctx, d.forEach) ?? 0) < opts.min) return false;
        if (opts.fromVar && !referencedAddresses(d.forEach).some((a) => a.startsWith('var.'))) return false;
        const uses = new RegExp(`\\b${d.iterator}\\.(value|key)\\b`);
        return !opts.ports || ['from_port', 'to_port'].every((p) => d.content![p] !== undefined && uses.test(exprText(d.content![p])));
      }),
    );

/** no resource of `type` has a static `field` block left (only `dynamic` ones) */
export const noStaticBlocks =
  (type: string, field: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).every((r) => argAt(r, field) === undefined);

/** a variable whose default is a list of at least `min` items */
export const listVariable =
  (min: number): Test =>
  (ctx) =>
    ctx.ir.variables.some((v) => {
      const d = v.args.default;
      return d?.kind === 'list' && d.items.length >= min;
    });

/* ------------------------------------------------------------ conditional resources */

/** `count = var.x ? 1 : 0` (a variable or local), or a count that follows such a resource: `length(aws_nat_gateway.nat)` */
function onSwitch(ctx: LessonCtx, r: ResourceNode, depth = 0): boolean {
  if (depth > 4 || r.args.count === undefined) return false;
  const refs = referencedAddresses(r.args.count);
  if (repeatOf(r, ctx.ir)?.optional) return refs.some((a) => /^(var|local)\./.test(a));
  return refs.some((a) => {
    const other = ctx.ir.resources.find((x) => x.id === a);
    return other !== undefined && other !== r && onSwitch(ctx, other, depth + 1);
  });
}

/** some resource of `type` exists or not on a switch */
export const optional =
  (type: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => onSwitch(ctx, r));

/**
 * Every reference to a resource matches its repetition, as Terraform demands:
 * an instance (`[0]`, `["a"]`) or a splat for a repeated one, no key for a
 * plain one. Resources' arguments and outputs.
 */
export const instanceKeysMatch: Test = (ctx) => {
  const byId = new Map(ctx.ir.resources.map((r) => [r.id, r] as const));
  const exprs = [
    ...ctx.ir.resources.flatMap((r) => Object.entries(r.args).filter(([k]) => !/[\s"]/.test(k)).map(([, e]) => e)),
    ...ctx.ir.outputs.flatMap((o) => Object.values(o.args)),
  ];
  return exprs.every((e) => {
    const refs: Array<{ field: string; path: string }> = [];
    collectRefs(e, '', refs);
    return refs.every(({ path }) => {
      const address = refTargetAddress(path);
      const target = address ? byId.get(address) : undefined;
      if (!address || !target) return true;
      const rest = path.slice(address.length);
      return isRepeatedNode(target) ? !(rest.startsWith('.') && !rest.startsWith('.*')) : !/^\[(?!\*\])/.test(rest);
    });
  });
};

/** an output that reads `type` in a way that survives zero instances: `one()`, `try()`, a conditional, a splat */
export const outputSurvivesZero =
  (type: string): Test =>
  (ctx) =>
    ctx.ir.outputs.some((o) => {
      const value = o.args.value;
      return (
        value !== undefined &&
        referencedAddresses(value).some((a) => a.startsWith(`${type}.`)) &&
        /\bone\s*\(|\btry\s*\(|\?|\[\*\]|\bfor\b/.test(exprText(value))
      );
    });

/* ------------------------------------------------------------ moved blocks */

const tidy = (address: string) => address.replace(/\s+/g, '');

/** where `address` ends up after the `moved` blocks (a whole resource's move carries its instances) */
function follow(address: string, moves: MovedStatement[]): string {
  let current = address;
  for (let i = 0; i < 16; i++) {
    const exact = moves.find((m) => m.from === current);
    const whole = exact ? undefined : moves.find((m) => !m.from.includes('[') && !m.to.includes('[') && current.startsWith(`${m.from}[`));
    if (exact) current = exact.to;
    else if (whole) current = whole.to + current.slice(whole.from.length);
    else break;
  }
  return current;
}

/**
 * Starting from what `start` plans, every instance either keeps its address
 * or `moved` blocks lead it to one the code plans now, with the same `attrs`
 * (a move must not change what moves); and at least one instance moved.
 */
export const movesKeep =
  (start: Files, attrs: string[] = []): Test =>
  (ctx) => {
    const before = plannedOf(start);
    const now = plannedOf(ctx.files);
    if (!before || !now) return false;
    const moves = movedBlocks(ctx.ir).map((m) => ({ from: tidy(m.from), to: tidy(m.to) }));
    let moved = 0;
    for (const [address, was] of before) {
      const to = follow(address, moves);
      if (to !== address) moved++;
      const is = now.get(to);
      if (!is || attrs.some((k) => is[k] !== was[k])) return false;
    }
    return moved > 0;
  };
