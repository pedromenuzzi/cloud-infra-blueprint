/**
 * Applying a connection rule (drawing an edge, dropping into a container) as
 * a pure op — shared by buildNewNode and the catalog emitter, and ready for
 * the canvas: rules whose argument sits in a nested block
 * (`blockConnections`, e.g. EKS `vpc_config { subnet_ids }`) rewrite that
 * block instead of a top-level argument.
 */
import { block, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, ResourceNode } from '@/ir/types';
import type { BlockConnectionRule, ConnectionRule, ResourceDef } from './types';

export type AnyConnectionRule = ConnectionRule | BlockConnectionRule;

/** Every rule of a def: top-level connections first, then nested-block ones. */
export function connectionRules(def: ResourceDef | undefined): AnyConnectionRule[] {
  return [...(def?.connections ?? []), ...(def?.blockConnections ?? [])];
}

/** The rule used when `def` connects to a resource of `targetType`. */
export function findConnectionRule(
  def: ResourceDef | undefined,
  targetType: string,
): AnyConnectionRule | undefined {
  return connectionRules(def).find((c) => c.targetTypes.includes(targetType));
}

function withReference(existing: Expression | undefined, rule: ConnectionRule, path: string, targetId: string) {
  if (rule.mode === 'set') return ref(path);
  const items: Expression[] =
    existing?.kind === 'list' ? [...existing.items] : existing ? [existing] : [];
  if (items.some((i) => i.kind === 'ref' && i.path.startsWith(`${targetId}.`))) return null;
  items.push(ref(path));
  return { kind: 'list', items } as Expression;
}

/** The op that makes `from` reference `to` through `rule`, or null when it already does. */
export function connectionOp(from: ResourceNode, to: ResourceNode, rule: AnyConnectionRule): Op | null {
  const path = `${to.id}.${rule.attr}`;
  if (!('block' in rule)) {
    const value = withReference(from.args[rule.arg], rule, path, to.id);
    return value ? { kind: 'set_arg', nodeId: from.id, field: rule.arg, value } : null;
  }
  const current = from.args[rule.block];
  const body =
    current?.kind === 'block' ? current.body : current?.kind === 'blocks' ? current.items[0] ?? {} : {};
  const value = withReference(body[rule.arg], rule, path, to.id);
  if (!value) return null;
  const nextBody = { ...body, [rule.arg]: value };
  const next: Expression =
    current?.kind === 'blocks'
      ? { kind: 'blocks', items: [nextBody, ...current.items.slice(1)] }
      : block(nextBody);
  return { kind: 'set_arg', nodeId: from.id, field: rule.block, value: next };
}

/** Whether `rule`'s argument already holds a value on `node` (an empty list counts as unset). */
export function isConnected(node: ResourceNode, rule: AnyConnectionRule): boolean {
  let value: Expression | undefined;
  if ('block' in rule) {
    const b = node.args[rule.block];
    value = b?.kind === 'block' ? b.body[rule.arg] : b?.kind === 'blocks' ? b.items[0]?.[rule.arg] : undefined;
  } else {
    value = node.args[rule.arg];
  }
  if (!value) return false;
  if (value.kind === 'list') return value.items.length > 0;
  return !(value.kind === 'literal' && (value.value === '' || value.value === null));
}
