import { formatRelativeTime } from '@/i18n/format';
import { currentLocale, type Locale } from '@/i18n/locale';

/** Join class names, skipping falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

let counter = 0;

/** Short unique id (good enough for client-side identities). */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(
    Math.random() * 1296,
  ).toString(36)}`;
}

/**
 * "2h ago" style relative time; in Portuguese "há 2 horas" (Intl), "agora"
 * under 45 seconds. Components showing it re-render on a language switch
 * through their own `useMessages`.
 */
export function timeAgo(iso: string, locale: Locale = currentLocale()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (locale === 'pt-BR') return s < 45 ? 'agora' : formatRelativeTime(then, now, locale);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function slugify(name: string): string {
  return (
    name
      // accents fold to their letter ("estático" → "estatico") instead of a dash
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || 'project'
  );
}

/** Valid Terraform identifier from arbitrary text. */
export function tfName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  const safe = cleaned || 'main';
  return /^[0-9]/.test(safe) ? `_${safe}` : safe;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped as typeof wrapped & { cancel: () => void };
}
