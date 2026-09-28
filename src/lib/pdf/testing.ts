/** Test helpers for reading back PDFs written by writer.ts. */
import { expect } from 'vitest';
import { charWidth, type PdfFont } from './metrics';

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

const cp1252 = new TextDecoder('windows-1252');
const decodeHex = (hex: string) => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));

/** the text drawn on the pages of an uncompressed PDF (WinAnsi decoded) */
export function pdfText(bytes: Uint8Array): string {
  const out: string[] = [];
  for (const m of latin1(bytes).matchAll(/<([0-9a-f]*)> Tj/g)) out.push(cp1252.decode(new Uint8Array(decodeHex(m[1]))));
  return out.join('\n');
}

export interface PdfPageInfo {
  /** 0-based */
  index: number;
  width: number;
  height: number;
  /** the uncompressed content stream */
  content: string;
  /** link annotations: rect (bottom-up coordinates) and target */
  links: Array<{ rect: number[]; dest?: { page: number; top: number }; uri?: string }>;
}

/** the pages of an uncompressed PDF written by writer.ts, in order */
export function pdfPages(bytes: Uint8Array): PdfPageInfo[] {
  const text = latin1(bytes);
  const objects = new Map<number, string>();
  for (const m of text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) objects.set(Number(m[1]), m[2]);
  const kids = /\/Type \/Pages \/Kids \[([^\]]*)\]/.exec(text)![1].match(/\d+(?= 0 R)/g)!.map(Number);
  const pageOf = new Map(kids.map((id, i) => [id, i] as const));
  return kids.map((id, index) => {
    const dict = objects.get(id)!;
    const [, , w, h] = /\/MediaBox \[([\d. ]+)\]/.exec(dict)![1].split(' ').map(Number);
    const contentId = Number(/\/Contents (\d+) 0 R/.exec(dict)![1]);
    const stream = objects.get(contentId)!;
    const content = stream.slice(stream.indexOf('stream\n') + 7, stream.lastIndexOf('\nendstream'));
    const annots = /\/Annots \[([^\]]*)\]/.exec(dict)?.[1].match(/\d+(?= 0 R)/g)?.map(Number) ?? [];
    const links = annots.map((a) => {
      const body = objects.get(a)!;
      const rect = /\/Rect \[([-\d. ]+)\]/.exec(body)![1].split(' ').map(Number);
      const dest = /\/Dest \[(\d+) 0 R \/XYZ 0 ([-\d.]+) null\]/.exec(body);
      const uri = /\/URI \(([^)]*)\)/.exec(body)?.[1];
      return { rect, dest: dest ? { page: pageOf.get(Number(dest[1]))!, top: Number(dest[2]) } : undefined, uri };
    });
    return { index, width: w, height: h, content, links };
  });
}

const FONT_OF: Record<string, PdfFont> = { F1: 'regular', F2: 'bold', F3: 'mono' };

export interface TextRun {
  page: number;
  text: string;
  font: PdfFont;
  size: number;
  /** left edge and baseline, top-down like the writer's coordinates */
  x: number;
  y: number;
  width: number;
  /** drawn inside a clip (the diagram box) */
  clipped: boolean;
}

export interface ShapeExtent {
  page: number;
  /** extent of the path's points, top-down */
  minX: number;
  maxX: number;
  maxY: number;
  clipped: boolean;
}

/** every text run and painted shape of an uncompressed PDF, with its position */
export function pdfLayout(bytes: Uint8Array): { pages: PdfPageInfo[]; runs: TextRun[]; shapes: ShapeExtent[] } {
  const pages = pdfPages(bytes);
  const runs: TextRun[] = [];
  const shapes: ShapeExtent[] = [];
  for (const page of pages) {
    // clip scopes: a bare `q`, a `… W n` line, a bare `Q`
    const clipStack: boolean[] = [];
    let clipped = false;
    for (const line of page.content.split('\n')) {
      if (line === 'q') {
        clipStack.push(clipped);
        continue;
      }
      if (line === 'Q') {
        clipped = clipStack.pop() ?? false;
        continue;
      }
      if (line.endsWith(' W n')) {
        clipped = true;
        continue;
      }
      const t = /BT \/(F\d) ([\d.]+) Tf [\d. ]+ rg ([-\d.]+) ([-\d.]+) Td <([0-9a-f]*)> Tj ET/.exec(line);
      if (t) {
        const font = FONT_OF[t[1]];
        const size = Number(t[2]);
        const codes = decodeHex(t[5]);
        const width = (codes.reduce((sum, c) => sum + charWidth(c, font), 0) * size) / 1000;
        runs.push({
          page: page.index,
          text: cp1252.decode(new Uint8Array(codes)),
          font,
          size,
          x: Number(t[3]),
          y: page.height - Number(t[4]),
          width,
          clipped,
        });
        continue;
      }
      if (line.includes(' W n')) continue; // a self-contained clip (gradient fills)
      // painted paths: collect the points of m / l / c / re
      const tokens = line.split(' ');
      const nums: number[] = [];
      const xs: number[] = [];
      const ys: number[] = [];
      let inCm = false;
      for (const tok of tokens) {
        const v = Number(tok);
        if (tok !== '' && !Number.isNaN(v)) {
          nums.push(v);
          continue;
        }
        if (tok === 'cm') inCm = true;
        const take = (n: number) => nums.slice(-n);
        if (tok === 'm' || tok === 'l') {
          const [x, y] = take(2);
          xs.push(x);
          ys.push(y);
        } else if (tok === 'c') {
          const p = take(6);
          xs.push(p[0], p[2], p[4]);
          ys.push(p[1], p[3], p[5]);
        } else if (tok === 're') {
          const [x, y, w, h] = take(4);
          xs.push(x, x + w);
          ys.push(y, y + h);
        }
        nums.length = 0;
      }
      if (xs.length && !inCm) {
        shapes.push({
          page: page.index,
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          maxY: page.height - Math.min(...ys),
          clipped,
        });
      }
    }
  }
  return { pages, runs, shapes };
}
