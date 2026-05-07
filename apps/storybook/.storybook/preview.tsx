import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@blueprint/ui/styles.css';

import { withThemeByClassName } from '@storybook/addon-themes';

import type { Preview } from '@storybook/react';

/**
 * Global Storybook preview config. Three things worth knowing:
 *
 *   1. The design-system stylesheet (`@blueprint/ui/styles.css`) is the same
 *      one shipped to the production web app. Stories therefore render with
 *      production tokens and dark-mode rules.
 *   2. `withThemeByClassName` toggles `class="dark"` on the iframe `<html>`,
 *      mirroring the way `apps/web` switches themes via the Zustand store.
 *      We add a `bg-background text-foreground` wrapper so the canvas
 *      surface tracks the active theme without each story doing it.
 *   3. `addon-a11y` audits every story by default. Failing rules are
 *      surfaced in the Storybook side panel and (when run from CI) in
 *      `--check-a11y` reports.
 */
const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/ },
      expanded: true,
    },
    options: {
      storySort: {
        order: [
          'Introduction',
          'Foundations',
          ['Colors', 'Typography', 'Radii & Shadows'],
          'Components',
          ['Button', 'Card', 'Input', 'Badge', 'Avatar', 'Modal', 'Logo', 'ProviderIcon'],
          'Patterns',
        ],
      },
    },
    a11y: {
      // Surface violations inline so designers see them in the same view.
      manual: false,
    },
    backgrounds: { disable: true },
  },

  decorators: [
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
    (Story) => (
      <div className="min-h-[100px] bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],

  tags: ['autodocs'],
};

export default preview;
