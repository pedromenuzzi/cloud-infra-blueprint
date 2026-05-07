import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Dedicated Vitest config so we don't accidentally pick up Playwright specs
 * (those live in `tests/e2e/` and use `@playwright/test`, which Vitest can't
 * load). Unit tests for the web app go under `src/**\/*.test.ts(x)`.
 *
 * `happy-dom` is used instead of jsdom — boots ~10x faster on Windows for
 * the kind of basic DOM work we do here (theme application, store updates).
 * If a future test needs a stricter DOM (canvas, layout, etc.), opt into
 * jsdom per file with the `// @vitest-environment jsdom` pragma.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['blueprint:source', 'import', 'module', 'browser', 'default'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**', 'playwright-report'],
    css: false,
  },
});
