/**
 * Translations as plain typed objects, one module per area, both languages
 * side by side:
 *
 *   export const dashboardMessages = defineMessages(
 *     { title: 'Projects', deleted: (n: number) => `Deleted ${n} project${n === 1 ? '' : 's'}` },
 *     { title: 'Projetos', deleted: (n: number) => `${n} projeto${n === 1 ? '' : 's'} excluído${n === 1 ? '' : 's'}` },
 *   );
 *
 *   const m = useMessages(dashboardMessages);   // in a component: re-renders on a language switch
 *   m.title; m.deleted(3);
 *   messagesFor(dashboardMessages).title;       // outside React: the language in effect now
 *
 * English is the source: the Portuguese object must have exactly the same
 * keys and function signatures, or it doesn't compile. Plurals, word order
 * and interpolation are just functions. A module is bundled with the
 * feature that imports it, so lazy chunks stay lazy.
 */
import { currentLocale, useLocale, type Locale } from './locale';

export type Messages<T> = Readonly<Record<Locale, T>>;

export function defineMessages<T extends object>(en: T, ptBR: NoInfer<T>): Messages<T> {
  return { en, 'pt-BR': ptBR };
}

/** this area's messages in the current language; the component re-renders when it changes */
export function useMessages<T>(messages: Messages<T>): T {
  return messages[useLocale((s) => s.locale)];
}

/** outside React (or inside a callback): the messages for the language in effect right now */
export function messagesFor<T>(messages: Messages<T>, locale: Locale = currentLocale()): T {
  return messages[locale];
}
