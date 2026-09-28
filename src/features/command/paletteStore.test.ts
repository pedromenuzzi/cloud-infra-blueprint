import { describe, expect, it } from 'vitest';
import { isPaletteShortcut } from './paletteStore';

const inMonaco = { closest: (sel: string) => (sel === '.monaco-editor' ? {} : null) };
const onCanvas = { closest: () => null };

function key(
  k: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
  target: unknown = onCanvas,
) {
  return {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    target: target as EventTarget,
  };
}

describe('isPaletteShortcut', () => {
  it('opens on ⌘K / Ctrl+K outside the code editor', () => {
    expect(isPaletteShortcut(key('k', { metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key('k', { ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key('K', { ctrlKey: true }))).toBe(true);
  });

  it('leaves ⌘K / Ctrl+K to Monaco (its chords) when the code editor has focus', () => {
    expect(isPaletteShortcut(key('k', { ctrlKey: true }, inMonaco))).toBe(false);
    expect(isPaletteShortcut(key('k', { metaKey: true }, inMonaco))).toBe(false);
  });

  it('opens on ⌘⇧P / Ctrl+Shift+P everywhere, the code editor included', () => {
    expect(isPaletteShortcut(key('P', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isPaletteShortcut(key('P', { metaKey: true, shiftKey: true }, inMonaco))).toBe(true);
  });

  it('ignores other keys and modifier combinations', () => {
    expect(isPaletteShortcut(key('k'))).toBe(false);
    expect(isPaletteShortcut(key('p', { ctrlKey: true }))).toBe(false);
    expect(isPaletteShortcut(key('K', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true }, null))).toBe(true);
  });
});
