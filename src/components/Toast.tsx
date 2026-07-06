import { AlertTriangle, Check, Info } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: ToastItem[];
  push(message: string, kind?: ToastKind): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(message, kind = 'info') {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => get().dismiss(id), 3200);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export function showToast(message: string, kind: ToastKind = 'info') {
  useToasts.getState().push(message, kind);
}

const ICONS: Record<ToastKind, typeof Check> = {
  success: Check,
  error: AlertTriangle,
  info: Info,
};

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-md border bg-surface-1 px-3.5 py-2 text-[13px] shadow-lg',
              t.kind === 'success' && 'text-success',
              t.kind === 'error' && 'text-danger',
              t.kind === 'info' && 'text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
