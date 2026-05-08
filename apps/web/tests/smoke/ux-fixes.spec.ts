import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * End-to-end smoke test covering the UX fixes shipped in commit 91d2eac:
 *
 * 1. Landing — "Watch demo" opens a "Coming soon" modal (was inert).
 * 2. Dashboard — Sidebar `Teams` / `Branches` / `Settings` are disabled
 *    buttons with a SOON badge instead of broken links to /404.
 * 3. Dashboard — Provider filter chips render as readable letter monograms
 *    (aws / Az / GCP / M+) and actually filter the project grid.
 * 4. Editor — Loads without JS errors (regression guard for the
 *    `react-resizable-panels` v4 cache issue) and shows the resize handles.
 * 5. Editor — Onboarding tour autoshows (Step 1 of 5) and Help (?) button
 *    reopens it; gear icon opens "Project settings — coming soon".
 *
 * Targets the running `pnpm dev` server. Storage state is reset before each
 * spec so tour-dismissed state doesn't bleed between tests.
 */

/** Runs once per page to surface client errors directly in the test report. */
function attachConsoleAssertions(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });
  return errors;
}

test.describe('UX fixes — landing + dashboard + editor', () => {
  test.beforeEach(async ({ context }) => {
    // Wipe the onboarding-tour dismissed flag so step-1 always renders.
    await context.addInitScript(() => {
      try {
        localStorage.removeItem('blueprint:tour:dismissed:v1');
        // Reset the persisted resizable-panels layout too so defaultSize wins.
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('react-resizable-panels')) localStorage.removeItem(key);
        }
      } catch {
        /* storage may be unavailable */
      }
    });
  });

  test('Landing: "Watch demo" opens the Coming Soon modal', async ({ page }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto('/');

    const watch = page.getByRole('button', { name: /Watch demo/i });
    await expect(watch).toBeVisible();
    await watch.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Watch demo — coming soon/i);
    await expect(dialog.getByRole('button', { name: 'Got it' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Got it' }).click();
    await expect(dialog).toBeHidden();

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Dashboard sidebar: Teams/Branches/Settings are disabled SOON buttons', async ({ page }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto('/dashboard');

    const rail = page.getByRole('navigation', { name: 'App navigation' });
    await expect(rail).toBeVisible();

    // The two implemented links are real <a> elements.
    await expect(rail.locator('a[title="Home"]')).toBeVisible();
    await expect(rail.locator('a[title="Projects"]')).toBeVisible();

    // The unimplemented ones are <button disabled> with a SOON badge.
    for (const label of ['Teams', 'Branches']) {
      const btn = rail.locator(`button[title^="${label}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
      await expect(btn).toContainText('SOON');
    }

    // Settings sits outside the nav at the bottom of the rail.
    const settingsBtn = page.locator('button[title^="Settings"]').first();
    await expect(settingsBtn).toBeVisible();
    await expect(settingsBtn).toBeDisabled();
    await expect(settingsBtn).toContainText('SOON');

    // Sanity: clicking a SOON button should NOT navigate away.
    await page.locator('button[title^="Teams"]').click({ force: true });
    await expect(page).toHaveURL(/\/dashboard$/);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Dashboard: provider chips are readable letters and filter the grid', async ({ page }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto('/dashboard');

    const filterGroup = page.getByRole('group', { name: /Filter by provider/i });
    await expect(filterGroup).toBeVisible();

    // Each pill is a <button> whose visible text is the provider label and
    // which contains a [role=img] monogram chip with the canonical letters.
    // We can't filter by accessible name because the chip's aria-label gets
    // appended to the button's name (e.g. "AWS AWS").
    const expectedAbbrs: { pill: string; aria: string; abbr: string }[] = [
      { pill: 'AWS', aria: 'AWS', abbr: 'aws' },
      { pill: 'Azure', aria: 'Azure', abbr: 'Az' },
      { pill: 'GCP', aria: 'GCP', abbr: 'GCP' },
      { pill: 'Multi-cloud', aria: 'Multi-cloud', abbr: 'M+' },
    ];
    for (const { pill, aria, abbr } of expectedAbbrs) {
      const pillBtn = filterGroup.locator('button', { hasText: pill });
      await expect(pillBtn, `pill ${pill} should exist`).toBeVisible();
      const chip = pillBtn.locator(`[role="img"][aria-label="${aria}"]`);
      await expect(chip, `chip ${abbr} should render with text`).toHaveText(abbr);
    }

    // Filtering by Azure narrows the grid to the two demo Azure projects.
    await filterGroup.locator('button', { hasText: 'Azure' }).click();
    await expect(page.getByRole('heading', { name: 'data-pipeline' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'azure-corp-vnet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'production-web-aws' })).toHaveCount(0);

    // Switching back to All restores AWS projects.
    await filterGroup.locator('button', { hasText: 'All' }).click();
    await expect(page.getByRole('heading', { name: 'production-web-aws' })).toBeVisible();

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Editor: loads without JS errors and shows resizable panels', async ({ page }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto('/editor/production-web-aws');

    // The router-error overlay would carry "Unexpected Application Error".
    await expect(page.getByText(/Unexpected Application Error/i)).toHaveCount(0);

    // Workspace landmark is rendered.
    await expect(page.getByLabel('Editor workspace')).toBeVisible();

    // 4 panels + 3 resize handles render.
    await expect(page.locator('[data-panel-group] [data-panel]')).toHaveCount(4);
    await expect(page.locator('[data-resize-handle]')).toHaveCount(3);

    // The Palette tab strip should now show the AWS provider monogram chip.
    await expect(
      page.locator('[role="tablist"] [role="img"][aria-label="AWS"]').first(),
    ).toHaveText('aws');

    // No client-side JS errors at all.
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Editor: onboarding tour auto-shows; Help (?) reopens; Settings opens modal', async ({
    page,
  }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto('/editor/production-web-aws');

    // Tour auto-shows on first visit (storage is wiped in beforeEach).
    // The dialog's accessible name changes per step (it tracks the current
    // step's title), so we always re-read it via `page.getByRole('dialog')`.
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Welcome to the editor');
    await expect(page.getByText(/Step 1 of 5/i)).toBeVisible();

    // Step forward, then Skip — the Skip button is always inside the dialog.
    await page.getByRole('dialog').getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/Step 2 of 5/i)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Help (?) button in the topbar reopens the tour at step 1.
    await page.getByRole('button', { name: /Help & onboarding tour/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Welcome to the editor');
    await expect(page.getByText(/Step 1 of 5/i)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Gear icon opens the "Coming soon" modal.
    await page.getByRole('button', { name: /^Settings$/i }).click();
    const settingsModal = page.getByRole('dialog');
    await expect(settingsModal).toBeVisible();
    await expect(settingsModal).toContainText(/Project settings — coming soon/i);
    await settingsModal.getByRole('button', { name: 'Got it' }).click();
    await expect(settingsModal).toBeHidden();

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
