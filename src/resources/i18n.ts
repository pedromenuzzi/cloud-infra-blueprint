/**
 * Resource catalog text in the UI language — the one place every screen
 * (palette, canvas, inspector, security, PDF…) gets a resource's name,
 * short name, description and category label from.
 *
 * `ResourceDef.displayName` etc. stay English: they're the catalog's source
 * text (and tests and generated names rely on them). Call these instead
 * wherever the text is shown to a person. A component calling them should
 * also read `useLocale` (or `useMessages`) so it re-renders on a switch.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { getDef } from './registry';
import { CATEGORY_LABELS, type Category } from './types';

/** "EC2 Instance" / "Instância EC2"; the type itself when unknown */
export function resourceName(type: string, locale: Locale = currentLocale()): string {
  void locale;
  return getDef(type)?.displayName ?? type;
}

/** the canvas node title: "EC2", "Subnet" / "Sub-rede" */
export function resourceShortName(type: string, locale: Locale = currentLocale()): string {
  void locale;
  return getDef(type)?.shortName ?? type;
}

/** "Virtual machine" / "Máquina virtual" */
export function resourceDescription(type: string, locale: Locale = currentLocale()): string | undefined {
  void locale;
  return getDef(type)?.description;
}

export function categoryLabel(category: Category, locale: Locale = currentLocale()): string {
  void locale;
  return CATEGORY_LABELS[category];
}
