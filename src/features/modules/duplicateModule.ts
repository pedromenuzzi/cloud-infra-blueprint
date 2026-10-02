/**
 * Duplicate a module call (context menu, ⌘D, ⌘K): the same source, version,
 * inputs and meta-arguments under a unique name (`network_copy`,
 * `network_copy_2`…), next to the original, in the original's file — one
 * undo step. Terraform plans a second copy of everything inside.
 */
import { showToast } from '@/components/Toast';
import { canvasMessages } from '@/features/editor/CanvasPane.messages';
import { freeSpotNear } from '@/features/editor/newNode';
import { useEditor } from '@/features/editor/store';
import { messagesFor } from '@/i18n/messages';
import { moduleAddress, withModuleNodes } from '@/ir/modules';
import type { Op } from '@/ir/ops';
import type { IR, ModuleNode } from '@/ir/types';

/** The copy and the op that adds it; null when `id` isn't a module call of `ir`. */
export function duplicateModuleOps(ir: IR, id: string): { node: ModuleNode; ops: Op[] } | null {
  const source = ir.modules.find((m) => m.id === id);
  if (!source) return null;
  const taken = new Set(ir.modules.map((m) => m.id));
  const stem = source.name.replace(/_copy(_\d+)?$/, '');
  let name = `${stem}_copy`;
  for (let i = 2; taken.has(moduleAddress(name)); i++) name = `${stem}_copy_${i}`;
  const laid = withModuleNodes(ir);
  const asNode = laid.resources.find((r) => r.id === id)!;
  const node: ModuleNode = {
    id: moduleAddress(name),
    name,
    args: structuredClone(source.args),
    position: freeSpotNear(laid, asNode, false),
    trivia: { leadingComments: [], ...(source.trivia.sourceFile ? { sourceFile: source.trivia.sourceFile } : {}) },
  };
  return { node, ops: [{ kind: 'add_module', node }] };
}

/** Duplicate the module call `id` of the canvas, select the copy and say its name. */
export function duplicateModuleCall(id: string): void {
  const state = useEditor.getState();
  const plan = duplicateModuleOps(state.ir, id);
  if (!plan) return;
  const before = state.filesRevision;
  state.applyCanvasOps(plan.ops, plan.node.id);
  if (useEditor.getState().filesRevision === before) return; // refused: the toast says why
  showToast(messagesFor(canvasMessages).duplicated(plan.node.id), 'success');
}
