/**
 * Predicates level 4 (references and data) needs on top of ../goals.ts:
 * `data` blocks' own arguments, resources and outputs that read a data
 * source (directly or through a local), `depends_on` that repeats a
 * reference, how an argument is written (a function, a template) and
 * values pasted where a lookup belongs. Candidates to hoist into goals.ts.
 */
import { instancesOf as repeatInstances, stringFor, type Instance } from '@/ir/checks/repeatValues';
import { exprText, localValue } from '@/ir/repeat';
import type { Expression, IR } from '@/ir/types';
import { blockContains, blocksOverlap, parseCidrBlock, type CidrBlock } from '@/resources/cidr';
import { argAt, referencedAddresses, resourcesOf, valueOf } from '../goals';
import type { LessonCtx } from '../types';

type Test = (ctx: LessonCtx) => boolean;

/** an expression and the `local.x` values it reads, recursively (a local reading itself stops there) */
function withLocals(ir: IR, e: Expression | undefined, seen = new Set<string>()): Expression[] {
  if (!e) return [];
  const out = [e];
  for (const a of referencedAddresses(e)) {
    const name = /^local\.([A-Za-z_][\w-]*)/.exec(a)?.[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(...withLocals(ir, localValue(ir, name), seen));
  }
  return out;
}

/** some `data` block of `type` has `path` set to `value` (a RegExp tests its text); any value when omitted */
export const dataArg =
  (type: string, path: string, value?: string | number | boolean | RegExp): Test =>
  (ctx) =>
    ctx.ir.data.some((d) => {
      const e = d.type === type ? argAt(d, path) : undefined;
      if (e === undefined) return false;
      if (value === undefined) return true;
      const v = valueOf(ctx.ir, e);
      return v !== undefined && (value instanceof RegExp ? value.test(String(v)) : v === value);
    });

/** some resource of `type` has `path` reading a `data "<dataType>"` block, directly or through locals */
export const readsData =
  (type: string, path: string, dataType: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) =>
      withLocals(ctx.ir, argAt(r, path)).some((e) => referencedAddresses(e).some((a) => a.startsWith(`data.${dataType}.`))),
    );

/** an `output` whose value reads a `data "<dataType>"` block (its attribute matching `attr`, when given), directly or through locals */
export const outputReadsData =
  (dataType: string, attr?: RegExp): Test =>
  (ctx) =>
    ctx.ir.outputs.some((o) =>
      withLocals(ctx.ir, o.args.value).some((e) =>
        referencedAddresses(e).some((a) => {
          const [head, type, , attribute] = a.split('.');
          return head === 'data' && type === dataType && (attr === undefined || (attribute !== undefined && attr.test(attribute.replace(/\[.*$/, ''))));
        }),
      ),
    );

/** some resource lists in `depends_on` a block it already references elsewhere (the reference already orders them) */
export const redundantDependsOn: Test = (ctx) =>
  ctx.ir.resources.some((r) => {
    const listed = new Set(referencedAddresses(r.args.depends_on));
    if (listed.size === 0) return false;
    return Object.entries(r.args).some(
      ([k, e]) => k !== 'depends_on' && withLocals(ctx.ir, e).some((x) => referencedAddresses(x).some((a) => listed.has(a))),
    );
  });

/**
 * Every resource of `type` (and there is one) writes `path` in a way that
 * matches: `/\bcidrsubnet\(/` for a function call, `/\$\{/` for a template.
 * The locals it reads count as part of it.
 */
export const writtenWith =
  (type: string, path: string, pattern: RegExp): Test =>
  (ctx) => {
    const rs = resourcesOf(ctx, type);
    return rs.length > 0 && rs.every((r) => withLocals(ctx.ir, argAt(r, path)).some((e) => pattern.test(exprText(e))));
  };

/** a CIDR an expression certainly evaluates to (`cidrsubnet(aws_vpc.main.cidr_block, 8, 1)` included) */
function cidrOf(ir: IR, e: Expression | undefined, instance?: Instance): CidrBlock | undefined {
  const text = stringFor(e, ir, instance);
  const parsed = text === undefined ? undefined : parseCidrBlock(text);
  return parsed?.ok ? parsed.block : undefined;
}

/**
 * Every subnet range that can be worked out (literals and `cidrsubnet`, per
 * `count` instance too) sits inside its VPC and overlaps no other; at least
 * one subnet. Ranges it can't work out don't count against it.
 */
export const subnetRangesFit: Test = (ctx) => {
  const subnets = resourcesOf(ctx, 'aws_subnet');
  const taken: CidrBlock[] = [];
  for (const s of subnets) {
    const vpc = ctx.ir.resources.find((r) => r.id === s.parentId && r.type === 'aws_vpc');
    const network = vpc && cidrOf(ctx.ir, vpc.args.cidr_block);
    for (const instance of repeatInstances(s, ctx.ir) ?? [undefined]) {
      const block = cidrOf(ctx.ir, s.args.cidr_block, instance);
      if (!block) continue;
      if ((network && !blockContains(network, block)) || taken.some((t) => blocksOverlap(t, block))) return false;
      taken.push(block);
    }
  }
  return subnets.length > 0;
};

/** every string literal in an expression, nested ones included */
function literals(e: Expression | undefined): string[] {
  if (!e) return [];
  switch (e.kind) {
    case 'literal':
      return typeof e.value === 'string' ? [e.value] : [];
    case 'list':
      return e.items.flatMap(literals);
    case 'object':
      return Object.values(e.fields).flatMap(literals);
    case 'block':
      return Object.values(e.body).flatMap(literals);
    case 'blocks':
      return e.items.flatMap((b) => Object.values(b).flatMap(literals));
    default:
      return [];
  }
}

/** no resource argument is a value pasted where a lookup belongs: an AMI id, a zone name, a VPC or subnet id */
export const nothingPasted =
  (pattern = /^(ami-[0-9a-f]{8,}|(vpc|subnet|sg)-[0-9a-f]{8,}|[a-z]{2}(-gov)?-[a-z]+-\d[a-z])$/): Test =>
  (ctx) =>
    ctx.ir.resources.every((r) => Object.values(r.args).every((e) => !literals(e).some((s) => pattern.test(s))));
