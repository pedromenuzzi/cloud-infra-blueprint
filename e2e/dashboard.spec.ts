import { expect, test } from '@playwright/test';
import { SEED_PROJECT, storedProjects } from './helpers';

test('projects can be renamed from the dashboard', async ({ page }) => {
  await page.goto('/dashboard');
  const card = page.getByRole('article', { name: SEED_PROJECT });
  await card.getByRole('button', { name: 'Rename project' }).click();
  const input = page.getByRole('textbox', { name: 'Rename project' });
  await input.fill('renamed-web');
  await input.press('Enter');
  await expect(page.getByRole('article', { name: 'renamed-web' })).toBeVisible();
  expect((await storedProjects(page)).map((p) => p.name)).toEqual(['renamed-web']);
});

test('search matches providers and templates; projects sort by name', async ({ page }) => {
  await page.goto('/dashboard');
  const quick = page.getByRole('region', { name: 'Quick start' });
  await quick.getByRole('button', { name: /^Azure/ }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await page.goto('/dashboard');

  const search = page.getByRole('searchbox', { name: 'Search projects' });
  await search.fill('azure');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: 'my-azure-app' })).toBeVisible();
  await search.fill('web app on aws'); // the seed's template name
  await expect(page.getByRole('article', { name: SEED_PROJECT })).toBeVisible();
  await search.fill('');

  await page.getByRole('combobox', { name: 'Sort projects' }).selectOption('name');
  await expect(page.getByRole('article').first()).toHaveAccessibleName('my-azure-app');
});

test('blank projects get unique names', async ({ page }) => {
  await page.goto('/dashboard');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: /^AWS/ }).click();
    await expect(page).toHaveURL(/\/editor\//);
    await page.goto('/dashboard');
  }
  const names = (await storedProjects(page)).map((p) => p.name);
  expect(names).toEqual(expect.arrayContaining(['my-aws-app', 'my-aws-app-2']));
});

test.describe('touch screens', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('card actions are visible without hovering', async ({ page }) => {
    await page.goto('/dashboard');
    const actions = page.getByRole('group', { name: `Actions for ${SEED_PROJECT}` });
    await expect(actions).toHaveCSS('opacity', '1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
