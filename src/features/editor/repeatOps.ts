/**
 * The ops behind the inspector's "Repeat" section and the rename field:
 * one batch (one undo step) that changes `count` / `for_each` or the name,
 * re-keys the references that must follow, and — when the state should be
 * kept — records the move in a `moved {}` block.
 *
 *   add count           web.id → web[0].id        moved { web → web[0] }
 *   add for_each (key)  web.id → web["a"].id      moved { web → web["a"] }
 *   remove (keep one)   web[0].id → web.id        moved { web[0] → web }
 *   count ↔ for_each    web[0] → web["a"] …       one moved block per known pair
 *   rename              web → app everywhere      moved { web → app }
 */
import { moveOps, type MovedStatement } from '@/hcl/moved';
import type { Op } from '@/ir/ops';
import { instanceAddress, instanceKey, repeatOf, exprText, type RepeatKind } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';

export interface RepeatSpec {
  kind: RepeatKind;
  expr: Expression;
}

export interface StateOptions {
  /** write `moved {}` blocks so Terraform moves the existing objects instead of replacing them */
  keepState: boolean;
  /** moved blocks that may already be applied (see hcl/moved.ts) */
  isHistory?: (m: MovedStatement) => boolean;
}

export interface RepeatChange {
  ops: Op[];
  /** the moves the change records (shown before applying) */
  moves: MovedStatement[];
}

/** the keys / size a spec will have (a spec is judged like the argument it becomes) */
export function specRepeat(spec: RepeatSpec, ir?: IR) {
  return repeatOf({ args: { [spec.kind]: spec.expr } }, ir)!;
}

/**
 * What changing `node`'s repetition to `next` (null: a single instance)
 * takes. `key`: when adding `for_each`, the key the existing instance gets;
 * when removing repetition, the instance that stays (an index or a key).
 */
export function repeatChange(ir: IR, node: ResourceNode, next: RepeatSpec | null, options: StateOptions & { key?: string }): RepeatChange {
  const cur = repeatOf(node, ir);
  const address = node.id;
  const ops: Op[] = [];
  const moves: MovedStatement[] = [];

  if (!cur && !next) return { ops, moves };
  if (cur && next && cur.kind === next.kind) {
    if (exprText(cur.expr) !== exprText(next.expr)) ops.push({ kind: 'set_arg', nodeId: address, field: next.kind, value: next.expr });
    return { ops, moves };
  }
  if (cur) ops.push({ kind: 'unset_arg', nodeId: address, field: cur.kind });
  if (next) ops.push({ kind: 'set_arg', nodeId: address, field: next.kind, value: next.expr });

  if (!cur && next) {
    // the one existing instance gets the first index / the chosen key
    const rep = specRepeat(next, ir);
    const key = next.kind === 'count' ? '0' : (options.key ?? rep.keys?.[0]);
    if (key !== undefined && key !== '') {
      const k = next.kind === 'count' ? 0 : key;
      ops.push({ kind: 'rekey_refs', address, rekey: { add: instanceKey(next.kind, k) } });
      moves.push({ from: address, to: instanceAddress(address, next.kind, k) });
    }
  } else if (cur && !next) {
    const key = options.key ?? (cur.kind === 'count' ? '0' : cur.keys?.[0]);
    ops.push({ kind: 'rekey_refs', address, rekey: { drop: true } });
    if (key !== undefined && key !== '') moves.push({ from: instanceAddress(address, cur.kind, key), to: address });
  } else if (cur && next) {
    // count ↔ for_each: index i ↔ the i-th key, as far as both are known
    const keys = (cur.kind === 'for_each' ? cur.keys : specRepeat(next, ir).keys) ?? [];
    const size = cur.kind === 'count' ? cur.size : specRepeat(next, ir).size;
    const pairs = size !== undefined && keys.length > 0 ? Math.min(size, keys.length) : 0;
    const map: Record<string, string> = {};
    for (let i = 0; i < pairs; i++) {
      const index = instanceKey('count', i);
      const key = instanceKey('for_each', keys[i]);
      if (cur.kind === 'count') map[index] = key;
      else map[key] = index;
      moves.push({
        from: instanceAddress(address, cur.kind, cur.kind === 'count' ? i : keys[i]),
        to: instanceAddress(address, next.kind, next.kind === 'count' ? i : keys[i]),
      });
    }
    if (pairs > 0) ops.push({ kind: 'rekey_refs', address, rekey: { map } });
  }

  if (options.keepState && moves.length > 0) {
    ops.push(...moveOps(ir, moves, { after: address, isHistory: options.isHistory }));
  }
  return { ops, moves };
}

/** Renaming a resource: references follow (rename_resource), and the state too when asked. */
export function renameOps(ir: IR, node: ResourceNode, newName: string, options: StateOptions): Op[] {
  const to = resourceAddress(node.type, newName);
  if (to === node.id) return [];
  const ops: Op[] = [{ kind: 'rename_resource', nodeId: node.id, newName }];
  if (options.keepState) ops.push(...moveOps(ir, [{ from: node.id, to }], { after: to, isHistory: options.isHistory }));
  return ops;
}
