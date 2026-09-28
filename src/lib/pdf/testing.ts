/** Test helpers for reading back PDFs written by writer.ts. */
import { expect } from 'vitest';

export const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/** every xref entry must point at the start of its object, startxref at the table */
export function expectWellFormed(bytes: Uint8Array) {
  const text = latin1(bytes);
  expect(text.startsWith('%PDF-1.4\n')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(startxref))!;
  expect(first).toBe('0');
  const entries = text.slice(startxref).split('\n').slice(3, 2 + Number(count));
  entries.forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    expect(text.slice(offset, offset + `${i + 1} 0 obj`.length), `object ${i + 1}`).toBe(`${i + 1} 0 obj`);
  });
  // stream lengths match their data
  for (const m of text.matchAll(/\/Length (\d+)>>\nstream\n/g)) {
    const start = m.index! + m[0].length;
    expect(text.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe('\nendstream');
  }
}

/** the text drawn on the pages of an uncompressed PDF (WinAnsi decoded) */
export function pdfText(bytes: Uint8Array): string {
  const cp1252 = new TextDecoder('windows-1252');
  const out: string[] = [];
  for (const m of latin1(bytes).matchAll(/<([0-9a-f]*)> Tj/g)) {
    out.push(cp1252.decode(new Uint8Array((m[1].match(/../g) ?? []).map((h) => parseInt(h, 16)))));
  }
  return out.join('\n');
}
