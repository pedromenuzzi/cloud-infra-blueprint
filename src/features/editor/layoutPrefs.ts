/**
 * The editor's layout preferences as plain data: which sections show, which
 * side the resource palette and the code pane sit on, how the inspector is
 * placed and how wide the code pane is. Pure functions (no DOM, no store)
 * so the rules are unit-tested; layoutStore.ts keeps the live copy.
 *
 * One rule holds everywhere: the canvas and the code can't both be hidden —
 * hiding one of them brings the other back.
 *
 * Stored as `cb-layout-v2`; the first read migrates `cb-panels-v1` (panel
 * visibility) and `cb-split-pct` (code width) and removes them.
 */

export type Side = 'left' | 'right';
export type InspectorMode = 'floating' | 'docked';
/** sections that can be shown or hidden */
export type SectionId = 'palette' | 'canvas' | 'code' | 'inspector';
/** sections that can change sides */
export type MovableId = 'palette' | 'code';

export interface LayoutPrefs {
  palette: boolean;
  canvas: boolean;
  code: boolean;
  /** the inspector opens with a selection; off, it waits as a slim tab */
  inspector: boolean;
  /** the palette is always the outermost column, on this side */
  paletteSide: Side;
  /** side of the canvas the code pane sits on */
  codeSide: Side;
  /** floating over the canvas, or a column of its own beside it */
  inspectorMode: InspectorMode;
  /** code pane width, % of the canvas + code area */
  split: number;
}

export const LAYOUT_KEY = 'cb-layout-v2';
export const LEGACY_PANELS_KEY = 'cb-panels-v1';
export const LEGACY_SPLIT_KEY = 'cb-split-pct';

export const SPLIT_MIN = 20;
export const SPLIT_MAX = 70;
export const SPLIT_DEFAULT = 36;

export const DEFAULT_PREFS: Readonly<LayoutPrefs> = Object.freeze({
  palette: true,
  canvas: true,
  code: true,
  inspector: true,
  paletteSide: 'left',
  codeSide: 'right',
  inspectorMode: 'floating',
  split: SPLIT_DEFAULT,
});

export const clampSplit = (pct: number): number => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct));

const isSide = (v: unknown): v is Side => v === 'left' || v === 'right';
const isMode = (v: unknown): v is InspectorMode => v === 'floating' || v === 'docked';

/** Anything (stored JSON, a partial object) → valid preferences that keep the canvas-or-code rule. */
export function normalizePrefs(input: unknown): LayoutPrefs {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const flag = (key: SectionId) => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : DEFAULT_PREFS[key]);
  const split = typeof raw.split === 'number' && Number.isFinite(raw.split) ? clampSplit(raw.split) : SPLIT_DEFAULT;
  const prefs: LayoutPrefs = {
    palette: flag('palette'),
    canvas: flag('canvas'),
    code: flag('code'),
    inspector: flag('inspector'),
    paletteSide: isSide(raw.paletteSide) ? raw.paletteSide : DEFAULT_PREFS.paletteSide,
    codeSide: isSide(raw.codeSide) ? raw.codeSide : DEFAULT_PREFS.codeSide,
    inspectorMode: isMode(raw.inspectorMode) ? raw.inspectorMode : DEFAULT_PREFS.inspectorMode,
    split,
  };
  if (!prefs.canvas && !prefs.code) prefs.code = true;
  return prefs;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The saved layout; on first run the v1 panel toggles and split width carry over (and are removed). */
export function readPrefs(storage: KeyValueStore | null): LayoutPrefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const saved = parse(storage.getItem(LAYOUT_KEY));
    if (saved && typeof saved === 'object') return normalizePrefs(saved);
    const legacy = parse(storage.getItem(LEGACY_PANELS_KEY));
    const legacySplit = Number(storage.getItem(LEGACY_SPLIT_KEY));
    const hasSplit = storage.getItem(LEGACY_SPLIT_KEY) !== null && Number.isFinite(legacySplit);
    if (!legacy && !hasSplit) return { ...DEFAULT_PREFS };
    const panels = legacy && typeof legacy === 'object' ? (legacy as Record<string, unknown>) : {};
    const migrated = normalizePrefs({
      palette: panels.palette,
      code: panels.code,
      inspector: panels.inspector,
      // v1 kept a split only when it was 20–70; anything else fell back to the default
      split: hasSplit && legacySplit >= SPLIT_MIN && legacySplit <= SPLIT_MAX ? legacySplit : undefined,
    });
    writePrefs(storage, migrated);
    storage.removeItem(LEGACY_PANELS_KEY);
    storage.removeItem(LEGACY_SPLIT_KEY);
    return migrated;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(storage: KeyValueStore | null, prefs: LayoutPrefs): void {
  try {
    storage?.setItem(LAYOUT_KEY, JSON.stringify({ v: 2, ...prefs, split: Math.round(prefs.split) }));
  } catch {
    /* private mode / full storage: the layout still applies to this tab */
  }
}

/** Show or hide one section, keeping the canvas or the code on screen. */
export function withSection(prefs: LayoutPrefs, section: SectionId, visible: boolean): LayoutPrefs {
  const next = { ...prefs, [section]: visible };
  if (!visible && section === 'canvas') next.code = true;
  if (!visible && section === 'code') next.canvas = true;
  return next;
}

/* ---------------------------------------------------------------- presets */

export type PresetId = 'default' | 'code-left' | 'canvas-focus' | 'code-focus';

/** what each preset sets; everything it leaves out stays as the user had it */
export const PRESETS: Readonly<Record<PresetId, Partial<LayoutPrefs>>> = {
  default: {
    palette: true,
    canvas: true,
    code: true,
    inspector: true,
    paletteSide: 'left',
    codeSide: 'right',
    inspectorMode: 'floating',
  },
  // the mirror image: code on the left, resources on the right
  'code-left': { palette: true, canvas: true, code: true, paletteSide: 'right', codeSide: 'left' },
  'canvas-focus': { palette: false, canvas: true, code: false },
  'code-focus': { palette: false, canvas: false, code: true },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function withPreset(prefs: LayoutPrefs, id: PresetId): LayoutPrefs {
  return normalizePrefs({ ...prefs, ...PRESETS[id] });
}

/** the preset the layout matches right now (the most specific one), if any */
export function activePreset(prefs: LayoutPrefs): PresetId | null {
  const matches = PRESET_IDS.filter((id) =>
    Object.entries(PRESETS[id]).every(([key, value]) => prefs[key as keyof LayoutPrefs] === value),
  );
  // "Default" also fixes the inspector; prefer it over a looser match
  return matches.includes('default') ? 'default' : (matches[0] ?? null);
}

/** Reset: the default layout and the default code width. */
export function defaultPrefs(): LayoutPrefs {
  return { ...DEFAULT_PREFS };
}

/**
 * Left-to-right order of the columns on a wide screen. The palette is the
 * outermost column on its side; the code pane sits on its side of the canvas.
 */
export function columnOrder(prefs: Pick<LayoutPrefs, 'paletteSide' | 'codeSide'>): Array<'palette' | 'canvas' | 'code'> {
  const middle: Array<'canvas' | 'code'> = prefs.codeSide === 'left' ? ['code', 'canvas'] : ['canvas', 'code'];
  return prefs.paletteSide === 'left' ? ['palette', ...middle] : [...middle, 'palette'];
}
