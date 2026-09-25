import { expect, test, type Page } from '@playwright/test';
import { canvasStats, openSeedProject, SEED_PROJECT, storedProject, waitForMonaco } from './helpers';

/** the resource address shown under the inspector title */
const inspectorAddress = (page: Page) => page.getByTestId('inspector-address');

test.describe('editor power features', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page);
    await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
  });

  test('⌘K adds a resource by name', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder('Search or run a command…').fill('dynamodb');
    await palette.getByRole('option', { name: /DynamoDB Table/ }).click();

    await expect(palette).toBeHidden();
    await expect(canvasStats(page)).toHaveText(/^8 resources/);
    await expect
      .poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '')
      .toContain('resource "aws_dynamodb_table" "table"');
  });

  test('⌘K runs actions and jumps to resources', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByPlaceholder('Search or run a command…').fill('main db');
    // "Go to resource" selects it and the inspector follows
    await palette.getByRole('option', { name: /main.*RDS Instance/ }).click();
    await expect(inspectorAddress(page)).toHaveText('aws_db_instance.main');
  });

  test('double-clicking the canvas opens quick add at the cursor', async ({ page }) => {
    // top-left corner: fitView padding keeps it empty (bottom corners hold the toolbar/minimap)
    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    await page.mouse.dblclick(box.x + 24, box.y + 24);

    const quickAdd = page.getByRole('dialog', { name: 'Quick add resource' });
    await expect(quickAdd).toBeVisible();
    await page.keyboard.type('sqs');
    await expect(quickAdd.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');

    await expect(quickAdd).toBeHidden();
    await expect(canvasStats(page)).toHaveText(/^8 resources/);
    await expect(page.getByTestId('canvas').getByText('queue', { exact: true }).first()).toBeVisible();
  });

  test('right-click → Duplicate copies a resource next to the original', async ({ page }) => {
    await page.locator('.react-flow__node[data-id="aws_iam_role.web"]').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Resource actions' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /Duplicate/ }).click();

    await expect(canvasStats(page)).toHaveText(/^8 resources/);
    await expect(page.locator('.react-flow__node[data-id="aws_iam_role.web_copy"]')).toBeVisible();
    await expect
      .poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '')
      .toMatch(/resource "aws_iam_role" "web_copy"[\s\S]*name\s*=\s*"production_web-web-role-copy"/);
  });

  test('selection syncs between the canvas and the code', async ({ page }) => {
    // canvas → code: the block is revealed and flashed
    await page.locator('.react-flow__node[data-id="aws_db_instance.main"]').click();
    await expect(page.locator('[data-testid="monaco"] .bp-code-flash').first()).toBeVisible();
    await expect(
      page.locator('[data-testid="monaco"] .view-line', { hasText: 'resource "aws_db_instance" "main"' }),
    ).toBeVisible();

    // code → canvas: clicking inside another block selects that resource
    await page.locator('[data-testid="monaco"] .view-line', { hasText: 'resource "aws_iam_role" "web"' }).click();
    await expect(page.locator('.react-flow__node[data-id="aws_iam_role.web"]')).toHaveClass(/selected/);
    await expect(inspectorAddress(page)).toHaveText('aws_iam_role.web');
  });

  test('panels collapse and come back', async ({ page }) => {
    await page.getByRole('button', { name: /^Code editor/ }).click();
    await expect(page.getByTestId('monaco')).toBeHidden();
    await page.getByRole('button', { name: /^Inspector/ }).click();
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden();

    await page.keyboard.press('Control+j');
    await waitForMonaco(page);
  });

  test('tidy up re-lays out the diagram as one undo step', async ({ page }) => {
    const before = (await storedProject(page, SEED_PROJECT))!.files['main.tf'];
    await page.getByRole('button', { name: 'Tidy up layout' }).click();
    await expect
      .poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf'])
      .not.toBe(before);
    await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf']).toBe(before);
  });

  test('the diagram exports as PNG', async ({ page }) => {
    await page.getByRole('button', { name: /^Export$/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Diagram as PNG' }).click();
    expect((await download).suggestedFilename()).toBe('production-web-diagram.png');
  });
});

test('first-run tips show once and stay dismissed', async ({ page }) => {
  await openSeedProject(page, { tips: true });
  const tips = page.getByRole('note', { name: 'Editor tips' });
  await expect(tips).toBeVisible();
  await tips.getByRole('button', { name: 'Dismiss tips' }).click();
  await expect(tips).toBeHidden();
  await page.reload();
  await waitForMonaco(page);
  await expect(tips).toBeHidden();
});

test('dropping Terraform files on the dashboard imports a project', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByLabel('Import Terraform files').setInputFiles([
    {
      name: 'main.tf',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'resource "aws_vpc" "core" {\n  cidr_block = "10.1.0.0/16"\n}\n\n' +
          'resource "aws_subnet" "app" {\n  vpc_id     = aws_vpc.core.id\n  cidr_block = "10.1.1.0/24"\n}\n\n' +
          'resource "aws_sqs_queue" "jobs" {\n  name = "jobs"\n}\n',
      ),
    },
  ]);
  await expect(page).toHaveURL(/\/editor\//);
  await waitForMonaco(page);
  await expect(canvasStats(page)).toHaveText(/^3 resources/);
  await expect(page.getByRole('textbox', { name: 'Project name' }).first()).toHaveValue('imported-terraform');
});
