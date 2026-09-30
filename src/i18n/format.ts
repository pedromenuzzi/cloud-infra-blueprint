/**
 * Numbers, money and dates in the UI language. These read the language at
 * call time: a component that formats should also read `useLocale` (or use
 * `useMessages`, which does) so it re-renders on a switch.
 */
import { currentLocale, type Locale } from './locale';

/** the BCP 47 tag Intl gets for a UI language */
export const intlTag = (locale: Locale = currentLocale()): string => (locale === 'pt-BR' ? 'pt-BR' : 'en-US');

export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale?: Locale): string {
  return new Intl.NumberFormat(intlTag(locale), options).format(value);
}

/** prices are list prices in US dollars in both languages: "$27.40" / "US$ 27,40" */
export function formatUsd(value: number, options?: Intl.NumberFormatOptions, locale?: Locale): string {
  return new Intl.NumberFormat(intlTag(locale), { style: 'currency', currency: 'USD', ...options }).format(value);
}

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions, locale?: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), options).format(value);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago" / "há 3 horas"; under a minute: "now" / "agora" */
export function formatRelativeTime(then: Date | number, now: number = Date.now(), locale?: Locale): string {
  const seconds = Math.round((now - (typeof then === 'number' ? then : then.getTime())) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlTag(locale), { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}

/** a list joined the way the language does it: "a, b and c" / "a, b e c" */
export function formatList(items: string[], type: Intl.ListFormatType = 'conjunction', locale?: Locale): string {
  return new Intl.ListFormat(intlTag(locale), { style: 'long', type }).format(items);
}
