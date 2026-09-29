/**
 * In-browser validation and the CIDR planner: carving subnets out of the
 * seed VPC (one undo step each), and a CIDR warning that shows up in the
 * canvas chip, the overview and the code, then clears once fixed.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, openSeedProject, SEED_PROJECT, storedProject } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const mainTf = async (page: Page) => (await storedProject(page, SEED_PROJECT))?.files['main.tf'] ?? '';
const planner = (page: Page) => page.getByTestId('cidr-planner');
const warningsChip = (page: Page) => page.getByTitle('Show warnings');

/** the HCL block of one resource in the stored main.tf */
async function block(page: Page, type: string, name: string): Promise<string> {
  const text = await mainTf(page);
  return new RegExp(`resource "${type}" "${name}" \\{[^}]*\\}`).exec(text)?.[0] ?? '';
}

async function open(page: Page) {
  await openSeedProject(page);
  await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
}

async function selectVpc(page: Page) {
  await node(page, 'aws_vpc.main').click({ position: { x: 300, y: 12 } });
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_vpc.main');
  await expect(planner(page)).toBeVisible();
}

test('the planner adds a subnet, splits the VPC across AZs, and one undo reverts the split', async ({ page }) => {
  await open(page);
  await selectVpc(page);
  const card = planner(page);
  await expect(card).toContainText('10.0.0.0/16');
  await expect(card).toContainText('512 allocated');
  await expect(card).toContainText('2 subnets');

  await card.getByRole('button', { name: 'Add subnet' }).click();
  await expect(canvasStats(page)).toHaveText('12 resources, 7 connections');
  await expect.poll(() => block(page, 'aws_subnet', 'subnet')).toContain('cidr_block        = "10.0.3.0/24"');
  expect(await block(page, 'aws_subnet', 'subnet')).toContain('availability_zone = "us-east-1c"');
  expect(await block(page, 'aws_subnet', 'subnet')).toContain('vpc_id            = aws_vpc.main.id');
  await expect(card).toContainText('3 subnets');
  // the new subnet is drawn inside the VPC
  const vpcBox = (await node(page, 'aws_vpc.main').boundingBox())!;
  const subnetBox = (await node(page, 'aws_subnet.subnet').boundingBox())!;
  expect(subnetBox.x).toBeGreaterThan(vpcBox.x);
  expect(subnetBox.y + subnetBox.height).toBeLessThanOrEqual(vpcBox.y + vpcBox.height + 1);

  await card.getByLabel('Subnet size').selectOption('22');
  await expect(card).toContainText('3 × /22 in us-east-1a, us-east-1b, us-east-1c');
  await card.getByRole('button', { name: 'Split into 3 subnets across availability zones' }).click();
  await expect(canvasStats(page)).toHaveText('15 resources, 7 connections');
  await expect.poll(() => block(page, 'aws_subnet', 'subnet_4')).toContain('"10.0.12.0/22"');
  for (const [name, cidr, zone] of [
    ['subnet_2', '10.0.4.0/22', 'us-east-1a'],
    ['subnet_3', '10.0.8.0/22', 'us-east-1b'],
    ['subnet_4', '10.0.12.0/22', 'us-east-1c'],
  ]) {
    const hcl = await block(page, 'aws_subnet', name);
    expect(hcl).toContain(`"${cidr}"`);
    expect(hcl).toContain(`"${zone}"`);
  }
  await expect(card).toContainText('6 subnets');
  await expect(warningsChip(page)).toBeHidden();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvasStats(page)).toHaveText('12 resources, 7 connections');
  await expect.poll(() => mainTf(page)).not.toContain('"subnet_2"');
  expect(await mainTf(page)).toContain('resource "aws_subnet" "subnet"');
});

test('a subnet outside its VPC raises a warning at the argument, and fixing it clears it', async ({ page }) => {
  await open(page);
  await selectVpc(page);
  // the planner's list selects the subnet
  await planner(page).getByRole('button', { name: /public_b/ }).click();
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_subnet.public_b');
  await expect(planner(page)).toContainText('251');

  const cidr = page.getByRole('textbox', { name: 'cidr_block' });
  await cidr.fill('10.1.2.0/24');
  await cidr.press('Enter');
  await expect(warningsChip(page)).toHaveText('1');
  await expect(planner(page)).toContainText("Outside aws_vpc.main's range");
  await expect(page.locator('[data-testid="monaco"] .squiggly-warning').first()).toBeAttached();

  await warningsChip(page).click();
  const message = "aws_subnet.public_b: cidr_block 10.1.2.0/24 is outside aws_vpc.main's range (10.0.0.0/16)";
  await expect(page.getByRole('button', { name: message })).toBeVisible();

  await cidr.fill('10.0.2.0/24');
  await cidr.press('Enter');
  await expect(warningsChip(page)).toBeHidden();
  await expect(page.locator('[data-testid="monaco"] .squiggly-warning')).toHaveCount(0);
});

test('the planner works from the keyboard', async ({ page }) => {
  await open(page);
  await selectVpc(page);
  await planner(page).getByLabel('Subnet size').focus();
  await page.keyboard.press('Tab');
  await expect(planner(page).getByRole('button', { name: 'Add subnet' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(canvasStats(page)).toHaveText('12 resources, 7 connections');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the planner passes axe in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cb-theme', t), theme);
    await open(page);
    await selectVpc(page);
    await page.waitForTimeout(400); // let the inspector's entry animation settle
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => {
      type Result = { violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> };
      const axe = (window as unknown as { axe: { run(ctx: Element, o: object): Promise<Result> } }).axe;
      const card = document.querySelector('[data-testid="cidr-planner"]')!;
      const { violations } = await axe.run(card, { resultTypes: ['violations'] });
      return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    });
    expect(violations).toEqual([]);
  });
}
