import { Check, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Kbd } from './ui';

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  /** radio-style menus (e.g. theme) */
  checked?: boolean;
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

  // keep the menu on screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const el = ref.current;
    el?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!el?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...(el?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="bp-pop-in fixed z-50 min-w-[220px] rounded-[10px] border bg-surface-1/95 p-1 shadow-lg backdrop-blur-md"
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
            role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
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
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut ? <Kbd>{entry.shortcut}</Kbd> : null}
            {entry.checked ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
