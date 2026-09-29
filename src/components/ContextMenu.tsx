import { Check, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { focusIsLost, Kbd, restoreFocus, useLayer } from './ui';

export interface MenuItem {
  id: string;
  label: string;
  /** a Lucide icon, or any component taking a className (e.g. a flag) */
  icon?: LucideIcon | ComponentType<{ className?: string }>;
  shortcut?: string;
  /** radio-style menus (e.g. theme) */
  checked?: boolean;
  /** with `checked`: an on/off toggle (menuitemcheckbox) rather than a radio */
  toggle?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

export type MenuEntry = MenuItem | 'separator';

/** Floating menu at a screen point — right-click menus on the canvas. */
export function ContextMenu({
  x,
  y,
  entries,
  onClose,
  label,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose(): void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  /** the labels as one string: a language switch re-words an open menu, which may change its size */
  const words = entries.map((e) => (e === 'separator' ? '-' : e.label)).join('|');

  // keep the menu on screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y, words]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Esc through the layer stack: only the top-most menu / dialog closes
  useLayer(true, onClose, { kind: 'popup', node: ref });

  // focus the first item; on close, give focus back to what opened the menu
  // (unless the chosen action already moved it somewhere on purpose)
  useLayoutEffect(() => {
    const el = ref.current;
    const trigger = document.activeElement;
    el?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    return () => {
      if (focusIsLost(el)) restoreFocus(trigger);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    const close = () => closeRef.current();
    const onPointer = (e: PointerEvent) => {
      if (!el?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!el?.contains(document.activeElement)) return;
      // menus aren't in the Tab order: Tab closes and moves on from the trigger
      if (e.key === 'Tab') {
        close();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const items = [...el.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? (i + 1) % items.length
              : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="bp-pop-in fixed z-50 min-w-[220px] max-w-[calc(100vw-16px)] rounded-[10px] border bg-surface-1/95 p-1 shadow-lg backdrop-blur-md"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <div key={`sep-${i}`} className="mx-1 my-1 h-px bg-border" role="separator" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role={
              entry.checked === undefined ? 'menuitem' : entry.toggle ? 'menuitemcheckbox' : 'menuitemradio'
            }
            aria-checked={entry.checked}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors',
              'hover:bg-surface-2 focus-visible:bg-surface-2 disabled:pointer-events-none disabled:opacity-45',
              entry.danger ? 'text-danger' : 'text-foreground',
            )}
          >
            {entry.icon ? (
              <entry.icon className={cn('h-3.5 w-3.5 shrink-0', entry.danger ? '' : 'text-muted')} />
            ) : (
              <span className="w-3.5" />
            )}
            <span className="min-w-0 flex-1">{entry.label}</span>
            {entry.shortcut ? <Kbd>{entry.shortcut}</Kbd> : null}
            {entry.checked ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
