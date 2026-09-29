/**
 * A lesson's title, description and step prose in the UI language (the
 * step files never change). A component calling this should also read
 * `useLocale` (or `useMessages`) so it re-renders on a language switch.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import type { TutorialDef } from './index';
import { TUTORIAL_TEXT_PT, type TutorialText } from './messages';

export function tutorialText(tutorial: TutorialDef, locale: Locale = currentLocale()): TutorialText {
  if (locale === 'pt-BR') return TUTORIAL_TEXT_PT[tutorial.slug];
  return {
    title: tutorial.title,
    description: tutorial.description,
    steps: tutorial.steps.map((s) => ({ title: s.title, body: s.body })),
  };
}
