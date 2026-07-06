import type { Op } from '@/ir/ops';
import type { IR, IREdge } from '@/ir/types';

/** Ops that remove the reference an edge represents (shared by canvas + inspector). */
export function removeConnectionOps(ir: IR, edge: IREdge): Op[] {
  const source = ir.resources.find((r) => r.id === edge.source);
  if (!source) return [];
  const expr = source.args[edge.field];
  if (!expr) return [];
  if (expr.kind === 'ref') {
    return [{ kind: 'unset_arg', nodeId: source.id, field: edge.field }];
  }
  if (expr.kind === 'list') {
    const items = expr.items.filter(
      (i) => !(i.kind === 'ref' && i.path.startsWith(`${edge.target}.`)),
    );
    return [
      items.length > 0
        ? { kind: 'set_arg', nodeId: source.id, field: edge.field, value: { kind: 'list', items } }
        : { kind: 'unset_arg', nodeId: source.id, field: edge.field },
    ];
  }
  return [];
}

/** True when a string the user typed should be committed as a bare reference. */
export function looksLikeTraversal(text: string): boolean {
  if (/\s/.test(text)) return false;
  if (/^(var|local|module|data)\.[\w][\w.-]*$/.test(text)) return true;
  return /^[a-z][a-z0-9]*_[a-z0-9_]+\.[\w-]+(\.[\w.[\]"*-]+)*$/.test(text);
}
