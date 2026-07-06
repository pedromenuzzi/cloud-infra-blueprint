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
    let x = PAD;
    let y = TITLE_H;
    let rowH = 0;
    let maxW = 0;
    for (const c of s.children) {
      if (x > PAD && x + c.w > innerMax) {
        x = PAD;
        y += rowH + GAP;
        rowH = 0;
      }
      const persisted = c.node?.position;
      if (persisted) {
        // keep persisted relative position, still grow the container to fit
        maxW = Math.max(maxW, persisted.x + c.w);
        y = Math.max(y, persisted.y);
        rowH = Math.max(rowH, c.h + (persisted.y - y));
      } else if (c.node) {
        c.node.position = { x, y };
        if (c.isContainer) {
          c.node.position.w = c.w;
          c.node.position.h = c.h;
        }
        maxW = Math.max(maxW, x + c.w);
        rowH = Math.max(rowH, c.h);
        x += c.w + GAP;
      }
    }
    const persistedSelf = s.node?.position;
    s.w = Math.max(CONTAINER_MIN_W, persistedSelf?.w ?? 0, maxW + PAD);
    s.h = Math.max(CONTAINER_MIN_H, persistedSelf?.h ?? 0, y + rowH + PAD);
  };

  for (const s of sized) measure(s);

  // place top-level nodes, flowing rows left→right
  let cursorX = 40;
  let cursorY = 40;
  let rowH = 0;
  // account for already-positioned top-level nodes so new ones don't overlap
  for (const s of sized) {
    const p = s.node?.position;
    if (p) {
      cursorY = Math.max(cursorY, p.y);
    }
  }
  for (const s of sized) {
    if (!s.node) continue;
    if (s.node.position) {
      // ensure containers always carry a size
      if (s.isContainer) {
        s.node.position.w = Math.max(s.node.position.w ?? 0, s.w);
        s.node.position.h = Math.max(s.node.position.h ?? 0, s.h);
      }
      continue;
    }
    if (cursorX > 40 && cursorX + s.w > MAX_ROW_W) {
      cursorX = 40;
      cursorY += rowH + GAP + 8;
      rowH = 0;
    }
    s.node.position = { x: cursorX, y: cursorY };
    if (s.isContainer) {
      s.node.position.w = s.w;
      s.node.position.h = s.h;
    }
    cursorX += s.w + GAP + 8;
    rowH = Math.max(rowH, s.h);
  }
}
