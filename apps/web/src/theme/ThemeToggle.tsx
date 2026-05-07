import { Button, cn } from '@blueprint/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { type ThemeMode } from './theme';
import { useTheme } from './useTheme';

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

interface ThemeToggleProps {
  /** Render as a small icon-only trigger (default) or a labelled one. */
  variant?: 'icon' | 'labelled';
  /** Tailwind classes to merge into the trigger button. */
  className?: string;
}

/**
 * Dropdown that lets the user pick between Light / Dark / System.
 *
 * Implemented as a tiny custom popover (no headless-ui / radix needed) so the
 * web app stays lean. Closes on outside click and on Escape; manages
 * `aria-expanded` and `role="menu"` for screen readers.
 */
export function ThemeToggle({ variant = 'icon', className }: ThemeToggleProps) {
  const mode = useTheme((s) => s.mode);
  const resolved = useTheme((s) => s.resolved);
  const setMode = useTheme((s) => s.setMode);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ActiveIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size={variant === 'icon' ? 'icon' : 'sm'}
        aria-label="Alterar tema"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={cn(className)}
      >
        <ActiveIcon className="h-4 w-4" />
        {variant === 'labelled' && <span className="ml-2 text-sm">{labelFor(mode)}</span>}
      </Button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Tema"
          className="absolute right-0 z-50 mt-2 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  setMode(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent/60 text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{opt.label}</span>
                {isActive && (
                  <span aria-hidden className="text-xs text-muted-foreground">
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelFor(mode: ThemeMode): string {
  const opt = OPTIONS.find((o) => o.value === mode);
  return opt?.label ?? 'Tema';
}
