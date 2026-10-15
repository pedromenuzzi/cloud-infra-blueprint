/**
 * Goals are checked live against what the app already understands of the
 * code: the parsed IR, its derived containment and edges, the validation
 * diagnostics, the security audit and the simulated terminal. Lessons build
 * their goals from the small predicates below (`has`, `argIs`, `inside`…),
 * so a learner's own naming and style pass as long as the result is right.
 */
import { parseProject } from '@/hcl/parser';
import { collectRefs, refTargetAddress } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { resolveString } from '@/ir/checks/resolve';
import { instanceCount, localValue } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { auditSecurity, type AuditResult } from '@/security/audit';
import type { Files, Goal, LessonCtx, SimCommand, SimState } from './types';

export function lessonContext(
  files: Files,
  extra: { ran?: Iterable<SimCommand>; state?: SimState | null } = {},
): LessonCtx {
  const { ir, diagnostics } = parseProject(files);
  const edges = deriveStructure(ir, getDef);
  let audit: AuditResult | undefined;
  return {
    files,
    ir,
    edges,
    diagnostics: [...diagnostics, ...validateProject(ir, getDef)],
    errored: diagnostics.some((d) => d.severity === 'error'),
    get audit() {
      audit ??= auditSecurity(ir);
      return audit;
    },
    ran: new Set(extra.ran ?? []),
    state: extra.state ?? null,
  };
}

/** each goal's result, in order; a goal whose test throws is simply not met */
export function checkGoals(goals: Goal[], ctx: LessonCtx): boolean[] {
  return goals.map((goal) => {
    try {
      return goal.test(ctx) === true;
    } catch {
      return false;
    }
  });
}

/* ------------------------------------------------------------ reading values */

type Value = string | number | boolean;

/** what an expression certainly evaluates to: a literal, a `var.x` default, a plain template; else undefined */
export function valueOf(ir: IR, e: Expression | undefined): Value | undefined {
  if (!e) return undefined;
  if (e.kind === 'literal') return e.value ?? undefined;
  if (e.kind === 'ref' && e.path.startsWith('local.')) return valueOf(ir, localValue(ir, e.path.slice(6)));
  return resolveString(ir, e)?.value;
}

/** `args.tags`, `args.versioning.enabled`: nested attribute and block bodies, by dotted path */
export function argAt(node: { args: Record<string, Expression> }, path: string): Expression | undefined {
  let current: Expression | undefined = { kind: 'object', fields: node.args };
  for (const key of path.split('.')) {
    if (!current) return undefined;
    if (current.kind === 'object') current = current.fields[key];
    else if (current.kind === 'block') current = current.body[key];
    else if (current.kind === 'blocks') current = current.items[0]?.[key];
    else return undefined;
  }
  return current;
}

/** addresses an expression references (`aws_vpc.main`, `var.region`, `data.aws_ami.x`) */
export function referencedAddresses(e: Expression | undefined): string[] {
  if (!e) return [];
  const refs: Array<{ field: string; path: string }> = [];
  collectRefs(e, '', refs);
  return refs.map((r) => refTargetAddress(r.path) ?? r.path);
}

export const resourcesOf = (ctx: LessonCtx, type: string): ResourceNode[] =>
  ctx.ir.resources.filter((r) => r.type === type);

/** how many instances of `type` the code declares (`count = 2` counts twice; unknown counts count once) */
export function instancesOf(ctx: LessonCtx, type: string): number {
  return resourcesOf(ctx, type).reduce((sum, r) => sum + (instanceCount(r, ctx.ir) ?? 1), 0);
}

/** `var.x` / `local.x` written anywhere in the root module's files */
function mentioned(ctx: LessonCtx, prefix: 'var' | 'local', name: string): boolean {
  const re = new RegExp(`\\b${prefix}\\.${name}\\b`);
  return Object.entries(ctx.files).some(([file, text]) => !file.includes('/') && re.test(text));
}

/* ------------------------------------------------------------ predicates lessons compose */

type Test = (ctx: LessonCtx) => boolean;

/** at least `min` instances of a resource type */
export const has =
  (type: string, min = 1): Test =>
  (ctx) =>
    instancesOf(ctx, type) >= min;

/** a data block of this type */
export const hasData =
  (type: string): Test =>
  (ctx) =>
    ctx.ir.data.some((d) => d.type === type);

/** some resource of `type` has `path` set to `value` (a RegExp tests its text) */
export const argIs =
  (type: string, path: string, value: Value | RegExp): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const v = valueOf(ctx.ir, argAt(r, path));
      return v !== undefined && (value instanceof RegExp ? value.test(String(v)) : v === value);
    });

/** some resource of `type` sets `path`, whatever the value */
export const argSet =
  (type: string, path: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => argAt(r, path) !== undefined);

/** some resource of `type` has `path` referencing a `targetType` resource (or data block, or `var`) */
export const argRefs =
  (type: string, path: string, targetType: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) =>
      referencedAddresses(argAt(r, path)).some(
        (a) => a.startsWith(`${targetType}.`) || a.startsWith(`data.${targetType}.`) || (targetType === 'var' && a.startsWith('var.')),
      ),
    );

/** some resource of `type` is drawn inside a `parentType` (containment the canvas derives from references) */
export const inside =
  (type: string, parentType: string): Test =>
  (ctx) => {
    const byId = new Map(ctx.ir.resources.map((r) => [r.id, r] as const));
    return resourcesOf(ctx, type).some((r) => r.parentId !== undefined && byId.get(r.parentId)?.type === parentType);
  };

/** some resource of `type` has the tag `key` (with `value`, when given) */
export const tagged =
  (type: string, key: string, value?: Value | RegExp): Test =>
    value === undefined ? argSet(type, `tags.${key}`) : argIs(type, `tags.${key}`, value);

/** a `variable` block (named `name`, when given), optionally with a default */
export const variable =
  (name?: string, opts: { hasDefault?: boolean; type?: string } = {}): Test =>
  (ctx) =>
    ctx.ir.variables.some(
      (v) =>
        (name === undefined || v.name === name) &&
        (opts.hasDefault === undefined || (v.args.default !== undefined) === opts.hasDefault) &&
        (opts.type === undefined || (v.args.type?.kind === 'ref' ? v.args.type.path : v.args.type?.kind === 'raw' ? v.args.type.hcl : undefined) === opts.type),
    );

/** `var.<name>` used somewhere (any variable, when no name) */
export const varUsed =
  (name?: string): Test =>
  (ctx) =>
    name ? mentioned(ctx, 'var', name) : ctx.ir.variables.some((v) => mentioned(ctx, 'var', v.name));

/** a local value named `name` */
export const local =
  (name: string): Test =>
  (ctx) =>
    localValue(ctx.ir, name) !== undefined;

export const localUsed =
  (name: string): Test =>
  (ctx) =>
    mentioned(ctx, 'local', name);

/** an `output` (named `name`, when given) whose value references a `refersTo` resource, when given */
export const output =
  (name?: string, refersTo?: string): Test =>
  (ctx) =>
    ctx.ir.outputs.some(
      (o) =>
        (name === undefined || o.name === name) &&
        (refersTo === undefined || referencedAddresses(o.args.value).some((a) => a.startsWith(`${refersTo}.`))),
    );

/** a `provider "<name>"` block, optionally in `region` */
export const provider =
  (name: string, region?: string): Test =>
  (ctx) =>
    ctx.ir.providers.some((p) => p.name === name && (region === undefined || valueOf(ctx.ir, p.args.region) === region));

/** the code parses, with no error diagnostics */
export const noErrors: Test = (ctx) => !ctx.errored && !ctx.diagnostics.some((d) => d.severity === 'error');

/** no security finding whose English title matches */
export const noFinding =
  (pattern: RegExp): Test =>
  (ctx) =>
    !ctx.audit.findings.some((f) => pattern.test(f.key));

/** a security finding whose English title matches (a lesson that shows a risk on purpose) */
export const finding =
  (pattern: RegExp): Test =>
  (ctx) =>
    ctx.audit.findings.some((f) => pattern.test(f.key));

/** the learner ran this terminal command successfully */
export const ran =
  (command: SimCommand): Test =>
  (ctx) =>
    ctx.ran.has(command);

/** the simulated state holds a resource of `type` (any, when no type) */
export const applied =
  (type?: string): Test =>
  (ctx) =>
    ctx.state !== null &&
    // `aws_vpc.main`, `aws_subnet.public[0]`, `module.net.aws_vpc.this`: the type is the next-to-last part
    Object.keys(ctx.state.resources).some((a) => type === undefined || a.split('.').at(-2) === type);

/** a root-module file whose text matches */
export const fileMatches =
  (file: string, pattern: RegExp): Test =>
  (ctx) =>
    pattern.test(ctx.files[file] ?? '');

export const all =
  (...tests: Test[]): Test =>
  (ctx) =>
    tests.every((t) => t(ctx));

export const any =
  (...tests: Test[]): Test =>
  (ctx) =>
    tests.some((t) => t(ctx));

export const not =
  (test: Test): Test =>
  (ctx) =>
    !test(ctx);
