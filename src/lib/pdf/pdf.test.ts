import { unzlibSync, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { encodeWinAnsi, fitText, textWidth, wrapText } from './metrics';
import { expectWellFormed, latin1, pdfText } from './testing';
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
