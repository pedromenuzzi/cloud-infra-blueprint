/**
 * Data source catalog text in the UI language: the one place the canvas,
 * the inspector, the palette, ⌘K and the PDF get a data source's name,
 * short name and description from. A type the catalog doesn't describe is
 * named after the resource catalog's entry of the same type (`aws_lb` → the
 * load balancer's name) or, failing that, its type without the provider
 * prefix.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { resourceName, resourceShortName } from '@/resources/i18n';
import { getDef } from '@/resources/registry';
import { presetByKey, typeDef, type DataSourcePreset } from './catalog';
import { DATA_PRESETS_PT_BR, DATA_TYPES_PT_BR } from './catalog.messages';

const ptType = (type: string, locale: Locale) =>
  locale === 'pt-BR' && Object.hasOwn(DATA_TYPES_PT_BR, type) ? DATA_TYPES_PT_BR[type as keyof typeof DATA_TYPES_PT_BR] : undefined;

const ptPreset = (key: string, locale: Locale) =>
  locale === 'pt-BR' && Object.hasOwn(DATA_PRESETS_PT_BR, key) ? DATA_PRESETS_PT_BR[key as keyof typeof DATA_PRESETS_PT_BR] : undefined;

const bare = (type: string) => type.replace(/^(aws|azurerm|azuread|google)_/, '');

/** "Availability Zones" / "Zonas de disponibilidade" */
export function dataSourceName(type: string, locale: Locale = currentLocale()): string {
  const def = typeDef(type);
  if (def) return ptType(type, locale)?.name ?? def.displayName;
  return getDef(type) ? resourceName(type, locale) : type;
}

/** the canvas node's type line: "Account" / "Conta" */
export function dataSourceShortName(type: string, locale: Locale = currentLocale()): string {
  const def = typeDef(type);
  if (def) return ptType(type, locale)?.shortName ?? def.shortName;
  return getDef(type) ? resourceShortName(type, locale) : bare(type);
}

export function dataSourceDescription(type: string, locale: Locale = currentLocale()): string | undefined {
  const def = typeDef(type);
  return def ? (ptType(type, locale)?.description ?? def.description) : undefined;
}

/** a palette entry's name: its own ("Ubuntu AMI") or its type's */
export function presetName(p: DataSourcePreset | string, locale: Locale = currentLocale()): string {
  const preset = typeof p === 'string' ? presetByKey(p) : p;
  if (!preset) return String(p);
  if (preset.displayName) return ptPreset(preset.key, locale)?.name ?? preset.displayName;
  return dataSourceName(preset.type, locale);
}

export function presetDescription(p: DataSourcePreset, locale: Locale = currentLocale()): string | undefined {
  if (p.description) return ptPreset(p.key, locale)?.description ?? p.description;
  return dataSourceDescription(p.type, locale);
}
