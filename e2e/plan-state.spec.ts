/**
 * A real plan and a real state, read in the browser: a `terraform show -json`
 * plan drawn on the seed project (marks on the nodes, the panel's counts,
 * risks and attribute diff, the "code changed" state), a state marking what
 * is deployed and what isn't in the code, "Create a project from a state",
 * axe in both themes, and the panel at 390 px. Fixtures in e2e/fixtures and
 * src/deploy/__fixtures__ (made with Terraform itself).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { SEED_PROJECT } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const PLAN = readFileSync(new URL('./fixtures/web-plan.json', import.meta.url));
const STATE = readFileSync(new URL('./fixtures/web.tfstate', import.meta.url));
const AWS_STATE = readFileSync(new URL('../src/deploy/__fixtures__/aws.tfstate.json', import.meta.url));
const SECRET = 'e2e-not-a-real-secret';

async function seriousAxeViolations(page: Page, within: string) {
  await page.waitForTimeout(400);
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async (selector) => {
    type Result = { violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> };
    const axe = (window as unknown as { axe: { run(ctx: Element, o: object): Promise<Result> } }).axe;
    const { violations } = await axe.run(document.querySelector(selector)!, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  }, within);
}

async function openSeed(page: Page, { theme }: { theme?: string } = {}) {
  await page.addInitScript((theme) => {
    localStorage.setItem('cb-tips-dismissed', '1');
    if (theme) localStorage.setItem('cb-theme', theme);
  }, theme);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.locator('.react-flow__node[data-id="aws_instance.web"]')).toBeVisible({ timeout: 15_000 });
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function openFile(page: Page, button: RegExp | string, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer });
}

test.describe('a real plan on the canvas', () => {
  test('open a plan: marks on the nodes, counts, risks and the attribute diff', async ({ page }) => {
    await openSeed(page);
    await page.getByTestId('deploy-button').click();
    const panel = page.getByTestId('deploy-panel');
    await expect(panel.getByText('See what a plan will do')).toBeVisible();
    await openFile(page, 'Open a plan…', 'plan.json', PLAN);

    await expect(node(page, 'aws_instance.web').locator('[data-plan-mark="update"]')).toBeVisible();
    await expect(node(page, 'aws_db_instance.main').locator('[data-plan-mark="replace"]')).toBeVisible();
    await expect(node(page, 'aws_subnet.public_a').locator('[data-plan-mark="create"]')).toBeVisible();
    // destroyed and not in the code: listed on the canvas, and in the panel's own list
    await expect(page.getByTestId('plan-gone')).toContainText('aws_s3_bucket.old_logs');
    await expect(panel.locator('[data-change="aws_s3_bucket.old_logs"]')).toBeVisible();

    const counts = panel.getByTestId('plan-counts');
    for (const chip of ['1 to create', '1 to change', '1 to replace', '1 to destroy', '1 import']) await expect(counts).toContainText(chip);
    await expect(panel.getByText('Plan: 2 to add, 1 to change, 2 to destroy.')).toBeVisible();
    const risk = panel.getByTestId('plan-risk');
    await expect(risk).toContainText('2 resources that keep data will be destroyed or replaced');
    await expect(risk).toContainText('aws_db_instance.main');

    // a change opens on its diff and selects its node
    await panel.getByRole('button', { name: 'Attributes of aws_db_instance.main' }).click();
    const db = panel.locator('[data-change="aws_db_instance.main"]');
    await expect(db.locator('[data-diff-row="engine_version"][data-forces]')).toContainText('forces replacement');
    await expect(db.locator('[data-diff-row="engine_version"]')).toContainText('"16.3"');
    await expect(db.locator('[data-diff-row="address"]')).toContainText('(known after apply)');
    await expect(page.getByTestId('inspector-address')).toHaveText('aws_db_instance.main');
    // a secret is never on the page
    await db.getByRole('button', { name: /unchanged attribute/ }).click();
    await expect(db.locator('[data-diff-row="password"]')).toContainText('(sensitive)');
    expect(await page.content()).not.toContain(SECRET);
    // the inspector says what the plan does to it
    await expect(page.getByTestId('deployed-section')).toContainText('replace');
  });

  test('the code changing since the plan is said, not silently dropped; clearing takes the marks away', async ({ page }) => {
    await openSeed(page);
    await page.getByTestId('deploy-button').click();
    await openFile(page, 'Open a plan…', 'plan.json', PLAN);
    const panel = page.getByTestId('deploy-panel');
    await expect(node(page, 'aws_instance.web').locator('[data-plan-mark]')).toBeVisible();

    // an edit in the inspector
    await panel.getByRole('button', { name: 'Close the plan and state panel' }).click();
    await node(page, 'aws_instance.web').click();
    await page.getByRole('combobox', { name: 'instance_type' }).selectOption('t3.large');
    await page.getByTestId('deploy-button').click();
    await expect(panel.getByText('The code changed since this plan was opened')).toBeVisible();
    await expect(node(page, 'aws_instance.web').locator('[data-plan-mark]')).toBeVisible();
    await panel.getByRole('button', { name: 'Keep showing' }).click();
    await expect(panel.getByText('The code changed since this plan was opened')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Clear', exact: true }).first().click();
    await expect(page.locator('[data-plan-mark]')).toHaveCount(0);
    await expect(panel.getByText('See what a plan will do')).toBeVisible();
  });

  test('a dropped plan, the sample plan, and the stable ?panel=plan link', async ({ page }) => {
    await openSeed(page);
    const url = page.url();
    // drag and drop anywhere on the editor
    const data = await page.evaluateHandle((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'plan.json', { type: 'application/json' }));
      return dt;
    }, PLAN.toString());
    await page.dispatchEvent('main', 'dragenter', { dataTransfer: data });
    await expect(page.getByTestId('deploy-drop')).toBeVisible();
    await page.dispatchEvent('main', 'drop', { dataTransfer: data });
    await expect(page.getByTestId('deploy-drop')).toHaveCount(0);
    await expect(node(page, 'aws_db_instance.main').locator('[data-plan-mark="replace"]')).toBeVisible();

    // what isn't a plan says why
    const junk = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['resource "x" "y" {}'], 'main.tf'));
      return dt;
    });
    await page.dispatchEvent('main', 'drop', { dataTransfer: junk });
    await expect(page.getByText('This is not JSON.', { exact: false })).toBeVisible();

    await page.goto(`${url}?panel=plan`);
    const panel = page.getByTestId('deploy-panel');
    await expect(panel.getByText('See what a plan will do')).toBeVisible();
    await expect(page).not.toHaveURL(/panel=/);
    await panel.getByRole('button', { name: 'Try with a sample plan' }).click();
    await expect(panel.getByText('Sample', { exact: true })).toBeVisible();
    await expect(node(page, 'aws_db_instance.main').locator('[data-plan-mark="replace"]')).toBeVisible();
    await expect(page.getByTestId('plan-gone')).toContainText('aws_instance.legacy');
  });
});

test.describe('a state on the canvas', () => {
  test('deployed or not, what the state holds that the code does not, attributes with secrets masked', async ({ page }) => {
    await openSeed(page);
    await page.getByTestId('deploy-button').click();
    const panel = page.getByTestId('deploy-panel');
    await panel.getByRole('tab', { name: 'State' }).click();
    await expect(panel.getByText('A state holds secrets', { exact: false })).toBeVisible();
    await openFile(page, 'Open a state…', 'terraform.tfstate', STATE);

    await expect(node(page, 'aws_vpc.main').locator('[data-state-mark="deployed"]')).toBeVisible();
    await expect(node(page, 'aws_db_instance.main').locator('[data-state-mark="deployed"]')).toBeVisible();
    await expect(node(page, 'aws_subnet.public_a').locator('[data-state-mark="missing"]')).toBeVisible();
    await expect(panel.getByText('3 of 11 blocks deployed')).toBeVisible();
    const drift = panel.getByTestId('state-drift');
    await expect(drift).toContainText('aws_s3_bucket.logs');
    await expect(drift).toContainText('2 instances');
    await drift.getByRole('button', { name: /aws_s3_bucket\.logs/ }).click();
    await expect(drift).toContainText('production-web-logs-0');

    // the inspector: attributes, the password masked until asked
    await node(page, 'aws_db_instance.main').click();
    const section = page.getByTestId('deployed-section');
    await expect(section).toContainText('Deployed · 1 instance');
    await expect(section).toContainText('production-web-db');
    await expect(section).toContainText('(sensitive)');
    expect(await page.content()).not.toContain(SECRET);
    const reveal = section.getByRole('button', { name: 'Show sensitive values' });
    await reveal.click();
    await expect(reveal).toHaveAttribute('aria-pressed', 'true');
    await expect(section).toContainText(SECRET);
    await reveal.click();
    await expect(section).not.toContainText(SECRET);

    // never stored
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/10\.0\.1\.12|production-web-logs-0/);
  });

  test('create a project from a state, from the dashboard: drawn, referenced, marked deployed', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cb-tips-dismissed', '1'));
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'From a Terraform state…' }).click();
    await (await chooser).setFiles({ name: 'terraform.tfstate', mimeType: 'application/json', buffer: AWS_STATE });

    const dialog = page.getByRole('dialog', { name: 'Create a project from a state' });
    const summary = dialog.getByTestId('from-state-summary');
    await expect(summary).toContainText('7 resources written (9 instances)');
    await expect(summary).toContainText('var.main_password');
    await expect(dialog.getByTestId('from-state-skipped')).toContainText('resources inside modules');
    await dialog.getByRole('textbox', { name: 'Project name' }).fill('Real infra');
    await dialog.getByRole('button', { name: 'Create project' }).click();

    await expect(page).toHaveURL(/\/editor\//);
    await expect(node(page, 'aws_subnet.public')).toBeVisible();
    await expect(node(page, 'aws_vpc.main').locator('[data-state-mark="deployed"]')).toBeVisible();
    await expect(node(page, 'aws_instance.app').locator('[data-state-mark="deployed"]')).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cb-projects-v1') ?? '[]'));
    const project = stored.find((p: { name: string }) => p.name === 'Real infra');
    expect(project.files['main.tf']).toContain('vpc_id            = aws_vpc.main.id');
    expect(JSON.stringify(project)).not.toContain('s3cr3t-pass');
  });
});

test.describe('the panel, accessible and on a phone', () => {
  for (const theme of ['light', 'dark']) {
    test(`axe, ${theme}: the plan and the state`, async ({ page }) => {
      await openSeed(page, { theme });
      await page.getByTestId('deploy-button').click();
      expect(await seriousAxeViolations(page, '[data-testid="deploy-panel"]')).toEqual([]);
      await openFile(page, 'Open a plan…', 'plan.json', PLAN);
      const panel = page.getByTestId('deploy-panel');
      await panel.getByRole('button', { name: 'Attributes of aws_db_instance.main' }).click();
      expect(await seriousAxeViolations(page, '[data-testid="deploy-panel"]')).toEqual([]);
      expect(await seriousAxeViolations(page, '.react-flow__node[data-id="aws_db_instance.main"]')).toEqual([]);
      await panel.getByRole('tab', { name: 'State' }).click();
      await openFile(page, 'Open a state…', 'terraform.tfstate', STATE);
      expect(await seriousAxeViolations(page, '[data-testid="deploy-panel"]')).toEqual([]);
      expect(await seriousAxeViolations(page, '.react-flow__node[data-id="aws_db_instance.main"]')).toEqual([]);
    });
  }

  test('390 px: from the ⋯ menu, the panel fits, a change shows its node', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSeed(page);
    await page.getByRole('button', { name: 'More actions' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Open a plan…' }).click();
    await (await chooser).setFiles({ name: 'plan.json', mimeType: 'application/json', buffer: PLAN });
    const panel = page.getByTestId('deploy-panel');
    await expect(panel).toBeVisible();
    // once it has slid in
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeGreaterThanOrEqual(8);
    const box = (await panel.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    // one panel at a time: picking a change gives the canvas to its node and the inspector
    await panel.getByRole('button', { name: 'Attributes of aws_instance.web' }).click();
    await expect(page.getByTestId('inspector-address')).toHaveText('aws_instance.web');
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('deployed-section')).toContainText('update');
    await page.getByTestId('deployed-section').getByRole('button', { name: /In the plan/ }).click();
    await expect(page.getByTestId('deploy-panel').locator('[data-change="aws_instance.web"] [data-diff-row="instance_type"]')).toBeVisible();
  });
});
