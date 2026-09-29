/**
 * Helpers for the price refresh (refresh-prices.ts): fetching the public price
 * lists, exact decimal conversions and loud failures. Node only — never
 * imported by the app.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** hours in the month every estimate uses (and GCP's own monthly figures) */
export const HOURS_PER_MONTH = 730;

export class PriceError extends Error {}

/** stop the refresh: a missing or ambiguous price must never become partial data */
export function fail(message: string): never {
  throw new PriceError(message);
}

export function log(message: string) {
  process.stdout.write(`${message}\n`);
}

/**
 * Set PRICES_CACHE_DIR to keep every download on disk and reuse it on the next
 * run (handy while adding SKUs: the GCP pages alone are ~70 MB). Delete the
 * directory to fetch fresh prices.
 */
const CACHE_DIR = process.env.PRICES_CACHE_DIR;

async function download(url: string): Promise<string> {
  const cached = CACHE_DIR ? join(CACHE_DIR, createHash('sha1').update(url).digest('hex')) : undefined;
  if (cached && existsSync(cached)) return readFileSync(cached, 'utf8');
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'accept-language': 'en-US,en', 'user-agent': 'cloud-blueprint-price-refresh' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (cached) {
        mkdirSync(CACHE_DIR!, { recursive: true });
        writeFileSync(cached, body);
      }
      return body;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return fail(`could not download ${url}: ${(lastError as Error).message}`);
}

export async function fetchText(url: string): Promise<string> {
  return download(url);
}

export async function fetchJson<T>(url: string): Promise<T> {
  const text = await download(url);
  try {
    return JSON.parse(text) as T;
  } catch {
    return fail(`${url} did not return JSON`);
  }
}

/** a price as the source spells it (`"0.0104000000"`, `2e-06`) → number, failing on anything else */
export function num(value: string | number | undefined, what: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === undefined || value === '' || !Number.isFinite(n) || n < 0) fail(`${what}: not a price (${String(value)})`);
  return n;
}

/** exact decimal spelling of a finite number (no exponent) */
function plainDecimal(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const [mantissa, exp] = s.toLowerCase().split('e');
  const e = Number(exp);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '');
  const [int, frac = ''] = digits.split('.');
  const all = int + frac;
  const point = int.length + e;
  const out =
    point <= 0 ? `0.${'0'.repeat(-point)}${all}` : point >= all.length ? `${all}${'0'.repeat(point - all.length)}` : `${all.slice(0, point)}.${all.slice(point)}`;
  return `${negative ? '-' : ''}${out}`;
}

/**
 * `value × 10^places`, exactly — per-unit prices become per-million or
 * per-10k ones without binary rounding noise (0.0000004 × 1e6 = 0.4, not
 * 0.39999999999999997).
 */
export function shift(value: number, places: number): number {
  const s = plainDecimal(value);
  const [int, frac = ''] = s.split('.');
  let digits = int + frac;
  let point = int.length + places;
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  return Number(`${digits.slice(0, point) || '0'}.${digits.slice(point) || '0'}`);
}

/** round half away from zero to `places` decimals (used only where a rate is converted, never on source prices) */
export function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** $/hour → $/month, at 730 h/month, rounded to 6 decimals */
export function monthly(hourly: number): number {
  return round(hourly * HOURS_PER_MONTH, 6);
}

/** $/day → $/month, at 730/24 days/month, rounded to 6 decimals */
export function monthlyFromDaily(daily: number): number {
  return round((daily * HOURS_PER_MONTH) / 24, 6);
}

export function median(values: number[]): number {
  if (!values.length) fail('median of nothing');
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Region multipliers: for each region, the median over `basket` of
 * regional price / default-region price, rounded to 3 decimals.
 */
export function multipliers(
  base: Record<string, number>,
  byRegion: Record<string, Record<string, number>>,
  regions: string[],
  defaultRegion: string,
  minSamples = 3,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const region of regions) {
    if (region === defaultRegion) {
      out[region] = 1;
      continue;
    }
    const prices = byRegion[region] ?? {};
    const ratios = Object.keys(base)
      .filter((sku) => prices[sku] !== undefined && base[sku] > 0)
      .map((sku) => prices[sku] / base[sku]);
    if (ratios.length < minSamples) fail(`region ${region}: only ${ratios.length} comparable prices`);
    out[region] = round(median(ratios), 3);
  }
  return out;
}

/** a record with the keys of `order` first, in that order */
export function ordered<T>(order: readonly string[], values: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of order) if (key in values) out[key] = values[key];
  for (const key of Object.keys(values)) if (!(key in out)) out[key] = values[key];
  return out;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
