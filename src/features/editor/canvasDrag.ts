/**
 * "Something is being dragged over the canvas" — a node (or a box-selected
 * group, or a connection being drawn), or a resource from the palette. While
 * it lasts, the panels floating over the canvas (inspector, security panel)
 * turn see-through and let the pointer through, so what's under them stays
 * visible and droppable.
 *
 * Node drags are read from the pointer, not from React Flow's callbacks:
 * the pointer moves past React Flow's own drag threshold (1 px) on the same
 * event React Flow starts its drag, so the flag is set before any selection
 * change that drag causes is rendered.
 */
import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';

type DragKind = 'node' | 'palette';

export const useCanvasDrag = create<{ kind: DragKind | null }>(() => ({ kind: null }));

export const isCanvasDragging = (): boolean => useCanvasDrag.getState().kind !== null;

const set = (kind: DragKind | null) => {
  if (useCanvasDrag.getState().kind !== kind) useCanvasDrag.setState({ kind });
};

/** where a pointer-down starts a drag of canvas content (not a pan of empty canvas, not a resize) */
const DRAGGABLE = '.react-flow__node, .react-flow__nodesselection-rect, .react-flow__handle';
const NOT_A_DRAG = '.react-flow__resize-control, .nodrag, button, input, select, textarea';

/** Track node drags that start inside `ref` (the canvas) — once `active` (the canvas is mounted). */
export function useCanvasDragTracking(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    let cleanup: (() => void) | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest(DRAGGABLE) || target.closest(NOT_A_DRAG)) return;
      cleanup?.();
      const { clientX: x0, clientY: y0 } = e;
      const onMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 1) set('node');
      };
      const onEnd = () => {
        cleanup?.();
        set(null);
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onEnd, true);
      window.addEventListener('pointercancel', onEnd, true);
      window.addEventListener('blur', onEnd);
      cleanup = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
        window.removeEventListener('blur', onEnd);
        cleanup = null;
      };
    };
    root.addEventListener('pointerdown', onDown, true);
    return () => {
      root.removeEventListener('pointerdown', onDown, true);
      cleanup?.();
      set(null);
    };
  }, [ref, active]);
}

/**
 * A palette resource is being dragged (HTML drag and drop). `dragend` fires
 * on the palette item; `drop` anywhere also ends it in case the item left
 * the page mid-drag (a drawer that closed).
 */
export function paletteDragStarted() {
  set('palette');
  const end = () => {
    window.removeEventListener('dragend', end, true);
    window.removeEventListener('drop', end, true);
    // after the canvas has handled the drop
    setTimeout(() => {
      if (useCanvasDrag.getState().kind === 'palette') set(null);
    }, 0);
  };
  window.addEventListener('dragend', end, true);
  window.addEventListener('drop', end, true);
}
