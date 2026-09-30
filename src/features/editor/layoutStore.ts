/**
 * Editor panel layout, persisted per browser (the rules live in layoutPrefs.ts).
 *
 * Wide screens: palette, canvas and code sit side by side in the order the
 * user chose; the inspector floats over the canvas while a resource is
 * selected, or docks as a column beside it. Any section can be hidden — it
 * leaves a slim strip that brings it back. Compact screens: the canvas takes
 * the full width and palette / code open as drawers over it (from their
 * side), one at a time. The topbar toggles work the same in both modes.
 */
import { create } from 'zustand';
import {
  clampSplit,
  defaultPrefs,
  readPrefs,
  withPreset,
  withSection,
  writePrefs,
  type InspectorMode,
  type LayoutPrefs,
  type MovableId,
  type PresetId,
  type SectionId,
  type Side,
} from './layoutPrefs';

export type PanelId = SectionId;
export type DrawerId = 'palette' | 'code';
export type { InspectorMode, MovableId, PresetId, Side };

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

interface LayoutState {
  panels: Record<PanelId, boolean>;
  paletteSide: Side;
  codeSide: Side;
  inspectorMode: InspectorMode;
  /** code pane width, % of the canvas + code area */
  split: number;
  compact: boolean;
  drawer: DrawerId | null;
  /**
   * The editor page is on screen with its configurable layout. The read-only
   * viewer reuses the canvas and inspector but always floats the inspector.
   */
  editorLayout: boolean;
  /** a panel being dragged by its grip to the other side, and the side under the pointer */
  panelDrag: { panel: MovableId; over: Side | null } | null;
  setCompact(compact: boolean): void;
  setEditorLayout(on: boolean): void;
  /** show / hide a panel — or, on compact screens, open / close its drawer */
  toggle(panel: PanelId): void;
  /** make a panel visible (opens its drawer on compact screens) */
  show(panel: PanelId): void;
  /** wide-screen visibility, keeping the canvas or the code on screen */
  setVisible(panel: PanelId, visible: boolean): void;
  setSide(panel: MovableId, side: Side): void;
  setInspectorMode(mode: InspectorMode): void;
  /** `persist: false` while the splitter is being dragged */
  setSplit(pct: number, persist?: boolean): void;
  applyPreset(id: PresetId): void;
  /** the default layout and code width */
  reset(): void;
  /** hide palette and code for the canvas; again: bring back what it hid */
  toggleCanvasFocus(): void;
  setPanelDrag(drag: LayoutState['panelDrag']): void;
  closeDrawer(): void;
  /** is this panel currently showing (for toggle pressed-state) */
  isOpen(panel: PanelId): boolean;
}

function prefsOf(s: LayoutState): LayoutPrefs {
  return {
    ...s.panels,
    paletteSide: s.paletteSide,
    codeSide: s.codeSide,
    inspectorMode: s.inspectorMode,
    split: s.split,
  };
}

function stateOf(prefs: LayoutPrefs): Pick<LayoutState, 'panels' | 'paletteSide' | 'codeSide' | 'inspectorMode' | 'split'> {
  const { palette, canvas, code, inspector, paletteSide, codeSide, inspectorMode, split } = prefs;
  return { panels: { palette, canvas, code, inspector }, paletteSide, codeSide, inspectorMode, split };
}

/** what "canvas focus" hid, to put back (this tab only) */
let focusRestore: { palette: boolean; code: boolean } | null = null;

export const useLayout = create<LayoutState>((set, get) => {
  const commit = (prefs: LayoutPrefs, extra: Partial<LayoutState> = {}) => {
    set({ ...stateOf(prefs), ...extra });
    writePrefs(storage(), prefs);
  };

  return {
    ...stateOf(readPrefs(storage())),
    compact: false,
    drawer: null,
    editorLayout: false,
    panelDrag: null,
    setCompact(compact) {
      if (compact !== get().compact) set({ compact, drawer: null });
    },
    setEditorLayout(on) {
      if (on !== get().editorLayout) set({ editorLayout: on });
    },
    toggle(panel) {
      const { compact, drawer, panels } = get();
      if (compact && panel === 'palette') {
        set({ drawer: drawer === 'palette' ? null : 'palette' });
        return;
      }
      if (compact && panel === 'code') {
        // canvas hidden: the code already fills the screen — "hide code" brings the canvas back
        if (!panels.canvas) get().setVisible('canvas', true);
        else set({ drawer: drawer === 'code' ? null : 'code' });
        return;
      }
      get().setVisible(panel, !panels[panel]);
    },
    show(panel) {
      if (!get().isOpen(panel)) get().toggle(panel);
    },
    setVisible(panel, visible) {
      if (get().panels[panel] === visible) return;
      if (panel === 'palette' || panel === 'code') focusRestore = null;
      const next = withSection(prefsOf(get()), panel, visible);
      // the code drawer has nothing to cover once the code fills the screen
      const drawer = !next.canvas && get().drawer === 'code' ? null : get().drawer;
      commit(next, { drawer });
    },
    setSide(panel, side) {
      const key = panel === 'palette' ? 'paletteSide' : 'codeSide';
      if (get()[key] === side) return;
      commit({ ...prefsOf(get()), [key]: side });
    },
    setInspectorMode(mode) {
      if (get().inspectorMode === mode) return;
      commit({ ...prefsOf(get()), inspectorMode: mode });
    },
    setSplit(pct, persist = true) {
      const split = clampSplit(pct);
      if (!persist) {
        if (split !== get().split) set({ split });
        return;
      }
      commit({ ...prefsOf(get()), split });
    },
    applyPreset(id) {
      focusRestore = null;
      commit(withPreset(prefsOf(get()), id), { drawer: null });
    },
    reset() {
      focusRestore = null;
      commit(defaultPrefs(), { drawer: null });
    },
    toggleCanvasFocus() {
      const prefs = prefsOf(get());
      if (prefs.palette || prefs.code || !prefs.canvas) {
        const restore = { palette: prefs.palette, code: prefs.code };
        commit({ ...prefs, palette: false, code: false, canvas: true }, { drawer: null });
        focusRestore = restore;
        return;
      }
      const restore = focusRestore ?? { palette: true, code: true };
      focusRestore = null;
      commit({ ...prefs, ...restore });
    },
    setPanelDrag(panelDrag) {
      set({ panelDrag });
    },
    closeDrawer() {
      set({ drawer: null });
    },
    isOpen(panel) {
      const { compact, drawer, panels } = get();
      if (!compact) return panels[panel];
      if (panel === 'palette') return drawer === 'palette';
      if (panel === 'code') return !panels.canvas || drawer === 'code';
      return panels[panel];
    },
  };
});

/** the side a drawer opens from on compact screens (its panel's side of the canvas) */
export function drawerSide(drawer: DrawerId, s: Pick<LayoutState, 'paletteSide' | 'codeSide'> = useLayout.getState()): Side {
  return drawer === 'palette' ? s.paletteSide : s.codeSide;
}
