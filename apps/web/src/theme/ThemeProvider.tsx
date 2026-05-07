import { useEffect, type ReactNode } from 'react';

import { THEME_STORAGE_KEY } from './theme';
import { useTheme } from './useTheme';

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Wires the theme store to two browser-level signals:
 *
 *  1. `prefers-color-scheme` change — when the user is on `system` and flips
 *     the OS theme, we re-derive `resolved` and re-paint.
 *  2. `storage` event — keeps multiple tabs of the same app in sync. Without
 *     this, changing the theme in one tab leaves the others stale.
 *
 * The actual first paint is handled by an inline script in `index.html` so
 * we never flash the wrong theme. This provider is a no-op until mounted.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const setMode = useTheme((s) => s.setMode);
  const syncFromSystem = useTheme((s) => s.syncFromSystem);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => syncFromSystem();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [syncFromSystem]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { state?: { mode?: string } };
        const next = parsed.state?.mode;
        if (next === 'light' || next === 'dark' || next === 'system') {
          setMode(next);
        }
      } catch {
        // Ignore malformed cross-tab payloads silently.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [setMode]);

  return <>{children}</>;
}
