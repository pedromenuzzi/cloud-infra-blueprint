/**
 * Deleting a data source other blocks still read: say which ones before
 * going ahead, like a module call. Their `data.x.y…` references stay as
 * they are (they then show up as warnings): what they should read instead
 * is the user's call, not something to guess.
 */
import { confirmAction } from '@/components/Confirm';
import { messagesFor } from '@/i18n/messages';
import { dataReferrers, isDataId } from '@/ir/dataSources';
import type { IR } from '@/ir/types';
import { dataSourceMessages } from './dataSources.messages';

/** blocks outside `ids` that read one of the data sources in `ids` */
export function dataDeleteReferrers(ir: IR, ids: string[]): string[] {
  const deleting = new Set(ids);
  return [...new Set(ids.filter(isDataId).flatMap((id) => dataReferrers(ir, id)))].filter((id) => !deleting.has(id));
}

/**
 * True when deleting `ids` needs a confirmation first: the dialog is shown
 * and `proceed` runs if the user agrees. False: go ahead now.
 */
export function confirmDataDelete(ir: IR, ids: string[], proceed: () => void): boolean {
  const data = ids.filter(isDataId);
  if (data.length === 0) return false;
  const referrers = dataDeleteReferrers(ir, ids);
  if (referrers.length === 0) return false;
  const m = messagesFor(dataSourceMessages);
  void confirmAction({
    title: data.length === 1 ? m.deleteTitle(data[0]) : m.deleteManyTitle(data.length),
    body: m.deleteBody(referrers),
    confirmLabel: m.deleteConfirm,
    danger: true,
  }).then((ok) => {
    if (ok) proceed();
  });
  return true;
}
