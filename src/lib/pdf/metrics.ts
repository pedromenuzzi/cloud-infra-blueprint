/**
 * Font metrics + text encoding for the PDF standard fonts we use.
 *
 * Every PDF viewer ships Helvetica, Helvetica-Bold and Courier, so nothing is
 * embedded. They are single-byte fonts: text is encoded as WinAnsi (CP1252),
 * which covers English and the Western European accents (á, ç, ã, ü…).
 * Anything else is transliterated or replaced with '?'.
 */

export type PdfFont = 'regular' | 'bold' | 'mono';

/** glyph widths (1/1000 em) for WinAnsi codes 32–255, from the Adobe core-14 AFM files */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
  722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0, 556, 0, 222, 556, 333,
  1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333,
  1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584,
  333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667,
  667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778,
  778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556,
  556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556,
  500, 556, 500,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778,
  722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0, 556, 0, 278, 556, 500,
  1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333,
  1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584,
  333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722,
  722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778,
  778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556,
  556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611,
  556, 611, 556,
];

/** CP1252 codes 0x80–0x9F, by Unicode code point */
const WIN_ANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** common symbols outside CP1252, spelled with characters that exist in it */
const TRANSLITERATE: Record<string, string> = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~',
  '✓': 'v', '✔': 'v', '✗': 'x', '✕': 'x', '⋯': '...', '−': '-', '‑': '-',
  ' ': ' ', ' ': ' ', '\t': '  ',
};

function codeOf(ch: string): number | undefined {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
  return WIN_ANSI_HIGH[cp];
}

/**
 * Encode text as WinAnsi byte codes. Characters the fonts can't show are
 * transliterated (→ becomes ->), stripped of accents the encoding lacks
 * (ő becomes o) or, as a last resort, replaced with '?'.
 */
export function encodeWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const code = codeOf(ch);
    if (code !== undefined) {
      out.push(code);
      continue;
    }
    if (ch === '\n' || ch === '\r') continue;
    const spelled = TRANSLITERATE[ch] ?? ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const codes = [...spelled].map(codeOf);
    if (spelled && spelled !== ch && codes.every((c) => c !== undefined)) out.push(...(codes as number[]));
    else out.push(0x3f);
  }
  return out;
}

export function charWidth(code: number, font: PdfFont): number {
  if (font === 'mono') return 600;
  const w = (font === 'bold' ? HELVETICA_BOLD : HELVETICA)[code - 32];
  return w || 556;
}

/** width of `text` in points */
export function textWidth(text: string, font: PdfFont, size: number): number {
  let units = 0;
  for (const code of encodeWinAnsi(text)) units += charWidth(code, font);
  return (units * size) / 1000;
}

/** width of one character (possibly transliterated to several glyphs), in 1/1000 em */
function charUnits(ch: string, font: PdfFont): number {
  let units = 0;
  for (const code of encodeWinAnsi(ch)) units += charWidth(code, font);
  return units;
}

/**
 * Split `text` into pieces no wider than `max` points, on character
 * boundaries — measured as rendered (→ is two glyphs, an emoji one '?') and
 * never inside a surrogate pair. Linear in the length of the text.
 */
export function splitToWidth(text: string, max: number, font: PdfFont, size: number): string[] {
  const limit = (max * 1000) / size;
  const parts: string[] = [];
  let cur = '';
  let units = 0;
  for (const ch of text.normalize('NFC')) {
    const w = charUnits(ch, font);
    if (cur && units + w > limit) {
      parts.push(cur);
      cur = '';
      units = 0;
    }
    cur += ch;
    units += w;
  }
  if (cur || parts.length === 0) parts.push(cur);
  return parts;
}

/** Word-wrap `text` to lines no wider than `max` points; explicit newlines are kept. */
export function wrapText(text: string, max: number, font: PdfFont, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/ +/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (textWidth(candidate, font, size) <= max) {
        cur = candidate;
        continue;
      }
      if (cur) lines.push(cur);
      if (textWidth(word, font, size) <= max) {
        cur = word;
      } else {
        const pieces = splitToWidth(word, max, font, size);
        lines.push(...pieces.slice(0, -1));
        cur = pieces[pieces.length - 1] ?? '';
      }
    }
    lines.push(cur);
  }
  return lines;
}

/** `text`, cut with an ellipsis so it fits in `max` points */
export function fitText(text: string, max: number, font: PdfFont, size: number): string {
  if (textWidth(text, font, size) <= max) return text;
  const limit = (max * 1000) / size - charUnits('…', font);
  let cut = '';
  let units = 0;
  for (const ch of text.normalize('NFC')) {
    const w = charUnits(ch, font);
    if (units + w > limit) break;
    cut += ch;
    units += w;
  }
  return `${cut.trimEnd()}…`;
}

/** the characters of `text` the standard fonts can't show (they print as '?'), each listed once */
export function unsupportedChars(text: string): string[] {
  const out = new Set<string>();
  for (const ch of text.normalize('NFC')) {
    if (ch === '?' || ch === '\n' || ch === '\r') continue;
    if (encodeWinAnsi(ch).includes(0x3f)) out.add(ch);
  }
  return [...out];
}
