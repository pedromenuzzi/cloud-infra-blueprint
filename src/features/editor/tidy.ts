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
  const validEdges = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .filter((e) => !isAncestor(e.target, e.source) && !isAncestor(e.source, e.target));

  // Group top-level trees into connected components. ELK (with nested
  // hierarchy) won't pack disconnected parts itself — it stacks them in a
  // tall column — so each component is laid out on its own and packed below.
  const rootOf = (id: string) => {
    let cur = id;
    for (let guard = 0; guard < 20; guard++) {
      const parent = byId.get(cur)?.parentId;
      if (!parent || !byId.has(parent)) return cur;
      cur = parent;
    }
    return cur;
  };
  const leader = new Map(roots.map((r) => [r.id, r.id] as const));
  const find = (id: string): string => {
    let cur = id;
    while (leader.get(cur) !== cur) cur = leader.get(cur)!;
    return cur;
  };
  for (const e of validEdges) {
    const a = find(rootOf(e.source));
    const b = find(rootOf(e.target));
    if (a !== b) leader.set(a, b);
  }
  const components = new Map<string, ResourceNode[]>();
  for (const r of roots) {
    const key = find(r.id);
    components.set(key, [...(components.get(key) ?? []), r]);
  }

  const layoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '72',
    'elk.spacing.nodeNode': '36',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  };
  const laidOut = await Promise.all(
    [...components.values()].map(async (group) => {
      const ids = new Set<string>();
      const collect = (r: ResourceNode) => {
        ids.add(r.id);
        for (const c of children.get(r.id) ?? []) collect(c);
      };
      group.forEach(collect);
      const graph: ElkNode = {
        id: '__root__',
        children: group.map(toElk),
        edges: validEdges
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .map((e): ElkExtendedEdge => ({ id: e.id, sources: [e.source], targets: [e.target] })),
        layoutOptions,
      };
      return elk.layout(graph);
    }),
  );

  // shelf-pack the components into rows of a roughly 16:9 area, biggest first
  const GAP = 72;
  const sized = laidOut
    .map((g) => ({ g, w: g.width ?? 0, h: g.height ?? 0 }))
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const area = sized.reduce((sum, c) => sum + (c.w + GAP) * (c.h + GAP), 0);
  const rowWidth = Math.max(...sized.map((c) => c.w), Math.sqrt(area * 1.8));
  const offsets = new Map<ElkNode, { x: number; y: number }>();
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const c of sized) {
    if (cx > 0 && cx + c.w > rowWidth) {
      cx = 0;
      cy += rowH + GAP;
      rowH = 0;
    }
    offsets.set(c.g, { x: cx, y: cy });
    cx += c.w + GAP;
    rowH = Math.max(rowH, c.h);
  }

  const ops: Op[] = [];
  const walk = (n: ElkNode, depth: number, offset: { x: number; y: number }) => {
    for (const c of n.children ?? []) {
      const r = byId.get(c.id);
      if (!r) continue;
      const dx = depth === 0 ? ORIGIN + offset.x : 0;
      const dy = depth === 0 ? ORIGIN + offset.y : 0;
      const container = isContainerType(r.type) || (c.children?.length ?? 0) > 0;
      ops.push({
        kind: 'move_node',
        nodeId: r.id,
        position: {
          x: Math.round((c.x ?? 0) + dx),
          y: Math.round((c.y ?? 0) + dy),
          ...(container
            ? { w: Math.round(c.width ?? CONTAINER_MIN_W), h: Math.round(c.height ?? CONTAINER_MIN_H) }
            : {}),
        },
      });
      walk(c, depth + 1, offset);
    }
  };
  for (const g of laidOut) walk(g, 0, offsets.get(g) ?? { x: 0, y: 0 });
  return ops;
}
