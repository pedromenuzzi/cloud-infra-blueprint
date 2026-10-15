/**
 * Predicates levels 0 and 1 need beyond ../goals.ts (candidates to hoist
 * there). Same style: small, composable, tolerant of the learner's naming.
 */
import { collectRefs } from '@/ir/expr';
import { localValue } from '@/ir/repeat';
import type { ResourceNode } from '@/ir/types';
import { argAt, referencedAddresses, resourcesOf, valueOf } from '../goals';
import type { LessonCtx } from '../types';

type Test = (ctx: LessonCtx) => boolean;

/** the resource `type.name` exists (for lessons that tell the learner the name) */
export const named =
  (type: string, name: string, test: (r: ResourceNode, ctx: LessonCtx) => boolean = () => true): Test =>
  (ctx) =>
    ctx.ir.resources.some((r) => r.type === type && r.name === name && test(r, ctx));

/** some resource of `type` has a list at `path` with at least `min` items */
export const listOf =
  (type: string, path: string, min: number): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const e = argAt(r, path);
      return e?.kind === 'list' && e.items.length >= min;
    });

/** some resource of `type` has at least `min` tags written as a map */
export const tagCount =
  (type: string, min: number): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const e = argAt(r, 'tags');
      return e?.kind === 'object' && Object.keys(e.fields).length >= min;
    });

/** every resource of `type` (and there is one) has `path` referencing a `local.*` value */
export const everyUsesLocal =
  (type: string, path: string): Test =>
  (ctx) => {
    const rs = resourcesOf(ctx, type);
    return rs.length > 0 && rs.every((r) => referencedAddresses(argAt(r, path)).some((a) => a.startsWith('local.')));
  };

/** a `locals { … }` block */
export const hasLocals: Test = (ctx) => ctx.ir.extras.some((b) => /^\s*locals\s*\{/.test(b.text));

/** some resource of `type` takes `path` from a variable: `var.x` directly, or a local built from one */
export const fromVar =
  (type: string, path: string): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) =>
      referencedAddresses(argAt(r, path)).some((a) => {
        if (a.startsWith('var.')) return true;
        if (!a.startsWith('local.')) return false;
        const value = localValue(ctx.ir, a.slice(6).split(/[.[]/)[0]);
        return referencedAddresses(value).some((b) => b.startsWith('var.'));
      }),
    );

/** an `output` whose value reads `attr` of a `type` resource (`aws_s3_bucket.site.arn`) */
export const outputReads =
  (type: string, attr: RegExp): Test =>
  (ctx) =>
    ctx.ir.outputs.some((o) => {
      if (!o.args.value) return false;
      const refs: Array<{ field: string; path: string }> = [];
      collectRefs(o.args.value, 'value', refs);
      return refs.some((r) => {
        const [head, , third] = r.path.split('.');
        return head === type && third !== undefined && attr.test(third.replace(/\[.*$/, ''));
      });
    });

/** the resource ids a resource of `type` points at through `path` */
const targetsOf = (r: ResourceNode, path: string, targetType: string) =>
  referencedAddresses(argAt(r, path)).filter((a) => a.startsWith(`${targetType}.`));

/** an `aws_s3_bucket_versioning` on some bucket of the code, with `status = "Enabled"` */
export const bucketVersioned: Test = (ctx) =>
  resourcesOf(ctx, 'aws_s3_bucket_versioning').some(
    (r) =>
      targetsOf(r, 'bucket', 'aws_s3_bucket').length > 0 &&
      valueOf(ctx.ir, argAt(r, 'versioning_configuration.status')) === 'Enabled',
  );

const BLOCK_FLAGS = ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'];

/** an `aws_s3_bucket_public_access_block` on some bucket of the code, its four settings `true` */
export const bucketPrivate: Test = (ctx) =>
  resourcesOf(ctx, 'aws_s3_bucket_public_access_block').some(
    (r) => targetsOf(r, 'bucket', 'aws_s3_bucket').length > 0 && BLOCK_FLAGS.every((f) => valueOf(ctx.ir, argAt(r, f)) === true),
  );

/** the last `apply` left exactly the resources the code declares (instance keys aside) */
export const stateMatchesCode: Test = (ctx) => {
  if (!ctx.state) return false;
  const applied = new Set(Object.keys(ctx.state.resources).map((a) => a.replace(/\[[^\]]*\]$/, '')));
  const declared = new Set(ctx.ir.resources.map((r) => r.id));
  return applied.size === declared.size && [...declared].every((id) => applied.has(id));
};
