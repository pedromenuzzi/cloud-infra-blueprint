/**
 * Adding a data source (the palette's section, a drop on the canvas, ⌘K):
 * one canvas op, selected afterwards and scrolled into view.
 */
import { showToast } from '@/components/Toast';
import { canvasApi } from '@/features/editor/canvasApi';
import { useLayout } from '@/features/editor/layoutStore';
import { useEditor } from '@/features/editor/store';
import { messagesFor } from '@/i18n/messages';
import type { CanvasPosition } from '@/ir/types';
import { presetByKey } from './catalog';
import { dataSourceMessages } from './dataSources.messages';
import { buildDataNode } from './newData';

/** drag data of a palette data source: its preset key */
export const DATA_MIME = 'application/x-blueprint-data';

/** Add the preset `key` at `position` (canvas units), else in the data column. Returns the new id. */
export function addDataSource(key: string, position?: CanvasPosition): string | null {
  const preset = presetByKey(key);
  if (!preset) return null;
  const state = useEditor.getState();
  const { node, ops } = buildDataNode(state.ir, preset, position);
  // a read-only view says so; code that doesn't parse first has to
  state.applyCanvasOps(ops, node.id);
  if (!useEditor.getState().ir.data.some((d) => d.id === node.id)) return null;
  showToast(messagesFor(dataSourceMessages).added(node.id), 'success');
  // the drawer of a phone layout is in the way of what was just added
  if (useLayout.getState().compact) useLayout.getState().closeDrawer();
  setTimeout(() => canvasApi()?.focusNode(node.id), 60);
  return node.id;
}
