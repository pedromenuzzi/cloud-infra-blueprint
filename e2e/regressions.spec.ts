/**
 * Regressions found in a hands-on QA sweep — each test reproduces what a
 * person did when the bug showed up.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { canvasStats, openSeedProject, pngSize, SEED_PROJECT, storedProject, waitForMonaco } from './helpers';

const node = (page: import('@playwright/test').Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: import('@playwright/test').Page) => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '';

test('the theme button opens a Light / Dark / System menu', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('header').getByRole('button', { name: /^Theme/ });
  await button.click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(button).toHaveAttribute('aria-label', 'Theme: Dark');
  await button.click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test.describe('editor', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page);
    await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
  });

  test('deleting a resource and undoing restores its connections', async ({ page }) => {
    await node(page, 'aws_security_group.web').click();
    await page.keyboard.press('Delete');
    await expect(canvasStats(page)).toHaveText('6 resources, 0 connections');
    await page.keyboard.press('Control+z');
    await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
  });

  test('a resource can be dragged out of its container (and back into another)', async ({ page }) => {
    const ec2 = await node(page, 'aws_instance.web').boundingBox();
    const vpc = await node(page, 'aws_vpc.main').boundingBox();
    await page.mouse.move(ec2!.x + 60, ec2!.y + 30);
    await page.mouse.down();
    await page.mouse.move(ec2!.x + 60, vpc!.y + vpc!.height + 50, { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => mainTf(page)).not.toMatch(/resource "aws_instance" "web" \{[^}]*subnet_id/);

    await page.keyboard.press('Control+z');
    await expect.poll(() => mainTf(page)).toMatch(/resource "aws_instance" "web" \{[^}]*subnet_id\s*=\s*aws_subnet\.public_a\.id/);

    const box = await node(page, 'aws_instance.web').boundingBox();
    const target = await node(page, 'aws_subnet.public_b').boundingBox();
    await page.mouse.move(box!.x + 60, box!.y + 30);
    await page.mouse.down();
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2 + 10, { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => mainTf(page)).toMatch(/subnet_id\s*=\s*aws_subnet\.public_b\.id/);
  });

  test('the inspector floats over the canvas and Esc closes it', async ({ page }) => {
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector).toBeHidden();
    await node(page, 'aws_db_instance.main').click();
    await expect(inspector).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
  });

  test('the stats pill opens the project overview; files open in the code editor', async ({ page }) => {
    await page.getByRole('button', { name: /project overview/ }).click();
    const overview = page.getByRole('dialog', { name: 'Project overview' });
    await overview.getByRole('button', { name: /variables\.tf/ }).click();
    await expect(overview).toBeHidden();
    await expect(page.locator('[data-testid="monaco"] .view-line', { hasText: 'variable "app_name"' })).toBeVisible();
  });

  test('exported PNGs contain the whole diagram after a container grows', async ({ page }) => {
    const ec2 = await node(page, 'aws_instance.web').boundingBox();
    const target = await node(page, 'aws_subnet.public_b').boundingBox();
    await page.mouse.move(ec2!.x + 60, ec2!.y + 30);
    await page.mouse.down();
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2 + 10, { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => mainTf(page)).toMatch(/subnet_id\s*=\s*aws_subnet\.public_b\.id/);

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Diagram as PNG' }).click();
    const { height } = pngSize(await readFile((await (await download).path())!));
    // VPC is ~488px tall + 2×48px padding, rendered at 2× → never cropped to the child nodes
    expect(height).toBeGreaterThan(1100);
  });
});

test('a blank project explains how to start', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: /^AWS/ }).click();
  await waitForMonaco(page);
  await expect(page.getByRole('heading', { name: 'Start your blueprint' })).toBeVisible();
  await page.getByRole('button', { name: 'Add resource' }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
});

test('deleting a project asks in an in-app dialog', async ({ page }) => {
  await page.goto('/dashboard');
  const card = page.getByRole('button', { name: `Open project ${SEED_PROJECT}` });
  await card.hover();
  await card.getByRole('button', { name: 'Delete project' }).click();
  const dialog = page.getByRole('alertdialog', { name: /Delete “production-web”/ });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(card).toBeVisible();
  await card.hover();
  await card.getByRole('button', { name: 'Delete project' }).click();
  await page.getByRole('button', { name: 'Delete project' }).last().click();
  await expect(card).toBeHidden();
});

test('⌘K lists projects to open', async ({ page }) => {
  await page.goto('/dashboard');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search or run a command…').fill('production');
  await page.getByRole('option', { name: /production-web/ }).click();
  await expect(page).toHaveURL(/\/editor\//);
});

test.describe('compact screens (1024px)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('the canvas gets the width; palette and code open as drawers', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const canvas = await page.getByTestId('canvas').boundingBox();
    expect(canvas!.width).toBeGreaterThan(900);
    await expect(page.getByRole('complementary', { name: 'Resource palette' })).toBeHidden();

    await page.getByRole('button', { name: /^Resource palette/ }).click();
    const palette = page.getByRole('complementary', { name: 'Resource palette' });
    await palette.getByText('S3 Bucket', { exact: true }).click();
    await expect(canvasStats(page)).toHaveText(/^8 resources/);
    await expect(palette).toBeHidden();

    await page.getByRole('button', { name: /^Code editor/ }).click();
    await waitForMonaco(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('monaco')).toBeHidden();
  });
});
