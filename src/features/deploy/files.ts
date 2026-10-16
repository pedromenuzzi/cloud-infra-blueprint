/**
 * Picking a plan or a state, and what to say when one can't be opened.
 * Light on purpose: the dashboard's Import menu loads it.
 */
import { messagesFor } from '@/i18n/messages';
import type { PlanError } from '@/deploy/plan';
import type { StateError } from '@/deploy/state';
import { deployMessages } from './messages';

/** the toast for a file that couldn't be opened (a read error code, or why it isn't a plan / a state) */
export function errorText(error: string | PlanError | StateError): string {
  const m = messagesFor(deployMessages);
  if (typeof error === 'string') return m.error[error] ?? m.error.unknown;
  if (error.code === 'format') return m.formatError(error.version);
  if (error.code === 'version') return m.versionError(error.version);
  if (error.code === 'bad-change') return m.badChange(error.index);
  if (error.code === 'bad-resource') return m.badResource(error.index);
  if (error.code === 'state-not-plan' || error.code === 'plan-not-state') return m.error.unknown;
  if (error.code === 'state-json-not-plan') return m.error['state-json'];
  return m.error[error.code] ?? m.error.unknown;
}

/** A file from the system picker (null when cancelled). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export const PLAN_ACCEPT = '.json,application/json';
export const STATE_ACCEPT = '.tfstate,.json,.backup,application/json';

