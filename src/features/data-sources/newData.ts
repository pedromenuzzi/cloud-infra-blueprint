/**
 * A data source added from the palette or ⌘K: its IR node (the preset's
 * arguments, a unique name) and where it lands (a column at the left of the
 * diagram, below the data sources already there). Pure, so tests exercise
 * exactly what users get.
 */
import { NODE_H, NODE_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { CanvasPosition, DataNode, IR } from '@/ir/types';
import { dataAddress, providerOfType } from '@/ir/types';
import type { DataSourcePreset } from './catalog';

/** the preset's name, made unique among data sources of the same type (`ubuntu`, `ubuntu_2`…) */
export function uniqueDataName(ir: IR, type: string, base: string): string {
  const taken = new Set(ir.data.map((d) => d.id));
  if (!taken.has(dataAddress(type, base))) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(dataAddress(type, `${base}_${i}`))) return `${base}_${i}`;
  return `${base}_${Date.now() % 1000}`;
}

const GAP_X = 96;
const GAP_Y = 32;

/** absolute boxes of the top-level blocks (children sit inside their container's box) */
function topBoxes(ir: IR): Array<{ x: number; y: number; w: number; h: number }> {
  const blocks = [...ir.resources.filter((r) => !r.parentId), ...ir.modules];
  return blocks
    .filter((b) => b.position)
    .map((b) => ({ x: b.position!.x, y: b.position!.y, w: b.position!.w ?? NODE_W, h: b.position!.h ?? NODE_H }));
}

/**
 * Where a new data source goes: under the column the project's data sources
 * already form, else in a new column at the left of everything, level with
 * the top of the diagram.
 */
export function dataSlot(ir: IR): CanvasPosition {
  const placed = ir.data.filter((d) => d.position).map((d) => d.position!);
  if (placed.length > 0) {
    const x = Math.min(...placed.map((p) => p.x));
    const column = placed.filter((p) => Math.abs(p.x - x) < NODE_W / 2);
    return { x, y: Math.max(...column.map((p) => p.y)) + NODE_H + GAP_Y };
  }
  const boxes = topBoxes(ir);
  if (boxes.length === 0) return { x: 40, y: 40 };
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  return { x: Math.round((left - NODE_W - GAP_X) / 8) * 8, y: top };
}

/** The node and the op that add `preset` (at `position`, else in the data column). */
export function buildDataNode(ir: IR, preset: DataSourcePreset, position?: CanvasPosition): { node: DataNode; ops: Op[] } {
  const name = uniqueDataName(ir, preset.type, preset.name);
  const node: DataNode = {
    id: dataAddress(preset.type, name),
    provider: providerOfType(preset.type),
    type: preset.type,
    name,
    args: preset.args(ir),
    position: position ?? dataSlot(ir),
    trivia: { leadingComments: [] },
  };
  return { node, ops: [{ kind: 'add_data', node }] };
}
