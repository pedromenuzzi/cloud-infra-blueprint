/**
 * The offline app. The only spec that lets the service worker run
 * (playwright.config.ts blocks it everywhere else). Serial: the update tests
 * change dist/sw.js on disk for a moment, like a new deploy would.
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

/** a new build: index.html's precache revision changed (same length: the preview server's headers stay valid) */
async function newDeploy(page: Page, run: () => Promise<void>) {
  const original = await readFile(SW_FILE, 'utf8');
  try {
    const changed = original.replace(/(url:"index\.html",revision:")(.)/, (_, head: string, c: string) => head + (c === '0' ? '1' : '0'));
    expect(changed).not.toBe(original);
    await writeFile(SW_FILE, changed);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    await run();
  } finally {
    await writeFile(SW_FILE, original);
  }
}

/** the new worker is the one in control now, and nothing is left waiting */
async function updated(page: Page) {
  expect(
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { waiting: reg?.waiting ?? null, active: reg?.active?.state };
    }),
  ).toEqual({ waiting: null, active: 'activated' });
}

function countLoads(page: Page) {
  const seen = { n: 0 };
  page.on('load', () => (seen.n += 1));
  return seen;
}

test('on the dashboard, a new deploy is applied on its own: one reload, no prompt', async ({ page }) => {
  await page.goto('/dashboard');
  await controlled(page);
  const loads = countLoads(page);
  await newDeploy(page, async () => {
    await expect.poll(() => loads.n, { timeout: 20_000 }).toBe(1);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByText('Update available')).toBeHidden();
    await updated(page);
    // once: the new version doesn't reload again
    await page.waitForTimeout(2500);
    expect(loads.n).toBe(1);
  });
});

test('on the dashboard with a dialog open or a search typed, it waits, then applies once nothing is in progress', async ({ page }) => {
  await page.goto('/dashboard');
  await controlled(page);
  const search = page.getByRole('searchbox', { name: 'Search projects' });
  await search.fill('prod');
  await page.getByRole('button', { name: /^New Project/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Start from a template' });
  await expect(dialog).toBeVisible();
  const loads = countLoads(page);
  await newDeploy(page, async () => {
    // busy: the prompt asks instead
    const prompt = page.getByRole('status').filter({ hasText: 'Update available' });
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    expect(loads.n).toBe(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // the typed search still holds it
    await page.waitForTimeout(2500);
    expect(loads.n).toBe(0);
    await search.fill('');
    await search.blur();
    await expect.poll(() => loads.n, { timeout: 15_000 }).toBe(1);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await updated(page);
  });
});

test('in the editor, a new deploy shows "Update available, Reload" and waits for it', async ({ page }) => {
  await openSeedProject(page, { monaco: false });
  await controlled(page);
  const loads = countLoads(page);
  await newDeploy(page, async () => {
    const prompt = page.getByRole('status').filter({ hasText: 'Update available' });
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    expect(loads.n).toBe(0);
    await prompt.getByRole('button', { name: 'Reload' }).click();
    await expect.poll(() => loads.n).toBe(1);
    await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
    await expect(page.getByText('Update available')).toBeHidden();
    await updated(page);
  });
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
