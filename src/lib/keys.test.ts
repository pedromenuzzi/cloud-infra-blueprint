import { describe, expect, it } from 'vitest';
import { keyCap, shortcutFor } from './keys';

describe('shortcut labels per platform', () => {
  it('spells a PC shortcut with Ctrl, Shift and plus signs', () => {
    expect(shortcutFor('pc', 'mod', 'K')).toBe('Ctrl+K');
    expect(shortcutFor('pc', 'mod', 'shift', 'z')).toBe('Ctrl+Shift+Z');
    expect(shortcutFor('pc', 'shift', '1')).toBe('Shift+1');
    expect(shortcutFor('pc', 'alt', 'F2')).toBe('Alt+F2');
  });

  it('spells a Mac shortcut with symbols, run together', () => {
    expect(shortcutFor('mac', 'mod', 'K')).toBe('⌘K');
    expect(shortcutFor('mac', 'mod', 'shift', 'z')).toBe('⌘⇧Z');
    expect(shortcutFor('mac', 'shift', '1')).toBe('⇧1');
  });

  it('gives one key cap at a time (the shortcuts dialog)', () => {
    expect([keyCap('mod', 'pc'), keyCap('shift', 'pc'), keyCap('mod', 'mac'), keyCap('shift', 'mac')]).toEqual(['Ctrl', 'Shift', '⌘', '⇧']);
    expect(keyCap('Esc', 'mac')).toBe('Esc');
  });
});
