/**
 * The canvas context menu of a module call. Entry ids follow the resource
 * menu's (`rename`, `delete`…) so a read-only view drops the same ones.
 */
import { ArrowUpRight, Code2, Copy, FolderOpen, PencilLine, Trash2 } from 'lucide-react';
import type { MenuEntry } from '@/components/ContextMenu';
import { showToast } from '@/components/Toast';
import { canvasMessages } from '@/features/editor/CanvasPane.messages';
import { useEditor } from '@/features/editor/store';
import { messagesFor } from '@/i18n/messages';
import { moduleTarget } from '@/ir/localModules';
import { findNode, isModuleId, moduleVersion, registryUrl } from '@/ir/modules';
import type { ModuleNode } from '@/ir/types';
import { copyText } from '@/lib/download';
import { modulesMessages } from './modules.messages';
import { openModuleView } from './moduleViewStore';

/** Menu entries for the module call `id`; [] when it isn't one. `rename` focuses the inspector's name field. */
export function moduleMenuEntries(id: string, rename: () => void): MenuEntry[] {
  if (!isModuleId(id)) return [];
  const { ir, files } = useEditor.getState();
  const node = findNode(ir, id) as ModuleNode | undefined;
  if (!node) return [];
  const m = messagesFor(modulesMessages);
  const cm = messagesFor(canvasMessages);
  const target = moduleTarget(files, node);
  const registry = target.kind === 'remote' ? registryUrl(target.info, moduleVersion(node)) : null;
  return [
    ...(target.kind === 'local' && target.module
      ? [{ id: 'open', label: m.open, icon: FolderOpen, onSelect: () => openModuleView(target.dir, node.name) }]
      : []),
    { id: 'code', label: cm.showInCode, icon: Code2, onSelect: () => useEditor.getState().revealInCode(id) },
    { id: 'rename', label: cm.rename, icon: PencilLine, shortcut: 'F2', onSelect: rename },
    {
      id: 'copy',
      label: cm.copyAddress,
      icon: Copy,
      onSelect: () => void copyText(id).then(() => showToast(messagesFor(canvasMessages).copied(id), 'success')),
    },
    ...(registry
      ? [{ id: 'docs', label: m.registryPage, icon: ArrowUpRight, onSelect: () => window.open(registry, '_blank', 'noopener') }]
      : []),
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
