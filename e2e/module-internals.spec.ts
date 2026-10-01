/**
 * Inside local modules: an opened module is edited on the canvas like the
 * root (inspector, rename with a module-relative `moved` block, delete,
 * duplicate), patched into its own files with one undo history for the
 * whole project; the cost estimate and the security audit read what each
 * call holds; completion knows a module's outputs and variables; the
 * Terraform zip keeps the original nesting and imports back; the GitHub
 * dialog counts child-module files. In Portuguese too, and axe-clean in
 * both themes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, storedProject } from './helpers';
import { mockGithub } from './githubMock';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const ROOT = `provider "aws" {
  region = "us-east-1"
}

module "network" {
  source = "../../modules/network"
  cidr   = "10.20.0.0/16"
}

module "edge" {
  source = "../../modules/edge"
  cidr   = "0.0.0.0/0"
  count  = 2
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
  subnet_id     = module.network.private_subnet_id
}
`;

const NETWORK = {
  'main.tf': `# the shop's network
resource "aws_vpc" "this" {
  cidr_block = var.cidr
}

resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.this.id
  cidr_block = "10.20.1.0/24" # app tier
}
`,
  'variables.tf': `variable "cidr" {
  type        = string
  description = "The VPC's address range"
}
`,
  'outputs.tf': `output "private_subnet_id" {
  description = "The private subnet the app runs in"
  value       = aws_subnet.private.id
}

output "vpc_id" {
  value = aws_vpc.this.id
}
`,
};

const EDGE = {
  'main.tf': `resource "aws_security_group" "ssh" {
  name = "ssh"
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.cidr]
  }
}

resource "aws_instance" "bastion" {
  ami                    = "ami-0c55b159cbfafe1f0"
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.ssh.id]
}

variable "cidr" {}
`,
};

/** the project as the import stores it */
const PROJECT = {
  'main.tf': ROOT,
  ...Object.fromEntries(Object.entries(NETWORK).map(([f, t]) => [`modules/network/${f}`, t])),
  ...Object.fromEntries(Object.entries(EDGE).map(([f, t]) => [`modules/edge/${f}`, t])),
};

function shopZip(): Buffer {
  return Buffer.from(
    zipSync({
      'shop/envs/prod/main.tf': strToU8(ROOT),
      ...Object.fromEntries(Object.entries(NETWORK).map(([f, t]) => [`shop/modules/network/${f}`, strToU8(t)])),
      ...Object.fromEntries(Object.entries(EDGE).map(([f, t]) => [`shop/modules/edge/${f}`, strToU8(t)])),
    }),
  );
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const view = (page: Page) => page.getByTestId('module-view');

async function importShop(page: Page, { locale = 'en', theme = 'light' }: { locale?: 'en' | 'pt-BR'; theme?: 'light' | 'dark' } = {}) {
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
    { name: 'shop.zip', mimeType: 'application/zip', buffer: shopZip() },
  ]);
  await expect(page).toHaveURL(/\/editor\//);
  await expect(node(page, 'module.network')).toBeVisible();
}

async function files(page: Page): Promise<Record<string, string>> {
  return (await storedProject(page, 'shop'))?.files ?? {};
}

/** select a node as a click on it does, wherever the canvas has scrolled it */
async function select(page: Page, id: string) {
  await node(page, id).dispatchEvent('click');
  await expect(page.getByTestId('inspector-address')).toHaveText(id);
}

async function openModule(page: Page, id: string) {
  await node(page, id).dblclick({ position: { x: 16, y: 10 } });
  await expect(view(page)).toBeVisible();
}

async function audit(page: Page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  await page.waitForTimeout(400);
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

test('an opened module is edited on the canvas, in its own files, with one undo history', async ({ page }) => {
  await importShop(page);
  await openModule(page, 'module.network');
  await expect(view(page).getByRole('navigation', { name: 'Module path' })).toHaveText(/root.*network/);
  await expect(node(page, 'aws_subnet.private')).toBeVisible();
  await expect(node(page, 'aws_instance.web')).toHaveCount(0);

  // the inspector edits it: one line of the module's file, nothing else
  await select(page, 'aws_subnet.private');
  // the code pane follows: the module's file is the one shown
  await expect(page.getByRole('tab', { name: 'modules/network/main.tf' })).toHaveAttribute('aria-selected', 'true');
  const cidr = page.getByRole('textbox', { name: /^cidr_block/ });
  await cidr.fill('10.20.9.0/24');
  await cidr.press('Enter');
  await expect.poll(async () => (await files(page))['modules/network/main.tf']).toBe(NETWORK['main.tf'].replace('10.20.1.0/24', '10.20.9.0/24'));
  expect((await files(page))['main.tf']).toBe(ROOT);

  // the root module's edits and the module's share one history
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(view(page)).toBeHidden();
  await expect(page.getByTestId('inspector-address')).toHaveText('module.network');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await files(page))['modules/network/main.tf']).toBe(NETWORK['main.tf']);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await files(page))['modules/network/main.tf']).toContain('10.20.9.0/24');
});

test('renaming inside a module writes its moved block there, in module-relative addresses', async ({ page }) => {
  await importShop(page);
  await openModule(page, 'module.network');
  await select(page, 'aws_subnet.private');
  const keep = page.getByLabel('Keep the state (write a moved block)');
  await keep.check();
  const name = page.locator('#inspector-tf-name');
  await name.fill('app');
  await name.press('Enter');
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_subnet.app');
  await expect.poll(async () => (await files(page))['modules/network/main.tf']).toContain('resource "aws_subnet" "app" {');
  const after = await files(page);
  expect(after['modules/network/main.tf']).toContain('moved {\n  from = aws_subnet.private\n  to   = aws_subnet.app\n}');
  expect(after['modules/network/outputs.tf']).toContain('value       = aws_subnet.app.id');
  // comments stay; the root, which reads module.network.private_subnet_id, is untouched
  expect(after['modules/network/main.tf']).toContain('# the shop\'s network');
  expect(after['modules/network/main.tf']).toContain('# app tier');
  expect(after['main.tf']).toBe(ROOT);

  // delete inside the module: one undo step
  await page.keyboard.press('Delete');
  await expect(node(page, 'aws_subnet.app')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(node(page, 'aws_subnet.app')).toBeVisible();
});

test('the cost and the security of what the module calls hold', async ({ page }) => {
  await importShop(page);
  // the module call's inspector sums it up
  await select(page, 'module.edge');
  await expect(page.getByTestId('module-inside-summary')).toContainText(/\d+ findings?, ~\$[\d.]+\/mo inside/);

  // the cost popover groups the resources under each call, × its instances
  await page.getByTestId('cost-chip').click();
  const popover = page.getByTestId('cost-popover');
  await expect(popover.getByRole('region', { name: 'Inside local modules' })).toBeVisible();
  const edge = popover.locator('[data-module="module.edge"]');
  await expect(edge).toContainText('×2');
  await edge.getByRole('button', { name: /bastion/ }).click();
  // a click opens the module there, the resource selected
  await expect(view(page)).toBeVisible();
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_instance.bastion');
  await expect(page.getByTestId('cost-line-total')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(view(page)).toBeHidden();

  // the security panel reports what's inside, labelled with the module path
  await page.getByRole('button', { name: /Security grade/ }).first().click();
  const findings = page.getByTestId('module-findings');
  await expect(findings).toContainText('module.edge');
  const chip = findings.getByRole('button', { name: 'module.edge › aws_security_group.ssh' });
  await expect(chip).toHaveAttribute('title', 'Open the module at module.edge › aws_security_group.ssh');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(view(page)).toBeVisible();
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_security_group.ssh');
});

test('completion knows a local module’s outputs, and a module file’s variables', async ({ page }) => {
  await importShop(page);
  await expect(page.locator('[data-testid="monaco"] .monaco-editor')).toBeVisible({ timeout: 15_000 });
  // hovering a module output says what it is
  const hover = page.locator('.monaco-hover:not(.hidden)');
  // Monaco may still be laying the code out: hover again until its widget shows
  await expect(async () => {
    await page.mouse.move(0, 0);
    await page.locator('[data-testid="monaco"] .view-line span', { hasText: 'private_subnet_id' }).last().hover();
    await expect(hover).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 12_000 });
  await expect(hover).toContainText('The private subnet the app runs in');
  await expect(hover).toContainText('value = aws_subnet.private.id');
  await page.mouse.move(0, 0);
  await page.locator('[data-testid="monaco"] .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('output "subnet" {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('value = module.network.');
  const suggest = page.locator('.suggest-widget.visible');
  await expect(suggest.getByText('private_subnet_id', { exact: true })).toBeVisible();
  await expect(suggest.getByText('vpc_id', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // inside the module's own file: its variables
  await page.getByRole('tab', { name: 'modules/edge/main.tf' }).click();
  await page.locator('[data-testid="monaco"] .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('locals { x = [var.');
  await expect(suggest.getByText('cidr', { exact: true })).toBeVisible();
});

test('a module call duplicates with a unique name, in one undo step', async ({ page }) => {
  await importShop(page);
  await select(page, 'module.network');
  await page.keyboard.press('Control+d');
  await expect(node(page, 'module.network_copy')).toBeVisible();
  await expect(page.getByTestId('inspector-address')).toHaveText('module.network_copy');
  await expect.poll(async () => (await files(page))['main.tf']).toContain('module "network_copy" {');
  await page.keyboard.press('Control+z');
  await expect(node(page, 'module.network_copy')).toHaveCount(0);
  await expect.poll(async () => (await files(page))['main.tf']).toBe(ROOT);
});

test('the Terraform zip keeps the nesting, and imports back to the same project', async ({ page }) => {
  await importShop(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox').fill('export terraform');
  const download = page.waitForEvent('download');
  await page.getByRole('option', { name: /Export Terraform \(\.zip\)/ }).click();
  const zip = await (await download).path();
  const entries = unzipSync(new Uint8Array(readFileSync(zip)));
  expect(Object.keys(entries).sort()).toEqual([
    'README.md',
    'shop/envs/prod/main.tf',
    'shop/modules/edge/main.tf',
    'shop/modules/network/main.tf',
    'shop/modules/network/outputs.tf',
    'shop/modules/network/variables.tf',
  ]);
  expect(strFromU8(entries['README.md'])).toContain('cd shop/envs/prod\nterraform init');

  // imported again: the same files
  await page.goto('/dashboard');
  await page.getByLabel('Import Terraform files').setInputFiles([{ name: 'again.zip', mimeType: 'application/zip', buffer: Buffer.from(readFileSync(zip)) }]);
  await expect(page).toHaveURL(/\/editor\//);
  await expect(node(page, 'module.network')).toBeVisible();
  expect((await storedProject(page, 'again'))?.files).toEqual(PROJECT);
});

test('the GitHub dialog counts the child modules’ files it will download', async ({ page }) => {
  await mockGithub(page, {
    'acme/shop': {
      files: {
        'envs/prod/main.tf': ROOT,
        ...Object.fromEntries(Object.entries(NETWORK).map(([f, t]) => [`modules/network/${f}`, t])),
        ...Object.fromEntries(Object.entries(EDGE).map(([f, t]) => [`modules/edge/${f}`, t])),
      },
    },
  });
  await page.addInitScript(() => localStorage.setItem('cb-tips-dismissed', '1'));
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Import from GitHub…' }).click();
  const d = page.getByRole('dialog', { name: /Import from GitHub/ });
  await d.getByLabel('GitHub link or owner/repo').fill('acme/shop');
  await d.getByRole('button', { name: 'Find Terraform' }).click();
  await expect(d.getByText('Includes 4 files of the 2 child modules it calls.')).toBeVisible();
  await d.getByRole('button', { name: 'Import 5 files' }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(canvasStats(page)).toHaveText('1 resource, 1 connection, 2 modules');
});

test('in Portuguese: the opened module, the cost groups, the findings and the summary', async ({ page }) => {
  await importShop(page, { locale: 'pt-BR' });
  await select(page, 'module.edge');
  await expect(page.getByTestId('module-inside-summary')).toContainText(/achados?, ~US\$\s[\d.,]+\/mês dentro dele/);
  await page.getByTestId('cost-chip').click();
  await expect(page.getByTestId('cost-popover').getByRole('region', { name: 'Dentro de módulos locais' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Segurança, nota/ }).first().click();
  await expect(page.getByTestId('module-findings')).toContainText('Dentro de módulos locais');
  await page.getByRole('button', { name: 'Fechar painel de segurança' }).click();
  await openModule(page, 'module.edge');
  await expect(view(page).getByRole('navigation', { name: 'Caminho do módulo' })).toHaveText(/raiz.*edge/);
  await expect(view(page).getByRole('button', { name: '1 entrada, 0 outputs' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe (${theme}): an opened module with a resource selected, the cost popover, the security panel`, async ({ page }) => {
    await importShop(page, { theme });
    await select(page, 'module.edge');
    expect(await audit(page), 'module call inspector').toEqual([]);
    await openModule(page, 'module.edge');
    await select(page, 'aws_security_group.ssh');
    expect(await audit(page), 'opened module').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByTestId('cost-chip').click();
    await expect(page.getByTestId('cost-popover')).toBeVisible();
    expect(await audit(page), 'cost popover').toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Security grade/ }).first().click();
    await expect(page.getByTestId('module-findings')).toBeVisible();
    expect(await audit(page), 'security panel').toEqual([]);
  });
}
