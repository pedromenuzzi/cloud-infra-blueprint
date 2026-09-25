import { expect, type Page } from '@playwright/test';

/** The dashboard seeds this project on first visit (fresh context = fresh localStorage). */
export const SEED_PROJECT = 'production-web';

export async function openSeedProject(page: Page, { tips = false, monaco = true } = {}) {
  // the first-run tips card floats over the canvas; tests opt in explicitly
  if (!tips) await page.addInitScript(() => localStorage.setItem('cb-tips-dismissed', '1'));
  await page.goto('/dashboard');
  await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
  await expect(page).toHaveURL(/\/editor\//);
  // compact layouts keep the code editor in a closed drawer
  if (monaco) await waitForMonaco(page);
  else await expect(canvasStats(page)).toBeVisible();
}

export async function waitForMonaco(page: Page) {
  // the Monaco chunk is ~3 MB — give it room when many browsers run in parallel
  await expect(page.locator('[data-testid="monaco"] .monaco-editor')).toBeVisible({ timeout: 15_000 });
}

export function canvasStats(page: Page) {
  return page.getByTestId('canvas').getByText(/\d+ resources?, \d+ connections?/);
}

/** Put the caret at the end of the active file, on a fresh blank line. */
export async function focusEndOfCode(page: Page) {
  await page.locator('[data-testid="monaco"] .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
}

/**
 * Insert text as one input event. Monaco usually treats it like a paste, but
 * occasionally processes it as typing (auto-closing `{`, auto-indenting on
 * newlines) — keep snippets single-line so both paths yield the same text.
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

/** Read a downloaded PNG's pixel size from its IHDR header. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
