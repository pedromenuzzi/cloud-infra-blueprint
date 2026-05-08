import { Button } from '@blueprint/ui';
import {
  Boxes,
  Code2,
  HelpCircle,
  LayoutPanelTop,
  MousePointer2,
  PanelRight,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'blueprint:tour:dismissed:v1';

interface Step {
  title: string;
  icon: LucideIcon;
  body: string;
  /** Soft hint of what's still F2/F3 vs already in F1. */
  status?: 'live' | 'preview';
}

const STEPS: Step[] = [
  {
    title: 'Welcome to the editor',
    icon: HelpCircle,
    body: 'Cloud Blueprint keeps your architecture diagram and your Terraform code in perfect sync. This quick tour shows the four panels you can resize by dragging the bars between them.',
    status: 'live',
  },
  {
    title: 'Resource palette',
    icon: Boxes,
    body: 'Switch providers (AWS / Azure / GCP) via the tabs and drag any resource onto the canvas. Search filters by name, type or tag. The drag handler is wired — full apply-to-IR persistence ships in Phase 2 (canvas).',
    status: 'preview',
  },
  {
    title: 'Visual canvas',
    icon: MousePointer2,
    body: 'See your infrastructure as a diagram. Sample VPC + subnets + EC2 + RDS are pre-loaded. Zoom controls live bottom-left, the minimap bottom-right. Click any node to inspect it (Phase 2 wires real selection).',
    status: 'preview',
  },
  {
    title: 'HCL editor',
    icon: Code2,
    body: 'Tabs for main.tf, variables.tf, outputs.tf, providers.tf — edited via a Monaco-style preview today. Phase 3 swaps this for a real Monaco instance bound to a Yjs CRDT so canvas <> code stay in sync as you type.',
    status: 'preview',
  },
  {
    title: 'Inspector & topbar',
    icon: PanelRight,
    body: 'Right-side inspector shows properties / connections / generated HCL for the selected node. Topbar has Share, Export, the theme toggle, and the help (?) button — click it any time to reopen this tour.',
    status: 'live',
  },
];

interface OnboardingTourProps {
  /** External control. If `null`, the component decides via localStorage. */
  open?: boolean;
  onClose?: () => void;
  /** Storage scope; defaults to per-app key. Pass another to test independently. */
  storageKey?: string;
}

/**
 * Five-step onboarding overlay for the editor. Auto-shows on the first visit
 * (we persist a "dismissed" flag in localStorage), and can be reopened from
 * the topbar's `?` button. ESC and the Skip button both dismiss.
 */
export function OnboardingTour({
  open: openProp,
  onClose,
  storageKey = STORAGE_KEY,
}: OnboardingTourProps = {}) {
  const isControlled = openProp != null;
  const [internalOpen, setInternalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dontShow, setDontShow] = useState(false);

  // Auto-show on first visit when uncontrolled.
  useEffect(() => {
    if (isControlled) return;
    try {
      const dismissed = localStorage.getItem(storageKey);
      if (!dismissed) setInternalOpen(true);
    } catch {
      setInternalOpen(true);
    }
  }, [isControlled, storageKey]);

  // ESC closes.
  useEffect(() => {
    const open = isControlled ? openProp : internalOpen;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, openProp, internalOpen]);

  const close = useCallback(() => {
    if (dontShow) {
      try {
        localStorage.setItem(storageKey, '1');
      } catch {
        // No-op: storage may be unavailable in private mode / SSR.
      }
    }
    if (isControlled) {
      onClose?.();
    } else {
      setInternalOpen(false);
    }
    // Reset position so reopen always starts at step 0.
    setStep(0);
  }, [dontShow, isControlled, onClose, storageKey]);

  const open = isControlled ? !!openProp : internalOpen;
  if (!open) return null;

  const total = STEPS.length;
  const current = STEPS[step]!;
  const Icon = current.icon;
  const isFirst = step === 0;
  const isLast = step === total - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div aria-hidden className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Step {step + 1} of {total}
                {current.status === 'preview' && (
                  <span className="ml-2 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[hsl(var(--warning-foreground))] dark:text-warning">
                    Preview
                  </span>
                )}
              </p>
              <h2 id="tour-title" className="mt-0.5 text-base font-semibold leading-tight">
                {current.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close tour"
            className="focus-ring -m-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="px-5 py-4 text-sm leading-relaxed text-foreground">{current.body}</div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 px-5 pb-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to step ${i + 1}`}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => setStep(i)}
              className={
                i === step
                  ? 'h-1.5 w-6 rounded-full bg-primary transition-all'
                  : 'h-1.5 w-1.5 rounded-full bg-border transition-all hover:bg-muted-foreground'
              }
            />
          ))}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-border/60 bg-surface-1 px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            Don&apos;t show again
          </label>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              Skip
            </Button>
            {!isFirst && (
              <Button variant="secondary" size="sm" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {!isLast ? (
              <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={close}>
                Got it
              </Button>
            )}
          </div>
        </footer>
      </div>

      <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-card/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
        <LayoutPanelTop className="mr-1 inline h-3 w-3" /> Drag the bars between panels to resize.
      </p>
    </div>
  );
}
