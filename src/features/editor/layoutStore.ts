/**
 * Editor panel layout, persisted per browser.
 *
 * Wide screens: palette and code sit beside the canvas; the inspector floats
 * over the canvas while a resource is selected. Compact screens: the canvas
 * takes the full width and palette / code open as drawers over it, one at a
 * time. The topbar toggles work the same in both modes.
 */
import { create } from 'zustand';

export type PanelId = 'palette' | 'code' | 'inspector';
export type DrawerId = 'palette' | 'code';

const KEY = 'cb-panels-v1';

function read(): Record<PanelId, boolean> {
  const all = { palette: true, code: true, inspector: true };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...all, ...(JSON.parse(raw) as Partial<Record<PanelId, boolean>>) } : all;
  } catch {
    return all;
  }
}

interface LayoutState {
  panels: Record<PanelId, boolean>;
  compact: boolean;
  drawer: DrawerId | null;
  setCompact(compact: boolean): void;
  toggle(panel: PanelId): void;
  closeDrawer(): void;
  /** is this panel currently showing (for toggle pressed-state) */
  isOpen(panel: PanelId): boolean;
}

export const useLayout = create<LayoutState>((set, get) => ({
  panels: read(),
  compact: false,
  drawer: null,
  setCompact(compact) {
    if (compact !== get().compact) set({ compact, drawer: null });
  },
  toggle(panel) {
    const { compact, drawer } = get();
    if (compact && panel !== 'inspector') {
      set({ drawer: drawer === panel ? null : panel });
      return;
    }
    const panels = { ...get().panels, [panel]: !get().panels[panel] };
    set({ panels });
    try {
      localStorage.setItem(KEY, JSON.stringify(panels));
    } catch {
      /* private mode */
    }
  },
  closeDrawer() {
    set({ drawer: null });
  },
  isOpen(panel) {
    const { compact, drawer, panels } = get();
    return compact && panel !== 'inspector' ? drawer === panel : panels[panel];
  },
}));
