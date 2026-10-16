/**
 * Where the inspector is on screen, for the page that places it and for the
 * canvas, which keeps the selected resource out from under it (auto-pan,
 * minimap and top-center pills make room for the floating inspector).
 */
import { useDeploy } from '@/features/deploy/store';
import { useSecurityUi } from '@/features/security/securityStore';
import { useLayout, type FloatRoom } from './layoutStore';
import { useEditor } from './store';

/** floating and docked inspector width, px */
export const INSPECTOR_WIDTH = 300;
/** the tool panel's width (security, or plan and state), floating on the canvas's left, px */
export const TOOL_PANEL_WIDTH = 340;
/** canvas a floating panel must leave uncovered, px: less, and the panels take turns */
export const CANVAS_MIN_VISIBLE = 300;
/** a floating panel's margin from the canvas edge, px */
const MARGIN = 12;

/** How many floating panels a canvas this wide holds while keeping a usable view. */
export function floatRoomFor(canvasWidth: number): FloatRoom {
  if (canvasWidth >= TOOL_PANEL_WIDTH + INSPECTOR_WIDTH + 3 * MARGIN + CANVAS_MIN_VISIBLE) return 'both';
  return canvasWidth >= TOOL_PANEL_WIDTH + 2 * MARGIN + CANVAS_MIN_VISIBLE ? 'one' : 'narrow';
}

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

/** The security panel floats on the canvas's left: a drawer opening from the left covers it. */
export function securityPanelSlot(s: LayoutView): boolean {
  if (!s.compact) return true;
  return !(s.drawer === 'palette' && s.paletteSide === 'left') && !(s.drawer === 'code' && s.codeSide === 'left');
}

export interface FloatingPanels {
  /** the tool panel (security, or plan and state) is open on the canvas */
  tool: boolean;
  /** the inspector floats on the canvas (a selection, the layout puts it there) */
  inspector: boolean;
  /** the one waiting as a slim tab while the other is in front (too little room for both) */
  folded: 'tool' | 'inspector' | null;
}

/**
 * The floating panels and their turns: both while the canvas keeps a usable
 * view between them, otherwise the one in front and the other as a tab.
 */
export function floatingPanels(s: LayoutView, selected: boolean, toolOpen: boolean): FloatingPanels {
  const tool = toolOpen && securityPanelSlot(s);
  const inspector = selected && floatingInspectorSlot(s);
  const folded = tool && inspector && s.floatRoom !== 'both' ? (s.floatFront === 'tool' ? 'inspector' : 'tool') : null;
  return { tool, inspector, folded };
}

const toolOpenNow = () => useSecurityUi.getState().panelOpen || useDeploy.getState().panelOpen;
const panelsNow = () => floatingPanels(useLayout.getState(), useEditor.getState().selection !== null, toolOpenNow());

/** The floating panels, live. */
export function useFloatingPanels(): FloatingPanels {
  const selected = useEditor((s) => s.selection !== null);
  const security = useSecurityUi((s) => s.panelOpen);
  const deploy = useDeploy((s) => s.panelOpen);
  const of = (s: LayoutView) => floatingPanels(s, selected, security || deploy);
  return {
    tool: useLayout((s) => of(s).tool),
    inspector: useLayout((s) => of(s).inspector),
    folded: useLayout((s) => of(s).folded),
  };
}

/** The inspector floats over the canvas right now (layout + a selection, not waiting as a tab). */
export function useFloatingInspectorShown(): boolean {
  const { inspector, folded } = useFloatingPanels();
  return inspector && folded !== 'inspector';
}

/** Width of the canvas's right edge the floating inspector covers, margins included (0 when it isn't there). */
export function floatingInspectorInset(canvasWidth: number): number {
  const { inspector, folded } = panelsNow();
  return inspector && folded !== 'inspector' ? Math.min(INSPECTOR_WIDTH, canvasWidth - 2 * MARGIN) + 20 : 0;
}

/** Width of the canvas's left edge the tool panel covers, margins included (0 when it isn't there). */
export function toolPanelInset(canvasWidth: number): number {
  const { tool, folded } = panelsNow();
  return tool && folded !== 'tool' ? Math.min(TOOL_PANEL_WIDTH, canvasWidth - 2 * MARGIN) + 20 : 0;
}

/** A tool panel waiting as a tab comes to the front (its topbar button, a link to it). */
export function bringToolPanelForward(): boolean {
  if (panelsNow().folded !== 'tool') return false;
  useLayout.getState().setFloatFront('tool');
  return true;
}
