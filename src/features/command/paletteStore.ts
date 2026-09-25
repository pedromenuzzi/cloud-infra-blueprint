/** Tiny, always-loaded state for the (lazily loaded) command palette + shortcuts dialog. */
import { create } from 'zustand';

interface PaletteState {
  open: boolean;
  shortcuts: boolean;
  setOpen(open: boolean): void;
  setShortcuts(open: boolean): void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  shortcuts: false,
  setOpen: (open) => set({ open }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
}));

export const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
