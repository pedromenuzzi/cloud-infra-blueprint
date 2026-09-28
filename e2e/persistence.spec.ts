/**
 * Data safety: saves across tabs, full storage, corrupted storage, and an old
 * tab whose chunks disappeared after a deploy.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  canvasStats,
  focusEndOfCode,
  insertCode,
  openSeedProject,
  SEED_PROJECT,
  storedProject,
  storedProjects,
  waitForMonaco,
} from './helpers';

const palette = (page: Page) => page.getByRole('complementary', { name: 'Resource palette' });

async function openSecondTab(page: Page, url: string) {
  await page.addInitScript(() => localStorage.setItem('cb-tips-dismissed', '1'));
  await page.goto(url);
  await waitForMonaco(page);
  await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
}

test.describe('two tabs on one project', () => {
  test('a save in one tab reloads the other when it has nothing pending', async ({ context }) => {
    const a = await context.newPage();
    await openSeedProject(a);
    const b = await context.newPage();
    await openSecondTab(b, a.url());

    await palette(a).getByText('S3 Bucket').click();
    await expect(canvasStats(a)).toHaveText(/^8 resources/);
    await expect(canvasStats(b)).toHaveText(/^8 resources/);
  });

  test('edits in both tabs ask before anything is overwritten', async ({ context }) => {
    const a = await context.newPage();
    await openSeedProject(a);
    const b = await context.newPage();
    await openSecondTab(b, a.url());

    // B has an unsaved edit (inside the 500 ms debounce) when A's save lands
    await focusEndOfCode(b);
    await insertCode(b, '# edited in B');
    await a.evaluate(() => {
      const all = JSON.parse(localStorage.getItem('cb-projects-v1')!);
      all[0].files['main.tf'] += '\n# edited in A\n';
      all[0].rev += 1;
      localStorage.setItem('cb-projects-v1', JSON.stringify(all));
    });

    const dialog = b.getByRole('alertdialog', { name: /was changed in another tab/ });
    await expect(dialog).toBeVisible();
    // nothing was overwritten while the question is open
    await b.waitForTimeout(800);
    expect((await storedProject(b, SEED_PROJECT))!.files['main.tf']).toContain('# edited in A');

    await dialog.getByRole('button', { name: 'Keep mine' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await storedProject(b, SEED_PROJECT))!.files['main.tf']).toContain('# edited in B');
    expect((await storedProject(b, SEED_PROJECT))!.files['main.tf']).not.toContain('# edited in A');
  });

  test('deleting the project in another tab offers to restore it', async ({ context }) => {
    const editor = await context.newPage();
    await openSeedProject(editor);
    const dashboard = await context.newPage();
    await dashboard.goto('/dashboard');

    const card = dashboard.getByRole('article', { name: SEED_PROJECT });
    await card.getByRole('button', { name: 'Delete project' }).click();
    await dashboard.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click();
    await expect(card).toBeHidden();

    const dialog = editor.getByRole('alertdialog', { name: /was deleted in another tab/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Restore project' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await storedProjects(editor)).map((p) => p.name)).toContain(SEED_PROJECT);
    // the dashboard tab sees it come back
    await expect(card).toBeVisible();
  });
});

test.describe('full storage', () => {
  test.beforeEach(async ({ page }) => {
    // the browser refuses project writes once `__storageFull` is set
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'cb-projects-v1' && (window as unknown as { __storageFull?: boolean }).__storageFull) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return setItem.call(this, key, value);
      };
    });
  });

  test('editing shows an error instead of "Saved"', async ({ page }) => {
    await openSeedProject(page);
    await page.evaluate(() => {
      (window as unknown as { __storageFull?: boolean }).__storageFull = true;
    });
    await palette(page).getByText('S3 Bucket').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Storage is full' })).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.locator('header [role="status"]')).not.toHaveText(/Saved/);
    expect((await storedProject(page, SEED_PROJECT))!.files['main.tf']).not.toContain('aws_s3_bucket');
  });

  test('creating a project stays on the dashboard and says why', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('article', { name: SEED_PROJECT })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __storageFull?: boolean }).__storageFull = true;
    });
    await page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: /^AWS/ }).click();
    await expect(page.getByText('Storage is full — export or delete projects')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test('corrupted storage is backed up and the dashboard still works', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded-corruption')) return;
    sessionStorage.setItem('seeded-corruption', '1');
    localStorage.setItem('cb-seeded-v1', '1');
    localStorage.setItem(
      'cb-projects-v1',
      JSON.stringify([null, { id: 'p1', name: 'survivor' }, { id: 'p2', name: 'no providers', files: { 'main.tf': '' } }]),
    );
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'survivor' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'no providers' })).toBeVisible();
  const backups = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('cb-projects-backup-')),
  );
  expect(backups).toHaveLength(1);
});

test('a chunk that vanished after a deploy reloads once, then shows the recovery screen', async ({ page }) => {
  let documentLoads = 0;
  page.on('load', () => {
    documentLoads += 1;
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('article', { name: SEED_PROJECT })).toBeVisible();
  // what GitHub Pages answers for a chunk name that no longer exists
  await page.route(/\/assets\/EditorPage-[\w-]+\.js$/, (route) =>
    route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' }),
  );
  await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();

  await expect(page.getByRole('heading', { name: 'Cloud Blueprint was updated' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to projects' })).toBeVisible();
  await expect(page.getByText('Error details')).toBeVisible();
  expect(documentLoads).toBe(2); // the visit + exactly one automatic reload

  await page.unroute(/\/assets\/EditorPage-[\w-]+\.js$/);
  await page.getByRole('button', { name: 'Reload' }).click();
  await waitForMonaco(page);
  await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
});
