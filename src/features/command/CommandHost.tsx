import { lazy, Suspense, useEffect, useState } from 'react';
import { hasOpenLayer } from '@/components/ui';
import { isPaletteShortcut, usePalette } from './paletteStore';

const CommandPalette = lazy(() =>
  import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const ShortcutsDialog = lazy(() =>
  import('./ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })),
);

/**
 * Global palette / "?" listener (see isPaletteShortcut for which keys). The
 * palette itself (cmdk, the catalog, editor actions) loads on first use so it
 * costs nothing on the landing page.
 */
export function CommandHost() {
  const open = usePalette((s) => s.open);
  const shortcuts = usePalette((s) => s.shortcuts);
  const [loaded, setLoaded] = useState({ palette: false, shortcuts: false });

  useEffect(() => {
    if (open || shortcuts) {
      setLoaded((l) => ({ palette: l.palette || open, shortcuts: l.shortcuts || shortcuts }));
    }
  }, [open, shortcuts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        const { open: isOpen, setOpen } = usePalette.getState();
        // not over a dialog: the palette would stack a second modal on top
        if (!isOpen && hasOpenLayer(['modal'])) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(!isOpen);
        return;
      }
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable], .monaco-editor');
      if (!typing && e.key === '?' && !e.metaKey && !e.ctrlKey && !hasOpenLayer()) {
        e.preventDefault();
        usePalette.getState().setShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <Suspense fallback={null}>
      {loaded.palette ? <CommandPalette /> : null}
      {loaded.shortcuts ? <ShortcutsDialog /> : null}
    </Suspense>
  );
}
