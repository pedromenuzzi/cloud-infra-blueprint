/** Tiny, always-loaded state for the (lazily loaded) command palette + shortcuts dialog. */
import { create } from 'zustand';

interface PaletteState {
  open: boolean;
  shortcuts: boolean;
  setOpen(open: boolean): void;
  setShortcuts(open: boolean): void;
}

/** What had focus when the palette opened — it gets focus back on close. */
let returnFocus: Element | null = null;

export const usePalette = create<PaletteState>((set, get) => ({
  open: false,
  shortcuts: false,
  setOpen: (open) => {
    if (open && !get().open && typeof document !== 'undefined') returnFocus = document.activeElement;
    set({ open });
  },
  setShortcuts: (shortcuts) => set({ shortcuts }),
}));

/** Hand over (and forget) the element to refocus after the palette closes. */
export function takePaletteReturnFocus(): Element | null {
  const el = returnFocus;
  returnFocus = null;
  return el;
}

/**
 * Which keys open the palette:
 *   - ⌘K (Mac) / Ctrl+K (Linux, Windows) everywhere EXCEPT inside the code
 *     editor, where Monaco owns its ⌘K / Ctrl+K chords (⌘K ⌘C comment, ⌘K ⌘0 fold…);
 *   - ⌘⇧P / Ctrl+Shift+P everywhere, the code editor included (as in VS Code).
 */
export function isPaletteShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>,
): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const key = e.key.toLowerCase();
  if (e.shiftKey) return key === 'p';
  if (key !== 'k') return false;
  const target = e.target as { closest?(selector: string): unknown } | null;
  return !target?.closest?.('.monaco-editor');
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The platform's command key, for shortcut labels: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
