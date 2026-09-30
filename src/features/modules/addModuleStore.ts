/** Tiny, always-loaded state for the (lazily loaded) "Add module" dialog — ⌘K, the palette and the canvas menu open it. */
import { create } from 'zustand';

interface AddModuleState {
  open: boolean;
  /** bumped on every open, so the dialog starts fresh */
  session: number;
}

export const useAddModule = create<AddModuleState>(() => ({ open: false, session: 0 }));

export function openAddModule() {
  useAddModule.setState((s) => ({ open: true, session: s.session + 1 }));
}

export function closeAddModule() {
  useAddModule.setState({ open: false });
}
