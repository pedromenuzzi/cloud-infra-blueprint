/**
 * Where the inspector is on screen, for the page that places it and for the
 * canvas, which keeps the selected resource out from under it (auto-pan,
 * minimap and top-center pills make room for the floating inspector).
 */
import { useLayout } from './layoutStore';
import { useEditor } from './store';

/** floating and docked inspector width, px */
export const INSPECTOR_WIDTH = 300;

type LayoutView = ReturnType<typeof useLayout.getState>;

/** Would a selection show the inspector floating over the canvas? */
export function floatingInspectorSlot(s: LayoutView): boolean {
  if (!s.panels.inspector) return false;
  // the viewer's own layout: always floating, its code drawer is its own state
  if (!s.editorLayout) return !(s.compact && s.drawer === 'code');
  if (!s.panels.canvas) return false;
  // compact: the (wide) code drawer, or the palette drawer on the inspector's side, covers it
  if (s.compact) return !(s.drawer === 'code' || (s.drawer === 'palette' && s.paletteSide === 'right'));
  return s.inspectorMode === 'floating';
}

/** Is the inspector docked in a column of its own beside the canvas? (it never covers the canvas then) */
export function dockedInspector(s: LayoutView): boolean {
  return s.editorLayout && !s.compact && s.panels.canvas && s.inspectorMode === 'docked';
}

/** The inspector floats over the canvas right now (layout + a selection). */
export function useFloatingInspectorShown(): boolean {
  const selected = useEditor((s) => s.selection !== null);
  const slot = useLayout(floatingInspectorSlot);
  return selected && slot;
}

/** Width of the canvas's right edge the floating inspector covers, margins included (0 when it isn't there). */
export function floatingInspectorInset(canvasWidth: number): number {
  const open = floatingInspectorSlot(useLayout.getState()) && useEditor.getState().selection !== null;
  return open ? Math.min(INSPECTOR_WIDTH, canvasWidth - 24) + 20 : 0;
}

/** The security panel floats on the canvas's left: a drawer opening from the left covers it. */
export function securityPanelSlot(s: LayoutView): boolean {
  if (!s.compact) return true;
  return !(s.drawer === 'palette' && s.paletteSide === 'left') && !(s.drawer === 'code' && s.codeSide === 'left');
}
