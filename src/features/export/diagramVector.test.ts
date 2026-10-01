/**
 * The PDF diagram's node cards: a long type label takes a second line (as on
 * the canvas) instead of an ellipsis, and a module call gets the module
 * node's neutral tile, not a resource category's color.
 */
import { describe, expect, it } from 'vitest';
import { textWidth } from '@/lib/pdf/metrics';
import { parseSvgPath } from '@/lib/pdf/svgPath';
import { latin1, pdfText } from '@/lib/pdf/testing';
import { PdfDocument } from '@/lib/pdf/writer';
import { drawDiagram, LIGHT_PALETTE, typeLabelLines, type DiagramNode, type DiagramVector } from './diagramVector';

const card = (over: Partial<DiagramNode>): DiagramNode => ({
  id: 'aws_s3_bucket_public_access_block.site',
  kind: 'resource',
  x: 0,
  y: 0,
  w: 208,
  h: 76,
  title: 'site',
  subtitle: 'nunca público',
  typeLabel: 'Bloqueio de acesso público',
  category: 'identity',
  provider: 'aws',
  glyph: 'g',
  ...over,
});

function render(nodes: DiagramNode[]): Uint8Array {
  const d: DiagramVector = {
    bounds: { x: 0, y: 0, width: 520, height: 120 },
    nodes,
    edges: [],
    glyphs: {
      g: { strokeWidth: 2, parts: [{ path: parseSvgPath('M4,4 L20,20'), fill: false, stroke: true }] },
      module: { strokeWidth: 2, parts: [{ path: parseSvgPath('M4,4 L20,20'), fill: false, stroke: true }] },
    },
    palette: LIGHT_PALETTE,
    lens: false,
  };
  const doc = new PdfDocument({}, false);
  const page = doc.addPage(600, 200);
  drawDiagram(page, d, { x: 20, y: 20, scale: 1, region: { x: 0, y: 0, w: 520, h: 120 }, locale: 'pt-BR' });
  return doc.save();
}

/** `#94a3b8` as the writer spells a color: `0.58 0.639 0.722` */
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => String(Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000)).join(' ');

describe('PDF diagram cards', () => {
  it('splits a long type label at a word, the first line beside the provider chip', () => {
    expect(typeLabelLines('SUB-REDE', 100, 140)).toEqual(['SUB-REDE']);
    const [first, second] = typeLabelLines('BLOQUEIO DE ACESSO PÚBLICO', 90, 138);
    expect(`${first} ${second}`).toBe('BLOQUEIO DE ACESSO PÚBLICO');
    expect(textWidth(first, 'bold', 9.5)).toBeLessThanOrEqual(90);
    expect(second).not.toContain('…');
    // a hyphen breaks like a space, and the hyphen stays on the first line
    expect(typeLabelLines('ASSOCIAÇÃO DE SUB-REDE DO NAT', textWidth('ASSOCIAÇÃO DE SUB-', 'bold', 9.5) + 1, 200)).toEqual([
      'ASSOCIAÇÃO DE SUB-',
      'REDE DO NAT',
    ]);
    // what two lines can't hold is cut on the second
    expect(typeLabelLines('A VERY LONG LABEL THAT GOES ON AND ON AND ON', 40, 60)[1]).toMatch(/…$/);
  });

  it('draws both lines of a long Portuguese type label, uncut, with the name and subtitle below', () => {
    const text = pdfText(render([card({}), card({ id: 'aws_security_group.web', typeLabel: 'Grupo de segurança', x: 260, title: 'web' })]));
    expect(text).not.toContain('…');
    expect(text).toContain('BLOQUEIO DE');
    expect(text).toContain('ACESSO PÚBLICO');
    expect(text).toContain('GRUPO DE');
    expect(text).toContain('SEGURANÇA');
    expect(text).toContain('nunca público');
  });

  it("gives a module call the module node's slate tile and label, not the compute orange", () => {
    const module = card({
      id: 'module.net',
      typeLabel: 'Módulo',
      title: 'net',
      subtitle: './modules/net',
      category: 'compute',
      provider: 'other',
      glyph: 'module',
    });
    const pdf = latin1(render([module]));
    expect(pdf).toContain(`/C0 [${rgb('#94a3b8')}] /C1 [${rgb('#475569')}]`);
    expect(pdf).not.toContain(rgb('#fb923c'));
    // the label in --module-text, and the stacked card behind it
    expect(pdf).toContain(`${rgb('#475569')} rg`);
    // a compute resource keeps its orange
    expect(latin1(render([card({ category: 'compute', glyph: 'g' })]))).toContain(`/C0 [${rgb('#fb923c')}]`);
  });
});
