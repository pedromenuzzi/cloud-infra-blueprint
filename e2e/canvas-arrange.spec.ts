/**
 * Auto-arrange and drop explanations — what Pedro ran into: three EC2
 * instances added to a subnet made a mess, and a database that "just
 * wouldn't go" into the subnets with nothing saying why.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, openSeedProject, SEED_PROJECT, storedProject } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: Page) => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** saved canvas boxes (relative to the parent) of the resources whose ids match */
function boxes(tf: string, match: RegExp): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const m of tf.matchAll(/# @blueprint:pos=(-?\d+),(-?\d+)(?:,(\d+),(\d+))?\nresource "([\w-]+)" "([\w-]+)"/g)) {
    const id = `${m[5]}.${m[6]}`;
    if (!match.test(id)) continue;
    out.set(id, { x: +m[1], y: +m[2], w: m[3] ? +m[3] : 208, h: m[4] ? +m[4] : 76 });
  }
  return out;
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** the instances in public_a don't overlap and fit inside it */
function expectNeatSubnet(tf: string) {
  const subnet = boxes(tf, /^aws_subnet\.public_a$/).get('aws_subnet.public_a')!;
  const inside = [...boxes(tf, /^aws_instance\./).entries()].filter(([id]) =>
    new RegExp(`resource "aws_instance" "${id.split('.')[1]}" \\{[^}]*subnet_id\\s*=\\s*aws_subnet\\.public_a\\.id`).test(tf),
  );
  expect(inside).toHaveLength(4);
  for (const [i, [id, b]] of inside.entries()) {
    expect(b.x + b.w, `${id} fits in the subnet`).toBeLessThanOrEqual(subnet.w);
    expect(b.y + b.h, `${id} fits in the subnet`).toBeLessThanOrEqual(subnet.h);
    for (const [other, o] of inside.slice(i + 1)) expect(overlap(b, o), `${id} overlaps ${other}`).toBe(false);
  }
}

async function dropFromPalette(page: Page, label: RegExp, targetId: string) {
  const canvas = await page.getByTestId('canvas').boundingBox();
  const target = (await node(page, targetId).boundingBox())!;
  await page.getByRole('button', { name: label }).dragTo(page.getByTestId('canvas'), {
    targetPosition: { x: target.x - canvas!.x + target.width / 2, y: target.y - canvas!.y + target.height / 2 },
  });
}

/** press on a node and move it over another one, without letting go */
async function dragOver(page: Page, id: string, targetId: string, offset = { x: 0, y: 10 }) {
  await page.keyboard.press('Escape'); // the inspector would cover the canvas
  const box = (await node(page, id).boundingBox())!;
  const target = (await node(page, targetId).boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 + offset.x, target.y + target.height / 2 + offset.y, { steps: 15 });
}

test.describe('auto-arrange', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page);
    await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
  });

  test('three EC2 instances dropped on a subnet land side by side, and Auto-arrange keeps it neat', async ({ page }) => {
    for (let i = 0; i < 3; i++) await dropFromPalette(page, /^Add EC2 Instance/, 'aws_subnet.public_a');
    await expect(canvasStats(page)).toHaveText(/^14 resources/);
    await expect.poll(async () => (await mainTf(page)).match(/aws_subnet\.public_a\.id/g)?.length).toBe(5);
    expectNeatSubnet(await mainTf(page));

    const before = await mainTf(page);
    await page.getByRole('button', { name: 'Auto-arrange' }).click();
    await expect.poll(() => mainTf(page)).not.toBe(before);
    const tf = await mainTf(page);
    expectNeatSubnet(tf);
    // the subnets line up: same row, same size
    const subnets = boxes(tf, /^aws_subnet\./);
    const [a, b] = [subnets.get('aws_subnet.public_a')!, subnets.get('aws_subnet.public_b')!];
    expect([a.y, a.w, a.h]).toEqual([b.y, b.w, b.h]);

    // again: nothing left to move
    await page.getByRole('button', { name: 'Auto-arrange' }).click();
    await expect(page.getByText('Already arranged')).toBeVisible();
    expect(await mainTf(page)).toBe(tf);
  });

  test('"Arrange inside" a container is one undo step', async ({ page }) => {
    const before = await mainTf(page);
    await node(page, 'aws_vpc.main').click({ button: 'right', position: { x: 80, y: 14 } });
    await page.getByRole('menuitem', { name: 'Arrange inside main' }).click();
    await expect.poll(() => mainTf(page)).not.toBe(before);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => mainTf(page)).toBe(before);
  });

  test('⌘K offers Auto-arrange', async ({ page }) => {
    const before = await mainTf(page);
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox').fill('organize');
    await page.getByRole('option', { name: /Auto-arrange layout/ }).click();
    await expect.poll(() => mainTf(page)).not.toBe(before);
  });
});

test.describe('dropping where a resource can’t go', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page);
    await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
  });

  test('RDS on a subnet says why while dragging, and the fix creates a DB subnet group in one undo step', async ({ page }) => {
    const before = await mainTf(page);
    await dragOver(page, 'aws_db_instance.main', 'aws_subnet.public_a');
    const hint = page.getByTestId('drop-hint');
    await expect(hint).toContainText("Can't go in subnet public_a");
    await expect(hint).toContainText('DB subnet group that spans two or more availability zones');
    await expect(node(page, 'aws_subnet.public_a').locator('[data-drop="no"]')).toBeVisible();
    await page.mouse.up();

    await expect(hint).toBeHidden();
    // nothing moved: it snapped back
    expect(await mainTf(page)).toBe(before);
    await page.getByRole('button', { name: 'Create a DB subnet group in main' }).click();
    await expect(page.getByText(/Created aws_db_subnet_group\.main with public_a and public_b/)).toBeVisible();
    await expect(canvasStats(page)).toHaveText(/^12 resources/);
    // (autosave is debounced)
    await expect
      .poll(() => mainTf(page))
      .toMatch(/resource "aws_db_subnet_group" "main" \{[^}]*subnet_ids\s*=\s*\[aws_subnet\.public_a\.id, aws_subnet\.public_b\.id\]/);
    expect(await mainTf(page)).toMatch(/db_subnet_group_name\s*=\s*aws_db_subnet_group\.main\.name/);
    // drawn inside the group, inside the VPC
    const group = (await node(page, 'aws_db_subnet_group.main').boundingBox())!;
    const db = (await node(page, 'aws_db_instance.main').boundingBox())!;
    const vpc = (await node(page, 'aws_vpc.main').boundingBox())!;
    expect(db.x >= group.x && db.y >= group.y && db.x + db.width <= group.x + group.width).toBe(true);
    expect(group.x >= vpc.x && group.y + group.height <= vpc.y + vpc.height).toBe(true);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect.poll(() => mainTf(page)).toBe(before);
    await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
  });

  test('a security group dropped on a subnet goes to its VPC and says why', async ({ page }) => {
    await dragOver(page, 'aws_security_group.web', 'aws_subnet.public_b');
    await expect(page.getByTestId('drop-hint')).toContainText('Goes in VPC main');
    await expect(node(page, 'aws_vpc.main').locator('[data-drop="ok"]').first()).toBeVisible();
    await page.mouse.up();
    await expect(page.getByText('A security group belongs to the whole VPC, not to one subnet')).toBeVisible();
    // not drawn over the subnet
    const sg = (await node(page, 'aws_security_group.web').boundingBox())!;
    const subnet = (await node(page, 'aws_subnet.public_b').boundingBox())!;
    const box = (b: typeof sg) => ({ x: b.x, y: b.y, w: b.width, h: b.height });
    expect(overlap(box(sg), box(subnet))).toBe(false);
  });

  test('an IAM role dropped in the VPC explains itself and stays put', async ({ page }) => {
    const before = await mainTf(page);
    await dragOver(page, 'aws_iam_role.web', 'aws_vpc.main', { x: 70, y: 100 });
    await expect(page.getByTestId('drop-hint')).toContainText("Can't go in VPC main");
    await page.mouse.up();
    await expect(page.getByText('An IAM role is an identity and permissions setting, not part of a network')).toBeVisible();
    expect(await mainTf(page)).toBe(before);
  });
});

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function seriousViolations(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    type Result = { violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> };
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<Result> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the Auto-arrange button, the drag hint and the fix toast pass axe`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cb-theme', t), theme);
    await openSeedProject(page);
    await expect(page.getByRole('button', { name: 'Auto-arrange' })).toBeVisible();
    // a refused drop's toast, with its fix button
    await dragOver(page, 'aws_db_instance.main', 'aws_subnet.public_a');
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Create a DB subnet group in main' })).toBeVisible();
    // and a drag in progress, hint card and outline showing
    await dragOver(page, 'aws_security_group.web', 'aws_subnet.public_b');
    await expect(page.getByTestId('drop-hint')).toBeVisible();
    await page.waitForTimeout(400);
    expect(await seriousViolations(page)).toEqual([]);
    await page.mouse.up();
  });
}
