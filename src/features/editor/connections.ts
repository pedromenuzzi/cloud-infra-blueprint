import { refTargetAddress } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { IR, IREdge } from '@/ir/types';

export interface ReferenceToRemove {
  source: string;
  target: string;
  field: string;
}

/**
 * Ops that drop references (source.field → target). Grouped per source+field
 * so removing two refs from the same list doesn't let one op overwrite the
 * other. Complex (raw) expressions are left alone.
 */
export function removeReferencesOps(ir: IR, refs: ReferenceToRemove[]): Op[] {
  const groups = new Map<string, { source: string; field: string; targets: Set<string> }>();
  for (const r of refs) {
    const key = `${r.source}\u0000${r.field}`;
    const group = groups.get(key) ?? { source: r.source, field: r.field, targets: new Set<string>() };
    group.targets.add(r.target);
    groups.set(key, group);
  }
  const ops: Op[] = [];
  for (const { source, field, targets } of groups.values()) {
    const node = ir.resources.find((n) => n.id === source);
    const expr = node?.args[field];
    if (!node || !expr) continue;
    const pointsAtTarget = (path: string) => targets.has(refTargetAddress(path) ?? '');
    if (expr.kind === 'ref') {
      if (pointsAtTarget(expr.path)) ops.push({ kind: 'unset_arg', nodeId: source, field });
    } else if (expr.kind === 'list') {
      const items = expr.items.filter((i) => !(i.kind === 'ref' && pointsAtTarget(i.path)));
      if (items.length === expr.items.length) continue;
      ops.push(
        items.length > 0
          ? { kind: 'set_arg', nodeId: source, field, value: { kind: 'list', items } }
          : { kind: 'unset_arg', nodeId: source, field },
      );
    }
  }
  return ops;
}

/** Ops that remove the reference an edge represents (shared by canvas + inspector). */
export function removeConnectionOps(ir: IR, edge: IREdge): Op[] {
  return removeReferencesOps(ir, [edge]);
}

/**
 * Delete resources as one undo step: the resources, everything nested inside
 * them, and the references surviving resources held to them (no dangling refs).
 */
export function deleteResourcesOps(
  ir: IR,
  edges: IREdge[],
  ids: string[],
): { ops: Op[]; removed: string[] } {
  const removed = new Set(ids.filter((id) => ir.resources.some((r) => r.id === id)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of ir.resources) {
      if (r.parentId && removed.has(r.parentId) && !removed.has(r.id)) {
        removed.add(r.id);
        grew = true;
      }
    }
  }
  const ops: Op[] = [...removed].map((id) => ({ kind: 'remove_resource', nodeId: id }));
  ops.push(
    ...removeReferencesOps(
      ir,
      edges.filter((e) => removed.has(e.target) && !removed.has(e.source)),
    ),
  );
  return { ops, removed: [...removed] };
}

/** True when a string the user typed should be committed as a bare reference. */
export function looksLikeTraversal(text: string): boolean {
  if (/\s/.test(text)) return false;
  if (/^(var|local|module|data)\.[\w][\w.-]*$/.test(text)) return true;
  return /^[a-z][a-z0-9]*_[a-z0-9_]+\.[\w-]+(\.[\w.[\]"*-]+)*$/.test(text);
}
