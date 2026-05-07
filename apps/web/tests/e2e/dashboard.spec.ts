import { expect, test } from '@playwright/test';

test.describe('Dashboard → Templates → Editor flow', () => {
  test('can navigate from landing to dashboard, open templates and pick one', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href="/dashboard"]').first().click();

    // Wait for the dashboard to render. It either shows real projects from the
    // API or the bundled demo set; either way the "New Project" button is here.
    const newProject = page.getByRole('button', { name: /New Project/i });
    await expect(newProject).toBeVisible();

    // Open the templates modal.
    await newProject.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/Start from a template/i)).toBeVisible();

    // The bundled catalog should always include this template.
    const useTemplate = page.getByRole('button', { name: 'Use template Web App on AWS' });
    await expect(useTemplate).toBeVisible();
    await useTemplate.click();

    // The editor route loads (lazy chunk).
    await page.waitForURL(/\/editor\//);
    // App rail and palette are part of the editor shell.
    await expect(page.getByText(/Resources/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('search filters the project list', async ({ page }) => {
    await page.goto('/dashboard');
    const search = page.getByLabel('Search projects');
    await expect(search).toBeVisible();
    // The bundled demo dataset includes a project named `monitoring-stack`,
    // and no name contains the typo `xyz` — search must filter the grid.
    await search.fill('monitoring');
    await expect(page.getByRole('heading', { name: 'monitoring-stack' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'production-web-aws' })).toHaveCount(0);
  });

  test('command palette can switch theme', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('body').click();
    await page.keyboard.press('Control+KeyK');
    const palette = page.getByRole('dialog', { name: /Command palette/i });
    await expect(palette).toBeVisible({ timeout: 10_000 });
    await palette.locator('input').fill('theme dark');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => page.locator('html').getAttribute('class'), { timeout: 5000 })
      .toMatch(/dark/);
  });
});
