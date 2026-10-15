/**
 * Predicates the modules level (6) needs on top of ../goals.ts. The lesson
 * context parses the root module only, so goals about a module's insides
 * build a context of their own from the module's folder (`inModule`), and
 * goals about values (ranges, zones, names per environment) read the
 * simulated plan, which already resolves inputs, `count` and `for_each` on
 * modules: two `module` blocks or one with `for_each` pass alike.
 */
import { cidrBlock, blocksOverlap } from '@/resources/cidr';
import { collectRefs, literalString } from '@/ir/expr';
import { moduleTarget, type LocalModule } from '@/ir/localModules';
import { moduleRef } from '@/ir/modules';
import type { ModuleNode } from '@/ir/types';
import { constraintAllows } from '@/schema/versions';
import { argAt, lessonContext, referencedAddresses, resourcesOf } from '../goals';
import { simulate } from '../sim/simulate';
import type { Files, LessonCtx, PlanSummary } from '../types';
import { defaultRouteToIgw, subnetIs } from './predicates-23';

type Test = (ctx: LessonCtx) => boolean;

/* ------------------------------------------------------------ local modules */

interface Called {
  call: ModuleNode;
  dir: string;
  module: LocalModule;
}

/** the root's calls to a local module the project holds and that parses */
export function calledModules(ctx: LessonCtx): Called[] {
  return ctx.ir.modules.flatMap((call) => {
    const t = moduleTarget(ctx.files, call);
    return t.kind === 'local' && t.module && !t.module.broken ? [{ call, dir: t.dir, module: t.module }] : [];
  });
}

const moduleCtxs = new WeakMap<Files, Map<string, LessonCtx>>();

/** a lesson context for the module in `dir`, as if its folder were the root */
function moduleCtx(ctx: LessonCtx, dir: string): LessonCtx {
  let byDir = moduleCtxs.get(ctx.files);
  if (!byDir) moduleCtxs.set(ctx.files, (byDir = new Map()));
  let inner = byDir.get(dir);
  if (!inner) {
    const prefix = `${dir}/`;
    const files = Object.fromEntries(Object.entries(ctx.files).flatMap(([p, t]) => (p.startsWith(prefix) ? [[p.slice(prefix.length), t]] : [])));
    byDir.set(dir, (inner = lessonContext(files)));
  }
  return inner;
}

/** some called local module (in `dir`, when given) passes every test, read from inside it */
export const inModule =
  (...tests: Test[]): Test =>
  (ctx) =>
    calledModules(ctx).some((c) => tests.every((t) => t(moduleCtx(ctx, c.dir))));

/** the call to `dir` exists (`source = "./modules/network"`, trailing slash or not) */
export const callsModule =
  (dir: string): Test =>
  (ctx) =>
    calledModules(ctx).some((c) => c.dir === dir);

/** inside a module: the variable a resource of `type` reads at `path` (`var.cidr_block` → `cidr_block`), when it is declared */
function inputBehind(ctx: LessonCtx, type: string, path: string): string | undefined {
  for (const r of resourcesOf(ctx, type)) {
    for (const a of referencedAddresses(argAt(r, path))) {
      const name = /^var\.([A-Za-z_][\w-]*)/.exec(a)?.[1];
      if (name && ctx.ir.variables.some((v) => v.name === name)) return name;
    }
  }
  return undefined;
}

/** inside a module: a resource of `type` takes `path` from a declared variable */
export const fromInput =
  (type: string, path: string): Test =>
  (ctx) =>
    inputBehind(ctx, type, path) !== undefined;

/** a call passes the input its module's `type` reads at `path` (the VPC's range: whatever the learner named it) */
export const passesInput =
  (type: string, path: string): Test =>
  (ctx) =>
    calledModules(ctx).some((c) => {
      const name = inputBehind(moduleCtx(ctx, c.dir), type, path);
      return name !== undefined && c.call.args[name] !== undefined;
    });

/**
 * A route table association ties subnets to a route table: one subnet, or
 * every subnet through `for_each = aws_subnet.x` (which the security lens
 * doesn't follow yet: see `publicInside`).
 */
const subnetsAssociated: Test = (ctx) =>
  resourcesOf(ctx, 'aws_route_table_association').some(
    (a) =>
      [argAt(a, 'subnet_id'), argAt(a, 'for_each')].some((e) => referencedAddresses(e).some((x) => x.startsWith('aws_subnet.'))) &&
      referencedAddresses(argAt(a, 'route_table_id')).some((x) => x.startsWith('aws_route_table.')),
  );

/** inside a module: public subnets, as the security lens sees them, or associated with a route table that has a default route to an internet gateway */
export const publicInside: Test = (ctx) => subnetIs('public')(ctx) || (defaultRouteToIgw(ctx) && subnetsAssociated(ctx));

/** module refs (`module.net.vpc_id`, `module.net["a"].ids[0]`) in some root resource of `type` at `path` */
function moduleRefsAt(ctx: LessonCtx, type: string, path: string): Array<{ call: ModuleNode; output: string }> {
  return resourcesOf(ctx, type).flatMap((r) => {
    const e = argAt(r, path);
    if (!e) return [];
    const refs: Array<{ field: string; path: string }> = [];
    collectRefs(e, '', refs);
    return refs.flatMap((ref) => {
      const m = moduleRef(ref.path);
      const call = m?.output ? ctx.ir.modules.find((x) => x.name === m.name) : undefined;
      return call && m?.output ? [{ call, output: m.output }] : [];
    });
  });
}

/** a root resource of `type` reads `path` from a local module's output that returns a `insideType` resource */
export const fromModuleOutput =
  (type: string, path: string, insideType: string): Test =>
  (ctx) =>
    moduleRefsAt(ctx, type, path).some(({ call, output }) => {
      const t = moduleTarget(ctx.files, call);
      const o = t.kind === 'local' ? t.module?.ir.outputs.find((x) => x.name === output) : undefined;
      return o !== undefined && referencedAddresses(o.args.value).some((a) => a.startsWith(`${insideType}.`));
    });

/* ------------------------------------------------------------ Registry modules */

const bare = (source: string) => source.trim().replace(/^registry\.terraform\.io\//i, '').toLowerCase();

const registryCalls = (ctx: LessonCtx, source: string) =>
  ctx.ir.modules.filter((m) => {
    const s = literalString(m.args.source);
    return s !== undefined && bare(s) === source;
  });

/** a call to this Registry module (`terraform-aws-modules/vpc/aws`) */
export const callsRegistry =
  (source: string): Test =>
  (ctx) =>
    registryCalls(ctx, source).length > 0;

/**
 * Its `version` stays on one major version: `5.21.0`, `= 5.21.0`, `~> 5.21`,
 * `>= 5.0, < 6.0` pass; `>= 5.0` (6 would slip in) and no version don't.
 */
export const pinnedTo =
  (source: string, major: number): Test =>
  (ctx) =>
    registryCalls(ctx, source).some((m) => {
      const v = literalString(m.args.version);
      const first = v && /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
      if (!v || !first) return false;
      const lowest = `${first[1]}.${first[2] ?? 0}.${first[3] ?? 0}`;
      return Number(first[1]) === major && constraintAllows(v, lowest) && !constraintAllows(v, `${major + 1}.0.0`);
    });

/** a call to this Registry module sets every one of these inputs */
export const registryInputs =
  (source: string, inputs: string[]): Test =>
  (ctx) =>
    registryCalls(ctx, source).some((m) => inputs.every((i) => m.args[i] !== undefined));

/** a root resource of `type` reads `path` from this Registry module's `output` */
export const fromRegistryOutput =
  (type: string, path: string, source: string, output: string): Test =>
  (ctx) =>
    moduleRefsAt(ctx, type, path).some((r) => r.output === output && registryCalls(ctx, source).includes(r.call));

/* ------------------------------------------------------------ environments, read from the plan */

const plans = new WeakMap<Files, PlanSummary | null>();

/** the simulated plan of the code from scratch (null when it doesn't plan) */
function planOf(ctx: LessonCtx): PlanSummary | null {
  if (!plans.has(ctx.files)) {
    const r = simulate('plan', ctx.files, null, { initialized: true });
    plans.set(ctx.files, r.ok ? (r.plan ?? null) : null);
  }
  return plans.get(ctx.files)!;
}

interface Env {
  cidr?: string;
  name?: string;
  zones: Set<string>;
}

/** `module.staging.aws_vpc.this` → `module.staging` (nested and keyed calls too) */
const VPC_IN_MODULE = /^(module\..+)\.aws_vpc\.[^.]+$/;
const SUBNET_IN_MODULE = /^(module\..+)\.aws_subnet\.[^.]+$/;

/** each module instance that builds a VPC: its range, its `Name` tag and the zones of its subnets */
function envsOf(ctx: LessonCtx): Map<string, Env> {
  const envs = new Map<string, Env>();
  const changes = planOf(ctx)?.changes ?? [];
  for (const c of changes) {
    const prefix = VPC_IN_MODULE.exec(c.address)?.[1];
    if (!prefix) continue;
    const after = (k: string) => c.attributes?.[k]?.[1] ?? undefined;
    let name: string | undefined;
    try {
      name = (JSON.parse(after('tags') ?? '{}') as Record<string, unknown>).Name as string | undefined;
    } catch {
      name = undefined;
    }
    envs.set(prefix, { cidr: after('cidr_block'), name: typeof name === 'string' ? name : undefined, zones: new Set() });
  }
  for (const c of changes) {
    const env = envs.get(SUBNET_IN_MODULE.exec(c.address)?.[1] ?? '');
    const zone = c.attributes?.availability_zone?.[1] ?? c.attributes?.availability_zone_id?.[1];
    if (env && zone) env.zones.add(zone);
  }
  return envs;
}

/** at least `min` module instances that each build a VPC */
export const environments =
  (min: number): Test =>
  (ctx) =>
    envsOf(ctx).size >= min;

/** two or more environments, every range known, none overlapping another */
export const rangesApart: Test = (ctx) => {
  const blocks = [...envsOf(ctx).values()].map((e) => (e.cidr ? cidrBlock(e.cidr) : undefined));
  if (blocks.length < 2 || blocks.some((b) => !b)) return false;
  return blocks.every((a, i) => blocks.slice(i + 1).every((b) => !blocksOverlap(a!, b!)));
};

/** two or more environments, each VPC with a `Name` tag of its own */
export const namesApart: Test = (ctx) => {
  const names = [...envsOf(ctx).values()].map((e) => e.name);
  return names.length >= 2 && names.every((n) => n) && new Set(names).size === names.length;
};

/** some environment (or, with `every`, each one) has subnets in at least `min` zones */
export const zonesPerEnv =
  (min: number, every = false): Test =>
  (ctx) => {
    const envs = [...envsOf(ctx).values()];
    const enough = (e: Env) => e.zones.size >= min;
    return envs.length > 0 && (every ? envs.every(enough) : envs.some(enough));
  };

/** the last apply left VPCs in at least `min` module instances */
export const appliedEnvs =
  (min: number): Test =>
  (ctx) =>
    ctx.state !== null && new Set(Object.keys(ctx.state.resources).flatMap((a) => VPC_IN_MODULE.exec(a)?.[1] ?? [])).size >= min;
