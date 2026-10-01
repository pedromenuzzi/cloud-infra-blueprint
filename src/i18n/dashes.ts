/**
 * No dash as punctuation in anything a person reads, in either language:
 * "A — B", "A – B", "A - B", "A—B". A comma, a colon, a period or
 * parentheses do that job (see GLOSSARY.md). Fine: hyphens inside words
 * (sub-rede, read-only, us-east-1), numeric ranges (×0–1, 1024–65535,
 * 10.0.1.4 – 10.0.1.254) and a lone "—" standing for "no value".
 *
 * Used by the message-module tests and by e2e/i18n-sweep.spec.ts.
 */

/** "×0–1", "1–3 AZs", "5.1–5.4", "10.0.1.4 – 10.0.1.254": a number on each side */
const NUMERIC_RANGE = /[^\s–—-]*\d[^\s–—-]*\s?[–—-]\s?[^\s–—-]*\d[^\s–—-]*/gu;

/** a spaced dash or hyphen, an em dash glued between words, or one opening or closing a phrase */
const SENTENCE_DASH = /\s[—–-]\s|\S—\S|^[—–-]\s+\S|\S\s+[—–-]$/u;

/** the stretch of `text` with a dash used as punctuation (with a little context), or null */
export function sentenceDash(text: string): string | null {
  const rest = text.replace(/\s+/g, ' ').trim().replace(NUMERIC_RANGE, '#');
  const hit = SENTENCE_DASH.exec(rest);
  if (!hit) return null;
  return rest.slice(Math.max(0, hit.index - 24), hit.index + hit[0].length + 24);
}
