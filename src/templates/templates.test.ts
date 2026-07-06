import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { scratchProject, TEMPLATES } from './index';

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug} builds valid, connected Terraform`, () => {
      const files = t.build('My Demo App');
      expect(Object.keys(files)).toContain('main.tf');
      expect(Object.keys(files)).toContain('providers.tf');
      expect(Object.keys(files)).toContain('versions.tf');

      const { ir, diagnostics } = parseProject(files);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

      const warnings = validateProject(ir, getDef);
      expect(warnings, `template ${t.slug} should have no validation warnings`).toEqual([]);

      const edges = deriveStructure(ir, getDef);
      expect(edges.length).toBeGreaterThan(0);

      // every resource type is in the catalog
      for (const r of ir.resources) {
        expect(getDef(r.type), `catalog def for ${r.type}`).toBeDefined();
      }

      // every resource carries a persisted canvas position
      for (const r of ir.resources) {
        expect(r.position, `${r.id} has a position`).toBeDefined();
      }
    });
  }

  it('scratch projects include provider + versions scaffolding', () => {
    for (const provider of ['aws', 'azure', 'gcp'] as const) {
      const files = scratchProject(provider, 'test');
      const { ir, diagnostics } = parseProject(files);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(ir.providers).toHaveLength(1);
      expect(ir.extras.some((e) => e.text.includes('required_providers'))).toBe(true);
    }
  });

  it('containment derives from real refs (web app: instance inside subnet inside vpc)', () => {
    const files = TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo');
    const { ir } = parseProject(files);
    deriveStructure(ir, getDef);
    const byId = new Map(ir.resources.map((r) => [r.id, r]));
    expect(byId.get('aws_subnet.public_a')?.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_instance.web')?.parentId).toBe('aws_subnet.public_a');
    expect(byId.get('aws_security_group.web')?.parentId).toBe('aws_vpc.main');
  });
});
