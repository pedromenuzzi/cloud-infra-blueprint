import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { useIRStore } from '../store/useIRStore';

import { CommandPalette } from './CommandPalette';
import { ShortcutsHelp } from './ShortcutsHelp';

/**
 * Mounts the global keyboard layer:
 *
 * - `Ctrl+K` / `Cmd+K` opens the command palette.
 * - `?` (Shift+/) opens the keyboard shortcuts help.
 * - `/` focuses the first text input on the page (if not already typing).
 * - `Esc` closes whatever overlay is on top.
 *
 * Lives in a single component so we don't sprinkle window listeners across
 * routes. Doesn't render any visible chrome of its own.
 */
export function ShortcutsLayer({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const isTyping = useCallback(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K — Command palette
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Ctrl+Z / Cmd+Z — Undo, Ctrl+Shift+Z / Cmd+Shift+Z — Redo. We also
      // accept Ctrl+Y for redo (Windows convention). These fire even when
      // the user is typing in the inspector — text inputs already get the
      // browser-native undo for their own value, but the IR-level undo
      // should always work.
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping()) return;
        e.preventDefault();
        const store = useIRStore.getState();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (isTyping()) return;
        e.preventDefault();
        useIRStore.getState().redo();
        return;
      }

      // Esc closes whatever's on top — handled by the modal itself, but we
      // also reset state in case focus has been lost.
      if (e.key === 'Escape') {
        if (helpOpen) setHelpOpen(false);
        return;
      }

      // The remaining shortcuts only fire when not typing.
      if (isTyping()) return;

      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        const input =
          document.querySelector<HTMLInputElement>(
            'input[type="search"], input[aria-label*="Search" i]',
          ) ?? document.querySelector<HTMLInputElement>('input[type="text"]');
        input?.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen, isTyping]);

  // Custom event so the palette can open the shortcuts modal.
  useEffect(() => {
    const onOpenShortcuts = () => setHelpOpen(true);
    window.addEventListener('blueprint:open-shortcuts', onOpenShortcuts);
    return () => window.removeEventListener('blueprint:open-shortcuts', onOpenShortcuts);
  }, []);

  return (
    <>
      {children}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
