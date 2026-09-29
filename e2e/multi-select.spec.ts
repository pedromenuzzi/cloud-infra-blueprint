/**
 * Multi-selection: the inspector turns into a panel that arranges, edits,
 * tags, connects and deletes the whole selection — each one undo step.
 */
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, focusEndOfCode, insertCode, openSeedProject, SEED_PROJECT, storedProject } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: Page) => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '';
const posOf = async (page: Page, address: string) => {
  const [type, name] = address.split('.');
  const m = new RegExp(`# @blueprint:pos=(-?\\d+),(-?\\d+)[^\\n]*\\n(?:#.*\\n)*resource "${type}" "${name}"`).exec(await mainTf(page));
  return m ? [Number(m[1]), Number(m[2])] : null;
};

async function boxSelect(page: Page, ids: string[]) {
  const boxes = await Promise.all(ids.map(async (id) => (await node(page, id).boundingBox())!));
  const left = Math.min(...boxes.map((b) => b.x)) - 12;
  const top = Math.min(...boxes.map((b) => b.y)) - 12;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 12;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 12;
  await page.keyboard.down('Shift');
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test.beforeEach(async ({ page }) => {
  await openSeedProject(page);
  await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
});

/** Ctrl-click the header strip of each container (its body may hold children). */
async function pickContainers(page: Page, ids: string[]) {
  for (const [i, id] of ids.entries()) {
    await node(page, id).click({ position: { x: 120, y: 14 }, modifiers: i === 0 ? [] : ['Control'] });
  }
}

test('a multi-selection opens the selection panel; align is one undo step', async ({ page }) => {
  await pickContainers(page, ['aws_subnet.public_a', 'aws_subnet.public_b']);
  const panel = page.getByRole('complementary', { name: '2 resources selected' });
  await expect(panel).toBeVisible();
  // distributing needs three
  await expect(panel.getByRole('button', { name: 'Distribute horizontally' })).toBeDisabled();

  const before = await posOf(page, 'aws_subnet.public_b');
  const target = await posOf(page, 'aws_subnet.public_a');
  await panel.getByRole('button', { name: 'Align left' }).click();
  await expect.poll(() => posOf(page, 'aws_subnet.public_b')).toEqual([target![0], before![1]]);

  await page.keyboard.press('Control+z');
  await expect.poll(() => posOf(page, 'aws_subnet.public_b')).toEqual(before);
  // the selection survives the undo
  await expect(panel).toBeVisible();
});

test('a box selection selects every resource inside it', async ({ page }) => {
  await boxSelect(page, ['aws_iam_role.web', 'aws_db_instance.main']);
  await expect(page.getByRole('complementary', { name: '2 resources selected' })).toBeVisible();
  await expect(node(page, 'aws_iam_role.web')).toHaveClass(/selected/);
  await expect(node(page, 'aws_db_instance.main')).toHaveClass(/selected/);
});

test('shared settings, tags and connections apply to every selected resource', async ({ page }) => {
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_instance" "api" { ami = "ami-1" }');
  await page.keyboard.press('Enter');
  await insertCode(page, 'resource "aws_instance" "worker" { instance_type = "t3.large" }');
  await expect(canvasStats(page)).toHaveText(/^13 resources/);

  await node(page, 'aws_instance.api').click();
  await node(page, 'aws_instance.worker').click({ modifiers: ['Control'] });
  await node(page, 'aws_instance.web').click({ modifiers: ['Control'] });
  const panel = page.getByRole('complementary', { name: '3 resources selected' });
  await expect(panel).toBeVisible();

  // a mixed value, set for all at once
  await panel.getByRole('combobox', { name: /instance_type/ }).selectOption('t3.medium');
  await expect.poll(async () => ((await mainTf(page)).match(/instance_type\s*=\s*"t3\.medium"/g) ?? []).length).toBe(3);

  await panel.getByLabel('Tag key for all').fill('env');
  await panel.getByLabel('Tag value for all').fill('prod');
  await panel.getByRole('button', { name: 'Add tag to all' }).click();
  await expect.poll(async () => ((await mainTf(page)).match(/env\s*=\s*"prod"/g) ?? []).length).toBe(3);

  await panel.getByLabel('Resource to connect all to').selectOption('aws_security_group.web');
  await panel.getByRole('button', { name: 'Connect all' }).click();
  await expect(page.getByText(/Connected 2 resources to aws_security_group\.web \(1 already were\)/)).toBeVisible();

  // one undo per bulk action
  await page.keyboard.press('Control+z');
  await expect.poll(async () => ((await mainTf(page)).match(/aws_security_group\.web\.id/g) ?? []).length).toBe(2);
});

test('the canvas menu and ⌘K act on the whole selection', async ({ page }) => {
  await pickContainers(page, ['aws_subnet.public_a', 'aws_subnet.public_b']);
  await node(page, 'aws_subnet.public_b').click({ position: { x: 120, y: 14 }, button: 'right' });
  const menu = page.getByRole('menu', { name: 'Selection actions' });
  await expect(menu.getByRole('menuitem', { name: 'Align left' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete 2 resources' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('group', { name: /Selection · 2 resources/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await node(page, 'aws_subnet.public_b').click({ position: { x: 120, y: 14 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete 2 resources' }).click();
  // the two subnets and the instance inside public_a
  await expect(canvasStats(page)).toHaveText(/^8 resources/);
  await expect(page.getByRole('complementary', { name: /resources selected/ })).toBeHidden();
});

test('clicking one resource in the panel selects only it', async ({ page }) => {
  await boxSelect(page, ['aws_iam_role.web', 'aws_db_instance.main']);
  const panel = page.getByRole('complementary', { name: '2 resources selected' });
  await panel.getByRole('button', { name: /^main/ }).click();
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_db_instance.main');
  await expect(node(page, 'aws_iam_role.web')).not.toHaveClass(/selected/);
});
