/**
 * Money for people: amounts in cents, rates with the digits that matter,
 * totals rounded — US dollars in every language, written the way the
 * language writes money ("$7.59" / "US$ 7,59").
 */
import { formatDate } from '@/i18n/format';
import { currentLocale, type Locale } from '@/i18n/locale';
import type { CostLine } from './types';

export const HOURS_PER_MONTH = 730;

/** keeps "US$" and the amount on one line */
const US = 'US$ ';

const grouped = (n: number, digits: number, locale: Locale) =>
  n.toLocaleString(locale === 'pt-BR' ? 'pt-BR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const money = (text: string, locale: Locale) => (locale === 'pt-BR' ? `${US}${text}` : `$${text}`);

/** $7.59, $1,234.50 · US$ 7,59, US$ 1.234,50 */
export function usd(amount: number, locale: Locale = currentLocale()): string {
  return money(grouped(amount, 2, locale), locale);
}

/** a unit price: $0.0104, $0.115, $0.08, $1.00, $0.00001667 */
export function rate(value: number, locale: Locale = currentLocale()): string {
  if (value === 0) return money('0', locale);
  if (value >= 1) return money(grouped(value, 2, locale), locale);
  // four significant digits, never in exponent notation (1.667e-5)
  const text = Number(value.toPrecision(4)).toFixed(12).replace(/0+$/, '');
  // "0.1" reads as a typo next to cents: keep at least two decimals
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  const digits = decimals < 2 ? value.toFixed(2) : text;
  return money(locale === 'pt-BR' ? digits.replace('.', ',') : digits, locale);
}

/** the headline number: ~$27, ~$8.23 under $10, ~$12.3k from $10,000 (~US$ 12,3 mil) */
export function approx(amount: number, locale: Locale = currentLocale()): string {
  const pt = locale === 'pt-BR';
  const one = (n: number) => (pt ? n.toFixed(1).replace('.', ',') : n.toFixed(1));
  if (amount <= 0) return money('0', locale);
  if (amount < 10) return `~${money(pt ? amount.toFixed(2).replace('.', ',') : amount.toFixed(2), locale)}`;
  if (amount < 10_000) return `~${money(grouped(Math.round(amount), 0, locale), locale)}`;
  if (amount < 1_000_000) {
    const k = amount < 100_000 ? one(amount / 1000) : (amount / 1000).toFixed(0);
    return pt ? `~${US}${k} mil` : `~$${k}k`;
  }
  return pt ? `~${US}${one(amount / 1_000_000)} mi` : `~$${one(amount / 1_000_000)}M`;
}

/** one line of a breakdown: "t3.micro 730 h × $0.0104 = $7.59", "Hosted zone $0.50" */
export function describeLine(line: CostLine, locale: Locale = currentLocale()): string {
  return line.detail ? `${line.label} ${line.detail} = ${usd(line.monthly, locale)}` : `${line.label} ${usd(line.monthly, locale)}`;
}

/** the whole breakdown on one line: "t3.micro 730 h × $0.0104 = $7.59 + 8 GB gp3 × $0.08 = $0.64" */
export function describeLines(lines: CostLine[], locale: Locale = currentLocale()): string {
  return lines.map((l) => describeLine(l, locale)).join(' + ');
}

/** "2026-09-29" → "Sep 29, 2026" / "29 de set. de 2026" */
export function priceDate(iso: string, locale: Locale = currentLocale()): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : formatDate(d, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }, locale);
}
