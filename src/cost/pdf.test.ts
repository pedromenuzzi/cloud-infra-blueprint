/** The "Cost estimate" section of the PDF document (archDoc.ts), read back from the file. */
import { describe, expect, it } from 'vitest';
import { buildArchitecturePdf, type ArchDocInput, type DocSections } from '@/features/export/archDoc';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { expectWellFormed, pdfLayout, pdfText } from '@/lib/pdf/testing';
import { getDef } from '@/resources/registry';
import { auditSecurity } from '@/security/audit';
import { TEMPLATES } from '@/templates';
import { estimateProject } from './estimate';
import { approx, usd } from './format';
import { PRICE_BOOK } from './prices/prices';

const SECTIONS: DocSections = { inventory: true, connections: true, security: true, code: false, cost: true };

function pdfFor(slug: string, sections: Partial<DocSections> = {}) {
  const files = TEMPLATES.find((t) => t.slug === slug)!.build('production-web');
  const { ir } = parseProject(files);
  const input: ArchDocInput = {
    title: 'Cost review',
    ir,
    edges: deriveStructure(ir, getDef),
    files: Object.entries(files),
    audit: auditSecurity(ir),
    diagram: null,
    sections: { ...SECTIONS, ...sections },
    paper: 'a4',
    generatedAt: new Date(2026, 8, 29, 9, 0),
    compress: false,
  };
  return { bytes: buildArchitecturePdf(input), cost: estimateProject(ir, PRICE_BOOK) };
}

describe('PDF cost estimate', () => {
  it('adds the section, its table of contents entry and an overview tile', () => {
    const { bytes, cost } = pdfFor('aws-web-app');
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    for (const s of ['Cost estimate', 'Est. per month'.toUpperCase(), 'By category', 'By resource', 'Total for the priced resources', 'Assumptions']) {
      expect(text, s).toContain(s);
    }
    // TOC line + section title
    expect(text.split('\n').filter((l) => l === 'Cost estimate').length).toBeGreaterThanOrEqual(2);
    expect(text).toContain(approx(cost.total));
    expect(text).toContain(`${usd(cost.total)} / month`);
    expect(text).toMatch(/t3\.micro 730 h × \$0\.\d+ = \$\d+\.\d\d/);
    expect(text).toContain('This is an estimate for planning, not a quote.');
    expect(text).toMatch(/No charge of their own \(9\): /);
    // five overview tiles: every label still fits
    expect(text.split('\n')).toContain('NETWORKS');
    expect(text).not.toMatch(/^[A-Z .&]+…$/m);
  });

  it('is left out when the switch is off (or absent)', () => {
    for (const sections of [{ cost: false }, { cost: undefined }]) {
      const text = pdfText(pdfFor('aws-web-app', sections).bytes);
      expect(text).not.toContain('Cost estimate');
      expect(text).not.toContain('EST. PER MONTH');
    }
  });

  it('shows usage-based services without a number, and totals by cloud for multi-cloud designs', () => {
    const serverless = pdfText(pdfFor('aws-serverless-api').bytes);
    expect(serverless).toContain('usage-based');
    const multi = pdfFor('multi-cloud-dr');
    const text = pdfText(multi.bytes);
    expect(text).toContain('By cloud');
    for (const g of multi.cost.byProvider.filter((p) => p.key !== 'other')) expect(text).toContain(g.priced ? usd(g.monthly) : 'no fixed price');
  });

  it('keeps every line of the section inside the margins', () => {
    for (const slug of ['aws-web-app', 'multi-cloud-dr', 'aws-container-stack']) {
      const bytes = pdfFor(slug).bytes;
      const { pages, runs } = pdfLayout(bytes);
      const start = runs.find((r) => r.text === 'Cost estimate' && r.size === 16)!;
      expect(start, slug).toBeDefined();
      for (const r of runs.filter((x) => x.page >= start.page && !x.clipped)) {
        expect(r.x, `${slug} "${r.text}"`).toBeGreaterThanOrEqual(39.5);
        expect(r.x + r.width, `${slug} "${r.text}"`).toBeLessThanOrEqual(pages[r.page].width - 39.5);
        expect(r.y, `${slug} "${r.text}"`).toBeLessThanOrEqual(pages[r.page].height - 23.9);
      }
    }
  });
});
