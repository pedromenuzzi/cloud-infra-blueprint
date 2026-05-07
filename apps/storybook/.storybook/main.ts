import { dirname, join } from 'node:path';

import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook 8 configuration. Stays minimal on purpose:
 *
 *   - `react-vite` framework so the build/dev pipeline matches the web app.
 *   - `addon-essentials` brings docs, controls, viewport, backgrounds.
 *   - `addon-a11y` runs axe per story so design drift fails locally before CI.
 *   - `addon-themes` toggles `class="dark"` on the root for our token-based
 *     dark mode (same mechanism the web app uses).
 *
 * `getAbsolutePath` works around pnpm's hoisting — Storybook's loader needs a
 * resolved disk path, not a bare specifier.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(ts|tsx)'],
  addons: [
    getAbsolutePath('@storybook/addon-essentials'),
    getAbsolutePath('@storybook/addon-interactions'),
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-themes'),
  ],
  framework: {
    name: getAbsolutePath('@storybook/react-vite') as '@storybook/react-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
    check: false,
  },
  // Prefix all asset URLs with the deploy base. GitHub Pages serves the site
  // from `https://<owner>.github.io/<repo>/`, so without a base every asset
  // 404s. Locally we keep `/`. The deploy workflow injects the right value
  // via `STORYBOOK_BASE`.
  viteFinal(viteConfig) {
    viteConfig.base = process.env.STORYBOOK_BASE ?? viteConfig.base ?? '/';
    return viteConfig;
  },
};

function getAbsolutePath(pkg: string): string {
  return dirname(require.resolve(join(pkg, 'package.json')));
}

export default config;
