/**
 * Layout reactions a page wires up once: revealing a resource in code shows
 * the code pane, and the selected resource is kept out from under the
 * floating inspector.
 */
import { useEffect, useRef } from 'react';
import { canvasApi } from './canvasApi';
import { isCanvasDragging } from './canvasDrag';
import { useFloatingPanels } from './inspectorPlacement';
import { useLayout } from './layoutStore';
import { useEditor } from './store';

/**
 * Whenever a resource or an error is revealed in code (the inspector's Code
 * button, "Show in code", the command palette, the canvas's "Show the
 * error"), make sure the code pane is on screen: it then scrolls to the
 * block and highlights it, or puts the caret on the error.
 */
export function useRevealOpensCode(open: () => void) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(
    () =>
      useEditor.subscribe((state, prev) => {
        if (state.revealSeq !== prev.revealSeq || state.errorSeq !== prev.errorSeq) openRef.current();
      }),
    [],
  );
}

/**
 * When the floating inspector or the tool panel opens, the selection changes
 * or the panels around the canvas move, pan (smoothly, just enough) so the
 * selected resource isn't under them. Never mid-drag: the pointer owns the
 * canvas then.
 */
export function useKeepSelectionVisible() {
  const floats = useFloatingPanels();
  const inspector = floats.inspector && floats.folded !== 'inspector';
  const tool = floats.tool && floats.folded !== 'tool';
  const selection = useEditor((s) => s.selection);
  const single = useEditor((s) => s.selectedIds.length <= 1);
  const arrangement = useLayout(
    (s) => `${s.compact}:${s.panels.palette}${s.panels.code}:${s.paletteSide}${s.codeSide}`,
  );
  useEffect(() => {
    if (!(inspector || tool) || !selection || !single || isCanvasDragging()) return;
    // after the inspector (and any resized canvas) is on screen
    const frame = requestAnimationFrame(() => canvasApi()?.focusNode(selection));
    return () => cancelAnimationFrame(frame);
  }, [inspector, tool, selection, single, arrangement]);
}
