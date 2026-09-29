import { describe, expect, it } from 'vitest';
import { TUTORIALS } from './index';
import { tutorialText } from './i18n';

/** the `code` spans of a paragraph, in order */
const codeSpans = (text: string) => text.split('`').filter((_, i) => i % 2 === 1);

describe('tutorial translations', () => {
  for (const tutorial of TUTORIALS) {
    it(`${tutorial.slug}: every step and paragraph is translated, code kept as is`, () => {
      const en = tutorialText(tutorial, 'en');
      const pt = tutorialText(tutorial, 'pt-BR');
      expect(en.title).toBe(tutorial.title);
      expect(pt.title).not.toBe(en.title);
      expect(pt.description.length).toBeGreaterThan(20);
      expect(pt.steps).toHaveLength(tutorial.steps.length);
      pt.steps.forEach((step, i) => {
        const source = tutorial.steps[i]!;
        expect(step.title.trim(), `step ${i + 1} title`).not.toBe('');
        expect(step.body, `step ${i + 1} paragraphs`).toHaveLength(source.body.length);
        step.body.forEach((paragraph, j) => {
          // the same code, in the same order: only the prose around it changes
          expect(codeSpans(paragraph), `step ${i + 1} ¶${j + 1}`).toEqual(codeSpans(source.body[j]!));
        });
      });
    });
  }
});
