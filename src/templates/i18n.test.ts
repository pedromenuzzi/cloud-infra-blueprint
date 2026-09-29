import { afterEach, describe, expect, it } from 'vitest';
import { useLocale } from '@/i18n/locale';
import { TEMPLATES } from './index';
import { templateDescription, templateName, templateSearchText, templateTagLabel } from './i18n';

afterEach(() => useLocale.getState().setLocale('en'));

describe('template text', () => {
  it('is the English source in English', () => {
    for (const t of TEMPLATES) {
      expect(templateName(t)).toBe(t.name);
      expect(templateDescription(t)).toBe(t.description);
    }
  });

  it('has a distinct Portuguese name and a description for every template', () => {
    useLocale.getState().setLocale('pt-BR');
    const names = TEMPLATES.map((t) => templateName(t));
    expect(new Set(names).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) expect(templateDescription(t).length).toBeGreaterThan(20);
    expect(templateName(TEMPLATES.find((t) => t.slug === 'aws-web-app')!)).toBe('App web na AWS');
    expect(templateTagLabel('Static Sites')).toBe('Sites estáticos');
  });

  it('searches in both languages', () => {
    const site = TEMPLATES.find((t) => t.slug === 'azure-static-site')!;
    expect(templateSearchText(site)).toMatch(/Static Site/);
    expect(templateSearchText(site)).toMatch(/Site estático/);
  });
});
