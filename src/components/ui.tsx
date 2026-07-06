/**
 * Cloud Blueprint design system components.
 * Canonical reference: ui-mockups/06-design-system.png
 */
import { X } from 'lucide-react';
import { forwardRef, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ----------------------------------------------------------------- Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg hover:bg-primary-hover shadow-xs border border-transparent',
  secondary:
    'bg-surface-1 text-primary border border-primary/40 hover:border-primary hover:bg-primary-soft',
  ghost: 'text-muted hover:text-foreground hover:bg-surface-2 border border-transparent',
  outline: 'bg-surface-1 text-foreground border border-border hover:bg-surface-2',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-xs border border-transparent',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-sm',
  md: 'h-8.5 px-3.5 text-[13px] gap-2 rounded-sm',
  lg: 'h-10 px-5 text-sm gap-2 rounded-md',
  icon: 'h-8 w-8 rounded-sm',
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button({ variant = 'primary', size = 'md', className, type, ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ Badge */

type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'outline'
  | 'aws'
  | 'azure'
  | 'gcp'
  | 'multi';

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-primary-soft text-primary border-primary/25',
  success: 'bg-success/12 text-success border-success/30',
  warning: 'bg-warning/12 text-warning border-warning/30',
  danger: 'bg-danger/12 text-danger border-danger/30',
  outline: 'bg-transparent text-muted border-border',
  aws: 'bg-aws/14 text-aws border-aws/35',
  azure: 'bg-azure/14 text-azure border-azure/35',
  gcp: 'bg-gcp/14 text-gcp border-gcp/35',
  multi: 'bg-multi/14 text-multi border-multi/35',
};

export function Badge({
  variant = 'default',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-semibold leading-[18px]',
        BADGE_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------- Card */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-md border bg-surface-1 shadow-xs', className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ Input */

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-8.5 w-full rounded-sm border bg-surface-1 px-2.5 text-[13px] text-foreground',
          'placeholder:text-faint',
          'focus:border-primary focus:outline-2 focus:-outline-offset-1 focus:outline-primary/30',
          'disabled:opacity-60',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-sm border bg-surface-1 px-2.5 py-2 text-[13px] text-foreground',
        'placeholder:text-faint focus:border-primary focus:outline-2 focus:-outline-offset-1 focus:outline-primary/30',
        className,
      )}
      {...props}
    />
  );
});

/* ----------------------------------------------------------------- Select */

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-8.5 w-full appearance-none rounded-sm border bg-surface-1 px-2.5 pr-7 text-[13px] text-foreground',
          'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222.4%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E")] bg-[right_8px_center] bg-no-repeat',
          'focus:border-primary focus:outline-2 focus:-outline-offset-1 focus:outline-primary/30',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

/* ------------------------------------------------------------------ Field */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-faint">{hint}</span> : null}
    </label>
  );
}

/* ------------------------------------------------------------------ Modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[8vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'w-full rounded-lg border bg-surface-1 shadow-lg',
          wide ? 'max-w-3xl' : 'max-w-md',
        )}
      >
        {title !== undefined ? (
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>{title}</div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Logo */

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 L28 9.5 L16 16 L4 9.5 Z" fill="#3B82F6" />
      <path d="M4 9.5 L16 16 L16 29 L4 22.5 Z" fill="#2563EB" />
      <path d="M28 9.5 L16 16 L16 29 L28 22.5 Z" fill="#1D4ED8" />
    </svg>
  );
}

export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5 font-semibold tracking-[-0.01em]', className)}>
      <LogoMark size={size} />
      <span className="text-[15px] text-foreground">Cloud Blueprint</span>
    </span>
  );
}

/* --------------------------------------------------------------- Kbd/Spin */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-border-strong bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-muted">
      {children}
    </kbd>
  );
}
