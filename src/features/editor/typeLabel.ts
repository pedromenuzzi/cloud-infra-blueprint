/**
 * The type label in a node's header (nodes.tsx): small bold caps, the first
 * line beside the provider chip, the second as wide as the text column, two
 * lines at most. Catalog short names always fit (src/resources/shortNames.test.ts);
 * a type outside the catalog is named by its Terraform type, in words, and cut
 * with an ellipsis where it would need a third line.
 *
 * Widths are estimated with Helvetica Bold's metrics scaled to Inter, plus the
 * label's letter spacing (e2e/polish-2.spec.ts measures the real thing).
 */
import { textWidth } from '@/lib/pdf/metrics';

/** nodes.tsx: a 208 px node, 1 px border and 10 px padding each side, a 40 px icon and a 10 px gap */
export const TEXT_COLUMN = 208 - 2 - 20 - 40 - 10;
/** the chip at the header's right, plus its 4 px gap: a provider's (9 px bold caps) or a data source's `data` */
export const CHIP = { aws: 34, azure: 44, gcp: 32, other: 0, data: 35 } as const;
const SIZE = 9.5;
const TRACKING = 0.07 * SIZE;
/** Inter Bold caps measure within a few % of Helvetica Bold's in Chromium: 5% of margin */
const INTER = 1.05;

/** the label's width in the header, as caps */
export const labelWidth = (text: string) => textWidth(text.toUpperCase(), 'bold', SIZE) * INTER + TRACKING * [...text].length;

/**
 * `label` as the header can show it: whole when it fits two lines, else cut
 * with an ellipsis on the second. A first word too long to sit beside the
 * chip gets a soft hyphen where it can break (the browser would otherwise
 * break it anywhere, with no hyphen).
 */
export function fitTypeLabel(label: string, chip: number): string {
  const text = label.replace(/_/g, ' ');
  const words = text.split(' ');
  const room = TEXT_COLUMN - chip;
  let first = '';
  let i = 0;
  for (; i < words.length; i++) {
    const candidate = first ? `${first} ${words[i]}` : words[i];
    if (labelWidth(candidate) > room) break;
    first = candidate;
  }
  let head = first;
  let rest = words.slice(i).join(' ');
  if (!first) {
    let cut = words[0];
    while (cut && labelWidth(`${cut}-`) > room) cut = cut.slice(0, -1);
    head = `${cut}\u00ad`;
    rest = text.slice(cut.length);
  }
  if (labelWidth(rest) <= TEXT_COLUMN) return first ? text : head + rest;
  let cut = rest;
  while (cut && labelWidth(`${cut}…`) > TEXT_COLUMN) cut = cut.slice(0, -1);
  return `${first ? `${head} ` : head}${cut.trimEnd()}…`;
}
