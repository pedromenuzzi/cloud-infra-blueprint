/**
 * Module calls: a zip with a local module imports with it (a module node on
 * the canvas, its files in the code pane), the module opens read-only and
 * Esc comes back; "Add module…" writes a Registry module in one undo step;
 * rename rewrites references and records a `moved` block; deleting a module
 * other blocks read asks first; the module inspector, the dialog and the
 * opened module speak Portuguese and pass axe in both themes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, openSeedProject, SEED_PROJECT, storedProject } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const ROOT = `module "network" {
  source = "./modules/network"
  cidr   = "10.20.0.0/16"
  name   = "prod"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"

  name = "shared"
  cidr = "10.0.0.0/16"
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
  subnet_id     = module.network.private_subnet_ids[0]
}

resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = module.vpc.vpc_id
}

output "vpc_id" {
  value = module.network.vpc_id
}
`;

const NETWORK = {
  'main.tf': `resource "aws_vpc" "this" {
  cidr_block = var.cidr
  tags       = { Name = var.name }
}

resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.this.id
  cidr_block = cidrsubnet(var.cidr, 8, 1)
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}
`,
  'variables.tf': `variable "cidr" {
  type        = string
  description = "The VPC's address range"
}

variable "name" {
  type = string
}

variable "az_count" {
  type    = number
  default = 2
}
`,
  'outputs.tf': `output "vpc_id" {
  value = aws_vpc.this.id
}

output "private_subnet_ids" {
  value = [aws_subnet.private.id]
}
`,
};

function stackZip(): Buffer {
  return Buffer.from(
    zipSync({
      'stack/main.tf': strToU8(ROOT),
      ...Object.fromEntries(Object.entries(NETWORK).map(([f, t]) => [`stack/modules/network/${f}`, strToU8(t)])),
      'stack/modules/unused/main.tf': strToU8('resource "aws_s3_bucket" "x" {}\n'),
    }),
  );
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function importStack(page: Page, { locale = 'en', theme = 'light' }: { locale?: 'en' | 'pt-BR'; theme?: 'light' | 'dark' } = {}) {
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
    { name: 'stack.zip', mimeType: 'application/zip', buffer: stackZip() },
  ]);
  await expect(page).toHaveURL(/\/editor\//);
  await expect(node(page, 'module.network')).toBeVisible();
}

/** select a node as a click on it does — wherever the canvas has scrolled it */
async function select(page: Page, id: string) {
  await node(page, id).dispatchEvent('click');
  await expect(page.getByTestId('inspector-address')).toHaveText(id);
}

async function mainTf(page: Page): Promise<string> {
  const project = await storedProject(page, 'stack');
  return project?.files['main.tf'] ?? '';
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

test('a zip with a local module: a module node, its files, open it read-only and come back', async ({ page }) => {
  await importStack(page);
  await expect(page.getByText('Imported the root module (stack/) and kept its child module; 1 other file was left out.')).toBeVisible();
  await expect(canvasStats(page)).toHaveText('2 resources, 2 connections, 2 modules');
  await expect(node(page, 'module.network')).toContainText('./modules/network');
  await expect(node(page, 'module.network')).toContainText('2 inputs');
  await expect(node(page, 'module.vpc')).toContainText('terraform-aws-modules/vpc');
  await expect(node(page, 'module.vpc')).toContainText('v5.0.0');
  // the child module's files are project files, set apart in the code pane; its resources aren't root resources
  const tabs = page.getByRole('tablist', { name: 'Files' });
  await expect(tabs.getByRole('tab')).toHaveText(['main.tf', 'modules/network/main.tf', 'modules/network/outputs.tf', 'modules/network/variables.tf']);
  await expect(node(page, 'aws_vpc.this')).toHaveCount(0);

  await select(page, 'module.network');
  await node(page, 'module.network').dblclick();
  const view = page.getByRole('region', { name: 'Module network (read-only)' });
  await expect(view).toBeVisible();
  await expect(view.getByRole('navigation', { name: 'Module path' })).toHaveText(/root.*network/);
  for (const id of ['aws_vpc.this', 'aws_subnet.private', 'aws_internet_gateway.this']) {
    await expect(view.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
  }
  await expect(view.getByText('3 resources')).toBeVisible();
  // its interface: required and optional inputs, outputs
  await expect(view.getByText('cidr', { exact: true })).toBeVisible();
  await expect(view.getByText('optional')).toBeVisible();
  // read-only: nothing inside moves
  await expect(view.locator('.react-flow__node.draggable')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  // back where it was: the module call selected again
  await expect(page.getByTestId('inspector-address')).toHaveText('module.network');
});

test('the module inspector: source, inputs, outputs read elsewhere, what is inside; a required input left out warns', async ({ page }) => {
  await importStack(page);
  await select(page, 'module.network');
  const inspector = page.getByRole('complementary', { name: 'Module inspector' });
  await expect(inspector.getByLabel('Source')).toHaveValue('./modules/network');
  await expect(inspector).toContainText('Folder: modules/network · 3 files');
  await expect(inspector).toContainText('Resources inside (3)');
  await expect(inspector).toContainText('private_subnet_ids');
  await expect(inspector).toContainText('read by aws_instance.web');

  await inspector.getByRole('button', { name: 'Remove input name' }).click();
  await expect(inspector).toContainText('Required, not passed (1)');
  await expect(inspector).toContainText('required input "name" is missing');
  await expect(node(page, 'module.network').getByTitle('Has warnings — see the inspector')).toBeVisible();
  await expect.poll(() => mainTf(page)).not.toContain('name   = "prod"');

  // added back from the list, then edited in place: one line each
  await inspector.getByRole('button', { name: 'Add input name' }).click();
  await inspector.getByLabel('name', { exact: true }).fill('staging');
  await inspector.getByLabel('name', { exact: true }).press('Enter');
  await expect.poll(() => mainTf(page)).toContain('name   = "staging"');

  // a Registry module links to its page
  await select(page, 'module.vpc');
  await expect(page.getByRole('link', { name: 'Registry page' })).toHaveAttribute(
    'href',
    'https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/5.0.0',
  );
});

test('rename rewrites module.old references and records a moved block', async ({ page }) => {
  await importStack(page);
  await select(page, 'module.network');
  const name = page.locator('#inspector-tf-name');
  await name.fill('core');
  await name.press('Enter');
  await expect(node(page, 'module.core')).toBeVisible();
  await expect(page.getByTestId('inspector-address')).toHaveText('module.core');
  await expect.poll(() => mainTf(page)).toContain('subnet_id     = module.core.private_subnet_ids[0]');
  const text = await mainTf(page);
  expect(text).toContain('module "core" {');
  expect(text).toContain('value = module.core.vpc_id');
  expect(text).toContain('moved {\n  from = module.network\n  to   = module.core\n}');
  expect(text).not.toContain('module.network.');
});

test('deleting a module other blocks read asks first, then deletes it in one undo step', async ({ page }) => {
  await importStack(page);
  await select(page, 'module.network');
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('alertdialog', { name: 'Delete module.network?' });
  await expect(confirm).toContainText('Still read by aws_instance.web and output.vpc_id.');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(node(page, 'module.network')).toHaveCount(0);
  // the references stay, flagged
  await expect.poll(() => mainTf(page)).not.toContain('module "network"');
  expect(await mainTf(page)).toContain('module.network.private_subnet_ids[0]');
  await expect(page.getByTitle('Show warnings')).toHaveText('2');

  await page.keyboard.press('Control+z');
  await expect(node(page, 'module.network')).toBeVisible();
  await expect.poll(() => mainTf(page)).toBe(ROOT);
});

test('a drag moves a module (its position comment), nothing else', async ({ page }) => {
  await importStack(page);
  const box = (await node(page, 'module.vpc').boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 190, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => mainTf(page)).toMatch(/# @blueprint:pos=-?\d+,-?\d+\nmodule "vpc" \{/);
  const text = await mainTf(page);
  expect(text.replace(/# @blueprint:pos=-?\d+,-?\d+\n/, '')).toBe(ROOT);
});

test('Add module… writes a Registry module wired to the network, in one undo step', async ({ page }) => {
  await openSeedProject(page);
  const before = (await storedProject(page, SEED_PROJECT))!.files['main.tf'];
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox').fill('add module');
  await page.getByRole('option', { name: /Add module…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add module' });
  await expect(dialog).toBeVisible();
  await dialog.getByText('EKS cluster').click();
  await expect(dialog.getByLabel('Name')).toHaveValue('eks');
  await expect(dialog).toContainText('Wired to the network already in the project.');
  await dialog.getByRole('button', { name: 'Add module' }).click();
  await expect(dialog).toBeHidden();
  await expect(node(page, 'module.eks')).toBeVisible();
  await expect(page.getByTestId('inspector-address')).toHaveText('module.eks');
  await expect
    .poll(async () => (await storedProject(page, SEED_PROJECT))!.files['main.tf'])
    .toContain('module "eks" {\n  source  = "terraform-aws-modules/eks/aws"\n  version = "~> 20.0"\n');
  expect((await storedProject(page, SEED_PROJECT))!.files['main.tf']).toMatch(/vpc_id\s+= aws_vpc\.\w+\.id/);

  await page.keyboard.press('Control+z');
  await expect(node(page, 'module.eks')).toHaveCount(0);
  await expect.poll(async () => (await storedProject(page, SEED_PROJECT))!.files['main.tf']).toBe(before);
});

test('in Portuguese: the import note, the inspector, the opened module and the dialog', async ({ page }) => {
  await importStack(page, { locale: 'pt-BR' });
  await expect(page.getByText('Módulo raiz importado (stack/) com seu módulo filho; 1 outro arquivo ficou de fora.')).toBeVisible();
  await expect(node(page, 'module.network')).toContainText('Módulo');
  await expect(node(page, 'module.network')).toContainText('2 entradas');
  await select(page, 'module.network');
  const inspector = page.getByRole('complementary', { name: 'Inspetor do módulo' });
  await expect(inspector).toContainText('Recursos dentro dele (3)');
  await inspector.getByRole('button', { name: 'Abrir módulo' }).first().click();
  const view = page.getByRole('region', { name: 'Módulo network (somente leitura)' });
  await expect(view.getByRole('navigation', { name: 'Caminho do módulo' })).toHaveText(/raiz.*network/);
  await expect(view).toContainText('obrigatória');
  await view.getByRole('button', { name: 'Voltar' }).click();
  await expect(view).toBeHidden();

  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Paleta de comandos' }).getByRole('combobox').fill('adicionar módulo');
  await page.getByRole('option', { name: /Adicionar módulo…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar módulo' });
  await expect(dialog).toContainText('Cluster EKS');
  await expect(dialog).toContainText('Origem personalizada');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe (${theme}): module node, inspector, opened module, Add module dialog`, async ({ page }) => {
    await importStack(page, { theme });
    await select(page, 'module.network');
    expect(await audit(page), 'module inspector').toEqual([]);
    await page.getByRole('complementary', { name: 'Module inspector' }).getByRole('button', { name: 'Open module' }).first().click();
    await expect(page.getByTestId('module-view')).toBeVisible();
    expect(await audit(page), 'opened module').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox').fill('add module');
    await page.getByRole('option', { name: /Add module…/ }).click();
    await expect(page.getByRole('dialog', { name: 'Add module' })).toBeVisible();
    expect(await audit(page), 'Add module dialog').toEqual([]);
  });
}
