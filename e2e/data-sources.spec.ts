/**
 * Data sources: an imported project's `data` blocks are nodes of their own
 * (a dashed lookup card, edges to what reads them), with an inspector (docs
 * link, arguments, readers, attributes); one is added from the palette and
 * from ⌘K; renaming one rewrites every reference and writes no `moved`
 * block; deleting one that is read asks first and keeps the references; a
 * resource argument offers the data source that usually fills it; Monaco
 * completes inside a data block; the screens speak Portuguese and pass axe
 * in both themes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, focusEndOfCode, insertCode, storedProject } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const MAIN = `data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [aws_vpc.main.id]
  }
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
}

output "ami" {
  value = data.aws_ami.ubuntu.id
}
`;

const zip = () => Buffer.from(zipSync({ 'lookups/main.tf': strToU8(MAIN) }));

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function importLookups(page: Page, { locale = 'en', theme = 'light' }: { locale?: 'en' | 'pt-BR'; theme?: 'light' | 'dark' } = {}) {
  await page.addInitScript(
    ([l, t]) => {
      localStorage.setItem('cb-locale', l);
      localStorage.setItem('cb-theme', t);
      localStorage.setItem('cb-tips-dismissed', '1');
    },
    [locale, theme],
  );
  await page.goto('/dashboard');
  await page.getByLabel(locale === 'en' ? 'Import Terraform files' : 'Importar arquivos Terraform').setInputFiles([
    { name: 'lookups.zip', mimeType: 'application/zip', buffer: zip() },
  ]);
  await expect(page).toHaveURL(/\/editor\//);
  await expect(node(page, 'data.aws_ami.ubuntu')).toBeVisible();
}

const inspectorOf = (page: Page) => page.getByRole('complementary', { name: 'Data source inspector' });

/** select a node as a click on it does, wherever the canvas has scrolled it */
async function select(page: Page, id: string) {
  await node(page, id).dispatchEvent('click');
  await expect(page.getByTestId('inspector-address')).toHaveText(id);
}

async function mainTf(page: Page): Promise<string> {
  return (await storedProject(page, 'lookups'))?.files['main.tf'] ?? '';
}

async function audit(page: Page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  await page.waitForTimeout(400);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await expect(page.locator('.bp-code-flash')).toHaveCount(0, { timeout: 4_000 });
  return page.evaluate(async () => {
    type Violation = { id: string; impact: string; nodes: Array<{ target: string[] }> };
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<{ violations: Violation[] }> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test('an imported project: data nodes, edges to their readers, and their inspector', async ({ page }) => {
  await importLookups(page);
  await expect(canvasStats(page)).toHaveText('2 resources, 2 connections, 3 data sources');
  const ami = node(page, 'data.aws_ami.ubuntu');
  await expect(ami).toHaveAccessibleName('Data source ubuntu, AMI, read by 2');
  await expect(ami.locator('code')).toHaveText('data');
  await expect(ami).toContainText('aws_ami');
  await expect(node(page, 'data.aws_availability_zones.available')).toContainText('not read');
  // readers point at the data source; a data source at what filters it
  await expect(page.locator('.react-flow__edge[data-id="aws_instance.web->data.aws_ami.ubuntu:ami"]')).toBeAttached();
  await expect(page.locator('.react-flow__edge[data-id="data.aws_subnets.private->aws_vpc.main:filter"]')).toBeAttached();

  await select(page, 'data.aws_ami.ubuntu');
  const inspector = inspectorOf(page);
  await expect(inspector.getByRole('heading', { name: 'AMI' })).toBeVisible();
  await expect(inspector.getByRole('link', { name: /Terraform docs/ })).toHaveAttribute(
    'href',
    'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami',
  );
  await expect(inspector.getByRole('heading', { name: 'Arguments (3)' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'aws_instance.web' })).toBeVisible();
  await expect(inspector.getByText('output.ami')).toBeVisible();
  // the attributes it exposes, from the provider's data sources (a lazy chunk)
  await expect(inspector.getByRole('button', { name: 'Copy data.aws_ami.ubuntu.image_id' })).toBeVisible({ timeout: 15_000 });

  // a literal argument edited in place: one line changes
  await inspector.getByLabel('most_recent', { exact: true }).selectOption('false');
  await expect.poll(() => mainTf(page)).toBe(MAIN.replace('most_recent = true', 'most_recent = false'));
});

test('add a data source from the palette and from ⌘K', async ({ page }) => {
  await importLookups(page);
  await page.getByRole('button', { name: 'Add data source Current Region (aws_region)' }).click();
  await expect(node(page, 'data.aws_region.current')).toBeVisible();
  await expect(page.getByTestId('inspector-address')).toHaveText('data.aws_region.current');
  await expect.poll(() => mainTf(page)).toContain('data "aws_region" "current" {}');

  await page.keyboard.press('Control+k');
  await page.locator('[cmdk-item][data-value="add-data-source"]').click();
  await page.locator('[cmdk-input]').fill('partition');
  await page.locator('[cmdk-item][data-value="data aws_partition"]').click();
  await expect(node(page, 'data.aws_partition.current')).toBeVisible();
  await expect.poll(() => mainTf(page)).toContain('data "aws_partition" "current" {}');
  await expect(canvasStats(page)).toHaveText('2 resources, 2 connections, 5 data sources');
});

test('rename rewrites every reference, with no moved block; deleting one that is read asks first', async ({ page }) => {
  await importLookups(page);
  await select(page, 'data.aws_ami.ubuntu');
  const name = inspectorOf(page).getByLabel('Terraform name');
  await name.fill('noble');
  await name.press('Enter');
  await expect(page.getByTestId('inspector-address')).toHaveText('data.aws_ami.noble');
  await expect
    .poll(() => mainTf(page))
    .toBe(MAIN.replace('"aws_ami" "ubuntu"', '"aws_ami" "noble"').replaceAll('data.aws_ami.ubuntu.id', 'data.aws_ami.noble.id'));
  expect(await mainTf(page)).not.toContain('moved');

  await select(page, 'data.aws_ami.noble');
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('alertdialog', { name: 'Delete data.aws_ami.noble?' });
  await expect(confirm).toContainText('Still read by aws_instance.web and output.ami.');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(node(page, 'data.aws_ami.noble')).toHaveCount(0);
  await expect.poll(() => mainTf(page)).not.toContain('data "aws_ami"');
  expect(await mainTf(page)).toContain('ami           = data.aws_ami.noble.id');
  // the references left behind show as warnings
  await expect(page.getByTitle('Show warnings')).toHaveText('2');

  // a data source nothing reads goes at once
  await select(page, 'data.aws_availability_zones.available');
  await page.keyboard.press('Delete');
  await expect(node(page, 'data.aws_availability_zones.available')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('a resource argument offers the data source that usually fills it', async ({ page }) => {
  await importLookups(page);
  await select(page, 'aws_instance.web');
  // the AMI argument already reads it: nothing to offer there
  await expect(page.getByRole('button', { name: 'Use data.aws_ami.ubuntu.id' })).toHaveCount(0);
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_subnet" "a" { vpc_id = aws_vpc.main.id }');
  await expect(node(page, 'aws_subnet.a')).toBeVisible();
  await select(page, 'aws_subnet.a');
  const chip = page.getByRole('button', { name: 'Use data.aws_availability_zones.available.names[0]' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect.poll(() => mainTf(page)).toContain('availability_zone = data.aws_availability_zones.available.names[0]');
  await expect(node(page, 'data.aws_availability_zones.available')).toContainText('read by 1');
});

test('Monaco completes arguments inside a data block and what a data source exposes', async ({ page }) => {
  await importLookups(page);
  await expect(page.locator('[data-testid="monaco"] .monaco-editor')).toBeVisible({ timeout: 15_000 });
  await focusEndOfCode(page);
  await insertCode(page, 'data "aws_ami" "x" {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('name_re');
  const suggest = page.locator('.suggest-widget.visible');
  await expect(suggest.getByText('name_regex', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('owners = [data.aws_ami.ubuntu.own');
  await expect(suggest.getByText('owner_id', { exact: true })).toBeVisible();
});

test('in Portuguese', async ({ page }) => {
  await importLookups(page, { locale: 'pt-BR' });
  await expect(page.getByTestId('canvas').getByText('2 recursos, 2 conexões, 3 fontes de dados')).toBeVisible();
  await expect(node(page, 'data.aws_ami.ubuntu')).toHaveAccessibleName('Fonte de dados ubuntu, AMI, lida por 2');
  await expect(node(page, 'data.aws_availability_zones.available')).toContainText('não lida');
  await node(page, 'data.aws_ami.ubuntu').dispatchEvent('click');
  const inspector = page.getByRole('complementary', { name: 'Inspetor da fonte de dados' });
  await expect(inspector.getByRole('heading', { name: 'Argumentos (3)' })).toBeVisible();
  await expect(inspector.getByRole('heading', { name: 'Lida por' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Excluir fonte de dados' })).toBeVisible();
  await expect(page.locator('[data-rove="cat:data"]')).toContainText('Fontes de dados');
  await expect(page.getByRole('button', { name: 'Adicionar fonte de dados AMI Ubuntu (aws_ami)' })).toBeAttached();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.locator('[cmdk-item][data-value="add-data-source"]').click();
  await expect(page.locator('[cmdk-item][data-value="data aws_ami.ubuntu"]')).toContainText('AMI Ubuntu');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe (${theme}): data nodes, the data source inspector, the palette section and ⌘K`, async ({ page }) => {
    await importLookups(page, { theme });
    expect(await audit(page), 'canvas with data nodes').toEqual([]);
    await select(page, 'data.aws_ami.ubuntu');
    await expect(inspectorOf(page).getByRole('button', { name: 'Copy data.aws_ami.ubuntu.image_id' })).toBeVisible({ timeout: 15_000 });
    expect(await audit(page), 'data source inspector').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.locator('[cmdk-item][data-value="add-data-source"]').click();
    await expect(page.locator('[cmdk-item][data-value="data aws_ami.ubuntu"]')).toBeVisible();
    expect(await audit(page), '⌘K data sources').toEqual([]);
  });
}
