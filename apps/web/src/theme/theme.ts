/**
 * Theme primitives shared by the store, the provider and the anti-flash
 * bootstrap script. Kept pure (no React, no Zustand) so the same module can
 * be safely inlined into `index.html` if we ever want to.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key — keep in sync with the inline script in index.html. */
export const THEME_STORAGE_KEY = 'cbp.theme';

/** Returns the OS preferred scheme; defaults to 'light' if unknown. */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Resolves a `ThemeMode` (which can be 'system') to a concrete theme. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

/**
 * Mutate the document so Tailwind's `darkMode: 'class'` picks up the right
 * variables. Also updates `color-scheme` so native form controls and
 * scrollbars match, and the meta theme-color so PWAs/mobile chrome track it.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0b0f1a' : '#ffffff';
}

/** Persisted mode reader, tolerant of corruption / missing localStorage. */
export function readStoredMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}
