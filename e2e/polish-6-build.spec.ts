/**
 * Polish, round 6 (the build side): editor toasts center in the canvas the
 * panels leave uncovered, never over the inspector or the code, and a deleted
 * resource leaves with a short exit (none under reduced motion) while the
 * model moves on at once.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, openSeedProject } from './helpers';

const DB = 'aws_db_instance.main';
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const toast = (page: Page) => page.locator('[data-bp-live] > div').filter({ hasText: 'Duplicated as' });

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function duplicateDb(page: Page) {
  await node(page, DB).click();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(toast(page)).toBeVisible();
  return (await toast(page).boundingBox())!;
}

for (const layout of [
  { name: 'floating inspector, code open', prefs: {} },
  { name: 'floating inspector, code closed', prefs: { code: false } },
  { name: 'docked inspector, code on the left', prefs: { inspectorMode: 'docked', codeSide: 'left' } },
]) {
  test(`an editor toast keeps clear of the inspector and the code (${layout.name})`, async ({ page }) => {
    await page.addInitScript((prefs) => {
      if (sessionStorage.getItem('laid-out')) return;
      sessionStorage.setItem('laid-out', '1');
      const base = { v: 2, palette: true, canvas: true, code: true, inspector: true, paletteSide: 'left', codeSide: 'right', inspectorMode: 'floating', split: 36 };
      localStorage.setItem('cb-layout-v2', JSON.stringify({ ...base, ...prefs }));
    }, layout.prefs);
    await openSeedProject(page, { monaco: !('code' in layout.prefs) });
    const box = await duplicateDb(page);
    const inspector = (await page.getByRole('complementary', { name: 'Inspector' }).boundingBox())!;
    const canvas = (await page.getByTestId('canvas').boundingBox())!;
    expect(overlaps(box, inspector)).toBe(false);
    // inside the canvas, so off the code pane and the palette
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    // still above the canvas toolbar
    const toolbar = (await page.getByRole('button', { name: 'Auto-arrange' }).boundingBox())!;
    expect(box.y + box.height).toBeLessThan(toolbar.y);
  });
}

test('a deleted resource fades out after the model has let it go', async ({ page }) => {
  await openSeedProject(page, { monaco: false });
  const before = await canvasStats(page).textContent();
  await node(page, DB).click();
  // the node as it leaves: watched from the page, the exit is only 150 ms
  await page.evaluate((id) => {
    const w = window as unknown as { leaving?: { hidden: string | null; selectable: boolean } };
    const observer = new MutationObserver(() => {
      const el = document.querySelector(`.react-flow__node.bp-exit[data-id="${id}"]`);
      if (!el) return;
      w.leaving = { hidden: el.getAttribute('aria-hidden'), selectable: el.classList.contains('selectable') };
      observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }, DB);
  await page.keyboard.press('Delete');
  // the model (and the counts) at once; the node on its way out, out of reach, then gone
  await expect(canvasStats(page)).not.toHaveText(before!);
  await expect(node(page, DB)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { leaving?: unknown }).leaving)).toEqual({ hidden: 'true', selectable: false });
  // an undo brings it back whole
  await page.keyboard.press('Control+z');
  await expect(node(page, DB)).toBeVisible();
  await expect(node(page, DB)).not.toHaveClass(/bp-exit/);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('a deleted resource goes at once', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    await page.evaluate(() => {
      const w = window as unknown as { exits: number };
      w.exits = 0;
      new MutationObserver(() => (w.exits += document.querySelectorAll('.bp-exit').length)).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });
    await node(page, DB).click();
    await page.keyboard.press('Delete');
    await expect(node(page, DB)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { exits: number }).exits)).toBe(0);
  });
});

test('a lesson toast sits on its canvas above the terminal, and leaving the lesson takes it away', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cb-tips-dismissed', '1');
    if (localStorage.getItem('cb-learn-v1') === null) localStorage.setItem('cb-learn-v1', JSON.stringify({ start: 'aws' }));
  });
  await page.goto('/learn/first-resource');
  await page.getByRole('button', { name: 'Show solution' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Show solution' }).click();
  await page.getByRole('dialog', { name: /Solution/ }).getByRole('button', { name: 'Use the solution' }).click();
  const solved = page.locator('[data-bp-live] > div').filter({ hasText: 'The solution replaced your code.' });
  await expect(solved).toBeVisible();
  const box = (await solved.boundingBox())!;
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(canvas.x);
  expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(box.y + box.height).toBeLessThan(canvas.y + canvas.height);

  await page.getByRole('link', { name: 'Back to the learning map' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(solved).toHaveCount(0);
});

test('the app never scrolls as a page; the landing does', async ({ page }) => {
  const scrolls = () =>
    page.evaluate(() => {
      window.scrollTo(0, 10_000);
      const y = window.scrollY;
      window.scrollTo(0, 0);
      return y;
    });
  await openSeedProject(page, { monaco: false });
  // something placed past the bottom (as hidden screen reader text once was) can't move the shell
  await page.evaluate(() => {
    const stray = document.createElement('div');
    stray.style.cssText = 'position:absolute;top:3000px;height:10px;width:10px';
    document.getElementById('root')!.firstElementChild!.appendChild(stray);
  });
  expect(await scrolls()).toBe(0);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  expect(await scrolls()).toBe(0);
  await page.goto('/');
  await expect(page.locator('[data-page-scrolls]')).toBeVisible();
  expect(await scrolls()).toBeGreaterThan(0);
});
