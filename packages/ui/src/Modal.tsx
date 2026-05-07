import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from './cn.js';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional accessible title; rendered visually if `header` is omitted. */
  title?: string;
  /** Optional accessible description, used by screen readers. */
  description?: string;
  /** Custom header. Pass `null` to render no header at all. */
  header?: ReactNode | null;
  /** Footer pinned to the bottom of the dialog. */
  footer?: ReactNode;
  /** Tailwind class merged into the dialog panel. Default `max-w-3xl`. */
  className?: string;
  children: ReactNode;
}

/**
 * Lightweight modal dialog — no Radix or Headless UI dep, < 60 LOC.
 *
 * - Renders only when `open` is true.
 * - Closes on backdrop click and on Escape.
 * - Locks body scroll while open.
 * - Sets `aria-labelledby` / `aria-describedby` from the optional title/description.
 *
 * For F1 this is enough; if we ever need focus trap or stacked modals, swap
 * the implementation behind the same props.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  header,
  footer,
  className,
  children,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div aria-hidden className="bg-foreground/30 absolute inset-0 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'border-border bg-card text-card-foreground relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-lg outline-none',
          className,
        )}
      >
        {header !== null && (
          <header className="border-border/60 flex items-start justify-between gap-4 border-b px-6 py-4">
            {header ?? (
              <div>
                {title && (
                  <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descId} className="text-muted-foreground mt-1 text-sm">
                    {description}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="focus-ring text-muted-foreground hover:bg-accent hover:text-foreground -m-2 rounded-md p-2 transition-colors"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                <path
                  d="M3 3 L13 13 M13 3 L3 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <footer className="border-border/60 bg-surface-1 flex items-center justify-between gap-3 border-t px-6 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
