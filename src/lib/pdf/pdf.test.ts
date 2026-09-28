import { unzlibSync, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { encodeWinAnsi, fitText, splitToWidth, textWidth, unsupportedChars, wrapText } from './metrics';
import { parseSvgPath, pathEnd, pointOnPath, shapePathData, type PathSeg } from './svgPath';
import { expectWellFormed, latin1, pdfLayout, pdfText } from './testing';
import { PdfDocument } from './writer';

describe('pdf metrics', () => {
  it('measures Helvetica with the AFM widths', () => {
    // H e l l o = 722 + 556 + 222 + 222 + 556 (regular), 722 + 556 + 278 + 278 + 611 (bold)
    expect(textWidth('Hello', 'regular', 10)).toBeCloseTo(22.78, 5);
    expect(textWidth('Hello', 'bold', 10)).toBeCloseTo(24.45, 5);
    expect(textWidth('abc', 'mono', 10)).toBeCloseTo(18, 5);
  });

  it('encodes WinAnsi, transliterating what the fonts lack', () => {
    expect(encodeWinAnsi('ação')).toEqual([0x61, 0xe7, 0xe3, 0x6f]);
    expect(encodeWinAnsi('a — b')).toEqual([0x61, 0x20, 0x97, 0x20, 0x62]);
    expect(encodeWinAnsi('€ • …')).toEqual([0x80, 0x20, 0x95, 0x20, 0x85]);
    expect(encodeWinAnsi('a→b')).toEqual([0x61, 0x2d, 0x3e, 0x62]);
    expect(encodeWinAnsi('ő')).toEqual([0x6f]);
    expect(encodeWinAnsi('🚀')).toEqual([0x3f]);
  });

  it('wraps words to a width and splits words that are too long', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog', 60, 'regular', 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 'regular', 10)).toBeLessThanOrEqual(60);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');

    const long = wrapText('arn:aws:iam::123456789012:role/very-long-role-name', 50, 'regular', 10);
    expect(long.join('')).toBe('arn:aws:iam::123456789012:role/very-long-role-name');
    for (const l of long) expect(textWidth(l, 'regular', 10)).toBeLessThanOrEqual(50);

    expect(wrapText('one\n\ntwo', 200, 'regular', 10)).toEqual(['one', '', 'two']);
  });

  it('cuts text with an ellipsis to fit', () => {
    const cut = fitText('a rather long project name', 50, 'bold', 10);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 'bold', 10)).toBeLessThanOrEqual(50);
    expect(fitText('short', 50, 'bold', 10)).toBe('short');
    // long input stays fast (linear) and still fits
    const long = fitText('x'.repeat(20_000), 80, 'mono', 7);
    expect(textWidth(long, 'mono', 7)).toBeLessThanOrEqual(80);
  });

  it('splits by rendered width: transliterations count as the glyphs they become, surrogate pairs stay whole', () => {
    // '→' prints as '->' (two glyphs): 10 arrows are 20 Courier cells, not 10
    const arrows = splitToWidth('→'.repeat(10), 7 * 0.6 * 12, 'mono', 7);
    expect(arrows.map((p) => [...p].length)).toEqual([6, 4]);
    for (const p of arrows) expect(textWidth(p, 'mono', 7)).toBeLessThanOrEqual(7 * 0.6 * 12 + 1e-9);

    const emoji = splitToWidth('ab😀cd😀ef', 7 * 0.6 * 3, 'mono', 7);
    expect(emoji.join('')).toBe('ab😀cd😀ef');
    for (const p of emoji) expect(p).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(splitToWidth('', 50, 'mono', 7)).toEqual(['']);
  });

  it('lists the characters the standard fonts cannot print', () => {
    expect(unsupportedChars('Produção — café, naïve')).toEqual([]);
    expect(unsupportedChars('Infra 生产 🚀 שלום?')).toEqual(['生', '产', '🚀', 'ש', 'ל', 'ו', 'ם']);
    // transliterated symbols print fine
    expect(unsupportedChars('a → b ≥ c')).toEqual([]);
  });
});

describe('svg paths', () => {
  const round = (segs: PathSeg[]) => JSON.parse(JSON.stringify(segs, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));

  it('reads absolute and relative commands, implicit repeats and compact numbers', () => {
    expect(round(parseSvgPath('M10,20 l5-5h10v10H0V0z'))).toEqual([
      { op: 'M', x: 10, y: 20 },
      { op: 'L', x: 15, y: 15 },
      { op: 'L', x: 25, y: 15 },
      { op: 'L', x: 25, y: 25 },
      { op: 'L', x: 0, y: 25 },
      { op: 'L', x: 0, y: 0 },
      { op: 'Z' },
    ]);
    // "M 0 0 1 1" continues as a line; ".5.5" is two numbers
    expect(round(parseSvgPath('M0 0 1 1 L.5.5'))).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 1, y: 1 },
      { op: 'L', x: 0.5, y: 0.5 },
    ]);
    // React Flow bézier edges
    expect(round(parseSvgPath('M100,50 C150,50 150,120 200,120'))).toEqual([
      { op: 'M', x: 100, y: 50 },
      { op: 'C', x1: 150, y1: 50, x2: 150, y2: 120, x: 200, y: 120 },
    ]);
  });

  it('turns quadratics, smooth curves and arcs into cubics', () => {
    const q = parseSvgPath('M0,0 Q10,10 20,0 T40,0');
    expect(q.map((s) => s.op)).toEqual(['M', 'C', 'C']);
    expect(round([q[1]])).toEqual([{ op: 'C', x1: 6.67, y1: 6.67, x2: 13.33, y2: 6.67, x: 20, y: 0 }]);
    const s = parseSvgPath('M0,0 C0,10 10,10 10,0 S20,-10 20,0');
    expect(round([s[2]])).toEqual([{ op: 'C', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 }]);
    // a half circle of radius 10 (compact arc flags as lucide writes them)
    const arc = parseSvgPath('M0,10 a10 10 0 01 20 0');
    expect(arc.map((x) => x.op)).toEqual(['M', 'C', 'C']);
    const top = pointOnPath([arc[0], arc[1]], 1)!;
    expect(top.x).toBeCloseTo(10, 5);
    expect(top.y).toBeCloseTo(0, 5);
  });

  it('converts basic shapes to path data', () => {
    const attrs = (a: Record<string, string>) => (name: string) => a[name] ?? null;
    expect(parseSvgPath(shapePathData('circle', attrs({ cx: '12', cy: '12', r: '10' }))!).filter((x) => x.op === 'C')).toHaveLength(4);
    expect(shapePathData('rect', attrs({ x: '2', y: '3', width: '20', height: '10' }))).toBe('M2,3 H22 V13 H2 Z');
    expect(parseSvgPath(shapePathData('rect', attrs({ width: '20', height: '10', rx: '2' }))!).length).toBeGreaterThan(8);
    expect(shapePathData('line', attrs({ x1: '1', y1: '2', x2: '3', y2: '4' }))).toBe('M1,2 L3,4');
    expect(shapePathData('polygon', attrs({ points: '0,0 10,0 5,8' }))).toBe('M0,0 L10,0 L5,8 Z');
    expect(shapePathData('text', attrs({}))).toBeUndefined();
  });

  it('finds where an edge arrives and from which direction', () => {
    const end = pathEnd(parseSvgPath('M0,0 C50,0 50,100 100,100'))!;
    expect(end).toMatchObject({ x: 100, y: 100 });
    expect(end.dx).toBeCloseTo(1, 5);
    expect(end.dy).toBeCloseTo(0, 5);
  });
});

describe('pdf writer', () => {
  it('writes a well-formed document with pages, images, links and bookmarks', () => {
    const doc = new PdfDocument({ title: 'Infra de produção', created: new Date(Date.UTC(2026, 8, 28, 11, 30)) }, false);
    const a = doc.addPage(595.28, 841.89);
    const b = doc.addPage(841.89, 595.28);
    a.text('Olá, visão geral', 40, 60, { font: 'bold', size: 18 });
    a.rect(40, 80, 200, 40, { fill: '#eef4fb', stroke: '#2563eb', radius: 6 });
    a.circle(60, 160, 8, { fill: '#10b981' });
    a.line(40, 200, 300, 200, { color: '#e2e8f0', dash: [1, 2] });
    a.link(40, 40, 100, 20, 'https://registry.terraform.io/(x)');
    a.linkTo(40, 220, 100, 20, b, 0);
    const img = doc.addImage(2, 1, zlibSync(new Uint8Array([255, 0, 0, 0, 0, 255])));
    b.image(img, 40, 40, 200, 100);
    doc.bookmark('Overview', a);
    doc.bookmark('Diagram', b);

    const bytes = doc.save();
    expectWellFormed(bytes);
    const text = latin1(bytes);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Subtype /Image /Width 2 /Height 1');
    expect(text).toContain('/Im1 Do');
    expect(text).toContain('/URI (https://registry.terraform.io/\\(x\\))');
    expect(text).toMatch(/\/Type \/Outlines .*\/Count 2/);
    expect(text).toContain('/CreationDate (D:20260928113000Z)');
    // top-left coordinates are flipped: y = 60 on an 841.89pt page is 781.89 from the bottom
    expect(text).toContain('40 781.89 Td');
    // Unicode title in the metadata, WinAnsi on the page
    expect(text).toContain('/Title <FEFF0049006e006600720061002000640065002000700072006f0064007500e700e3006f>');
    expect(pdfText(bytes)).toBe('Olá, visão geral');
  });

  it('draws paths, gradients, clips and translucent shapes', () => {
    const doc = new PdfDocument({}, false);
    const page = doc.addPage(200, 200);
    page.path(parseSvgPath('M0,0 L10,0 L10,10 Z'), { fill: '#ff0000', lineCap: 'round', lineJoin: 'round' }, { dx: 20, dy: 30, scale: 2 });
    page.gradientRect(10, 10, 40, 40, { from: '#fb923c', to: '#ea580c', angle: 145 }, 8);
    page.gradientRect(60, 10, 40, 40, { from: '#fb923c', to: '#ea580c', angle: 145 }, 8);
    page.rect(10, 60, 50, 20, { fill: '#000000', opacity: 0.5 });
    page.save();
    page.clipRect(0, 100, 100, 50, 4);
    page.setOpacity(0.4);
    page.text('dimmed', 10, 120, { opacity: 0.5 });
    page.restore();

    const bytes = doc.save();
    expectWellFormed(bytes);
    const text = latin1(bytes);
    // one shading reused by both tiles, declared on the page
    expect(text.match(/\/Sh0 sh/g)).toHaveLength(2);
    expect(text).toMatch(/\/Shading << \/Sh0 << \/ShadingType 2 /);
    // opacities multiply: 0.4 group × 0.5 text = 0.2
    expect(text).toMatch(/\/ExtGState << .*\/ca 0\.5 .*\/ca 0\.4 .*\/ca 0\.2 /);
    expect(text).toContain('20 170 m 40 170 l 40 150 l h');
    expect(text).toContain('1 J 1 j');
    const { runs } = pdfLayout(bytes);
    expect(runs).toEqual([expect.objectContaining({ text: 'dimmed', clipped: true, x: 10, y: 120 })]);
  });

  it('deflates page content by default', () => {
    const doc = new PdfDocument();
    doc.addPage(200, 200).text('compressed', 10, 20);
    const bytes = doc.save();
    expectWellFormed(bytes);
    const text = latin1(bytes);
    const m = /\/Filter \/FlateDecode \/Length (\d+)>>\nstream\n/.exec(text)!;
    const start = m.index + m[0].length;
    const content = latin1(unzlibSync(bytes.slice(start, start + Number(m[1]))));
    expect(content).toContain('Tj');
    expect(text).not.toContain('Tj');
  });
});
