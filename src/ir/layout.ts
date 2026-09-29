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

export function autoLayout(ir: IR, isContainerType: (type: string) => boolean): void {
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

  for (const s of sized) measure(s);

  // place new top-level nodes in rows below everything already on the canvas
  const placed: Box[] = [];
  for (const s of sized) {
    const p = s.node?.position;
    if (!p) continue;
    // ensure containers always carry a size
    if (s.isContainer) {
      p.w = Math.max(p.w ?? 0, s.w);
      p.h = Math.max(p.h ?? 0, s.h);
    }
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
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + GAP / 2 && b.x < a.x + a.w + GAP / 2 && a.y < b.y + b.h + GAP / 2 && b.y < a.y + a.h + GAP / 2;

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
