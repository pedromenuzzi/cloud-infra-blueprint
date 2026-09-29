/**
 * Align and distribute a multi-selection. Positions are relative to the
 * parent container (the IR convention), so only siblings — resources in the
 * same container, or all at the top level — can be lined up together.
 */
import { messagesFor } from '@/i18n/messages';
import { NODE_H, NODE_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { IR, ResourceNode } from '@/ir/types';
import { alignMessages } from './align.messages';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

interface Box {
  node: ResourceNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

// whole pixels, not the drag grid: resources already lined up off-grid stay put
const snap = Math.round;

function boxes(ir: IR, ids: string[]): Box[] {
  const wanted = new Set(ids);
  return ir.resources
    .filter((r) => wanted.has(r.id) && r.position)
    .map((node) => ({
      node,
      x: node.position!.x,
      y: node.position!.y,
      w: node.position!.w ?? NODE_W,
      h: node.position!.h ?? NODE_H,
    }));
}

/** Why the selection can't be aligned (in the UI language in effect), or null when it can. */
export function alignBlocker(ir: IR, ids: string[], min = 2): string | null {
  const list = boxes(ir, ids);
  if (list.length < min) return messagesFor(alignMessages).atLeast(min);
  const parents = new Set(list.map((b) => b.node.parentId ?? ''));
  if (parents.size > 1) return messagesFor(alignMessages).sameContainer;
  return null;
}

const move = (b: Box, x: number, y: number): Op => ({
  kind: 'move_node',
  nodeId: b.node.id,
  position: { ...b.node.position!, x: snap(x), y: snap(y) },
});

/** Ops that line the selection up on one edge or center; [] when blocked or already aligned. */
export function alignOps(ir: IR, ids: string[], mode: AlignMode): Op[] {
  if (alignBlocker(ir, ids)) return [];
  const list = boxes(ir, ids);
  const left = Math.min(...list.map((b) => b.x));
  const right = Math.max(...list.map((b) => b.x + b.w));
  const top = Math.min(...list.map((b) => b.y));
  const bottom = Math.max(...list.map((b) => b.y + b.h));
  const target = (b: Box): { x: number; y: number } => {
    switch (mode) {
      case 'left':
        return { x: left, y: b.y };
      case 'center':
        return { x: (left + right) / 2 - b.w / 2, y: b.y };
      case 'right':
        return { x: right - b.w, y: b.y };
      case 'top':
        return { x: b.x, y: top };
      case 'middle':
        return { x: b.x, y: (top + bottom) / 2 - b.h / 2 };
      case 'bottom':
        return { x: b.x, y: bottom - b.h };
    }
  };
  return list.flatMap((b) => {
    const t = target(b);
    return snap(t.x) === b.x && snap(t.y) === b.y ? [] : [move(b, t.x, t.y)];
  });
}

/**
 * Equal gaps between the selection along an axis, keeping the first and last
 * resource where they are (needs three or more).
 */
export function distributeOps(ir: IR, ids: string[], axis: DistributeAxis): Op[] {
  if (alignBlocker(ir, ids, 3)) return [];
  const horizontal = axis === 'horizontal';
  const list = boxes(ir, ids).sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const size = (b: Box) => (horizontal ? b.w : b.h);
  const start = horizontal ? list[0].x : list[0].y;
  const last = list[list.length - 1];
  const end = (horizontal ? last.x : last.y) + size(last);
  const gap = (end - start - list.reduce((sum, b) => sum + size(b), 0)) / (list.length - 1);
  const ops: Op[] = [];
  let cursor = start;
  for (const b of list) {
    const x = horizontal ? cursor : b.x;
    const y = horizontal ? b.y : cursor;
    if (snap(x) !== b.x || snap(y) !== b.y) ops.push(move(b, x, y));
    cursor += size(b) + gap;
  }
  return ops;
}
