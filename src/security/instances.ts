/**
 * The audit sees a repeated resource as its instances: one finding for the
 * block, worded for all of them ("web (each of its 3 instances)"), and fixes
 * that cover every instance (a public access block per bucket instance).
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { ref, refTargetAddress } from '@/ir/expr';
import { repeatOf } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { instanceMessages } from './instances.messages';

/**
 * Arguments that make a new resource follow `target` instance by instance:
 * `for_each = aws_s3_bucket.x` + `bucket = each.value.id`, the same `count`
 * + `bucket = aws_s3_bucket.x[count.index].id`, or just `bucket = aws_s3_bucket.x.id`.
 */
export function perInstanceArgs(target: ResourceNode, arg: string, attr: string): Record<string, Expression> {
  const rep = repeatOf(target);
  if (!rep) return { [arg]: ref(`${target.id}.${attr}`) };
  if (rep.kind === 'for_each') return { for_each: ref(target.id), [arg]: ref(`each.value.${attr}`) };
  return { count: rep.expr, [arg]: ref(`${target.id}[count.index].${attr}`) };
}

/** `bucket = each.value.id` under `for_each = aws_s3_bucket.x` points at aws_s3_bucket.x */
export function chainedTarget(r: ResourceNode, arg: string): string | undefined {
  const value = r.args[arg];
  const each = r.args.for_each;
  if (value?.kind !== 'ref' || !/^each\.value\b/.test(value.path) || each?.kind !== 'ref') return undefined;
  return refTargetAddress(each.path) ?? undefined;
}

/** how many instances `r` is when that is worth saying: undefined → one; null-size → "each of its instances" */
function many(r: ResourceNode, ir: IR): { n: number | undefined } | null {
  const rep = repeatOf(r, ir);
  if (!rep || rep.optional) return null;
  if (rep.size !== undefined && rep.size <= 1) return null;
  return { n: rep.size };
}

/** `name`, or "name (each of its 3 instances)" for a repeated resource */
export function subjectName(name: string, r: ResourceNode | undefined, ir: IR, locale: Locale = currentLocale()): string {
  const m = r ? many(r, ir) : null;
  return m ? messagesFor(instanceMessages, locale).eachOf(name, m.n) : name;
}

/** "Applies to each of its 3 instances." for a repeated resource, else null */
export function appliesToEach(r: ResourceNode, ir: IR, locale: Locale = currentLocale()): string | null {
  const m = many(r, ir);
  return m ? messagesFor(instanceMessages, locale).appliesToEach(m.n) : null;
}
