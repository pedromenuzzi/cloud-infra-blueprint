/**
 * The lesson player (/learn/:slug): the editor on the lesson's draft (never
 * a project), goals checked live from the canvas, the code and the
 * terminal, each mode's layout (canvas, mixed, code), the solution and
 * reset flows, "Open in editor", the phone tabs, and axe in both themes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { aws } from '../src/learn/content/shared';
import { focusEndOfCode, insertCode, storedProjects, waitForMonaco } from './helpers';

const LESSON = '/learn/first-resource';
const LEARN_KEY = 'cb-learn-v1';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface Seed {
  start?: 'new' | 'aws';
  theme?: 'light' | 'dark';
}

/** a fresh lesson; `seed` is written once, so a reload keeps what the page stored */
async function openLesson(page: Page, seed: Seed = {}, path = LESSON, title = 'Your first resource') {
  await page.addInitScript(
    ({ key, seed }) => {
      localStorage.setItem('cb-tips-dismissed', '1');
      if (seed.theme) localStorage.setItem('cb-theme', seed.theme);
      if (localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, JSON.stringify({ start: seed.start ?? null }));
    },
    { key: LEARN_KEY, seed },
  );
  await page.goto(path);
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
}

const goal = (page: Page, id: string) => page.locator(`[data-goal="${id}"]`);
const goalsCount = (page: Page) => page.getByRole('progressbar', { name: 'Goals' });

const dragBucket = (page: Page) =>
  page.getByRole('button', { name: /^Add S3 Bucket \(/ }).dragTo(page.getByTestId('canvas'), { targetPosition: { x: 160, y: 140 } });

async function dropBucket(page: Page) {
  await dragBucket(page);
  await expect(goal(page, 'bucket')).toHaveAttribute('data-met', 'true');
}

/** a second bucket, typed: one line, so Monaco's typing and paste paths agree */
async function typeNamedBucket(page: Page) {
  await waitForMonaco(page);
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_s3_bucket" "photos" { bucket = "photos-ana-2026" }');
}

/** a file's whole text, replaced by a paste (typed, Monaco would auto-close and re-indent the braces) */
async function typeFile(page: Page, file: string, text: string) {
  await waitForMonaco(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.getByRole('tab', { name: file, exact: true }).click();
  await page.locator('[data-testid="monaco"] .view-lines').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+v');
}

/** what a learner types in the mixed and code lessons (their solutions) */
const VARIABLES = {
  'variables.tf': 'variable "environment" {\n  type    = string\n  default = "dev"\n}\n',
  'main.tf': aws(`resource "aws_s3_bucket" "site" {
  bucket = "acme-site-\${var.environment}"

  tags = {
    Project     = "acme"
    Environment = var.environment
  }
}
`)['main.tf'],
};
const SECURITY_GROUP = aws(`resource "aws_security_group" "web" {
  name        = "web"
  description = "HTTPS in, everything out"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`)['main.tf'];

const progress = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), LEARN_KEY);
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test.describe('lesson player', () => {
  test('goals turn green from the canvas and the code; the draft is kept, never a project', async ({ page }) => {
    await openLesson(page);
    await expect(page).toHaveTitle(/Your first resource/);
    await expect(goalsCount(page)).toHaveAttribute('aria-valuenow', '0');

    await dropBucket(page);
    await expect(page.getByTestId('goal-news')).toHaveText('Goal met: An S3 bucket on the canvas');
    await expect(goal(page, 'label')).not.toHaveAttribute('data-met', 'true');

    // the canvas leads: the inspector opens beside the canvas, never over it
    const canvas = await box(page, '#bp-canvas');
    expect(canvas.width / (await box(page, '#bp-workspace')).width).toBeGreaterThan(0.45);
    const inspector = await box(page, '[data-testid="docked-inspector"]');
    expect(inspector.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);

    await typeNamedBucket(page);
    await expect(goal(page, 'label')).toHaveAttribute('data-met', 'true');
    await expect(goal(page, 'name')).toHaveAttribute('data-met', 'true');
    await expect(goalsCount(page)).toHaveAttribute('aria-valuenow', '3');

    // a hint on demand
    await goal(page, 'apply').getByRole('button', { name: 'Hint' }).click();
    await expect(goal(page, 'apply')).toContainText('then terraform plan and terraform apply');

    // saved as the lesson's draft, not as a project
    await expect.poll(async () => (await progress(page)).drafts?.['first-resource']?.['main.tf'] ?? '').toContain('photos-ana-2026');
    expect(await storedProjects(page)).not.toContainEqual(expect.objectContaining({ origin: 'lesson:first-resource' }));
    expect((await progress(page)).lessons?.['first-resource']?.met).toEqual(expect.arrayContaining(['bucket', 'label', 'name']));

    // the lesson's layout never becomes the editor's
    await page.getByRole('button', { name: /^Resources/ }).click();
    expect(await page.evaluate(() => localStorage.getItem('cb-layout-v2'))).toBeNull();

    await page.reload();
    await expect(goal(page, 'name')).toHaveAttribute('data-met', 'true');
    await expect(goalsCount(page)).toHaveAttribute('aria-valuenow', '3');
  });

  test('the terminal finishes the lesson: plan and apply, then the XP and the way on', async ({ page }) => {
    await openLesson(page);
    await dropBucket(page);
    await typeNamedBucket(page);
    const terminal = page.getByTestId('terminal-panel');
    await terminal.getByRole('button', { name: 'Run terraform init' }).click();
    await terminal.getByRole('button', { name: 'Run terraform plan' }).click();
    await expect(page.locator('.react-flow__node [data-plan-mark="create"]').first()).toBeVisible();
    await terminal.getByRole('button', { name: 'Run terraform apply' }).click();
    await terminal.getByRole('button', { name: 'Approve' }).click();

    const finish = page.getByTestId('lesson-finish');
    await expect(finish).toBeVisible();
    await expect(finish).toContainText('+40 XP');
    await expect(finish.getByRole('link', { name: /^Next: / })).toHaveAttribute('href', /\/learn\/arguments-and-types$/);
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    expect((await progress(page)).lessons['first-resource']).toMatchObject({ status: 'done', xp: 40 });
    // one card for the moment: the lesson with its XP, never taking the keyboard from the terminal
    const cheer = page.getByTestId('celebrations').locator('[data-cheer="lesson"]');
    await expect(cheer).toContainText('Lesson complete');
    await expect(cheer).toContainText('+40 XP');

    // back on the map, the stretch just walked draws itself in and the map opens on the next station
    await finish.getByRole('link', { name: 'Back to the learning map' }).click();
    const station = page.locator('[data-level="aws-0"] [data-station="0.2"]');
    await expect(station).toHaveAttribute('data-state', 'done');
    await expect(page.locator('[data-level="aws-0"] [data-trail] .bp-trail-draw')).toHaveCount(2);
    await expect(page.locator('[data-level="aws-0"] [data-station="0.3"]')).toBeInViewport();
  });

  test('show solution: asks first, shows what is missing, and applies it as one undo step', async ({ page }) => {
    await openLesson(page);
    await page.getByRole('button', { name: 'Show solution' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Show the solution?' });
    await expect(ask).toContainText('20 XP instead of 40');
    await ask.getByRole('button', { name: 'Show solution' }).click();

    const dialog = page.getByRole('dialog', { name: /Solution/ });
    await expect(dialog).toContainText('lines your code does not have yet');
    await expect(dialog.locator('pre')).toContainText('resource "aws_s3_bucket" "photos"');
    await dialog.getByRole('button', { name: 'Use the solution' }).click();
    await expect(dialog).toBeHidden();
    await expect(goal(page, 'label')).toHaveAttribute('data-met', 'true');
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
    const aside = page.getByRole('button', { name: 'Choosing a bucket name' });
    await expect(aside).toHaveAttribute('aria-expanded', 'false');
    await aside.click();
    await expect(page.getByText('Bucket names are global')).toBeVisible();
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
    await expect(page.getByTestId('terminal-panel')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your first resource' })).toBeHidden();
    await page.getByRole('button', { name: /^Resources/ }).click();
    await page.getByRole('button', { name: /^Add S3 Bucket \(/ }).click();
    await expect(tabs.getByRole('tab', { name: /Lesson/ })).toContainText('1/4');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('lesson modes', () => {
  test('mixed: resources and code side by side; typed variables turn the goals green', async ({ page }) => {
    await openLesson(page, {}, '/learn/variables', 'Variables');
    await expect(page.getByRole('complementary', { name: 'Resource palette' })).toBeVisible();
    const canvas = await box(page, '#bp-canvas');
    const code = await box(page, '#bp-code');
    expect(canvas.width).toBeGreaterThan(code.width);

    await typeFile(page, 'variables.tf', VARIABLES['variables.tf']);
    await expect(goal(page, 'declare')).toHaveAttribute('data-met', 'true');
    await typeFile(page, 'main.tf', VARIABLES['main.tf']);
    await expect(goal(page, 'tag')).toHaveAttribute('data-met', 'true');
    await expect(goal(page, 'name')).toHaveAttribute('data-met', 'true');

    // Ctrl+Enter plans, even from inside the code
    await page.getByTestId('terminal-panel').getByRole('button', { name: 'Run terraform init' }).click();
    await page.locator('[data-testid="monaco"] .view-lines').click();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('lesson-finish')).toBeVisible();
  });

  test('code: the code leads, the canvas draws what is typed, the caret never opens the inspector over it', async ({ page }) => {
    await openLesson(page, {}, '/learn/security-groups', 'Security groups');
    await expect(page.getByRole('complementary', { name: 'Resource palette' })).toBeHidden();
    await expect(page.locator('[data-strip="palette"]')).toBeVisible();
    const canvas = await box(page, '#bp-canvas');
    const code = await box(page, '#bp-code');
    expect(code.width).toBeGreaterThan(canvas.width);
    expect(canvas.width / (await box(page, '#bp-workspace')).width).toBeGreaterThan(0.4);

    await typeFile(page, 'main.tf', SECURITY_GROUP);
    await expect(page.locator('.react-flow__node[data-id^="aws_security_group."]')).toBeVisible();
    for (const id of ['sg', 'description', 'https', 'egress', 'valid']) {
      await expect(goal(page, id)).toHaveAttribute('data-met', 'true');
    }
    await expect(page.getByTestId('lesson-finish')).toBeVisible();
    // the caret picks the block it is in as it moves, but the code keeps its whole column
    await page.locator('[data-testid="monaco"] .view-lines').click();
    await expect(page.getByTestId('docked-inspector')).toHaveCount(0);
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
