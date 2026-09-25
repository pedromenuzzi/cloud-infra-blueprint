import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * E2E against the production build (`vite preview`), so lazy chunks and
 * Monaco contribs are exercised exactly as shipped. Run `pnpm build` first.
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
