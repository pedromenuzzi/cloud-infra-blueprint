import { describe, expect, it } from 'vitest';
import { diffAddedLines } from '@/components/HclSnippet';
import { parseProject } from '@/hcl/parser';
import { validateProject } from '@/ir/validate';
import { getDef } from '@/resources/registry';
import { TUTORIALS } from './index';

describe('tutorials', () => {
  it('has unique slugs', () => {
    const slugs = TUTORIALS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const tutorial of TUTORIALS) {
    describe(tutorial.slug, () => {
      tutorial.steps.forEach((step, i) => {
        it(`step ${i + 1} "${step.title}" is valid Terraform`, () => {
          const { ir, diagnostics } = parseProject(step.files);
          expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
          // teaching material must not trip its own validator
          const warnings = validateProject(ir, getDef);
          expect(warnings).toEqual([]);
          // the focus file must exist
          expect(step.files[step.focusFile ?? 'main.tf']).toBeDefined();
          expect(step.body.length).toBeGreaterThan(0);
        });
      });

      it('steps grow the infrastructure', () => {
        const counts = tutorial.steps.map(
          (s) => parseProject(s.files).ir.resources.length,
        );
        for (let i = 1; i < counts.length; i++) {
          expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        }
      });

      it('later steps highlight added lines', () => {
        for (let i = 1; i < tutorial.steps.length; i++) {
          const prev = tutorial.steps[i - 1];
          const cur = tutorial.steps[i];
          const anyAdded = Object.keys(cur.files).some(
            (f) => diffAddedLines(prev.files[f] ?? '', cur.files[f]).size > 0,
          );
          expect(anyAdded, `step ${i + 1} of ${tutorial.slug} adds visible lines`).toBe(true);
        }
      });
    });
  }
});
