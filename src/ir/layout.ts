/**
 * Deterministic auto-layout for IR nodes that have no persisted position
 * (e.g. HCL pasted from an existing project). Containers grow to fit their
 * children; children positions are relative to their parent (React Flow
 * subflow convention).
 */
import type { IR, ResourceNode } from './types';

export const NODE_W = 208;
export const NODE_H = 76;
const PAD = 28;
const TITLE_H = 44;
const GAP = 36;
const MAX_ROW_W = 1280;
export const CONTAINER_MIN_W = 320;
export const CONTAINER_MIN_H = 180;

/**
 * Spacing of Auto-arrange, shared with new-node placement so an added
 * resource lands where arranging would put it.
 */
export const ARRANGE = {
  /** container sides and bottom */
  pad: 28,
  /** first row inside a container, below its title bar */
  top: 56,
  /** between resources in a row / between rows */
  gapX: 36,
  gapY: 32,
  /** between sibling containers (subnets side by side) */
  groupGap: 36,
  /** between a container's resources and its sub-containers */
  bandGap: 40,
} as const;

/** columns of the grid `n` resources are arranged in: square-ish (1, 2, 2, 2, 3, 3…) */
export const leafColumns = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

interface Sized {
  node: ResourceNode | null; // null = virtual root
  children: Sized[];
  w: number;
  h: number;
  isContainer: boolean;
}

/**
 * Lays out what has no position yet. Returns the ids of the nodes whose
 * saved position it had to change (see `adoptSavedChildren`): the text
 * still holds their old spots until an edit writes these down.
 */
export function autoLayout(ir: IR, isContainerType: (type: string) => boolean): Set<string> {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const childrenMap = new Map<string, ResourceNode[]>();
  const roots: ResourceNode[] = [];
  for (const r of ir.resources) {
    if (r.parentId && byId.has(r.parentId)) {
      const arr = childrenMap.get(r.parentId) ?? [];
      arr.push(r);
      childrenMap.set(r.parentId, arr);
    } else {
      roots.push(r);
    }
  }
  const adopted = adoptSavedChildren(ir, byId, childrenMap, isContainerType);

  const build = (node: ResourceNode): Sized => {
    const kids = (childrenMap.get(node.id) ?? []).map(build);
    const isContainer = isContainerType(node.type) || kids.length > 0;
    return { node, children: kids, w: NODE_W, h: NODE_H, isContainer };
  };

  const sized = roots.map(build);

  // measure + place children (relative coordinates) bottom-up
  const measure = (s: Sized): void => {
    for (const c of s.children) measure(c);
    if (!s.isContainer) {
      s.w = NODE_W;
      s.h = NODE_H;
      return;
    }
    if (s.children.length === 0) {
      const persisted = s.node?.position;
      s.w = persisted?.w ?? CONTAINER_MIN_W;
      s.h = persisted?.h ?? CONTAINER_MIN_H;
      return;
    }
    const innerMax = Math.max(MAX_ROW_W / 2, NODE_W * 2 + GAP);
    // siblings the user already placed keep their spot; new ones flow around them
    const occupied: Box[] = [];
    for (const c of s.children) {
      const p = c.node?.position;
      if (p) occupied.push({ x: p.x, y: p.y, w: c.w, h: c.h });
    }
    const flow = rowFlow(occupied, PAD, TITLE_H, innerMax);
    for (const c of s.children) {
      if (!c.node || c.node.position) continue;
      c.node.position = flow(c.w, c.h);
      if (c.isContainer) {
        c.node.position.w = c.w;
        c.node.position.h = c.h;
      }
    }
    const right = Math.max(0, ...occupied.map((b) => b.x + b.w));
    const bottom = Math.max(TITLE_H, ...occupied.map((b) => b.y + b.h));
    const persistedSelf = s.node?.position;
    s.w = Math.max(CONTAINER_MIN_W, persistedSelf?.w ?? 0, right + PAD);
    s.h = Math.max(CONTAINER_MIN_H, persistedSelf?.h ?? 0, bottom + PAD);
    // nested containers grow to fit too (top-level ones are sized below)
    if (persistedSelf && s.node?.parentId) {
      persistedSelf.w = s.w;
      persistedSelf.h = s.h;
    }
  };

  const settle = () => {
    for (const s of sized) measure(s);
    // ensure containers always carry a size
    for (const s of sized) {
      const p = s.node?.position;
      if (p && s.isContainer) {
        p.w = Math.max(p.w ?? 0, s.w);
        p.h = Math.max(p.h ?? 0, s.h);
      }
    }
  };
  settle();
  // an adopted container clears its level, then each container it is in (grown to hold it) clears its own
  for (const { node, ancestors } of adopted.containers) {
    for (const level of [{ node, before: null }, ...ancestors]) {
      if (nudgeClear(ir, level.node, level.before, isContainerType, adopted.moved)) settle();
    }
  }

  // place new top-level nodes in rows below everything already on the canvas
  const placed: Box[] = [];
  for (const s of sized) {
    const p = s.node?.position;
    if (!p) continue;
    placed.push({ x: p.x, y: p.y, w: s.isContainer ? (p.w ?? s.w) : s.w, h: s.isContainer ? (p.h ?? s.h) : s.h });
  }
  const top = placed.length > 0 ? Math.max(...placed.map((b) => b.y + b.h)) + GAP + 8 : 40;
  const flow = rowFlow(placed, 40, top, MAX_ROW_W);
  for (const s of sized) {
    if (!s.node || s.node.position) continue;
    s.node.position = flow(s.w, s.h);
    if (s.isContainer) {
      s.node.position.w = s.w;
      s.node.position.h = s.h;
    }
  }
  return adopted.moved;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + GAP / 2 && b.x < a.x + a.w + GAP / 2 && a.y < b.y + b.h + GAP / 2 && b.y < a.y + a.h + GAP / 2;

/** a positioned node's box in its parent's coordinates, as the canvas draws it */
function boxOf(r: ResourceNode, isContainerType: (type: string) => boolean): Box {
  const p = r.position!;
  return isContainerType(r.type) ? { x: p.x, y: p.y, w: p.w ?? CONTAINER_MIN_W, h: p.h ?? CONTAINER_MIN_H } : { x: p.x, y: p.y, w: NODE_W, h: NODE_H };
}

/**
 * Children saved before their parent's type held anything: an Aurora
 * cluster (`aws_rds_cluster`) became a container after projects had placed
 * its instances on the canvas, as top-level nodes beside it. The app saves
 * every container with its size, so one saved without a size dates from
 * then, and its children's saved spots are canvas coordinates. It is drawn
 * around the children that sit in its own parent's area (where they were,
 * and where its card was); the others take a free spot inside it, like a
 * new child. What it and the containers it is in then cover is moved by
 * `nudgeClear`.
 */
function adoptSavedChildren(
  ir: IR,
  byId: Map<string, ResourceNode>,
  childrenMap: Map<string, ResourceNode[]>,
  isContainerType: (type: string) => boolean,
): { containers: Array<{ node: ResourceNode; ancestors: Array<{ node: ResourceNode; before: Box }> }>; moved: Set<string> } {
  const containers: Array<{ node: ResourceNode; ancestors: Array<{ node: ResourceNode; before: Box }> }> = [];
  const moved = new Set<string>();
  for (const c of ir.resources) {
    const p = c.position;
    if (!p || p.w !== undefined || !isContainerType(c.type)) continue;
    // where its parent's coordinates start on the canvas (every ancestor placed, or nothing to go by)
    const origin = { x: 0, y: 0 };
    const ancestors: Array<{ node: ResourceNode; before: Box }> = [];
    let a = c.parentId ? byId.get(c.parentId) : undefined;
    for (let depth = 0; a?.position && depth < 16; depth++) {
      origin.x += a.position.x;
      origin.y += a.position.y;
      ancestors.push({ node: a, before: boxOf(a, isContainerType) });
      a = a.parentId ? byId.get(a.parentId) : undefined;
    }
    if (a) continue;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    const area = parent ? boxOf(parent, isContainerType) : undefined;
    const kept: Array<{ node: ResourceNode; box: Box }> = [];
    for (const k of childrenMap.get(c.id) ?? []) {
      if (!k.position) continue;
      const box = { ...boxOf(k, isContainerType), x: k.position.x - origin.x, y: k.position.y - origin.y };
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      // drawn outside the container the cluster is in: a spot inside the cluster instead
      if (area && (cx < 0 || cy < 0 || cx > area.w || cy > area.h)) k.position = undefined;
      else kept.push({ node: k, box });
      moved.add(k.id);
    }
    const left = Math.min(p.x, ...kept.map(({ box }) => box.x - ARRANGE.pad));
    const top = Math.min(p.y, ...kept.map(({ box }) => box.y - ARRANGE.top));
    const right = Math.max(p.x + NODE_W, ...kept.map(({ box }) => box.x + box.w + ARRANGE.pad));
    const bottom = Math.max(p.y + NODE_H, ...kept.map(({ box }) => box.y + box.h + ARRANGE.pad));
    for (const { node, box } of kept) Object.assign(node.position!, { x: box.x - left, y: box.y - top });
    // inside a parent, clear of its edge and title bar (the children come along)
    const shift = area ? { x: Math.max(0, 8 - left), y: Math.max(0, ARRANGE.top - 8 - top) } : { x: 0, y: 0 };
    Object.assign(p, {
      x: left + shift.x,
      y: top + shift.y,
      w: Math.max(CONTAINER_MIN_W, right - left),
      h: Math.max(CONTAINER_MIN_H, bottom - top),
    });
    containers.push({ node: c, ancestors });
    moved.add(c.id);
  }
  return { containers, moved };
}

const covers = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * What `c` now covers on its own level (`before`: only what its old box
 * didn't) moves out of the way: to its right or below it, whichever is the
 * shorter move, past anything already there. Everything else keeps its spot.
 * True when something moved (the containers around it then grow to hold it).
 */
function nudgeClear(ir: IR, c: ResourceNode, before: Box | null, isContainerType: (type: string) => boolean, moved: Set<string>): boolean {
  const box = boxOf(c, isContainerType);
  let nudged = false;
  const level = ir.resources.filter((s) => s !== c && s.position && s.parentId === c.parentId);
  for (const s of level) {
    const from = boxOf(s, isContainerType);
    if (!covers(from, box) || (before && covers(from, before))) continue;
    const others = [box, ...level.filter((o) => o !== s).map((o) => boxOf(o, isContainerType))];
    const clear = (start: Box, axis: 'x' | 'y'): Box => {
      let b = start;
      for (let guard = 0; guard < 64; guard++) {
        const hit = others.find((o) => overlaps(o, b));
        if (!hit) break;
        b = axis === 'x' ? { ...b, x: hit.x + hit.w + GAP } : { ...b, y: hit.y + hit.h + GAP };
      }
      return b;
    };
    const right = clear({ ...from, x: box.x + box.w + GAP }, 'x');
    const below = clear({ ...from, y: box.y + box.h + GAP }, 'y');
    const to = right.x - from.x <= below.y - from.y ? right : below;
    // in place: a module call or data source shares its position object with the IR it came from
    Object.assign(s.position!, { x: to.x, y: to.y });
    moved.add(s.id);
    nudged = true;
  }
  return nudged;
}

/**
 * Row-by-row placement from (left, top) that skips boxes already taken.
 * Every placed box is added to `occupied`.
 */
function rowFlow(occupied: Box[], left: number, top: number, maxRight: number) {
  let x = left;
  let y = top;
  let rowH = 0;
  return (w: number, h: number): { x: number; y: number } => {
    for (;;) {
      if (x > left && x + w > maxRight) {
        x = left;
        y += Math.max(rowH, NODE_H) + GAP;
        rowH = 0;
      }
      const box = { x, y, w, h };
      const hit = occupied.find((o) => overlaps(o, box));
      if (hit) {
        x = hit.x + hit.w + GAP;
        continue;
      }
      occupied.push(box);
      rowH = Math.max(rowH, h);
      x += w + GAP;
      return { x: box.x, y: box.y };
    }
  }
}
