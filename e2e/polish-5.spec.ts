/**
 * Polish, round 5 (the shell): the first page loads with the entry and the
 * next one while idle, the rail is real navigation, "Continue your trail"
 * holds its place while the lessons load, and the landing's live demo fits a
 * phone and keeps still for reduced motion.
 */
import { expect, test } from '@playwright/test';

test('the first page is preloaded with the entry; a deep link elsewhere is not', async ({ page }) => {
  await page.goto('/');
  const preloads = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"], link[rel="preload"]')].map((l) => l.href),
    );
  const landing = await preloads();
  expect(landing.some((href) => /\/assets\/LandingPage-[\w-]+\.js$/.test(href))).toBe(true);
  expect(landing.some((href) => /\/assets\/inter-latin-wght-normal-[\w-]+\.woff2$/.test(href))).toBe(true);

  await page.goto('/editor/nothing-here');
  const editor = await preloads();
  expect(editor.some((href) => /LandingPage|DashboardPage|LearnPage|inter-latin/.test(href))).toBe(false);
});

test('the landing fetches both doors while idle, so the click opens at once', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (request) => fetched.push(request.url()));
  await page.goto('/');
  await expect.poll(() => fetched.some((url) => /\/assets\/DashboardPage-[\w-]+\.js$/.test(url))).toBe(true);
  await expect.poll(() => fetched.some((url) => /\/assets\/LearnPage-[\w-]+\.js$/.test(url))).toBe(true);
});

test('the rail links to its pages, marks the current one, and readies the editor', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (request) => fetched.push(request.url()));
  await page.goto('/dashboard');
  const rail = page.getByRole('navigation', { name: 'Primary' });
  await expect(rail.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  await expect(rail.getByRole('link', { name: 'Learn' })).not.toHaveAttribute('aria-current');
  // a project is the next likely click: the editor's chunk comes while idle
  await expect.poll(() => fetched.some((url) => /\/assets\/EditorPage-[\w-]+\.js$/.test(url))).toBe(true);

  await rail.getByRole('link', { name: 'Learn' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Learn' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('"Continue your trail" holds its place while the lessons load: nothing below it moves', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cb-learn-v1', JSON.stringify({ last: 'your-vpc', lessons: {} })));
  let release = () => undefined as void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/lessons-[\w-]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/dashboard');
  const quickStart = page.getByRole('region', { name: 'Quick start' });
  await expect(quickStart).toBeVisible();
  const before = (await quickStart.boundingBox())!.y;
  release();
  await expect(page.getByRole('region', { name: 'Continue your trail' })).toBeVisible();
  expect((await quickStart.boundingBox())!.y).toBe(before);
});

test.describe('on a phone (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the live demo's diagram fits the frame", async ({ page }) => {
    await page.goto('/');
    const node = page.getByRole('button', { name: /events/ });
    const box = (await node.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test("the live demo's edges keep still", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /handler/ })).toBeVisible();
    await expect(page.locator('animateMotion')).toHaveCount(0);
  });
});
