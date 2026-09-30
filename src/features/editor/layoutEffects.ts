/**
 * Layout reactions a page wires up once: revealing a resource in code shows
 * the code pane, and the selected resource is kept out from under the
 * floating inspector.
 */
import { useEffect, useRef } from 'react';
import { canvasApi } from './canvasApi';
import { isCanvasDragging } from './canvasDrag';
import { useFloatingInspectorShown } from './inspectorPlacement';
import { useLayout } from './layoutStore';
import { useEditor } from './store';

/**
 * Whenever a resource is revealed in code (the inspector's Code button,
 * "Show in code", the command palette), make sure the code pane is on
 * screen — it then scrolls to the block and highlights it.
 */
export function useRevealOpensCode(open: () => void) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(
    () =>
      useEditor.subscribe((state, prev) => {
        if (state.revealSeq !== prev.revealSeq) openRef.current();
      }),
    [],
  );
}

/**
 * When the floating inspector opens, the selection changes or the panels
 * around the canvas move, pan (smoothly, just enough) so the selected
 * resource isn't under the inspector. Never mid-drag: the pointer owns the
 * canvas then.
 */
export function useKeepSelectionVisible() {
  const floating = useFloatingInspectorShown();
  const selection = useEditor((s) => s.selection);
  const single = useEditor((s) => s.selectedIds.length <= 1);
  const arrangement = useLayout(
    (s) => `${s.compact}:${s.panels.palette}${s.panels.code}:${s.paletteSide}${s.codeSide}`,
  );
  useEffect(() => {
    if (!floating || !selection || !single || isCanvasDragging()) return;
    // after the inspector (and any resized canvas) is on screen
    const frame = requestAnimationFrame(() => canvasApi()?.focusNode(selection));
    return () => cancelAnimationFrame(frame);
  }, [floating, selection, single, arrangement]);
}
