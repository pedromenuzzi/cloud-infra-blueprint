import dagre from 'dagre';

import type { IR, ResourceNode, ModuleNode } from '@blueprint/ir';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const DEFAULT_DIRECTION = 'LR' as const;

export interface AutoLayoutOptions {
  /** `LR` (left → right, default) or `TB` (top → bottom). */
  direction?: 'LR' | 'TB';
  /** Spacing between sibling nodes (`nodesep`). */
  nodesep?: number;
  /** Spacing between layers (`ranksep`). */
  ranksep?: number;
  /** Override node size for measurement (defaults to `200 × 80`). */
  nodeWidth?: number;
  nodeHeight?: number;
}

/**
 * Re-position every resource and module in the IR using dagre.
 *
 * The IR coming out of the HCL parser has all `position: { x: 0, y: 0 }`
 * because parsed Terraform has no canvas coordinates — without this pass
 * the canvas would render every node stacked at the origin.
 *
 * Dagre is the same engine the canvas already uses for re-layout (we ship
 * it as a `@blueprint/web` dep), so the imported result is visually
 * indistinguishable from a "Tidy up" press inside the editor.
 *
 * Why not ELK? ELK gives nicer routing for very dense graphs but ships as a
 * 600 kB worker. Dagre is ~25 kB, runs synchronously, and produces stable
 * results that match the rest of the app — fine for the import flow.
 */
export function applyAutoLayout(ir: IR, opts: AutoLayoutOptions = {}): IR {
  const {
    direction = DEFAULT_DIRECTION,
    nodesep = 56,
    ranksep = 96,
    nodeWidth = NODE_WIDTH,
    nodeHeight = NODE_HEIGHT,
  } = opts;

  if (ir.resources.length === 0 && ir.modules.length === 0) {
    return ir;
  }

  const g = new dagre.graphlib.Graph<{ width: number; height: number }>({
    multigraph: false,
    compound: false,
  });
  g.setGraph({ rankdir: direction, nodesep, ranksep, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const r of ir.resources) {
    g.setNode(r.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const m of ir.modules) {
    g.setNode(m.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const e of ir.edges) {
    if (g.hasNode(e.fromNodeId) && g.hasNode(e.toNodeId)) {
      g.setEdge(e.fromNodeId, e.toNodeId);
    }
  }

  dagre.layout(g);

  const reposition = <T extends ResourceNode | ModuleNode>(node: T): T => {
    const laid = g.node(node.id);
    if (!laid) return node;
    return {
      ...node,
      position: {
        x: Math.round(laid.x - nodeWidth / 2),
        y: Math.round(laid.y - nodeHeight / 2),
      },
    };
  };

  return {
    ...ir,
    resources: ir.resources.map(reposition),
    modules: ir.modules.map(reposition),
  };
}
