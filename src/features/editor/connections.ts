import { refTargetAddress } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, IR, IREdge } from '@/ir/types';

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
    const next = withoutRefs(expr, (path) => targets.has(refTargetAddress(path) ?? ''));
    if (next === undefined) continue;
    ops.push(next === null ? { kind: 'unset_arg', nodeId: source, field } : { kind: 'set_arg', nodeId: source, field, value: next });
  }
  return ops;
}

/**
 * `expr` without the references `drop` matches: undefined when nothing
 * changed, null when nothing is left. Looks into nested blocks (EKS
 * `vpc_config { subnet_ids }`); a nested block itself is kept, even empty.
 */
function withoutRefs(expr: Expression, drop: (path: string) => boolean): Expression | null | undefined {
  switch (expr.kind) {
    case 'ref':
      return drop(expr.path) ? null : undefined;
    case 'list': {
      const items = expr.items.filter((i) => !(i.kind === 'ref' && drop(i.path)));
      if (items.length === expr.items.length) return undefined;
      return items.length > 0 ? { kind: 'list', items } : null;
    }
    case 'block': {
      const body = bodyWithoutRefs(expr.body, drop);
      return body ? { kind: 'block', body } : undefined;
    }
    case 'blocks': {
      let changed = false;
      const items = expr.items.map((b) => {
        const body = bodyWithoutRefs(b, drop);
        if (!body) return b;
        changed = true;
        return body;
      });
      return changed ? { kind: 'blocks', items } : undefined;
    }
    default:
      return undefined;
  }
}

function bodyWithoutRefs(
  body: Record<string, Expression>,
  drop: (path: string) => boolean,
): Record<string, Expression> | undefined {
  let changed = false;
  const next = { ...body };
  for (const [key, value] of Object.entries(body)) {
    const stripped = withoutRefs(value, drop);
    if (stripped === undefined) continue;
    changed = true;
    if (stripped === null) delete next[key];
    else next[key] = stripped;
  }
  return changed ? next : undefined;
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

/**
 * True when a string the user typed should be committed as a bare reference:
 * `var.x` / `local.x` / `module.x` / `data.x`, or an attribute of a resource
 * that exists in the project. Anything else stays a string — a Lambda handler
 * like `lambda_function.lambda_handler` or a file name like `app_bundle.zip`
 * looks like a traversal but isn't one.
 */
export function looksLikeTraversal(text: string, ir: IR): boolean {
  if (/\s/.test(text)) return false;
  if (/^(var|local|module|data)\.[\w][\w.-]*$/.test(text)) return true;
  if (!/^[a-z][a-z0-9]*_[a-z0-9_]+\.[\w-]+(\[[^\]]*\])?(\.[\w.[\]"*-]+)*$/.test(text)) return false;
  const address = refTargetAddress(text.replace(/\[[^\]]*\]/, ''));
  return address !== null && ir.resources.some((r) => r.id === address);
}
