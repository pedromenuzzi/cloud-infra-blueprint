/**
 * Where something lands inside a container, and the room it makes there.
 *
 * - `slotIn`: the drop spot when it's free, else the next free cell of the
 *   container's grid (the same grid Auto-arrange draws), so three EC2
 *   instances dropped on a subnet end up side by side, not on top of each other.
 * - `makeRoomOps`: a container grows to hold what's inside it instead of
 *   letting it spill out, and pushes the siblings to its right and below out
 *   of the way — up the whole parent chain.
 * - `settleOps`: after ops that change what a resource sits in (a fix that
 *   sets `db_subnet_group_name`…), put it in a free spot of its new container.
 *
 * Everything is plain move ops, so callers apply them with the change that
 * caused them — one undo step.
 */
import { deriveStructure } from '@/ir/graph';
import { ARRANGE, CONTAINER_MIN_H, CONTAINER_MIN_W, leafColumns, NODE_H, NODE_W } from '@/ir/layout';
import { applyOps, type Op } from '@/ir/ops';
import type { CanvasPosition, IR, ResourceNode } from '@/ir/types';
import { getDef, isContainerType } from '@/resources/registry';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** a node's box relative to its parent — the size the canvas draws it at */
export function boxOf(r: ResourceNode, position: CanvasPosition | undefined = r.position): Rect {
  const p = position ?? { x: 0, y: 0 };
  return isContainerType(r.type)
    ? { x: p.x, y: p.y, w: p.w ?? CONTAINER_MIN_W, h: p.h ?? CONTAINER_MIN_H }
    : { x: p.x, y: p.y, w: NODE_W, h: NODE_H };
}

export const sizeFor = (type: string) =>
  isContainerType(type) ? { w: CONTAINER_MIN_W, h: CONTAINER_MIN_H } : { w: NODE_W, h: NODE_H };

const MARGIN = 12;

const hits = (a: Rect, b: Rect, margin = MARGIN) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

const snap = (v: number) => Math.round(v / 8) * 8;

const childrenOf = (ir: IR, parentId: string | undefined, except?: string) =>
  ir.resources.filter((r) => (r.parentId ?? undefined) === parentId && r.id !== except);

/**
 * A spot for a `size` box inside `container` (relative to it): `preferred`
 * when it overlaps nothing, else the first free cell in reading order.
 */
export function slotIn(
  ir: IR,
  container: ResourceNode,
  size: { w: number; h: number },
  options: { preferred?: { x: number; y: number }; except?: string } = {},
): { x: number; y: number } {
  const kids = childrenOf(ir, container.id, options.except);
  const taken = kids.map((k) => boxOf(k));
  const free = (r: Rect) => !taken.some((t) => hits(r, t));
  if (options.preferred) {
    // never over the title bar or the left edge
    const r = { x: Math.max(8, snap(options.preferred.x)), y: Math.max(ARRANGE.top - 8, snap(options.preferred.y)), ...size };
    if (free(r)) return { x: r.x, y: r.y };
  }
  const group = isContainerType(container.type) && size.w > NODE_W;
  // line up with what's already there: siblings of the same kind anchor the grid
  const alike = kids.filter((k) => isContainerType(k.type) === group);
  const anchor =
    alike.length > 0
      ? { x: Math.min(...alike.map((k) => boxOf(k).x)), y: Math.min(...alike.map((k) => boxOf(k).y)) }
      : { x: ARRANGE.pad, y: ARRANGE.top };
  const width = boxOf(container).w;
  const gapX = group ? ARRANGE.groupGap : ARRANGE.gapX;
  const gapY = group ? ARRANGE.groupGap : ARRANGE.gapY;
  const fits = Math.max(1, Math.floor((width - anchor.x - ARRANGE.pad + gapX) / (size.w + gapX)));
  // leaves only: grow into the square-ish grid Auto-arrange would draw
  const onlyLeaves = kids.every((k) => !isContainerType(k.type));
  const cols = onlyLeaves && !group ? Math.max(fits, leafColumns(kids.length + 1)) : fits;
  for (let row = 0; row < 400; row++) {
    for (let col = 0; col < cols; col++) {
      const r = { x: anchor.x + col * (size.w + gapX), y: anchor.y + row * (size.h + gapY), ...size };
      if (free(r)) return { x: r.x, y: r.y };
    }
  }
  return { x: anchor.x, y: Math.max(ARRANGE.top, ...taken.map((t) => t.y + t.h + gapY)) };
}

/**
 * A free spot for a `size` box among `parentId`'s children (or on the top
 * level) as close as possible to `preferred`, scanning right, then down.
 */
export function freeSpotAround(
  ir: IR,
  parentId: string | undefined,
  size: { w: number; h: number },
  preferred: { x: number; y: number },
  except?: string,
): { x: number; y: number } {
  const taken = childrenOf(ir, parentId, except).map((k) => boxOf(k));
  const start = { x: snap(preferred.x), y: snap(preferred.y) };
  const stepX = size.w + ARRANGE.gapX;
  const stepY = size.h + ARRANGE.gapY;
  for (let ring = 0; ring < 12; ring++) {
    for (let row = 0; row <= ring; row++) {
      for (let col = 0; col <= ring; col++) {
        if (row !== ring && col !== ring) continue;
        const r = { x: start.x + col * stepX, y: start.y + row * stepY, ...size };
        if (!taken.some((t) => hits(r, t))) return { x: r.x, y: r.y };
      }
    }
  }
  return start;
}

/**
 * Grow `containerId` (and its ancestors) so every child fits, pushing the
 * siblings to the right and below by what it grew. `extra` is a box about
 * to be added inside it; `positions` already-decided moves to build on.
 */
export function makeRoomOps(
  ir: IR,
  containerId: string,
  extra?: Rect,
  positions: Map<string, CanvasPosition> = new Map(),
): Op[] {
  return resizeOps(ir, containerId, undefined, positions, extra);
}

/**
 * Give `containerId` exactly `size` (undefined: whatever fits its children),
 * then grow each ancestor to fit — every container that grows pushes its
 * siblings to the right and below out of the way. Returns the moves.
 */
export function resizeOps(
  ir: IR,
  containerId: string,
  size: { w: number; h: number } | undefined,
  positions: Map<string, CanvasPosition> = new Map(),
  extra?: Rect,
): Op[] {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const decided = new Map(positions);
  const changed = new Map<string, CanvasPosition>();
  const pos = (r: ResourceNode) => decided.get(r.id) ?? r.position;
  const set = (id: string, p: CanvasPosition) => {
    decided.set(id, p);
    changed.set(id, p);
  };

  let current: ResourceNode | undefined = byId.get(containerId);
  let target = size;
  let inside: Rect | undefined = extra;
  for (let guard = 0; current && guard < 16; guard++) {
    const box = boxOf(current, pos(current));
    let w: number;
    let h: number;
    if (target) {
      ({ w, h } = target);
    } else {
      const kids = ir.resources.filter((r) => r.parentId === current!.id).map((k) => boxOf(k, pos(k)));
      if (inside) kids.push(inside);
      w = Math.max(box.w, Math.max(0, ...kids.map((k) => k.x + k.w)) + ARRANGE.pad);
      h = Math.max(box.h, Math.max(0, ...kids.map((k) => k.y + k.h)) + ARRANGE.pad);
    }
    if (w === box.w && h === box.h) break;
    set(current.id, { ...(pos(current) ?? { x: 0, y: 0 }), x: box.x, y: box.y, w, h });
    const dw = w - box.w;
    const dh = h - box.h;
    // siblings wholly to the right move right, wholly below move down —
    // the rest of the drawing keeps its shape and nothing new overlaps
    for (const sibling of ir.resources) {
      if (sibling.id === current.id || (sibling.parentId ?? undefined) !== (current.parentId ?? undefined)) continue;
      const s = boxOf(sibling, pos(sibling));
      const shiftX = dw > 0 && s.x >= box.x + box.w ? dw : 0;
      const shiftY = dh > 0 && s.y >= box.y + box.h ? dh : 0;
      if (shiftX === 0 && shiftY === 0) continue;
      const p = pos(sibling) ?? { x: 0, y: 0 };
      set(sibling.id, { ...p, x: p.x + shiftX, y: p.y + shiftY });
    }
    target = undefined;
    inside = undefined;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return [...changed].map(([nodeId, position]) => ({ kind: 'move_node' as const, nodeId, position }));
}

/** the IR after `ops`, with containment derived (a scratch copy — the input is untouched) */
export function preview(ir: IR, ops: Op[]): IR {
  const next = applyOps(ir, ops).ir;
  const scratch = { ...next, resources: next.resources.map((r) => ({ ...r })) };
  deriveStructure(scratch, getDef);
  return scratch;
}

/**
 * `ops` plus the moves that settle `nodeId` in the container those ops put
 * it in: a free spot there (the container grows to fit). Nothing extra when
 * its container doesn't change.
 */
export function settleOps(ir: IR, ops: Op[], nodeId: string): Op[] {
  const before = ir.resources.find((r) => r.id === nodeId);
  const after = preview(ir, ops);
  const node = after.resources.find((r) => r.id === nodeId);
  if (!node || !before || node.parentId === before.parentId) return ops;
  const size = sizeFor(node.type);
  const keep = node.position?.w !== undefined ? { w: node.position.w, h: node.position.h } : {};
  if (!node.parentId) {
    // left its container: stay where it was drawn, on the top level
    const abs = absolutePosition(ir, before);
    const spot = freeSpotAround(after, undefined, size, abs, nodeId);
    return [...ops, { kind: 'move_node', nodeId, position: { ...spot, ...keep } }];
  }
  const parent = after.resources.find((r) => r.id === node.parentId)!;
  const spot = slotIn(after, parent, keep.w ? { w: keep.w, h: keep.h ?? size.h } : size, { except: nodeId });
  const box = { ...spot, w: keep.w ?? size.w, h: keep.h ?? size.h };
  return [
    ...ops,
    { kind: 'move_node', nodeId, position: { ...spot, ...keep } },
    ...makeRoomOps(after, parent.id, box),
  ];
}

/** top-left of a node in canvas coordinates (positions are relative to the parent) */
export function absolutePosition(ir: IR, node: ResourceNode): { x: number; y: number } {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  let x = node.position?.x ?? 0;
  let y = node.position?.y ?? 0;
  for (let cur = node.parentId ? byId.get(node.parentId) : undefined, guard = 0; cur && guard < 16; guard++) {
    x += cur.position?.x ?? 0;
    y += cur.position?.y ?? 0;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return { x, y };
}
