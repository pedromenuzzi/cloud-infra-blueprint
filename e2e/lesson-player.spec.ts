/**
 * The lesson player (/learn/:slug): the editor on the lesson's draft (never
 * a project), goals checked live from the canvas and the code, the solution
 * and reset flows, "Open in editor", the phone tabs, and axe in both themes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { focusEndOfCode, insertCode, storedProjects, waitForMonaco } from './helpers';

const LESSON = '/learn/first-resource';
const LEARN_KEY = 'cb-learn-v1';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface Seed {
  start?: 'new' | 'aws';
  /** terminal commands already run in the lesson (the simulated terminal is another screen's) */
  runs?: string[];
  theme?: 'light' | 'dark';
}

/** a fresh lesson; `seed` is written once, so a reload keeps what the page stored */
async function openLesson(page: Page, seed: Seed = {}) {
  await page.addInitScript(
    ({ key, seed }) => {
      localStorage.setItem('cb-tips-dismissed', '1');
      if (seed.theme) localStorage.setItem('cb-theme', seed.theme);
      if (localStorage.getItem(key) !== null) return;
      const progress = { start: seed.start ?? null, runs: seed.runs ? { 'first-resource': seed.runs } : {} };
      localStorage.setItem(key, JSON.stringify(progress));
    },
    { key: LEARN_KEY, seed },
  );
  await page.goto(LESSON);
  await expect(page.getByRole('heading', { name: 'Your first resource', level: 1 })).toBeVisible();
}

const goal = (page: Page, id: string) => page.locator(`[data-goal="${id}"]`);
const goalsCount = (page: Page) => page.getByRole('progressbar', { name: 'Goals' });

const dragBucket = (page: Page) =>
  page.getByRole('button', { name: /^Add S3 Bucket/ }).dragTo(page.getByTestId('canvas'), { targetPosition: { x: 160, y: 140 } });

async function dropBucket(page: Page) {
  await dragBucket(page);
  await expect(goal(page, 'bucket')).toHaveAttribute('data-met', 'true');
}

/** a second bucket, typed: one line, so Monaco's typing and paste paths agree */
async function typeNamedBucket(page: Page) {
  await waitForMonaco(page);
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_s3_bucket" "logs" { bucket = "my-logs-123" }');
}

const progress = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), LEARN_KEY);

test.describe('lesson player', () => {
  test('goals turn green from the canvas and the code; the draft is kept, never a project', async ({ page }) => {
    await openLesson(page);
    await expect(page).toHaveTitle(/Your first resource/);
    await expect(goalsCount(page)).toHaveAttribute('aria-valuenow', '1');
    await expect(goal(page, 'valid')).toHaveAttribute('data-met', 'true');
    await expect(goal(page, 'bucket')).not.toHaveAttribute('data-met', 'true');

    await dropBucket(page);
    await expect(page.getByTestId('goal-news')).toHaveText('Goal met: An S3 bucket on the canvas');
    await expect(goal(page, 'name')).not.toHaveAttribute('data-met', 'true');

    await typeNamedBucket(page);
    await expect(goal(page, 'name')).toHaveAttribute('data-met', 'true');
    await expect(goalsCount(page)).toHaveAttribute('aria-valuenow', '3');

    // a hint on demand
    await goal(page, 'plan').getByRole('button', { name: 'Hint' }).click();
    await expect(goal(page, 'plan')).toContainText('run init first');

    // saved as the lesson's draft, not as a project
    await expect.poll(async () => (await progress(page)).drafts?.['first-resource']?.['main.tf'] ?? '').toContain('my-logs-123');
    expect(await storedProjects(page)).not.toContainEqual(expect.objectContaining({ origin: 'lesson:first-resource' }));
    expect((await progress(page)).lessons?.['first-resource']?.met).toEqual(expect.arrayContaining(['bucket', 'name', 'valid']));

    // the lesson's layout never becomes the editor's
    await page.getByRole('button', { name: /^Resources/ }).click();
    expect(await page.evaluate(() => localStorage.getItem('cb-layout-v2'))).toBeNull();

    await page.reload();
    await expect(goal(page, 'name')).toHaveAttribute('data-met', 'true');
    await expect(goalsCount(page)).toHaveAttribute('aria-valuenow', '3');
  });

  test('every goal met completes the lesson once, with its XP and the way on', async ({ page }) => {
    await openLesson(page, { runs: ['init', 'plan'] });
    await dropBucket(page);
    await typeNamedBucket(page);
    const finish = page.getByTestId('lesson-finish');
    await expect(finish).toBeVisible();
    await expect(finish).toContainText('+40 XP');
    await expect(finish.getByRole('link', { name: 'Back to the learning map' })).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    const done = (await progress(page)).lessons['first-resource'];
    expect(done).toMatchObject({ status: 'done', xp: 40 });
    expect((await progress(page)).xp).toBe(40);
  });

  test('show solution: asks first, shows what is missing, and applies it as one undo step', async ({ page }) => {
    await openLesson(page);
    await page.getByRole('button', { name: 'Show solution' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Show the solution?' });
    await expect(ask).toContainText('20 XP instead of 40');
    await ask.getByRole('button', { name: 'Show solution' }).click();

    const dialog = page.getByRole('dialog', { name: /Solution/ });
    await expect(dialog).toContainText('lines your code does not have yet');
    await expect(dialog.locator('pre')).toContainText('resource "aws_s3_bucket" "assets"');
    await dialog.getByRole('button', { name: 'Use the solution' }).click();
    await expect(dialog).toBeHidden();
    await expect(goal(page, 'name')).toHaveAttribute('data-met', 'true');
    await expect(page.getByText('20 XP (half, solution shown)')).toBeVisible();
    expect((await progress(page)).lessons['first-resource'].usedSolution).toBe(true);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(goal(page, 'bucket')).not.toHaveAttribute('data-met', 'true');

    // seen once: no second warning
    await page.getByRole('button', { name: 'Show solution' }).click();
    await expect(page.getByRole('dialog', { name: /Solution/ })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  });

  test('reset brings the starting code back', async ({ page }) => {
    await openLesson(page);
    await dropBucket(page);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Reset the lesson?' }).getByRole('button', { name: 'Reset lesson' }).click();
    await expect(goal(page, 'bucket')).not.toHaveAttribute('data-met', 'true');
    await expect(page.getByTestId('canvas').getByText('Start your blueprint')).toBeVisible();
    await expect.poll(async () => (await progress(page)).drafts?.['first-resource']).toBeUndefined();
  });

  test('open in editor makes a project from the lesson code, once per version', async ({ page }) => {
    await openLesson(page);
    await dropBucket(page);
    await page.getByRole('button', { name: 'Open in editor' }).click();
    await expect(page).toHaveURL(/\/editor\//);
    const id = page.url().split('/editor/')[1];
    const made = (await storedProjects(page)).find((p) => p.id === id) as { origin?: string; files: Record<string, string> };
    expect(made.origin).toBe('lesson:first-resource');
    expect(made.files['main.tf']).toContain('aws_s3_bucket');

    await page.goBack();
    await expect(goal(page, 'bucket')).toHaveAttribute('data-met', 'true');
    await page.getByRole('button', { name: 'Open in editor' }).click();
    await expect(page).toHaveURL(new RegExp(`/editor/${id}$`));
  });

  test('docs tab reads the selected resource from the provider schema', async ({ page }) => {
    await openLesson(page);
    await page.getByRole('tab', { name: 'Docs' }).click();
    await expect(page.getByText('Select a resource on the canvas')).toBeVisible();
    await dragBucket(page);
    const docs = page.getByRole('tabpanel');
    await expect(docs.getByRole('heading', { name: 'S3 Bucket' })).toBeVisible();
    await expect(docs.getByRole('link', { name: /Terraform Registry/ })).toHaveAttribute('href', /\/docs\/resources\/s3_bucket$/);
    await expect(docs.locator('dt code', { hasText: /^bucket$/ })).toBeVisible();
  });

  test('asides about AWS start collapsed for people who know AWS', async ({ page }) => {
    await openLesson(page, { start: 'aws' });
    const aside = page.getByRole('button', { name: 'What is S3?' });
    await expect(aside).toHaveAttribute('aria-expanded', 'false');
    await aside.click();
    await expect(page.getByText('S3 is AWS storage')).toBeVisible();
  });

  test('an unknown lesson goes back to the map', async ({ page }) => {
    await page.goto('/learn/no-such-lesson');
    await expect(page).toHaveURL(/\/learn$/);
  });

  test('on a phone, the lesson and the editor are tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLesson(page);
    const tabs = page.getByRole('tablist', { name: 'Lesson and editor' });
    await expect(tabs.getByRole('tab', { name: /Lesson/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('canvas')).toBeHidden();

    await tabs.getByRole('tab', { name: 'Build' }).click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your first resource' })).toBeHidden();
    await page.getByRole('button', { name: /^Resources/ }).click();
    await page.getByRole('button', { name: /^Add S3 Bucket/ }).click();
    await expect(tabs.getByRole('tab', { name: /Lesson/ })).toContainText('2/4');
    const box = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(box).toBeLessThanOrEqual(390);
  });
});

async function seriousViolations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    type Violation = { id: string; impact: string; nodes: Array<{ target: string[] }> };
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<{ violations: Violation[] }> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`));
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`lesson player is accessible (${theme})`, async ({ page }) => {
    await openLesson(page, { theme });
    await waitForMonaco(page);
    await dropBucket(page);
    await page.waitForTimeout(400);
    expect(await seriousViolations(page), 'desktop').toEqual([]);

    await page.getByRole('tab', { name: 'Docs' }).click();
    expect(await seriousViolations(page), 'docs tab').toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('tablist', { name: 'Lesson and editor' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await seriousViolations(page), 'phone').toEqual([]);
  });
}
