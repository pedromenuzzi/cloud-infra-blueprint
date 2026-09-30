/**
 * The canvas node's type label ("SECURITY GROUP" / "GRUPO DE SEGURANÇA") in
 * the small caps of features/editor/nodes.tsx: every catalog short name, in
 * both languages, must fit the node's header — two lines at most (the first
 * beside the provider chip, the second as wide as the text), no word broken
 * in the middle. Widths are estimated with Helvetica Bold's metrics
 * (src/lib/pdf/metrics.ts) scaled to Inter, plus the label's letter spacing;
 * e2e/polish-2.spec.ts measures the real thing in the browser.
 */
import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/locale';
import { textWidth } from '@/lib/pdf/metrics';
import { resourceShortName } from './i18n';
import { allDefs } from './registry';

/** nodes.tsx: a 208 px node, 1 px border and 10 px padding each side, a 40 px icon and a 10 px gap */
const TEXT_COLUMN = 208 - 2 - 20 - 40 - 10;
/** the provider chip at the header's right (9 px bold caps, 4 px padding each side), plus the 4 px gap */
const CHIP: Record<string, number> = { aws: 34, azure: 44, gcp: 32, other: 0 };
const SIZE = 9.5;
const TRACKING = 0.07 * SIZE;
/**
 * Inter Bold caps measure within a few % of Helvetica Bold's in Chromium
 * (narrower on average, wider on "I" and "M"): 5% of margin
 */
const INTER = 1.05;

const width = (text: string) => textWidth(text, 'bold', SIZE) * INTER + TRACKING * [...text].length;

/** greedy word wrap, as the browser does it: the first line `first` wide, the others `rest` (null when a word can't fit) */
function wrap(text: string, first: number, rest: number): string[] | null {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const max = lines.length === 0 ? first : rest;
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= max) {
      line = candidate;
      continue;
    }
    if (!line) return null;
    lines.push(line);
    if (width(word) > rest) return null;
    line = word;
  }
  lines.push(line);
  return lines;
}

const LOCALES: Locale[] = ['en', 'pt-BR'];

describe('canvas type labels', () => {
  for (const locale of LOCALES) {
    it(`every short name fits the node header in ${locale}`, () => {
      const problems: string[] = [];
      for (const def of allDefs()) {
        if (def.container) continue; // a container's header is as wide as the container
        const label = resourceShortName(def.type, locale).toUpperCase();
        const lines = wrap(label, TEXT_COLUMN - CHIP[def.provider], TEXT_COLUMN);
        if (!lines) problems.push(`${def.type}: a word of "${label}" is wider than the header`);
        else if (lines.length > 2) problems.push(`${def.type}: "${label}" takes ${lines.length} lines`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('leaves a container its name in the narrowest container', () => {
    // CONTAINER_MIN_W (ir/layout.ts) less padding, icon, five gaps and the provider chip; the subtitle gives
    // way first (nodes.tsx), so what the type label leaves is the name's: at least ~9 characters of it
    const NAME = 64;
    for (const locale of LOCALES) {
      for (const def of allDefs().filter((d) => d.container)) {
        const label = resourceShortName(def.type, locale).toUpperCase();
        const room = 320 - 24 - 24 - 5 * 8 - (CHIP[def.provider] - 4) - NAME;
        expect(width(label), `${def.type} (${locale}): "${label}"`).toBeLessThanOrEqual(room);
      }
    }
  });

  it('measures like the browser for a known label', () => {
    // "GRUPO DE SEGURANÇA" rendered at 9.5 px Inter Bold with 0.07em tracking is 123 px wide in Chromium
    expect(width('GRUPO DE SEGURANÇA')).toBeGreaterThan(120);
    expect(width('GRUPO DE SEGURANÇA')).toBeLessThan(140);
  });
});
