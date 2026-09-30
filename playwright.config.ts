import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * E2E against the production build (`vite preview`), so lazy chunks and
 * Monaco contribs are exercised exactly as shipped. Run `pnpm build` first.
 *
 * The build registers a service worker (offline app). It's blocked for every
 * spec by default: a worker would serve cached files past `page.route()`
 * mocks and keep state between tests. e2e/pwa.spec.ts opts back in with
 * `test.use({ serviceWorkers: 'allow' })`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    // the UI follows the browser language: specs speak English unless they switch
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      // full Chromium in new-headless mode (no separate headless-shell download)
      use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
