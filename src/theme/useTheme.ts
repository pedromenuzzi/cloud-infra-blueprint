import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'cb-theme';

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function isDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark());
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', isDark(theme));
}

interface ThemeState {
  theme: Theme;
  setTheme(theme: Theme): void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: ((): Theme => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {
      /* private mode */
    }
    return 'system';
  })(),
  setTheme(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
    apply(theme);
    set({ theme });
  },
}));

// react to OS changes while in `system`, and sync across tabs
if (typeof window !== 'undefined') {
  apply(useTheme.getState().theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useTheme.getState().theme === 'system') apply('system');
  });
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'system')) {
      apply(e.newValue);
      useTheme.setState({ theme: e.newValue });
    }
  });
}
