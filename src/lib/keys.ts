/**
 * Keyboard shortcuts written the way each platform writes them: ⌘K, ⌘⇧Z and
 * ⇧1 on Apple devices; Ctrl+K, Ctrl+Shift+Z and Shift+1 on Windows and
 * Linux. Every shortcut label in the app goes through here, so nobody on a
 * PC is shown a ⌘. The shortcuts dialog can also show the other platform's
 * spelling (`shortcutFor`).
 */
export type KeyPlatform = 'mac' | 'pc';

/** a named modifier, or any other key as it reads on the cap ("K", "1", "/", "F2") */
export type Key = 'mod' | 'shift' | 'alt' | (string & {});

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const PLATFORM: KeyPlatform = IS_MAC ? 'mac' : 'pc';

const CAPS: Record<KeyPlatform, Record<string, string>> = {
  mac: { mod: '⌘', shift: '⇧', alt: '⌥' },
  pc: { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' },
};

/** one key cap: "⌘" / "Ctrl", "⇧" / "Shift", "⌥" / "Alt", or the key itself (single letters upper-cased) */
export function keyCap(key: Key, platform: KeyPlatform = PLATFORM): string {
  return CAPS[platform][key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** a shortcut in a given platform's spelling: "⌘⇧Z" on a Mac, "Ctrl+Shift+Z" on a PC */
export function shortcutFor(platform: KeyPlatform, ...keys: Key[]): string {
  const caps = keys.map((key) => keyCap(key, platform));
  return caps.join(platform === 'mac' ? '' : '+');
}

/** a shortcut in this device's spelling */
export const shortcut = (...keys: Key[]): string => shortcutFor(PLATFORM, ...keys);

/** the same shortcut on the other platform (for "Ctrl+K (⌘K on a Mac)") */
export const otherShortcut = (...keys: Key[]): string => shortcutFor(PLATFORM === 'mac' ? 'pc' : 'mac', ...keys);

/** the platform's command key: ⌘ or Ctrl */
export const MOD = keyCap('mod');

/** an `aria-keyshortcuts` value: "Meta+K" on a Mac, "Control+K" elsewhere */
export function ariaShortcut(...keys: Key[]): string {
  const names: Record<string, string> = { mod: IS_MAC ? 'Meta' : 'Control', shift: 'Shift', alt: 'Alt' };
  return keys.map((key) => names[key] ?? key).join('+');
}
