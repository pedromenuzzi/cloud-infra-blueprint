/**
 * Resource catalog text in the UI language — the one place every screen
 * (palette, canvas, inspector, security, PDF…) gets a resource's name,
 * short name, description, category label, canvas subtitle and field help
 * from.
 *
 * `ResourceDef.displayName` etc. stay English: they're the catalog's source
 * text (and tests and generated names rely on them). Call these instead
 * wherever the text is shown to a person. A component calling them should
 * also read `useLocale` (or `useMessages`) so it re-renders on a switch.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import type { Expression } from '@/ir/types';
import { CATALOG_PT_BR, type CatalogText } from './catalog.messages';
import { resourceMessages } from './messages';
import { getDef } from './registry';
import type { Category, FieldDef } from './types';

function portuguese(type: string, locale: Locale): CatalogText | undefined {
  return locale === 'pt-BR' && Object.hasOwn(CATALOG_PT_BR, type) ? CATALOG_PT_BR[type as keyof typeof CATALOG_PT_BR] : undefined;
}

/** "EC2 Instance" / "Instância EC2"; the type itself when unknown */
export function resourceName(type: string, locale: Locale = currentLocale()): string {
  return portuguese(type, locale)?.name ?? getDef(type)?.displayName ?? type;
}

/** the canvas node title: "EC2", "Subnet" / "Sub-rede" */
export function resourceShortName(type: string, locale: Locale = currentLocale()): string {
  return portuguese(type, locale)?.shortName ?? getDef(type)?.shortName ?? type;
}

/** "Virtual machine" / "Máquina virtual" */
export function resourceDescription(type: string, locale: Locale = currentLocale()): string | undefined {
  const def = getDef(type);
  if (!def?.description) return undefined;
  return portuguese(type, locale)?.description ?? def.description;
}

export function categoryLabel(category: Category, locale: Locale = currentLocale()): string {
  return messagesFor(resourceMessages, locale).categories[category];
}

/** the canvas node's second line ("t3.micro", "2 inbound · 1 outbound" / "2 de entrada · 1 de saída") */
export function resourceSubtitle(
  type: string,
  args: Record<string, Expression>,
  locale: Locale = currentLocale(),
): string | undefined {
  return getDef(type)?.subtitle?.(args, locale);
}

export interface FieldHelp {
  /** a friendlier name than the argument ("Security groups"), when the catalog gives one */
  label?: string;
  /** the one-line hint under the field ("GiB", "Globally unique…") */
  doc?: string;
  /** an example value — Terraform text, the same in every language */
  placeholder?: string;
}

/**
 * What the inspector shows around a catalog field, in the UI language.
 * Fields the catalog doesn't know (schema arguments) have no help here.
 */
export function fieldHelp(type: string, field: string, locale: Locale = currentLocale()): FieldHelp {
  const def: FieldDef | undefined = getDef(type)?.fields.find((f) => f.name === field);
  if (!def) return {};
  const text = portuguese(type, locale)?.fields?.[field];
  return {
    label: def.label === undefined ? undefined : (text?.label ?? def.label),
    doc: def.doc === undefined ? undefined : (text?.doc ?? def.doc),
    placeholder: def.placeholder,
  };
}
