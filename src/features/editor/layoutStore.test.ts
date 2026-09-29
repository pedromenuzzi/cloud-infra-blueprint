/**
 * Layout preferences: validation, the canvas-or-code rule, presets, the
 * migration from cb-panels-v1 / cb-split-pct, and the live store's toggles
 * in wide and compact mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activePreset,
  columnOrder,
  DEFAULT_PREFS,
  LAYOUT_KEY,
  LEGACY_PANELS_KEY,
  LEGACY_SPLIT_KEY,
  normalizePrefs,
  readPrefs,
  withPreset,
  withSection,
  type LayoutPrefs,
} from './layoutPrefs';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const prefs = (over: Partial<LayoutPrefs> = {}): LayoutPrefs => ({ ...DEFAULT_PREFS, ...over });

describe('layout prefs', () => {
  it('turns anything into valid preferences', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs('nope')).toEqual(DEFAULT_PREFS);
    expect(
      normalizePrefs({ palette: 'yes', paletteSide: 'top', codeSide: 'left', inspectorMode: 'pinned', split: 99 }),
    ).toEqual({ ...DEFAULT_PREFS, codeSide: 'left', split: 70 });
    expect(normalizePrefs({ split: 5 }).split).toBe(20);
    expect(normalizePrefs({ split: Number.NaN }).split).toBe(DEFAULT_PREFS.split);
  });

  it('never hides the canvas and the code together', () => {
    expect(normalizePrefs({ canvas: false, code: false })).toMatchObject({ canvas: false, code: true });
    expect(withSection(prefs({ code: false }), 'canvas', false)).toMatchObject({ canvas: false, code: true });
    expect(withSection(prefs({ canvas: false }), 'code', false)).toMatchObject({ canvas: true, code: false });
    // other sections come and go freely
    expect(withSection(prefs(), 'palette', false)).toMatchObject({ palette: false, canvas: true, code: true });
    expect(withSection(prefs(), 'inspector', false)).toMatchObject({ inspector: false });
  });

  it('applies presets and recognizes the one in effect', () => {
    expect(activePreset(prefs())).toBe('default');
    const mirrored = withPreset(prefs(), 'code-left');
    expect(mirrored).toMatchObject({ paletteSide: 'right', codeSide: 'left', palette: true, code: true });
    expect(activePreset(mirrored)).toBe('code-left');
    expect(columnOrder(mirrored)).toEqual(['code', 'canvas', 'palette']);

    const canvasOnly = withPreset(mirrored, 'canvas-focus');
    expect(canvasOnly).toMatchObject({ palette: false, canvas: true, code: false, paletteSide: 'right' });
    expect(activePreset(canvasOnly)).toBe('canvas-focus');

    const codeOnly = withPreset(prefs(), 'code-focus');
    expect(codeOnly).toMatchObject({ palette: false, canvas: false, code: true });
    expect(activePreset(codeOnly)).toBe('code-focus');

    // "Default" puts everything back, the inspector included
    expect(withPreset(prefs({ inspectorMode: 'docked', inspector: false, canvas: false }), 'default')).toMatchObject(
      { ...DEFAULT_PREFS, split: DEFAULT_PREFS.split },
    );
    expect(activePreset(prefs({ inspectorMode: 'docked' }))).toBeNull();
  });

  it('orders the columns from the chosen sides', () => {
    expect(columnOrder(prefs())).toEqual(['palette', 'canvas', 'code']);
    expect(columnOrder(prefs({ codeSide: 'left' }))).toEqual(['palette', 'code', 'canvas']);
    expect(columnOrder(prefs({ paletteSide: 'right' }))).toEqual(['canvas', 'code', 'palette']);
  });
});

describe('layout storage', () => {
  it('migrates cb-panels-v1 and cb-split-pct once, then removes them', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_PANELS_KEY, JSON.stringify({ palette: false, code: true, inspector: false }));
    storage.setItem(LEGACY_SPLIT_KEY, '52');
    const migrated = readPrefs(storage);
    expect(migrated).toEqual({ ...DEFAULT_PREFS, palette: false, inspector: false, split: 52 });
    expect(storage.getItem(LEGACY_PANELS_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_SPLIT_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(LAYOUT_KEY)!)).toMatchObject({ v: 2, palette: false, split: 52 });
    // the second read is the v2 record
    expect(readPrefs(storage)).toEqual(migrated);
  });

  it('drops a v1 split outside 20–70, as v1 did', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_SPLIT_KEY, '90');
    expect(readPrefs(storage).split).toBe(DEFAULT_PREFS.split);
  });

  it('prefers v2 over leftovers, and survives broken or missing storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(LAYOUT_KEY, JSON.stringify({ v: 2, ...DEFAULT_PREFS, codeSide: 'left' }));
    storage.setItem(LEGACY_PANELS_KEY, JSON.stringify({ palette: false }));
    expect(readPrefs(storage)).toMatchObject({ codeSide: 'left', palette: true });

    const broken = new MemoryStorage();
    broken.setItem(LAYOUT_KEY, '{not json');
    expect(readPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(readPrefs(throwing)).toEqual(DEFAULT_PREFS);
  });
});

describe('layout store', () => {
  let storage: MemoryStorage;
  let useLayout: typeof import('./layoutStore').useLayout;

  beforeEach(async () => {
    storage = new MemoryStorage();
    storage.setItem(LEGACY_PANELS_KEY, JSON.stringify({ code: false }));
    vi.stubGlobal('localStorage', storage);
    vi.resetModules();
    ({ useLayout } = await import('./layoutStore'));
  });

  afterEach(() => vi.unstubAllGlobals());

  const saved = () => JSON.parse(storage.getItem(LAYOUT_KEY) ?? '{}') as LayoutPrefs;

  it('starts from the migrated v1 layout', () => {
    expect(useLayout.getState().panels).toEqual({ palette: true, canvas: true, code: false, inspector: true });
    expect(saved().code).toBe(false);
  });

  it('hides and shows sections on wide screens, keeping the canvas or the code, and saves it', () => {
    const s = () => useLayout.getState();
    s().toggle('code');
    expect(s().panels.code).toBe(true);
    s().toggle('canvas');
    expect(s().panels).toMatchObject({ canvas: false, code: true });
    expect(s().isOpen('canvas')).toBe(false);
    // hiding the code now brings the canvas back
    s().toggle('code');
    expect(s().panels).toMatchObject({ canvas: true, code: false });
    expect(saved()).toMatchObject({ canvas: true, code: false });
  });

  it('opens drawers on compact screens, from the panels’ sides', async () => {
    const { drawerSide } = await import('./layoutStore');
    const s = () => useLayout.getState();
    s().setCompact(true);
    s().toggle('palette');
    expect(s().drawer).toBe('palette');
    expect(s().isOpen('palette')).toBe(true);
    s().toggle('code');
    expect(s().drawer).toBe('code');
    expect(s().isOpen('palette')).toBe(false);
    // drawers don't touch the wide-screen preferences
    expect(s().panels.code).toBe(false);
    s().setSide('code', 'left');
    expect(drawerSide('code')).toBe('left');
    expect(drawerSide('palette')).toBe('left');
  });

  it('on compact screens a hidden canvas leaves the code on screen; "hide code" brings the canvas back', () => {
    const s = () => useLayout.getState();
    s().setCompact(true);
    s().toggle('code');
    expect(s().drawer).toBe('code');
    s().toggle('canvas');
    expect(s().panels.canvas).toBe(false);
    // the code fills the screen, not a drawer
    expect(s().drawer).toBeNull();
    expect(s().isOpen('code')).toBe(true);
    s().toggle('code');
    expect(s().panels.canvas).toBe(true);
    expect(s().isOpen('code')).toBe(false);
  });

  it('moves panels, docks the inspector, applies presets and resets', () => {
    const s = () => useLayout.getState();
    s().setSide('palette', 'right');
    s().setInspectorMode('docked');
    s().setSplit(90);
    expect(s().split).toBe(70);
    expect(saved()).toMatchObject({ paletteSide: 'right', inspectorMode: 'docked', split: 70 });

    s().setCompact(true);
    s().toggle('palette');
    s().applyPreset('code-focus');
    expect(s().drawer).toBeNull();
    expect(s().panels).toMatchObject({ palette: false, canvas: false, code: true });

    s().reset();
    expect(saved()).toMatchObject({ ...DEFAULT_PREFS, v: 2 });
  });

  it('does not write the split while it is being dragged', () => {
    const s = () => useLayout.getState();
    s().setSplit(44, false);
    expect(s().split).toBe(44);
    expect(saved().split).not.toBe(44);
    s().setSplit(44);
    expect(saved().split).toBe(44);
  });

  it('canvas focus hides resources and code, and brings back what it hid', () => {
    const s = () => useLayout.getState();
    s().toggle('code'); // palette + code visible
    s().toggleCanvasFocus();
    expect(s().panels).toMatchObject({ palette: false, code: false, canvas: true });
    s().toggleCanvasFocus();
    expect(s().panels).toMatchObject({ palette: true, code: true });

    // only what was showing comes back
    s().setVisible('palette', false);
    s().toggleCanvasFocus();
    s().toggleCanvasFocus();
    expect(s().panels).toMatchObject({ palette: false, code: true });
  });

  it('show() opens a panel only when it is closed', () => {
    const s = () => useLayout.getState();
    s().show('code');
    expect(s().panels.code).toBe(true);
    s().show('code');
    expect(s().panels.code).toBe(true);
    s().setCompact(true);
    s().show('code');
    expect(s().drawer).toBe('code');
    s().show('code');
    expect(s().drawer).toBe('code');
  });
});
