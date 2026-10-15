/**
 * Monaco's own words in the UI language: the table its `localize` reads
 * (patched in vite.config.ts), English text → this language's. Imported by
 * setup.ts before Monaco, so the words Monaco settles while loading (its
 * menus, the find widget's labels) are already translated.
 *
 * A switch afterwards rewords what Monaco looks up when it shows it (hovers,
 * suggestions, the problems peek); what it settled while loading only
 * changes with a reload, which a toast offers.
 */
import { showToast } from '@/components/Toast';
import { currentLocale, useLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { monacoMessages, monacoReloadMessages } from './nls.messages';

type Table = Record<string, string>;

/** English text → its translation in `locale` (none for English) */
export function monacoTable(locale: Locale): Table | undefined {
  if (locale === 'en') return undefined;
  const en = monacoMessages.en as Table;
  const translated = monacoMessages[locale] as Table;
  return Object.fromEntries(Object.keys(en).map((key) => [en[key], translated[key]]));
}

const scope = globalThis as { __cbMonacoNls?: Table };
/** the language Monaco settled its words in */
const loadedIn = currentLocale();
scope.__cbMonacoNls = monacoTable(loadedIn);

useLocale.subscribe((state, prev) => {
  if (state.locale === prev.locale) return;
  scope.__cbMonacoNls = monacoTable(state.locale);
  // back to the language it loaded in: nothing waits for a reload
  if (state.locale === loadedIn) return;
  const m = messagesFor(monacoReloadMessages, state.locale);
  showToast(m.reloadToSwitch, 'info', { action: { label: m.reload, onClick: () => location.reload() } });
});
