import { findResourceMaybe } from './graph.js';

import type { IR, Op } from './types.js';

/**
 * Compute the **inverse** of a single `Op` against the IR it is about to be
 * applied to.
 *
 * Together with `applyOp`, this is what makes Undo/Redo trivial:
 * `applyOp(applyOp(ir, op), invertOp(ir, op)) === ir` (structurally) for
 * every supported `Op`. Same identity holds for `Op[]` via `invertOps`.
 *
 * `prev` MUST be the IR **before** `op` is applied. Some inverses
 * (`set_arg`, `move_node`, `rename_resource`, …) capture a value that only
 * exists in the pre-state — calling `invertOp` after `applyOp` would lose
 * it.
 *
 * Returns `undefined` when there is no meaningful inverse (e.g. setting a
 * variable that was never set before; we model the pristine-empty case as
 * "no-op to undo to").
 *
 * Implementation notes:
 *   - When the original `Op` has no observable effect (e.g. `set_arg` with
 *     identical value), the inverse is `undefined` — `useUndoableIRStore`
 *     skips no-op entries to avoid littering the history.
 *   - `add_edge` / `remove_edge` need the `IREdge` object to round-trip;
 *     inverses preserve the full edge so re-applying them recreates the
 *     same id.
 */
export function invertOp(prev: IR, op: Op): Op | undefined {
  switch (op.kind) {
    case 'add_resource':
      return { kind: 'remove_resource', nodeId: op.node.id };

    case 'remove_resource': {
      const node = findResourceMaybe(prev, op.nodeId);
      if (!node) return undefined;
      return { kind: 'add_resource', node };
    }

    case 'set_arg': {
      const node = findResourceMaybe(prev, op.nodeId);
      if (!node) return undefined;
      const previous = node.args[op.field];
      if (previous === undefined) {
        return { kind: 'unset_arg', nodeId: op.nodeId, field: op.field };
      }
      return {
        kind: 'set_arg',
        nodeId: op.nodeId,
        field: op.field,
        value: previous,
      };
    }

    case 'unset_arg': {
      const node = findResourceMaybe(prev, op.nodeId);
      if (!node) return undefined;
      const previous = node.args[op.field];
      if (previous === undefined) return undefined;
      return {
        kind: 'set_arg',
        nodeId: op.nodeId,
        field: op.field,
        value: previous,
      };
    }

    case 'rename_resource': {
      const node = findResourceMaybe(prev, op.nodeId);
      if (!node) return undefined;
      if (node.name === op.newName) return undefined;
      return { kind: 'rename_resource', nodeId: op.nodeId, newName: node.name };
    }

    case 'move_node': {
      const r = prev.resources.find((x) => x.id === op.nodeId);
      const m = prev.modules.find((x) => x.id === op.nodeId);
      const node = r ?? m;
      if (!node) return undefined;
      const { x, y } = node.position;
      if (x === op.position.x && y === op.position.y) return undefined;
      return { kind: 'move_node', nodeId: op.nodeId, position: { x, y } };
    }

    case 'reparent_node': {
      const r = findResourceMaybe(prev, op.nodeId);
      if (!r) return undefined;
      if (r.parentId === op.parentId) return undefined;
      return { kind: 'reparent_node', nodeId: op.nodeId, parentId: r.parentId };
    }

    case 'add_edge':
      return { kind: 'remove_edge', edgeId: op.edge.id };

    case 'remove_edge': {
      const edge = prev.edges.find((e) => e.id === op.edgeId);
      if (!edge) return undefined;
      return { kind: 'add_edge', edge };
    }

    case 'set_provider': {
      // No prior config means we should remove on undo, but the IR doesn't
      // model that as an Op. Re-set to the previous value or fall back to
      // undefined when none existed (caller treats undefined as "skip").
      const previous = prev.providers[op.provider];
      if (!previous) return undefined;
      return { kind: 'set_provider', provider: op.provider, config: previous };
    }

    case 'set_variable': {
      const previous = prev.variables[op.name];
      if (!previous) return undefined;
      return { kind: 'set_variable', name: op.name, decl: previous };
    }

    case 'set_output': {
      const previous = prev.outputs[op.name];
      if (!previous) return undefined;
      return { kind: 'set_output', name: op.name, decl: previous };
    }
  }
}

/**
 * Build the inverse sequence for a list of `Op`s applied in order.
 *
 * Each inverse is computed against the IR state **just before** the
 * corresponding op runs, so the returned list, when applied **in reverse**,
 * exactly undoes the original batch.
 */
export function invertOps(prev: IR, ops: Op[]): Op[] {
  const inverses: Op[] = [];
  let cursor = prev;
  for (const op of ops) {
    const inv = invertOp(cursor, op);
    if (inv) inverses.unshift(inv);
    // Advance the cursor so subsequent inverses see the right pre-state.
    // Importing applyOp here would create a cycle; do it inline instead.
    cursor = applyOpInline(cursor, op);
  }
  return inverses;
}

function applyOpInline(ir: IR, op: Op): IR {
  switch (op.kind) {
    case 'add_resource':
      return { ...ir, resources: [...ir.resources, op.node] };
    case 'remove_resource':
      return {
        ...ir,
        resources: ir.resources.filter((r) => r.id !== op.nodeId),
        edges: ir.edges.filter((e) => e.fromNodeId !== op.nodeId && e.toNodeId !== op.nodeId),
      };
    case 'set_arg':
      return {
        ...ir,
        resources: ir.resources.map((r) =>
          r.id === op.nodeId ? { ...r, args: { ...r.args, [op.field]: op.value } } : r,
        ),
      };
    case 'unset_arg':
      return {
        ...ir,
        resources: ir.resources.map((r) => {
          if (r.id !== op.nodeId) return r;
          const args = { ...r.args };
          delete args[op.field];
          return { ...r, args };
        }),
      };
    case 'rename_resource':
      return {
        ...ir,
        resources: ir.resources.map((r) => (r.id === op.nodeId ? { ...r, name: op.newName } : r)),
      };
    case 'move_node':
      return {
        ...ir,
        resources: ir.resources.map((r) =>
          r.id === op.nodeId ? { ...r, position: op.position } : r,
        ),
        modules: ir.modules.map((m) => (m.id === op.nodeId ? { ...m, position: op.position } : m)),
      };
    case 'reparent_node':
      return {
        ...ir,
        resources: ir.resources.map((r) =>
          r.id === op.nodeId ? { ...r, parentId: op.parentId } : r,
        ),
      };
    case 'add_edge':
      return { ...ir, edges: [...ir.edges, op.edge] };
    case 'remove_edge':
      return { ...ir, edges: ir.edges.filter((e) => e.id !== op.edgeId) };
    case 'set_provider':
      return { ...ir, providers: { ...ir.providers, [op.provider]: op.config } };
    case 'set_variable':
      return { ...ir, variables: { ...ir.variables, [op.name]: op.decl } };
    case 'set_output':
      return { ...ir, outputs: { ...ir.outputs, [op.name]: op.decl } };
  }
}
