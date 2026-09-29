/**
 * Template names, descriptions and tags in the UI language — what every
 * screen that lists templates (dashboard, landing, template picker, command
 * palette) shows. `TemplateDef.name` etc. stay English: they are the source
 * text. A component calling these should also read `useLocale` (or
 * `useMessages`) so it re-renders on a language switch.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import type { TemplateDef, TemplateTag } from './index';
import { TEMPLATE_TAGS_PT, TEMPLATE_TEXT_PT } from './messages';

/** "Web App on AWS" / "App web na AWS" */
export function templateName(template: TemplateDef, locale: Locale = currentLocale()): string {
  return locale === 'pt-BR' ? TEMPLATE_TEXT_PT[template.slug].name : template.name;
}

export function templateDescription(template: TemplateDef, locale: Locale = currentLocale()): string {
  return locale === 'pt-BR' ? TEMPLATE_TEXT_PT[template.slug].description : template.description;
}

/** "Web Apps" / "Apps web" */
export function templateTagLabel(tag: TemplateTag, locale: Locale = currentLocale()): string {
  return locale === 'pt-BR' ? TEMPLATE_TAGS_PT[tag] : tag;
}

/** Name, description and tags in every language — what a search box should match. */
export function templateSearchText(template: TemplateDef): string {
  const pt = TEMPLATE_TEXT_PT[template.slug];
  return [
    template.name,
    template.description,
    ...template.tags,
    pt.name,
    pt.description,
    ...template.tags.map((tag) => TEMPLATE_TAGS_PT[tag]),
  ].join(' ');
}
