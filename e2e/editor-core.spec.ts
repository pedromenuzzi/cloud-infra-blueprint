/**
 * Editor core: the canvas never corrupts the code, one undo history for
 * canvas and code, multi-selection, keyboard moves and inspector edits.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, focusEndOfCode, insertCode, openSeedProject, SEED_PROJECT, storedProject } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: Page) => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '';
const codeLines = (page: Page) => page.locator('[data-testid="monaco"] .view-lines');

async function drag(page: Page, id: string, dx: number, dy: number) {
  const box = await node(page, id).boundingBox();
  await page.mouse.move(box!.x + 60, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 60 + dx, box!.y + 30 + dy, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await openSeedProject(page);
  await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
});

test('the canvas is read-only while the code has errors, and nothing gets corrupted', async ({ page }) => {
  await codeLines(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText('@@@ oops\n');
  await expect(page.getByText('Code has errors — fix them to edit the canvas again')).toBeVisible();
  await expect.poll(() => mainTf(page)).toContain('@@@ oops');
  const broken = await mainTf(page);

  await drag(page, 'aws_iam_role.web', 0, 160);
  await page.waitForTimeout(800);
  expect(await mainTf(page)).toBe(broken);

  // remove the typo: everything else is exactly as it was
  await codeLines(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(page.getByText(/Code has errors/)).toBeHidden();
  await expect.poll(() => mainTf(page)).toBe(broken.replace('@@@ oops\n', ''));
});

test('Ctrl+Z in the code after a canvas edit undoes it cleanly', async ({ page }) => {
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_sqs_queue" "typed" {}');
  await expect(canvasStats(page)).toHaveText(/^8 resources/);

  await node(page, 'aws_vpc.main').click({ position: { x: 300, y: 12 } });
  await page.keyboard.press('F2');
  await page.locator('#inspector-tf-name').fill('core_network');
  await page.locator('#inspector-tf-name').press('Enter');
  await expect.poll(() => mainTf(page)).toContain('resource "aws_vpc" "core_network"');

  await codeLines(page).click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => mainTf(page)).toContain('resource "aws_vpc" "main"');
  await page.keyboard.press('Control+z');
  await expect.poll(() => mainTf(page)).not.toContain('aws_sqs_queue');
  const text = await mainTf(page);
  expect(text).toContain('resource "aws_instance" "web"');
  expect(text).toContain('resource "aws_security_group" "web"');
  await expect(page.getByText(/Code has errors/)).toBeHidden();
  await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
});

test('the toolbar Undo reverts code typed in the editor', async ({ page }) => {
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_sqs_queue" "typed" {}');
  await expect(canvasStats(page)).toHaveText(/^8 resources/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvasStats(page)).toHaveText('7 resources, 2 connections');
  await expect.poll(() => mainTf(page)).not.toContain('aws_sqs_queue');
});

test('the inspector survives tags turning into an expression', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_s3_bucket" "b" { tags = { team = "core" } }');
  await expect(node(page, 'aws_s3_bucket.b')).toBeVisible();
  await node(page, 'aws_s3_bucket.b').click();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();

  await codeLines(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.insertText('resource "aws_s3_bucket" "b" { tags = var.common_tags }');
  await expect.poll(() => mainTf(page)).toContain('tags = var.common_tags');
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByText('complex expression — edit in code').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a box selection keeps every node, and Delete removes them all', async ({ page }) => {
  const iam = (await node(page, 'aws_iam_role.web').boundingBox())!;
  const db = (await node(page, 'aws_db_instance.main').boundingBox())!;
  const left = Math.min(iam.x, db.x) - 16;
  const top = Math.min(iam.y, db.y) - 16;
  const right = Math.max(iam.x + iam.width, db.x + db.width) + 16;
  const bottom = Math.max(iam.y + iam.height, db.y + db.height) + 16;
  await page.keyboard.down('Shift');
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(node(page, 'aws_iam_role.web')).toHaveClass(/selected/);
  await expect(node(page, 'aws_db_instance.main')).toHaveClass(/selected/);

  await page.keyboard.press('Delete');
  await expect(canvasStats(page)).toHaveText(/^5 resources/);
});

test('arrow keys move a node and the new position is saved', async ({ page }) => {
  const pos = async () => /# @blueprint:pos=(-?\d+),(-?\d+)\n(?:#.*\n)*resource "aws_iam_role" "web"/.exec(await mainTf(page));
  const before = await pos();
  await node(page, 'aws_iam_role.web').click();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => Number((await pos())?.[2])).toBeGreaterThan(Number(before![2]));
  // moves snap to the 8px grid, so x may settle on the nearest grid line
  expect(Math.abs(Number((await pos())?.[1]) - Number(before![1]))).toBeLessThan(8);
});

test('text that only looks like a reference stays a string', async ({ page }) => {
  await node(page, 'aws_instance.web').click();
  const ami = page.getByRole('complementary', { name: 'Inspector' }).getByLabel(/^ami/);
  await ami.fill('base_image.latest');
  await ami.press('Enter');
  await expect.poll(() => mainTf(page)).toMatch(/ami\s*= "base_image\.latest"/);
});

test('Escape cancels an inspector edit', async ({ page }) => {
  await node(page, 'aws_vpc.main').click({ position: { x: 300, y: 12 } });
  await page.keyboard.press('F2');
  await page.locator('#inspector-tf-name').fill('typo_half');
  await page.locator('#inspector-tf-name').press('Escape');
  await page.locator('#inspector-tf-name').blur();
  await page.waitForTimeout(700);
  expect(await mainTf(page)).toContain('resource "aws_vpc" "main"');
  expect(await mainTf(page)).not.toContain('typo_half');
});

test('the canvas export button only offers export formats', async ({ page }) => {
  await page.getByRole('button', { name: 'Export image' }).click();
  const menu = page.getByRole('menu', { name: 'Export' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Export PDF document…', 'Export as PNG', 'Export as SVG']);
});

test('resizing a container from its top-left corner leaves its children in place', async ({ page }) => {
  await node(page, 'aws_vpc.main').click({ position: { x: 300, y: 12 } });
  // selecting pans the canvas clear of the inspector — measure once it settles
  await page.waitForTimeout(700);
  const child = (await node(page, 'aws_subnet.public_a').boundingBox())!;
  const handle = page.locator('.react-flow__node[data-id="aws_vpc.main"] .react-flow__resize-control.handle.top.left');
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 60, h.y - 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => mainTf(page)).toMatch(/# @blueprint:pos=-?\d+,-?\d+,\d+,\d+\nresource "aws_vpc" "main"/);
  await page.waitForTimeout(300);
  const after = (await node(page, 'aws_subnet.public_a').boundingBox())!;
  expect(Math.abs(after.x - child.x)).toBeLessThan(4);
  expect(Math.abs(after.y - child.y)).toBeLessThan(4);
});
