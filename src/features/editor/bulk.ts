/**
 * Edits applied to a whole multi-selection at once — one undo step each:
 * a setting every selected resource shares, a tag, or a connection (attach
 * one security group to five instances).
 */
import { lit } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { connectionOp, findConnectionRule } from '@/resources/connect';
import { getDef } from '@/resources/registry';
import type { FieldDef } from '@/resources/types';

const EDITABLE: ReadonlySet<FieldDef['type']> = new Set(['string', 'number', 'boolean', 'select']);

/** values that must differ per resource — one CIDR for five subnets is never what you want */
const PER_RESOURCE = /cidr|address_prefix|ip_range|identifier|dns_name|domain_name|hostname|fqdn|^bucket$|^name$/;

export function selectedNodes(ir: IR, ids: string[]): ResourceNode[] {
  const wanted = new Set(ids);
  return ir.resources.filter((r) => wanted.has(r.id));
}

/**
 * Settings every selected resource has (same name and kind), minus the ones
 * that must differ per resource (the cloud-side name) or are references
 * (those are connections).
 */
export function commonFields(nodes: ResourceNode[]): FieldDef[] {
  const defs = nodes.map((n) => getDef(n.type));
  if (nodes.length < 2 || defs.some((d) => !d)) return [];
  const [first, ...rest] = defs as NonNullable<(typeof defs)[number]>[];
  const unique = new Set(defs.map((d) => d!.nameArg ?? 'name'));
  return first.fields.filter(
    (f) =>
      EDITABLE.has(f.type) &&
      !f.refTo &&
      !unique.has(f.name) &&
      !PER_RESOURCE.test(f.name) &&
      rest.every((d) => d.fields.some((g) => g.name === f.name && g.type === f.type)),
  );
}

/** The value all nodes share for `field`: undefined when unset everywhere, 'mixed' when they differ. */
export function sharedValue(nodes: ResourceNode[], field: string): Expression | 'mixed' | undefined {
  const key = (e: Expression | undefined) => (e ? JSON.stringify(e) : '');
  const first = nodes[0]?.args[field];
  return nodes.every((n) => key(n.args[field]) === key(first)) ? first : 'mixed';
}

/** Set (or, with null, remove) `field` on every node that doesn't already have that value. */
export function bulkSetOps(nodes: ResourceNode[], field: string, value: Expression | null): Op[] {
  return nodes.flatMap((n): Op[] => {
    const current = n.args[field];
    if (value === null) return current ? [{ kind: 'unset_arg', nodeId: n.id, field }] : [];
    return current && JSON.stringify(current) === JSON.stringify(value) ? [] : [{ kind: 'set_arg', nodeId: n.id, field, value }];
  });
}

/**
 * Add or overwrite one tag on every node that takes tags. Nodes whose tags
 * are an expression (`var.common_tags`, `merge(…)`) are skipped — rewriting
 * them would drop what the expression adds.
 */
export function bulkTagOps(nodes: ResourceNode[], key: string, value: string): { ops: Op[]; skipped: string[] } {
  const ops: Op[] = [];
  const skipped: string[] = [];
  for (const n of nodes) {
    const def = getDef(n.type);
    const tags = n.args.tags;
    if (!def?.fields.some((f) => f.type === 'tags') && !tags) continue;
    if (tags && tags.kind !== 'object') {
      skipped.push(n.id);
      continue;
    }
    const fields = tags?.kind === 'object' ? tags.fields : {};
    const next = lit(value);
    if (fields[key] && JSON.stringify(fields[key]) === JSON.stringify(next)) continue;
    ops.push({ kind: 'set_arg', nodeId: n.id, field: 'tags', value: { kind: 'object', fields: { ...fields, [key]: next } } });
  }
  return { ops, skipped };
}

/**
 * The rule `node` uses to reference a `targetType`, unless it is a containment
 * argument (subnet_id, vpc_id…): moving resources into a container is a drag,
 * not a bulk edit, or they'd land at meaningless positions inside it.
 */
function bulkRule(node: ResourceNode, targetType: string) {
  const def = getDef(node.type);
  const rule = findConnectionRule(def, targetType);
  if (!rule || def?.containment?.some((c) => c.arg === rule.arg)) return undefined;
  return rule;
}

/** Resources every selected node can reference through a connection rule (e.g. a security group). */
export function connectTargets(ir: IR, nodes: ResourceNode[]): ResourceNode[] {
  if (nodes.length < 2) return [];
  const selected = new Set(nodes.map((n) => n.id));
  return ir.resources.filter((t) => !selected.has(t.id) && nodes.every((n) => bulkRule(n, t.type) !== undefined));
}

/** Connect every node to `target`; nodes already connected are left alone. */
export function bulkConnectOps(nodes: ResourceNode[], target: ResourceNode): { ops: Op[]; already: number } {
  const ops: Op[] = [];
  let already = 0;
  for (const n of nodes) {
    const rule = bulkRule(n, target.type);
    if (!rule) continue;
    const op = connectionOp(n, target, rule);
    // a `set` rule re-points; count it as done when it already points at the target
    const current = 'block' in rule ? undefined : n.args[rule.arg];
    if (!op || (current?.kind === 'ref' && current.path.startsWith(`${target.id}.`))) already++;
    else ops.push(op);
  }
  return { ops, already };
}
