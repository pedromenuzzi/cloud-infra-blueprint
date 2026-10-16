/**
 * Tiny, always-loaded state for the (lazily loaded) "Create a project from a
 * state" dialog: the dashboard's Import menu, the command palette and the
 * plan and state panel open it, with a state already read or by picking one.
 * The state lives here, in memory, only while the dialog is open.
 */
import { create } from 'zustand';
import { showToast } from '@/components/Toast';
import { readJsonFile } from '@/deploy/json';
import { parseState, type ParsedState } from '@/deploy/state';
import { errorText, pickFile, STATE_ACCEPT } from './files';

interface FromStateState {
  open: boolean;
  state: ParsedState | null;
  /** the file it came from */
  fileName: string;
  /** bumped on every open, so the dialog starts fresh */
  session: number;
}

export const useFromState = create<FromStateState>(() => ({ open: false, state: null, fileName: '', session: 0 }));

/** Open the dialog on `state`, or on a state the user picks first (nothing opens when cancelled or unreadable). */
export async function openFromState(state?: ParsedState, fileName = 'terraform.tfstate') {
  if (!state) {
    const file = await pickFile(STATE_ACCEPT);
    if (!file) return;
    const read = await readJsonFile(file);
    if (!read.ok) {
      showToast(errorText(read.error), 'error');
      return;
    }
    const parsed = parseState(read.value);
    if (!parsed.ok) {
      showToast(errorText(parsed.error), 'error');
      return;
    }
    state = parsed.state;
    fileName = file.name;
  }
  useFromState.setState((s) => ({ open: true, state, fileName, session: s.session + 1 }));
}

export function closeFromState() {
  useFromState.setState({ open: false, state: null });
}
