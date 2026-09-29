/**
 * The UI language, persisted per browser. First visit: the browser's
 * preferred languages decide (any Portuguese → pt-BR), else English.
 */
import { create } from 'zustand';

export type Locale = 'en' | 'pt-BR';

export const LOCALES: readonly { id: Locale; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'pt-BR', label: 'Português (Brasil)', short: 'PT' },
];

const KEY = 'cb-locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'pt-BR';
}

/** the saved choice, else the first supported language the browser asks for */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* private mode */
  }
  const wanted = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of wanted) {
    const lower = (tag ?? '').toLowerCase();
    if (lower.startsWith('pt')) return 'pt-BR';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

function apply(locale: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

interface LocaleState {
  locale: Locale;
  setLocale(locale: Locale): void;
}

export const useLocale = create<LocaleState>((set, get) => {
  const initial = detectLocale();
  apply(initial);
  return {
    locale: initial,
    setLocale(locale) {
      if (locale === get().locale) return;
      try {
        localStorage.setItem(KEY, locale);
      } catch {
        /* private mode: still switch for this tab */
      }
      apply(locale);
      set({ locale });
    },
  };
});

/** the language in effect, for code outside React (toasts, PDF, audit text) */
export const currentLocale = (): Locale => useLocale.getState().locale;
