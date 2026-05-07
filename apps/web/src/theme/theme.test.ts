import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyTheme,
  getSystemTheme,
  readStoredMode,
  resolveTheme,
  THEME_STORAGE_KEY,
} from './theme';
import { useTheme } from './useTheme';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * jsdom doesn't ship a working `matchMedia`. We stub it so the theme module
 * has a deterministic, switchable system preference.
 */
function stubMatchMedia(prefersDark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Reset the persisted store so every test starts from `mode: 'system'`. */
function resetStore(): void {
  useTheme.setState({ mode: 'system', resolved: 'light' });
  localStorage.clear();
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('theme primitives', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    stubMatchMedia(false);
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('resolveTheme passes through concrete modes', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolveTheme follows the OS for "system"', () => {
    stubMatchMedia(true);
    expect(getSystemTheme()).toBe('dark');
    expect(resolveTheme('system')).toBe('dark');

    stubMatchMedia(false);
    expect(getSystemTheme()).toBe('light');
    expect(resolveTheme('system')).toBe('light');
  });

  it('applyTheme toggles the dark class and color-scheme on <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('readStoredMode tolerates missing / corrupted entries', () => {
    expect(readStoredMode()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, '{"corrupted":true}');
    expect(readStoredMode()).toBe('system');
  });
});

describe('useTheme store', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    stubMatchMedia(false);
    resetStore();
  });

  it('setMode persists the choice and re-paints', () => {
    useTheme.getState().setMode('dark');
    expect(useTheme.getState().resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    useTheme.getState().setMode('light');
    expect(useTheme.getState().resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('cycle goes light → dark → system → light', () => {
    useTheme.getState().setMode('light');
    useTheme.getState().cycle();
    expect(useTheme.getState().mode).toBe('dark');
    useTheme.getState().cycle();
    expect(useTheme.getState().mode).toBe('system');
    useTheme.getState().cycle();
    expect(useTheme.getState().mode).toBe('light');
  });

  it('syncFromSystem only repaints when in "system" mode', () => {
    // Start in explicit dark; OS flip should NOT touch the resolved theme.
    useTheme.getState().setMode('dark');
    stubMatchMedia(false);
    useTheme.getState().syncFromSystem();
    expect(useTheme.getState().resolved).toBe('dark');

    // Switch to system; now OS flips DO matter.
    useTheme.getState().setMode('system');
    stubMatchMedia(true);
    useTheme.getState().syncFromSystem();
    expect(useTheme.getState().resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
