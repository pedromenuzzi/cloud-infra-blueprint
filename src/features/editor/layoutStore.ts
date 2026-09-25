/** Which editor panels are open — persisted per browser. */
import { create } from 'zustand';

export type PanelId = 'palette' | 'code' | 'inspector';

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
  toggle(panel: PanelId): void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  panels: read(),
  toggle(panel) {
    const panels = { ...get().panels, [panel]: !get().panels[panel] };
    set({ panels });
    try {
      localStorage.setItem(KEY, JSON.stringify(panels));
    } catch {
      /* private mode */
    }
  },
}));
