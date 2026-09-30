/**
 * Deleting a module call that other blocks still read from: say which ones
 * before going ahead. Their `module.x…` references are left as they are
 * (they then show up as warnings) — what they should point at instead is
 * the user's call, not something to guess.
 */
import { confirmAction } from '@/components/Confirm';
import { messagesFor } from '@/i18n/messages';
import { isModuleId, moduleReferrers } from '@/ir/modules';
import type { IR } from '@/ir/types';
import { modulesMessages } from './modules.messages';

/**
 * True when deleting `ids` needs a confirmation first: the dialog is shown
 * and `proceed` runs if the user agrees. False: go ahead now.
 */
export function confirmModuleDelete(ir: IR, ids: string[], proceed: () => void): boolean {
  const deleting = new Set(ids);
  const modules = ids.filter(isModuleId);
  if (modules.length === 0) return false;
  const referrers = [...new Set(modules.flatMap((id) => moduleReferrers(ir, id)))].filter((id) => !deleting.has(id));
  if (referrers.length === 0) return false;
  const m = messagesFor(modulesMessages);
  void confirmAction({
    title: modules.length === 1 ? m.deleteTitle(modules[0]) : m.deleteManyTitle(modules.length),
    body: m.deleteBody(referrers),
    confirmLabel: m.deleteConfirm,
    danger: true,
  }).then((ok) => {
    if (ok) proceed();
  });
  return true;
}
