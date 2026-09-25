import { expect, type Page } from '@playwright/test';

/** The dashboard seeds this project on first visit (fresh context = fresh localStorage). */
export const SEED_PROJECT = 'production-web';

export async function openSeedProject(page: Page) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await waitForMonaco(page);
}

export async function waitForMonaco(page: Page) {
  await expect(page.locator('[data-testid="monaco"] .monaco-editor')).toBeVisible();
}

export function canvasStats(page: Page) {
  return page.getByTestId('canvas').getByText(/\d+ resources, \d+ connections/);
}

/** Put the caret at the end of the active file, on a fresh blank line. */
export async function focusEndOfCode(page: Page) {
  await page.locator('[data-testid="monaco"] .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
}

/**
 * Insert text as one input event: Monaco treats it like a paste, so
 * auto-closing brackets/quotes don't double up.
 */
export async function insertCode(page: Page, text: string) {
  await page.keyboard.insertText(text);
}

interface StoredProject {
  id: string;
  name: string;
  files: Record<string, string>;
}

/** Projects as persisted by the app (the source of truth after autosave). */
export async function storedProjects(page: Page): Promise<StoredProject[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cb-projects-v1') ?? '[]'));
}

export async function storedProject(page: Page, name: string) {
  const all = await storedProjects(page);
  return all.find((p) => p.name === name);
}
