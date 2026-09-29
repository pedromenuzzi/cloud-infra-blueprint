/**
 * The offline app. The only spec that lets the service worker run
 * (playwright.config.ts blocks it everywhere else). Serial: the update test
 * changes dist/sw.js on disk for a moment, like a new deploy would.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, openSeedProject, SEED_PROJECT, storedProject, waitForMonaco } from './helpers';

test.use({ serviceWorkers: 'allow' });
test.describe.configure({ mode: 'serial' });

const SW_FILE = fileURLToPath(new URL('../dist/sw.js', import.meta.url));

async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 });
}

/** The idle warm-up fetched Monaco and ELK into the worker's cache. */
async function editorCached(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const keys = await (await caches.open('cb-assets')).keys();
          return ['CodePane-', 'editor.worker-', 'elk.bundled-'].every((name) => keys.some((k) => k.url.includes(name)));
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test('after one visit, the dashboard and the editor work offline', async ({ page, context }) => {
  await page.goto('/dashboard');
  await controlled(page);
  await expect(page.getByText('Cloud Blueprint now works offline too')).toBeVisible();
  await openSeedProject(page);
  await editorCached(page);

  await context.setOffline(true);
  await page.reload();
  await waitForMonaco(page);
  await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
  // ELK came from the cache too: tidy up works
  const before = (await storedProject(page, SEED_PROJECT))!.files['main.tf'];
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await expect
    .poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf'], { timeout: 15_000 })
    .not.toBe(before);
  await expect(page.getByText(/Couldn't arrange/)).toBeHidden();

  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  // a full offline load of another route, served from the cached shell
  await page.goto('/dashboard');
  await expect(page.getByRole('article', { name: SEED_PROJECT })).toBeVisible();
  await expect(page.getByText('Works offline: this browser keeps a copy of the app')).toBeVisible();
  await context.setOffline(false);
});

test('a new deploy shows "Update available — Reload" instead of failing later', async ({ page }) => {
  await page.goto('/dashboard');
  await controlled(page);
  const original = await readFile(SW_FILE, 'utf8');
  try {
    // a new build: index.html's precache revision changed (same length: the preview server's headers stay valid)
    const changed = original.replace(/(url:"index\.html",revision:")(.)/, (_, head: string, c: string) => head + (c === '0' ? '1' : '0'));
    expect(changed).not.toBe(original);
    await writeFile(SW_FILE, changed);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    const prompt = page.getByRole('status').filter({ hasText: 'Update available' });
    await expect(prompt).toBeVisible({ timeout: 20_000 });

    let reloads = 0;
    page.on('load', () => (reloads += 1));
    await prompt.getByRole('button', { name: 'Reload' }).click();
    await expect.poll(() => reloads).toBe(1);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByText('Update available')).toBeHidden();
    // the new worker is the one in control now, and nothing is left waiting
    expect(
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return { waiting: reg?.waiting ?? null, active: reg?.active?.state };
      }),
    ).toEqual({ waiting: null, active: 'activated' });
  } finally {
    await writeFile(SW_FILE, original);
  }
});

test('the manifest makes the app installable under any base path', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(href!, page.url()).href)).json();
  // relative to the manifest: works at / and under /cloud-infra-blueprint/
  expect(manifest).toMatchObject({ start_url: './dashboard', scope: './', display: 'standalone' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  const scope = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return (await navigator.serviceWorker.getRegistration())?.scope;
  });
  expect(scope).toBe(new URL('/', page.url()).href);
});
