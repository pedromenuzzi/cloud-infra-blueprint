import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import {
  applyTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from './theme';

interface ThemeState {
  /** What the user picked. `system` follows `prefers-color-scheme`. */
  mode: ThemeMode;
  /** What's actually painted right now. Derived from `mode`. */
  resolved: ResolvedTheme;
  /** Set a concrete mode (light / dark / system) and re-paint. */
  setMode: (mode: ThemeMode) => void;
  /** Convenience: cycle light → dark → system → light. */
  cycle: () => void;
  /**
   * Re-derive `resolved` from the current `mode`. Useful when the OS theme
   * changes while the app is running.
   */
  syncFromSystem: () => void;
}

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      resolved: resolveTheme('system'),
      setMode: (mode) => {
        const resolved = resolveTheme(mode);
        applyTheme(resolved);
        set({ mode, resolved });
      },
      cycle: () => {
        const next = NEXT_MODE[get().mode];
        get().setMode(next);
      },
      syncFromSystem: () => {
        const { mode } = get();
        if (mode !== 'system') return;
        const resolved = resolveTheme('system');
        if (resolved !== get().resolved) {
          applyTheme(resolved);
          set({ resolved });
        }
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Persist only the user's choice; `resolved` is always derived.
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const resolved = resolveTheme(state.mode);
        applyTheme(resolved);
        state.resolved = resolved;
      },
    },
  ),
);
