import { expect, test } from '@playwright/test';
import {
  canvasStats,
  focusEndOfCode,
  insertCode,
  openSeedProject,
  SEED_PROJECT,
  storedProject,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openSeedProject(page);
  await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
});

test('clicking a palette item adds a node and writes its HCL block', async ({ page }) => {
  await page.getByRole('complementary', { name: 'Resource palette' }).getByText('S3 Bucket').click();

  await expect(canvasStats(page)).toHaveText(/^8 resources/);
  await expect
    .poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '')
    .toMatch(/resource\s+"aws_s3_bucket"\s+"\w+"\s*\{/);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(canvasStats(page)).toHaveText(/^7 resources/);
});

test('the palette searches across providers and categories', async ({ page }) => {
  const palette = page.getByRole('complementary', { name: 'Resource palette' });
  await palette.getByRole('tab', { name: 'GCP' }).click();
  await palette.getByPlaceholder('Search resources…').fill('pub/sub');

  await expect(palette.getByRole('heading', { name: 'Messaging & APIs' })).toBeVisible();
  await palette.getByText('Pub/Sub Topic').click();

  await expect(canvasStats(page)).toHaveText(/^8 resources/);
  await expect
    .poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '')
    .toMatch(/resource\s+"google_pubsub_topic"\s+"topic"\s*\{\s*name\s*=\s*"topic"/);
});

test('typing Terraform in the code pane rebuilds the diagram', async ({ page }) => {
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_s3_bucket" "e2e_logs" { bucket = "e2e-logs" }');

  await expect(canvasStats(page)).toHaveText(/^8 resources/);
  await expect(page.getByTestId('canvas').getByText('e2e_logs')).toBeVisible();
});

test('broken code keeps the last valid diagram and shows a non-overlapping warning', async ({
  page,
}) => {
  await focusEndOfCode(page);
  // unclosed block when pasted, empty value when typed (auto-closed `{`) — an error either way
  await insertCode(page, 'resource "aws_s3_bucket" "half" { bucket = ');

  const warning = page.getByRole('status').filter({ hasText: 'Code has errors' });
  await expect(warning).toBeVisible();
  await expect(canvasStats(page)).toHaveText(/^7 resources/);

  const a = (await canvasStats(page).boundingBox())!;
  const b = (await warning.boundingBox())!;
  const overlaps =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps, 'stats pill and error pill must not overlap').toBe(false);
});

// Regression: editor.api alone ships no suggest/hover widgets — providers were
// registered but never rendered until the contribs were imported.
test('code completion suggests resource types from the catalog', async ({ page }) => {
  await focusEndOfCode(page);
  await page.keyboard.type('resource "aws_s3');

  const suggest = page.locator('.suggest-widget.visible');
  await expect(suggest).toBeVisible();
  await expect(suggest.getByText('aws_s3_bucket', { exact: true })).toBeVisible();
});

test('hovering a resource type shows its catalog description', async ({ page }) => {
  const token = page
    .locator('[data-testid="monaco"] .view-line span')
    .filter({ hasText: /^"?aws_vpc"?$/ })
    .first();
  await token.hover();
  await expect(page.locator('.monaco-hover').filter({ hasText: 'aws_vpc' })).toBeVisible();
});
