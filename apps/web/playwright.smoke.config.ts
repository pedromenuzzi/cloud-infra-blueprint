import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-test config that targets a long-running dev server (default :5173)
 * instead of `vite preview`. Intended for ad-hoc verification while you're
 * iterating on a chat with a developer agent — CI keeps using the main
 * `playwright.config.ts`.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
