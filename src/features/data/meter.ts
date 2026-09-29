import { formatNumber } from '@/i18n/format';
import { currentLocale, type Locale } from '@/i18n/locale';

/**
 * Storage meter math. Two limits apply to this app's data:
 *
 * - localStorage, where projects live: ~5 Mi UTF-16 code units per origin,
 *   whatever the disk size — this is the one that fills up first;
 * - the origin quota reported by `navigator.storage.estimate()`, shared by
 *   the offline app cache, IndexedDB (folder links) and the rest.
 *
 * The meter shows the tighter of the two and nudges at 70%.
 */

/** Suggest backing up and freeing space from here on. */
export const NUDGE_AT = 0.7;
/** Saving is about to fail. */
export const FULL_AT = 0.95;

export interface StorageSnapshot {
  /** localStorage in use (all keys, UTF-16 code units — ~bytes for Terraform text) */
  localUsed: number;
  localBudget: number;
  /** `navigator.storage.estimate()`, when the browser has it */
  estimate?: { usage?: number; quota?: number } | null;
}

export interface MeterLimit {
  used: number;
  total: number;
  free: number;
  /** 0‥1 */
  ratio: number;
}

export interface Meter {
  local: MeterLimit;
  /** the origin quota, when known */
  origin: MeterLimit | null;
  /** which limit is closer to full */
  binding: 'local' | 'origin';
  /** the binding limit's ratio, 0‥1 */
  ratio: number;
  /** whole percent for display (never shows 100 before it is really full) */
  percent: number;
  level: 'ok' | 'nudge' | 'full';
}

function limit(used: number, total: number): MeterLimit {
  const safeUsed = Math.max(0, Number.isFinite(used) ? used : 0);
  const safeTotal = Math.max(0, Number.isFinite(total) ? total : 0);
  const ratio = safeTotal > 0 ? Math.min(1, safeUsed / safeTotal) : 0;
  return { used: safeUsed, total: safeTotal, free: Math.max(0, safeTotal - safeUsed), ratio };
}

export function computeMeter(snapshot: StorageSnapshot): Meter {
  const local = limit(snapshot.localUsed, snapshot.localBudget);
  const { usage, quota } = snapshot.estimate ?? {};
  const origin = typeof usage === 'number' && typeof quota === 'number' && quota > 0 ? limit(usage, quota) : null;
  const binding = origin && origin.ratio > local.ratio ? 'origin' : 'local';
  const ratio = binding === 'origin' ? origin!.ratio : local.ratio;
  const percent = ratio >= 1 ? 100 : Math.min(99, Math.round(ratio * 100));
  return {
    local,
    origin,
    binding,
    ratio,
    percent,
    level: ratio >= FULL_AT ? 'full' : ratio >= NUDGE_AT ? 'nudge' : 'ok',
  };
}

/** 0 B, 812 B, 12 KB, 1.2 MB, 38 GB (binary units, one decimal under 10; "1,2 MB" in Portuguese). */
export function formatBytes(bytes: number, locale: Locale = currentLocale()): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  // 1023.6 KB rounds to 1024 KB: say 1 MB instead
  if (rounded >= 1024 && unit < units.length - 1) return `1 ${units[unit + 1]}`;
  return `${locale === 'en' ? rounded : formatNumber(rounded, { useGrouping: false }, locale)} ${units[unit]}`;
}
