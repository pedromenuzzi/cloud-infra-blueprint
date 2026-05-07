import type { IR, IREdge, IRPatch, ModuleNode, Op, ResourceNode } from './types.js';

/**
 * Find a resource node by id, throwing if missing. Use the `*Maybe` variant
 * if absence is expected.
 */
export function findResource(ir: IR, nodeId: string): ResourceNode {
  const r = findResourceMaybe(ir, nodeId);
  if (!r) throw new Error(`ResourceNode not found: ${nodeId}`);
  return r;
}

export function findResourceMaybe(ir: IR, nodeId: string): ResourceNode | undefined {
  return ir.resources.find((r) => r.id === nodeId);
}

export function findModuleMaybe(ir: IR, nodeId: string): ModuleNode | undefined {
  return ir.modules.find((m) => m.id === nodeId);
}

/**
 * Apply a sequence of `Op`s to an IR, returning a NEW IR (functional update).
 * Existing references to nodes/edges are preserved by reference when unchanged.
 */
export function applyOps(ir: IR, ops: Op[]): IR {
  let next: IR = ir;
  for (const op of ops) next = applyOp(next, op);
  return next;
}

export function applyOp(ir: IR, op: Op): IR {
  switch (op.kind) {
    case 'add_resource':
      return { ...ir, resources: [...ir.resources, op.node] };
    case 'remove_resource':
      return {
        ...ir,
        resources: ir.resources.filter((r) => r.id !== op.nodeId),
        edges: ir.edges.filter((e) => e.fromNodeId !== op.nodeId && e.toNodeId !== op.nodeId),
      };
    case 'set_arg': {
      const next = ir.resources.map((r) =>
        r.id === op.nodeId ? { ...r, args: { ...r.args, [op.field]: op.value } } : r,
      );
      return { ...ir, resources: next };
    }
    case 'unset_arg': {
      const next = ir.resources.map((r) => {
        if (r.id !== op.nodeId) return r;
        const args = { ...r.args };
        delete args[op.field];
        return { ...r, args };
      });
      return { ...ir, resources: next };
    }
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
      return {
        ...ir,
        providers: { ...ir.providers, [op.provider]: op.config },
      };
    case 'set_variable':
      return { ...ir, variables: { ...ir.variables, [op.name]: op.decl } };
    case 'set_output':
      return { ...ir, outputs: { ...ir.outputs, [op.name]: op.decl } };
  }
}

/** Apply a bulk patch (used by templates). */
export function applyPatch(ir: IR, patch: IRPatch): IR {
  const removeRes = new Set(patch.removeResources ?? []);
  const removeEdg = new Set(patch.removeEdges ?? []);
  return {
    ...ir,
    providers: { ...ir.providers, ...(patch.setProviders ?? {}) },
    variables: { ...ir.variables, ...(patch.setVariables ?? {}) },
    outputs: { ...ir.outputs, ...(patch.setOutputs ?? {}) },
    modules: [...ir.modules.filter((m) => !removeRes.has(m.id)), ...(patch.addModules ?? [])],
    resources: [...ir.resources.filter((r) => !removeRes.has(r.id)), ...(patch.addResources ?? [])],
    edges: [...ir.edges.filter((e) => !removeEdg.has(e.id)), ...(patch.addEdges ?? [])],
  };
}

/**
 * Detect cycles in the network/reference subgraph. Returns the first cycle as
 * an ordered list of node ids, or `undefined` if the graph is a DAG.
 */
export function detectCycle(
  ir: IR,
  kinds: IREdge['kind'][] = ['reference', 'network'],
): string[] | undefined {
  const adj = new Map<string, string[]>();
  for (const e of ir.edges) {
    if (!kinds.includes(e.kind)) continue;
    const arr = adj.get(e.fromNodeId) ?? [];
    arr.push(e.toNodeId);
    adj.set(e.fromNodeId, arr);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  function visit(u: string): string[] | undefined {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === WHITE) {
        parent.set(v, u);
        const cyc = visit(v);
        if (cyc) return cyc;
      } else if (c === GRAY) {
        const cycle: string[] = [v];
        let cur: string | null = u;
        while (cur && cur !== v) {
          cycle.push(cur);
          cur = parent.get(cur) ?? null;
        }
        cycle.push(v);
        return cycle.reverse();
      }
    }
    color.set(u, BLACK);
    return undefined;
  }

  for (const node of [...ir.resources, ...ir.modules]) {
    if ((color.get(node.id) ?? WHITE) === WHITE) {
      const cyc = visit(node.id);
      if (cyc) return cyc;
    }
  }
  return undefined;
}
