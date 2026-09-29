/** Money for people: amounts in cents, rates with the digits that matter, totals rounded. */
import type { CostLine } from './types';

export const HOURS_PER_MONTH = 730;

const grouped = (n: number, digits: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** $7.59, $1,234.50 */
export function usd(amount: number): string {
  return `$${grouped(amount, 2)}`;
}

/** a unit price: $0.0104, $0.115, $0.08, $1.00, $0.00001667 */
export function rate(value: number): string {
  if (value === 0) return '$0';
  if (value >= 1) return `$${grouped(value, 2)}`;
  // four significant digits, never in exponent notation (1.667e-5)
  const text = Number(value.toPrecision(4)).toFixed(12).replace(/0+$/, '');
  // "0.1" reads as a typo next to cents: keep at least two decimals
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  return `$${decimals < 2 ? value.toFixed(2) : text}`;
}

/** the headline number: ~$27, ~$8.23 under $10, ~$12.3k from $10,000 */
export function approx(amount: number): string {
  if (amount <= 0) return '$0';
  if (amount < 10) return `~$${amount.toFixed(2)}`;
  if (amount < 10_000) return `~$${grouped(Math.round(amount), 0)}`;
  if (amount < 1_000_000) return `~$${(amount / 1000).toFixed(amount < 100_000 ? 1 : 0)}k`;
  return `~$${(amount / 1_000_000).toFixed(1)}M`;
}

/** one line of a breakdown: "t3.micro 730 h × $0.0104 = $7.59", "Hosted zone $0.50" */
export function describeLine(line: CostLine): string {
  return line.detail ? `${line.label} ${line.detail} = ${usd(line.monthly)}` : `${line.label} ${usd(line.monthly)}`;
}

/** the whole breakdown on one line: "t3.micro 730 h × $0.0104 = $7.59 + 8 GB gp3 × $0.08 = $0.64" */
export function describeLines(lines: CostLine[]): string {
  return lines.map(describeLine).join(' + ');
}

const DATE = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-09-29" → "Sep 29, 2026" */
export function priceDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
}
