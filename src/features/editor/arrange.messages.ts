/** Auto-arrange: the canvas toolbar button, ⌘K and the context menus. */
import { defineMessages } from '@/i18n/messages';

/** search words for ⌘K, in both languages whichever is on screen */
const KEYWORDS = ['tidy', 'auto layout', 'arrange', 'organize', 'layout', 'organizar', 'arrumar', 'alinhar'];

export const arrangeMessages = defineMessages(
  {
    button: 'Auto-arrange',
    tooltip: 'Tidy the whole diagram (one undo step)',
    overlap: 'Some resources overlap — Auto-arrange tidies them',
    command: 'Auto-arrange layout',
    keywords: KEYWORDS,
    arrangeInside: (name: string) => `Arrange inside ${name}`,
    failed: (message: string) => `Couldn't arrange the layout: ${message}`,
    already: 'Already arranged',
  },
  {
    button: 'Organizar',
    tooltip: 'Organiza todo o diagrama (desfaz em um passo)',
    overlap: 'Alguns recursos estão sobrepostos — Organizar resolve isso',
    command: 'Organizar layout automaticamente',
    keywords: KEYWORDS,
    arrangeInside: (name: string) => `Organizar dentro de ${name}`,
    failed: (message: string) => `Não foi possível organizar o layout: ${message}`,
    already: 'Já está organizado',
  },
);
