/**
 * The canvas context menu of a data source. Entry ids follow the resource
 * menu's (`rename`, `delete`…) so a read-only view drops the same ones.
 */
import { ArrowUpRight, Code2, Copy, PencilLine, Trash2 } from 'lucide-react';
import type { MenuEntry } from '@/components/ContextMenu';
import { showToast } from '@/components/Toast';
import { canvasMessages } from '@/features/editor/CanvasPane.messages';
import { useEditor } from '@/features/editor/store';
import { messagesFor } from '@/i18n/messages';
import { findData, isDataId } from '@/ir/dataSources';
import { copyText } from '@/lib/download';
import { dataDocsUrl } from './catalog';

/** Menu entries for the data source `id`; [] when it isn't one. `rename` focuses the inspector's name field. */
export function dataMenuEntries(id: string, rename: () => void): MenuEntry[] {
  if (!isDataId(id)) return [];
  const node = findData(useEditor.getState().ir, id);
  if (!node) return [];
  const cm = messagesFor(canvasMessages);
  const docs = dataDocsUrl(node.type);
  return [
    { id: 'code', label: cm.showInCode, icon: Code2, onSelect: () => useEditor.getState().revealInCode(id) },
    { id: 'rename', label: cm.rename, icon: PencilLine, shortcut: 'F2', onSelect: rename },
    {
      id: 'copy',
      label: cm.copyAddress,
      icon: Copy,
      onSelect: () => void copyText(id).then(() => showToast(messagesFor(canvasMessages).copied(id), 'success')),
    },
    ...(docs ? [{ id: 'docs', label: cm.terraformDocs, icon: ArrowUpRight, onSelect: () => window.open(docs, '_blank', 'noopener') }] : []),
    'separator',
    {
      id: 'delete',
      label: cm.delete,
      icon: Trash2,
      shortcut: 'Del',
      danger: true,
      onSelect: () => useEditor.getState().deleteResources([id]),
    },
  ];
}
