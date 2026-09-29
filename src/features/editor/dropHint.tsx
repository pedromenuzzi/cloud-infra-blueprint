/**
 * What a drag over the canvas is about to do: the container it would go in
 * is outlined (dashed red when it can't), and a small card next to the
 * pointer says where it goes or why not. Set by the drag handlers
 * (./useCanvasDrops.ts), read by the container nodes and the card.
 */
import { Ban, CornerDownRight, Wrench } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useMessages } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { dropMessages } from './drop.messages';

export interface DropHint {
  /** the container to outline */
  targetId: string | null;
  tone: 'ok' | 'no';
  title: string;
  reason?: string;
  /** a fix is offered on release */
  fix?: boolean;
  /** pointer, in screen coordinates */
  x: number;
  y: number;
}

interface DropHintState {
  hint: DropHint | null;
  show(hint: DropHint): void;
  clear(): void;
}

const same = (a: DropHint, b: DropHint) =>
  a.targetId === b.targetId && a.tone === b.tone && a.title === b.title && a.reason === b.reason && a.fix === b.fix && a.x === b.x && a.y === b.y;

export const useDropHint = create<DropHintState>((set, get) => ({
  hint: null,
  show(hint) {
    const current = get().hint;
    if (!current || !same(current, hint)) set({ hint });
  },
  clear() {
    if (get().hint) set({ hint: null });
  },
}));

/** how a container node is outlined while something is dragged over it */
export const useDropTone = (id: string) => useDropHint((s) => (s.hint?.targetId === id ? s.hint.tone : null));

// --- the palette's drag carries its type only in the drop event: remember it at dragstart
let paletteType: string | null = null;

/** the resource type being dragged from the palette, if any */
export const draggedPaletteType = () => paletteType;

export function useTrackPaletteDrag() {
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      const item = (e.target as Element | null)?.closest?.('[data-rove^="res:"]');
      paletteType = item?.getAttribute('data-rove')?.slice(4) ?? null;
    };
    const onEnd = () => {
      paletteType = null;
      useDropHint.getState().clear();
    };
    document.addEventListener('dragstart', onStart, true);
    document.addEventListener('dragend', onEnd, true);
    document.addEventListener('drop', onEnd);
    return () => {
      document.removeEventListener('dragstart', onStart, true);
      document.removeEventListener('dragend', onEnd, true);
      document.removeEventListener('drop', onEnd);
    };
  }, []);
}

const CARD_W = 300;

/** the card by the pointer, plus a live region that reads it out */
export function DropHintCard() {
  const hint = useDropHint((s) => s.hint);
  const m = useMessages(dropMessages);
  const spoken = hint ? [hint.title, hint.reason, hint.fix ? m.releaseForFix : undefined].filter(Boolean).join('. ') : '';
  const left = hint ? (hint.x + 18 + CARD_W > window.innerWidth ? hint.x - 18 - CARD_W : hint.x + 18) : 0;
  const top = hint ? Math.min(hint.y + 18, window.innerHeight - 120) : 0;
  return createPortal(
    <>
      <span role="status" aria-live="polite" className="sr-only" data-bp-live="">
        {spoken}
      </span>
      {hint ? (
        <div
          aria-hidden
          data-testid="drop-hint"
          data-tone={hint.tone}
          className={cn(
            'pointer-events-none fixed z-[70] rounded-[10px] border bg-surface-1 px-3 py-2 shadow-lg',
            hint.tone === 'no' ? 'border-danger/50' : 'border-primary/40',
          )}
          style={{ left, top, maxWidth: CARD_W }}
        >
          <div
            className={cn(
              'flex items-center gap-1.5 text-[12.5px] font-semibold',
              hint.tone === 'no' ? 'text-danger' : 'text-primary',
            )}
          >
            {hint.tone === 'no' ? <Ban className="h-3.5 w-3.5 shrink-0" /> : <CornerDownRight className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0">{hint.title}</span>
          </div>
          {hint.reason ? <p className="mt-1 text-[11.5px] leading-snug text-muted">{hint.reason}</p> : null}
          {hint.fix ? (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-foreground">
              <Wrench className="h-3 w-3 shrink-0 text-primary" /> {m.releaseForFix}
            </p>
          ) : null}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
