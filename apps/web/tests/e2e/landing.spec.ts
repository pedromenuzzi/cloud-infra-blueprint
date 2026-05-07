import { expect, test } from '@playwright/test';

test.describe('Landing page', () => {
  test('renders the hero, brand and primary CTAs', async ({ page }) => {
    await page.goto('/');

    // Hero headline.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The brand wordmark appears in the header.
    await expect(page.getByText(/Cloud Blueprint/i).first()).toBeVisible();

    // At least one CTA points to the dashboard.
    const dashboardLinks = page.locator('a[href="/dashboard"]');
    await expect(dashboardLinks.first()).toBeVisible();
  });

  test('Ctrl+K opens the command palette and Esc closes it', async ({ page }) => {
    page.on('console', (msg) => msg.type() === 'error' && console.log('PAGE ERR:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE THROW:', err.message));
    await page.goto('/');
    // Wait for hydration; click body to make sure focus is in-page.
    await page.waitForLoadState('networkidle');
    await page.locator('body').click();
    await page.keyboard.press('Control+KeyK');
    await expect(page.getByRole('dialog', { name: /Command palette/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Command palette/i })).toBeHidden();
  });

  test('shortcuts help opens via the command palette', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('body').click();
    await page.keyboard.press('Control+KeyK');
    const palette = page.getByRole('dialog', { name: /Command palette/i });
    await expect(palette).toBeVisible({ timeout: 10_000 });
    // Click the entry directly so we don't depend on the input focus order.
    await palette.getByRole('button', { name: /Show keyboard shortcuts/i }).click();
    // The palette closes and the shortcuts help modal opens — its title
    // is "Keyboard shortcuts" inside a separate <dialog>.
    await expect(
      page.getByRole('dialog').filter({ hasText: 'Move faster with your keyboard' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
