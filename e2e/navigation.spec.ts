import { expect, test } from '@playwright/test';
import { canvasStats, SEED_PROJECT, waitForMonaco } from './helpers';

test('landing page leads to the dashboard with the seeded demo project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Open the app' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Open project ${SEED_PROJECT}` })).toBeVisible();
});

test('a template creates a new project and opens it in the editor', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('e2e-static');

  const card = page.locator('div', { hasText: 'Static Site CDN' }).filter({
    has: page.getByRole('button', { name: 'Use template' }),
  });
  await card.last().getByRole('button', { name: 'Use template' }).click();

  await expect(page).toHaveURL(/\/editor\//);
  await waitForMonaco(page);
  await expect(page.getByRole('textbox', { name: 'Project name' }).first()).toHaveValue(
    'e2e-static',
  );
  await expect(canvasStats(page)).not.toHaveText(/^0 resources/);
});

test('unknown routes render the 404 page', async ({ page }) => {
  await page.goto('/definitely-not-a-page');
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(page).toHaveTitle('Page not found · Cloud Blueprint');
  await expect(page.getByRole('link', { name: 'Back to projects' })).toBeVisible();
});
