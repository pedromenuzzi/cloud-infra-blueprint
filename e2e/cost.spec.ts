/**
 * Monthly cost estimate: the canvas chip, its breakdown popover, the
 * inspector line and the PDF section — on the seed project (production-web:
 * an EC2 t3.micro in a public subnet, an RDS db.t3.micro postgres with 20 GB,
 * and 9 resources with no charge of their own).
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { openSeedProject } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const chip = (page: Page) => page.getByTestId('cost-chip');
const popover = (page: Page) => page.getByRole('dialog', { name: 'Estimated monthly cost' });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

/** "~$27/mo" → 27 */
const amount = (text: string | null) => Number(/\$([\d,.]+)/.exec(text ?? '')?.[1].replace(/,/g, ''));

async function seriousAxe(page: Page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    type Violation = { id: string; impact: string; nodes: Array<{ target: string[] }> };
    const axe = (window as unknown as { axe: { run(ctx: Element, o: object): Promise<{ violations: Violation[] }> } }).axe;
    const { violations } = await axe.run(document.querySelector('[data-testid="cost-popover"]') ?? document.body, { resultTypes: ['violations'] });
    return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test.describe('cost estimate', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page, { monaco: false });
  });

  test('the canvas chip shows the monthly total of the seed project', async ({ page }) => {
    await expect(chip(page)).toHaveText(/^~\$\d+\/mo$/);
    const total = amount(await chip(page).textContent());
    // t3.micro + 8 GB gp3 + its public IPv4, db.t3.micro + 20 GB: about $27 at us-east-1 list prices
    expect(total).toBeGreaterThan(15);
    expect(total).toBeLessThan(60);
    await expect(chip(page)).toHaveAccessibleName(/^Cost estimate: ~\$\d+\/mo$/);
    await expect(chip(page)).toHaveAccessibleDescription(/on-demand list prices/);
  });

  test('the breakdown lists, sorts and selects resources; Esc and a click outside close it', async ({ page }) => {
    await chip(page).click();
    const dialog = popover(page);
    await expect(dialog).toBeVisible();
    const rows = dialog.getByTestId('cost-rows').getByRole('listitem');
    await expect(rows).toHaveCount(2);
    // by cost: the database first
    await expect(rows.nth(0)).toContainText('main');
    await expect(rows.nth(0)).toContainText('RDS');
    await expect(rows.nth(1)).toContainText('web');
    await expect(rows.nth(1)).toContainText(/t3\.micro 730 h × \$0\.\d+ = \$\d+\.\d\d/);
    await expect(dialog.getByText('By category')).toBeVisible();
    await expect(dialog).toContainText('Compute');
    await expect(dialog).toContainText('Database');
    await expect(dialog).toContainText(/prices as of \w{3} \d{1,2}, \d{4}/);
    await expect(dialog).toContainText('An estimate, not a quote');

    await dialog.getByRole('button', { name: 'Name' }).click();
    await expect(dialog.getByRole('button', { name: 'Name' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows.nth(0)).toContainText('main');
    await dialog.getByRole('button', { name: /9 with no charge/ }).click();
    await expect(dialog.getByRole('listitem').filter({ hasText: 'no charge' })).toHaveCount(9);
    expect(await seriousAxe(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(chip(page)).toBeFocused();

    await chip(page).click();
    await expect(dialog).toBeVisible();
    await page.locator('.react-flow__pane').click({ position: { x: 30, y: 300 } });
    await expect(dialog).toBeHidden();

    // a row selects its resource
    await chip(page).click();
    await dialog.getByTestId('cost-rows').getByRole('button', { name: /web/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('inspector-address')).toHaveText('aws_instance.web');
  });

  test('the inspector line follows a change of instance_type', async ({ page }) => {
    await node(page, 'aws_instance.web').click();
    const line = inspector(page).getByTestId('cost-line');
    await expect(line).toContainText(/t3\.micro 730 h × \$0\.0\d+/);
    await expect(line).toContainText(/8 GB gp3/);
    await expect(line).toContainText('Public IPv4');
    const before = amount(await line.getByTestId('cost-line-total').textContent());
    const chipBefore = amount(await chip(page).textContent());

    await inspector(page).getByLabel(/^instance_type/).selectOption('t3.large');
    await expect(line).toContainText(/t3\.large 730 h × \$0\.0\d+/);
    await expect(line).not.toContainText('t3.micro');
    await expect.poll(async () => amount(await line.getByTestId('cost-line-total').textContent())).toBeGreaterThan(before);
    await expect.poll(async () => amount(await chip(page).textContent())).toBeGreaterThan(chipBefore);
  });

  test('a resource with no charge of its own says so', async ({ page }) => {
    await node(page, 'aws_iam_role.web').click();
    await expect(inspector(page).getByTestId('cost-line')).toHaveText('No charge of its own');
  });
});

/** the inflated content stream of every page, in file order */
function pageContents(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of text.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+)>>\nstream\n/g)) {
    const start = m.index + m[0].length;
    out.push(inflateSync(pdf.subarray(start, start + Number(m[1]))).toString('latin1'));
  }
  return out;
}

const textRuns = (content: string) => [...content.matchAll(/<([0-9a-f]*)> Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1'));

async function exportPdf(page: Page, costOn: boolean) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: /PDF document/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export PDF document' });
  const toggle = dialog.getByRole('switch', { name: 'Cost estimate' });
  // on by default
  await expect(toggle).toBeChecked();
  if (!costOn) await toggle.uncheck();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF' }).click();
  const file = await download;
  await expect(dialog).toBeHidden();
  return readFile((await file.path())!);
}

test.describe('cost estimate in the PDF', () => {
  test('the document has a cost section and an overview tile when the switch is on', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const chipTotal = (await chip(page).textContent())!.replace('/mo', '');
    const runs = pageContents(await exportPdf(page, true)).flatMap(textRuns);
    expect(runs).toContain('Cost estimate');
    expect(runs).toContain('EST. PER MONTH');
    expect(runs).toContain(chipTotal);
    expect(runs.some((r) => /^t3\.micro 730 h × \$0\.\d+ = \$\d+\.\d\d$/.test(r))).toBe(true);
    expect(runs).toContain('Total for the priced resources');
  });

  test('and none when it is off', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const runs = pageContents(await exportPdf(page, false)).flatMap(textRuns);
    expect(runs).not.toContain('Cost estimate');
    expect(runs).not.toContain('EST. PER MONTH');
  });
});
