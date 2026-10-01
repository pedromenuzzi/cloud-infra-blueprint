import { expect, test } from '@playwright/test';
import { storedProjects } from './helpers';
import { TUTORIALS } from '../src/tutorials';

const tutorial = TUTORIALS[0];

test('the current step lives in the URL and survives a refresh', async ({ page }) => {
  await page.goto(`/tutorials/${tutorial.slug}`);
  const counter = page.getByText(/^Step \d+ of \d+$/);
  await expect(counter).toHaveText(/^Step 1 of/);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\?step=3$/);
  await page.reload();
  await expect(counter).toHaveText(/^Step 3 of/);
  await expect(page).toHaveTitle(`${tutorial.title} · Tutorials — Cloud Blueprint`);
});

test('opening the same step in the editor again reuses the copy', async ({ page }) => {
  await page.goto(`/tutorials/${tutorial.slug}?step=2`);
  const ids = new Set<string>();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /Open this step in the editor/ }).click();
    await expect(page).toHaveURL(/\/editor\//);
    ids.add(page.url());
    await page.goBack();
    await expect(page).toHaveURL(/\/tutorials\//);
  }
  expect(ids.size).toBe(1);
  const copies = (await storedProjects(page)).filter((p) => p.name.startsWith(`${tutorial.title} (step 2`));
  expect(copies).toHaveLength(1);
});

test.describe('on a phone (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the lesson stacks above the diagram and nothing scrolls sideways', async ({ page }) => {
    await page.goto(`/tutorials/${tutorial.slug}`);
    const lesson = page.getByRole('complementary', { name: 'Lesson' });
    const diagram = page.getByRole('region', { name: 'Diagram' });
    await expect(lesson).toBeVisible();
    const l = (await lesson.boundingBox())!;
    const d = (await diagram.boundingBox())!;
    expect(l.width).toBeGreaterThan(380);
    expect(d.width).toBeGreaterThan(380);
    expect(d.y).toBeGreaterThanOrEqual(l.y + l.height - 1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const theme = (await page.locator('header').getByRole('button', { name: /^Theme/ }).boundingBox())!;
    expect(theme.x + theme.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole('button', { name: /Open this step in the editor/ })).toHaveText(/^\s*Open in editor\s*$/, {
      useInnerText: true,
    });
  });
});
