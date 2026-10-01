/**
 * The real provider schema in the editor: the inspector's "All arguments",
 * schema completions in Monaco, and schema validation warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, focusEndOfCode, insertCode, openSeedProject, SEED_PROJECT, storedProject } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: Page) => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '';
/** the text of the `aws_instance.web` block in the saved main.tf */
const ec2Block = async (page: Page) => /resource "aws_instance" "web" \{[\s\S]*?\n\}/.exec(await mainTf(page))?.[0] ?? '';

test.beforeEach(async ({ page }) => {
  await openSeedProject(page);
  await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
});

test('All arguments: search, edit, add a block, undo', async ({ page }) => {
  await node(page, 'aws_instance.web').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const all = inspector.getByTestId('schema-fields');
  // the AWS schema chunk loads lazily
  await expect(all).toBeVisible({ timeout: 15_000 });
  await expect(all.getByRole('heading', { name: /All arguments \(\d+\)/ })).toBeVisible();
  // long lists fold the optional arguments
  const toggle = all.getByRole('button', { name: /Show all \d+ optional arguments/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(all.getByText('disable_api_stop', { exact: true })).toBeHidden();

  const search = all.getByRole('textbox', { name: 'Search all arguments' });
  await search.fill('monitor');
  await expect(all.getByText('monitoring', { exact: true })).toBeVisible();
  await expect(all.getByText('disable_api_stop', { exact: true })).toBeHidden();
  await all.getByRole('combobox').selectOption('true');
  await expect.poll(() => ec2Block(page)).toMatch(/\n\s*monitoring\s*=\s*true\n/);

  await search.fill('root block');
  await all.getByRole('button', { name: 'Add root_block_device block' }).click();
  await expect.poll(() => ec2Block(page)).toMatch(/\n\s*root_block_device \{\}\n/);
  // set arguments are grouped, the block previews with a way into the code
  await search.fill('');
  await expect(all.getByRole('heading', { name: 'Set in code · 2' })).toBeVisible();
  await expect(all.getByTestId('schema-arg-root_block_device').getByRole('button', { name: 'Edit root_block_device in code' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => ec2Block(page)).not.toContain('root_block_device');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => ec2Block(page)).not.toContain('monitoring');
});

test('code completion offers schema arguments the catalog lacks, and exported attributes', async ({ page }) => {
  // wait for the AWS schema (the inspector shows it once loaded)
  await node(page, 'aws_instance.web').click();
  await expect(page.getByTestId('schema-fields')).toBeVisible({ timeout: 15_000 });

  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_s3_bucket" "e2e" {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('object_lock_en');
  const suggest = page.locator('.suggest-widget.visible');
  await expect(suggest.getByText('object_lock_enabled', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Enter');
  await page.keyboard.type('bucket = aws_db_instance.main.');
  await expect(suggest.getByText('endpoint', { exact: true })).toBeVisible();
  await expect(suggest.getByText('arn', { exact: true })).toBeVisible();
});

test('an unknown argument warns with a did-you-mean, and the inspector fixes it', async ({ page }) => {
  await node(page, 'aws_instance.web').click();
  await expect(page.getByTestId('schema-fields')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Close inspector' }).click();

  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_s3_bucket" "e2e" { force_destory = true }');
  await expect(canvasStats(page)).toHaveText(/^12 resources/);

  const message = 'aws_s3_bucket.e2e: unknown argument "force_destory". Did you mean "force_destroy"?';
  // a Monaco marker on the argument …
  await expect(page.locator('[data-testid="monaco"] .squiggly-warning').first()).toBeAttached();
  // … and the canvas warnings chip
  await page.getByTitle('Show warnings').click();
  await expect(page.getByRole('button', { name: message })).toBeVisible();
  await page.getByRole('button', { name: message }).click();

  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByTestId('inspector-address')).toHaveText('aws_s3_bucket.e2e');
  const row = inspector.getByTestId('schema-arg-force_destory');
  await expect(row).toContainText('unknown');
  await row.getByRole('button', { name: 'Rename to force_destroy' }).click();
  await expect
    .poll(async () => /resource "aws_s3_bucket" "e2e" \{[^}]*\}/.exec(await mainTf(page))?.[0] ?? '')
    .toMatch(/force_destroy\s*=\s*true/);
  await expect(page.getByTitle('Show warnings')).toBeHidden();
});
