/**
 * Cloud Blueprint design system components.
 * Canonical reference: ui-mockups/06-design-system.png
 */
import { X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { shellMessages } from './messages';

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
  danger: 'bg-danger-solid text-white hover:bg-danger-solid-hover shadow-xs border border-transparent',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-sm',
  md: 'h-8.5 px-3.5 text-[13px] gap-2 rounded-sm',
  lg: 'h-10 px-5 text-sm gap-2 rounded-md',
  icon: 'h-8 w-8 rounded-sm',
};

/** Button look for other elements (a router `Link` styled as a button, not wrapping one). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(
    'inline-flex select-none items-center justify-center font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    'disabled:pointer-events-none disabled:opacity-50',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

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
      className={buttonClass(variant, size, className)}
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

// text-* resolve to the AA text tokens (--primary-text, --aws-text, …) in global.css
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

/* ------------------------------------------------------------ Layer stack */

/**
 * Everything that floats over the page — dialogs, menus, the command palette,
 * side panels — registers here while open. Esc closes only the top-most layer,
 * and page-level shortcuts ask `hasOpenLayer()` before acting.
 *
 *   modal  a `Modal`: the rest of the page is inert while it is on top
 *   popup  menus and self-managed dialogs (cmdk): focus handled by the owner
 *   panel  non-modal panels: Esc typed into an editor outside the panel is
 *          left to that editor
 */
export type LayerKind = 'modal' | 'popup' | 'panel';

interface LayerEntry {
  kind: LayerKind;
  /** latest Esc handler (a ref, so re-renders never re-subscribe) */
  onEscape: RefObject<(() => void) | undefined>;
  node?: RefObject<HTMLElement | null>;
}

const layers: LayerEntry[] = [];
const inerted = new Set<Element>();
const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .monaco-editor';

/** Is any layer (of these kinds) open? Page-level key handlers bail out when it is. */
export function hasOpenLayer(kinds?: LayerKind[]): boolean {
  return layers.some((l) => !kinds || kinds.includes(l.kind));
}

/** Only the top modal stays interactive: every other child of <body> goes inert. */
function syncInert() {
  for (const el of inerted) el.removeAttribute('inert');
  inerted.clear();
  const root = [...layers].reverse().find((l) => l.kind === 'modal' && l.node?.current)?.node
    ?.current;
  if (!root) return;
  for (const child of Array.from(document.body.children)) {
    if (child.contains(root) || child.hasAttribute('inert') || child.hasAttribute('data-bp-live')) {
      continue;
    }
    if (/^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(child.tagName)) continue;
    child.setAttribute('inert', '');
    inerted.add(child);
  }
}

/** Push a layer; returns the function that removes it. (`useLayer` wraps this.) */
export function pushLayer(entry: LayerEntry): () => void {
  layers.push(entry);
  if (entry.kind === 'modal') syncInert();
  return () => {
    const i = layers.indexOf(entry);
    if (i !== -1) layers.splice(i, 1);
    if (entry.kind === 'modal') syncInert();
  };
}

if (typeof window !== 'undefined') {
  // one listener for the app, bubble phase: widgets inside a layer that use
  // Esc themselves (an inline editor, a nested menu) call preventDefault()
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    const top = layers[layers.length - 1];
    if (!top) return;
    const target = e.target instanceof Element ? e.target : null;
    if (top.kind === 'panel' && target?.closest(EDITABLE) && !top.node?.current?.contains(target)) {
      return;
    }
    const handler = top.onEscape.current;
    if (!handler) return;
    e.preventDefault();
    handler();
  });
}

/**
 * Register a layer while `active`. `onEscape` runs when Esc is pressed and
 * this is the top layer — omit it for widgets that close themselves (cmdk).
 */
export function useLayer(
  active: boolean,
  onEscape?: () => void,
  options: { kind?: LayerKind; node?: RefObject<HTMLElement | null> } = {},
) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  const { kind = 'popup', node } = options;
  useLayoutEffect(() => {
    if (!active) return;
    return pushLayer({ kind, onEscape: escape, node });
  }, [active, kind, node]);
}

/* ------------------------------------------------------------------ Focus */

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'summary',
  '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

/** Elements Tab can reach inside `root`, in DOM order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]')) return false;
    // one stop per radio group: the checked radio (or the first when none is)
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      const group = Array.from(
        root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`),
      );
      if ((group.find((r) => r.checked) ?? group[0]) !== el) return false;
    }
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
}

/** Focus `el` again if it still can take focus (connected, not inert). */
export function restoreFocus(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected || el.closest('[inert]')) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

/** Focus went nowhere useful (the page, or an element that just left the DOM). */
export function focusIsLost(within?: Element | null): boolean {
  const active = document.activeElement;
  return (
    !active || active === document.body || !active.isConnected || (!!within && within.contains(active))
  );
}

/* ------------------------------------------------------------------ Modal */

/** A dialog needs a name: its title (aria-labelledby), or `label` when it has none. */
type ModalName = { title: ReactNode; label?: string } | { title?: undefined; label: string };

/**
 * Dialog, portaled to <body>. While open the page behind it is inert, focus
 * starts inside (the `autoFocus` element, else the first field or button),
 * Tab cycles within it, and Esc closes only the top-most layer. On close,
 * focus returns to whatever opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  label,
  role = 'dialog',
  describedBy,
}: {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  /** `xl`: for a table that needs the room (the rules of an NSG or a network ACL) */
  wide?: boolean | 'xl';
  role?: 'dialog' | 'alertdialog';
  /** id of the element that describes the dialog (alertdialogs) */
  describedBy?: string;
} & ModalName) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const triggerRef = useRef<Element | null>(null);
  const m = useMessages(shellMessages);

  // remember what opened the dialog — an insertion effect runs before React's
  // autoFocus (commit/layout) moves focus into the new dialog
  useInsertionEffect(() => {
    if (open) triggerRef.current = document.activeElement;
  }, [open]);

  // push the layer (inerts the page), then focus inside. On close: pop (the
  // page is live again), then give focus back to the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const pop = pushLayer({ kind: 'modal', onEscape: closeRef, node: overlayRef });
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const first =
        panel.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
        (bodyRef.current ? tabbables(bodyRef.current)[0] : undefined) ??
        tabbables(panel)[0] ??
        panel;
      first.focus({ preventScroll: true });
    }
    return () => {
      pop();
      if (focusIsLost(panel)) restoreFocus(trigger);
    };
  }, [open]);

  // Tab / Shift+Tab cycle inside the panel. A DOM listener on purpose: menus
  // portaled from inside the dialog are React children but not DOM descendants.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const items = tabbables(panel);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
      } else if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', onKey);
    return () => panel.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={overlayRef}
      className="bp-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 pt-[8vh] backdrop-blur-[3px] max-sm:px-2 max-sm:pt-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label === undefined && title !== undefined ? titleId : undefined}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          'bp-modal-in w-full min-w-0 rounded-lg border bg-surface-1 shadow-lg outline-none',
          wide === 'xl' ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-md',
        )}
      >
        {title !== undefined ? (
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4 max-sm:px-4">
            <div id={titleId} className="min-w-0">
              {title}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={m.close}
              onClick={onClose}
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        <div ref={bodyRef} className="contents">
          {children}
        </div>
      </div>
    </div>,
    document.body,
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
    <kbd className="shrink-0 whitespace-nowrap rounded-[4px] border border-border-strong bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-muted">
      {children}
    </kbd>
  );
}
