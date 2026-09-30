import { useEffect } from 'react';
import { currentLocale, useLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { libMessages } from './messages';

export const APP_NAME = 'Cloud Blueprint';
export const DEFAULT_TITLE = `${APP_NAME} — ${libMessages.en.appTagline}`;

/** The landing title in a language: "Cloud Blueprint — <tagline>". */
export function defaultTitle(locale: Locale = currentLocale()): string {
  return `${APP_NAME} — ${messagesFor(libMessages, locale).appTagline}`;
}

/** Formats a page title the way every route does: "<page> — Cloud Blueprint". */
export function pageTitle(title?: string | null, locale: Locale = currentLocale()): string {
  const clean = title?.trim();
  return clean ? `${clean} — ${APP_NAME}` : defaultTitle(locale);
}

/**
 * Sets `document.title` while the calling component is mounted, e.g.
 * `useDocumentTitle(projectName)` → "my-app — Cloud Blueprint". A falsy
 * title shows the default (landing) title. Pass the title already in the UI
 * language; the default follows a language switch by itself.
 */
export function useDocumentTitle(title?: string | null) {
  const locale = useLocale((s) => s.locale);
  useEffect(() => {
    document.title = pageTitle(title, locale);
    return () => {
      document.title = defaultTitle(locale);
    };
  }, [title, locale]);
}
