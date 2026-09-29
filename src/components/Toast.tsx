import { AlertTriangle, Check, Info } from 'lucide-react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  /** one button ("Show"); using it closes the toast */
  action?: { label: string; onClick(): void };
  /** a quieter second line, e.g. "Ctrl Z to undo" */
  hint?: string;
  /** ms before it goes away: 3200 by default, 8000 with an action */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastOptions['action'];
  hint?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push(message: string, kind?: ToastKind, options?: ToastOptions): void;
  dismiss(id: number): void;
}

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToasts = create<ToastState>((set, get) => {
  const schedule = (id: number, ms: number) => {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => get().dismiss(id), ms));
  };
  return {
    toasts: [],
    push(message, kind = 'info', options = {}) {
      const id = ++seq;
      const { action, hint } = options;
      set({ toasts: [...get().toasts, { id, message, kind, ...(action ? { action } : {}), ...(hint ? { hint } : {}) }] });
      schedule(id, options.duration ?? (action ? 8000 : 3200));
    },
    dismiss(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
  };
});

/** a toast being read (hovered) or used (focused) stays until it is let go */
function hold(id: number) {
  clearTimeout(timers.get(id));
}

function release(id: number) {
  if (!useToasts.getState().toasts.some((t) => t.id === id)) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => useToasts.getState().dismiss(id), 2500));
}

export function showToast(message: string, kind: ToastKind = 'info', options?: ToastOptions) {
  useToasts.getState().push(message, kind, options);
}

const ICONS: Record<ToastKind, typeof Check> = {
  success: Check,
  error: AlertTriangle,
  info: Info,
  warning: AlertTriangle,
};

/**
 * Portaled to <body> and marked `data-bp-live`, so a modal dialog (which makes
 * the rest of the page inert) doesn't silence it.
 */
export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  return createPortal(
    <div
      aria-live="polite"
      data-bp-live=""
      className="pointer-events-none fixed inset-x-3 bottom-4 z-[80] flex flex-col items-center gap-2"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            onMouseEnter={() => hold(t.id)}
            onMouseLeave={() => release(t.id)}
            onFocus={() => hold(t.id)}
            onBlur={() => release(t.id)}
            className={cn(
              'pointer-events-auto flex max-w-[640px] items-center gap-2 rounded-md border bg-surface-1 px-3.5 py-2 text-[13px] shadow-lg',
              t.kind === 'success' && 'text-success',
              t.kind === 'error' && 'text-danger',
              t.kind === 'warning' && 'text-warning',
              t.kind === 'info' && 'text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {t.hint ? (
              <span className="min-w-0">
                <span className="block">{t.message}</span>
                <span className="block text-[11.5px] text-muted">{t.hint}</span>
              </span>
            ) : (
              t.message
            )}
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  useToasts.getState().dismiss(t.id);
                }}
                className="-my-1 -mr-1.5 ml-1 shrink-0 rounded-[6px] px-2 py-1 text-[12.5px] font-semibold text-primary transition-colors hover:bg-surface-2 hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-primary"
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
