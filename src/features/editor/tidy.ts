/**
 * "Tidy up": a layered, left-to-right layout computed by ELK with real
 * nesting — children are laid out inside their containers and containers
 * grow to fit. Returns plain move ops (positions relative to the parent,
 * the same convention as the IR), so the result is one undo step and lives
 * in the code as the usual position comments.
 */
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { IR, IREdge, ResourceNode } from '@/ir/types';

const ORIGIN = 40;

export async function computeTidyOps(
  ir: IR,
  edges: IREdge[],
  isContainerType: (type: string) => boolean,
): Promise<Op[]> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();

  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const children = new Map<string, ResourceNode[]>();
  const roots: ResourceNode[] = [];
  for (const r of ir.resources) {
    if (r.parentId && byId.has(r.parentId)) {
      const list = children.get(r.parentId) ?? [];
      list.push(r);
      children.set(r.parentId, list);
    } else {
      roots.push(r);
    }
  }

  const isAncestor = (maybeAncestor: string, id: string) => {
    let cur = byId.get(id)?.parentId;
    for (let guard = 0; cur && guard < 20; guard++) {
      if (cur === maybeAncestor) return true;
      cur = byId.get(cur)?.parentId;
    }
    return false;
  };

  const toElk = (r: ResourceNode): ElkNode => {
    const kids = children.get(r.id) ?? [];
    const container = isContainerType(r.type) || kids.length > 0;
    if (!container) return { id: r.id, width: NODE_W, height: NODE_H };
    if (kids.length === 0) {
      return {
        id: r.id,
        width: Math.max(CONTAINER_MIN_W, r.position?.w ?? 0),
        height: Math.max(CONTAINER_MIN_H, r.position?.h ?? 0),
      };
    }
    return {
      id: r.id,
      children: kids.map(toElk),
      layoutOptions: {
        'elk.padding': '[top=56,left=28,bottom=28,right=28]',
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${CONTAINER_MIN_W}, ${CONTAINER_MIN_H})`,
      },
    };
  };

  // containment already shows parent links; an edge into your own ancestor only confuses ELK
  const elkEdges: ElkExtendedEdge[] = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .filter((e) => !isAncestor(e.target, e.source) && !isAncestor(e.source, e.target))
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));

  const graph: ElkNode = {
    id: '__root__',
    children: roots.map(toElk),
    edges: elkEdges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '36',
      'elk.spacing.componentComponent': '64',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
  };

  const laid = await elk.layout(graph);
  const ops: Op[] = [];
  const walk = (n: ElkNode, depth: number) => {
    for (const c of n.children ?? []) {
      const r = byId.get(c.id);
      if (!r) continue;
      const offset = depth === 0 ? ORIGIN : 0;
      const container = isContainerType(r.type) || (c.children?.length ?? 0) > 0;
      ops.push({
        kind: 'move_node',
        nodeId: r.id,
        position: {
          x: Math.round((c.x ?? 0) + offset),
          y: Math.round((c.y ?? 0) + offset),
          ...(container
            ? { w: Math.round(c.width ?? CONTAINER_MIN_W), h: Math.round(c.height ?? CONTAINER_MIN_H) }
            : {}),
        },
      });
      walk(c, depth + 1);
    }
  };
  walk(laid, 0);
  return ops;
}
