/**
 * References that don't match the target's repetition — what Terraform
 * rejects as "Missing resource instance key" / "Unexpected resource instance
 * key": `aws_subnet.private.id` when the subnet has `count`, or
 * `aws_vpc.main[0].id` when the VPC has neither `count` nor `for_each`.
 * Whole-resource references (`for_each = aws_s3_bucket.x`, `depends_on`) and
 * splats are fine either way.
 */
import { messagesFor } from '@/i18n/messages';
import { collectRefs, refTargetAddress } from '../expr';
import { exprText, instanceRef, isRepeatedNode } from '../repeat';
import type { ResourceNode } from '../types';
import { instanceCheckMessages } from './instances.messages';
import type { CheckContext } from './types';

export function instanceChecks(ctx: CheckContext) {
  const m = messagesFor(instanceCheckMessages);
  const byId = new Map<string, ResourceNode>(ctx.ir.resources.map((r) => [r.id, r]));
  for (const node of ctx.ir.resources) {
    const seen = new Set<string>();
    for (const [field, expr] of Object.entries(node.args)) {
      // verbatim sub-blocks (`dynamic "x" {…}`, provisioners) keep their own scope
      if (/[\s"]/.test(field)) continue;
      const refs: Array<{ field: string; path: string }> = [];
      collectRefs(expr, field, refs);
      for (const { path } of refs) {
        const address = refTargetAddress(path);
        const target = address ? byId.get(address) : undefined;
        if (!target || target === node) continue;
        const rest = path.slice(address!.length);
        const key = `${field}\u0000${path}`;
        if (seen.has(key)) continue;
        const repeated = isRepeatedNode(target);
        if (repeated && rest.startsWith('.') && !rest.startsWith('.*')) {
          seen.add(key);
          const attr = rest.slice(1);
          const kind = target.args.count ? 'count' : 'for_each';
          const one = exprText(instanceRef(target, attr, { ir: ctx.ir, from: node }));
          const all = exprText(instanceRef(target, attr, { ir: ctx.ir, all: true }));
          ctx.warn(node, field, m.missingKey(field, path, address!, kind, one, all));
        } else if (!repeated && /^\[(?!\*\])/.test(rest)) {
          seen.add(key);
          const close = rest.indexOf(']');
          ctx.warn(node, field, m.unexpectedKey(field, path, address!, `${address}${close === -1 ? '' : rest.slice(close + 1)}`));
        }
      }
    }
  }
}
