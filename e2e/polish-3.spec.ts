/**
 * Polish, round 3: the editor top bar on tablet and small laptop widths,
 * Aurora instances (aws_rds_cluster_instance) inside their cluster, the
 * "Subnets per AZ" template written with count, and the CIDR planner on
 * repeated subnets.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { TEMPLATES } from '../src/templates';
import { SEED_PROJECT } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

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

/** open a project built from this HCL, in `locale` (and `theme`) */
async function openProject(page: Page, name: string, text: string, { locale = 'en', theme }: { locale?: string; theme?: string } = {}) {
  const id = `prj_${name}`;
  await page.addInitScript(
    ({ id, name, text, locale, theme }) => {
      localStorage.setItem('cb-locale', locale);
      if (theme) localStorage.setItem('cb-theme', theme);
      if (localStorage.getItem('cb-projects-v1')) return;
      const now = new Date().toISOString();
      localStorage.setItem('cb-seeded-v1', '1');
      localStorage.setItem('cb-tips-dismissed', '1');
      localStorage.setItem(
        'cb-projects-v1',
        JSON.stringify([{ id, name, files: { 'main.tf': text }, providers: [], createdAt: now, updatedAt: now }]),
      );
    },
    { id, name, text, locale, theme },
  );
  await page.goto(`/editor/${id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

/** open the seeded project in `locale` (and `theme`), without waiting for Monaco */
async function openSeed(page: Page, { locale = 'en', theme }: { locale?: string; theme?: string } = {}) {
  await page.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem('cb-tips-dismissed', '1');
      localStorage.setItem('cb-locale', locale);
      if (theme) localStorage.setItem('cb-theme', theme);
    },
    { locale, theme },
  );
  await page.goto('/dashboard');
  await page.getByRole('button', { name: locale === 'en' ? `Open project ${SEED_PROJECT}` : `Abrir projeto ${SEED_PROJECT}` }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

/** what in the top bar sticks out of the viewport, is squeezed below its size, or leaves the name too narrow */
async function topbarProblems(page: Page): Promise<string[]> {
  return page.locator('header').first().evaluate((header) => {
    const vw = document.documentElement.clientWidth;
    const problems: string[] = [];
    if (header.scrollWidth > header.clientWidth + 1) problems.push(`header scrolls: ${header.scrollWidth} > ${header.clientWidth}`);
    const name = (el: Element) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? el.tagName;
    for (const el of header.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > vw + 0.5 || box.left < -0.5) problems.push(`${name(el)} outside: ${box.left.toFixed(0)}..${box.right.toFixed(0)} of ${vw}`);
    }
    // a flex item can also shrink below its size instead of overflowing: buttons keep theirs
    for (const el of header.querySelectorAll('button, a')) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.width < 26) problems.push(`${name(el)} squeezed to ${box.width.toFixed(0)} px`);
    }
    const input = header.querySelector('input');
    if (input && input.getBoundingClientRect().width < 96) problems.push(`project name only ${input.getBoundingClientRect().width.toFixed(0)} px`);
    return problems;
  });
}

test.describe('editor top bar from tablet to small laptop widths', () => {
  for (const locale of ['en', 'pt-BR']) {
    test(`${locale}: nothing overflows or gets squeezed at 640, 768, 900, 1024, 1100 and 1280 px`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 760 });
      await openSeed(page, { locale });
      for (const width of [640, 768, 900, 1024, 1100, 1280]) {
        await page.setViewportSize({ width, height: 760 });
        await expect.poll(() => topbarProblems(page), { message: `at ${width} px` }).toEqual([]);
      }
    });
  }

  test('below lg the view link moves into ⋯, below md the Layout menu does too; from lg up both are buttons', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void w.__copied.push(t) } });
    });
    await page.setViewportSize({ width: 768, height: 760 });
    await openSeed(page);
    const header = page.locator('header').first();
    await expect(header.getByRole('button', { name: 'Copy view link' })).toBeHidden();
    await expect(header.getByRole('button', { name: 'Layout', exact: true })).toBeVisible();
    await header.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu.getByRole('menuitem', { name: 'Layout…' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Copy view link (read-only)' }).click();
    await expect(page.getByText('View link copied')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0])).toMatch(/\/#view=/);

    await page.setViewportSize({ width: 700, height: 760 });
    await expect(header.getByRole('button', { name: 'Layout', exact: true })).toBeHidden();
    await header.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menu', { name: 'More actions' }).getByRole('menuitem', { name: 'Layout…' }).click();
    await expect(page.getByRole('dialog', { name: 'Layout' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1024, height: 760 });
    await expect(header.getByRole('button', { name: 'More actions' })).toBeHidden();
    await expect(header.getByRole('button', { name: 'Copy view link' })).toBeVisible();
    // icon-only buttons keep their name as a tooltip
    await expect(header.getByRole('button', { name: 'Share' })).toHaveAttribute('title', 'Share');
  });

  test('pt-BR below md: the save state is an icon with its word for screen readers and as a tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 760 });
    await openSeed(page, { locale: 'pt-BR' });
    const status = page.locator('header').first().getByRole('status').filter({ hasText: 'Salvo' });
    await expect(status).toHaveAttribute('title', 'Salvo');
    expect(await status.locator('span').evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [768, 1024]) {
      test(`axe, ${theme} theme, pt-BR, ${width} px: the top bar`, async ({ page }) => {
        await page.setViewportSize({ width, height: 760 });
        await openSeed(page, { locale: 'pt-BR', theme });
        expect(await seriousAxeViolations(page, 'header')).toEqual([]);
      });
    }
  }
});

/* ------------------------------------------------------------ Aurora instances */

const AURORA = `provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"
}

resource "aws_db_subnet_group" "db" {
  subnet_ids = [aws_subnet.a.id, aws_subnet.b.id]
}

resource "aws_rds_cluster" "orders" {
  cluster_identifier   = "orders"
  engine               = "aurora-postgresql"
  db_subnet_group_name = aws_db_subnet_group.db.name
  storage_encrypted    = true
}

resource "aws_rds_cluster_instance" "orders" {
  count              = 2
  identifier         = "orders-\${count.index}"
  cluster_identifier = aws_rds_cluster.orders.id
  instance_class     = "db.r6g.large"
  engine             = aws_rds_cluster.orders.engine
}
`;

test.describe('Aurora instances inside their cluster', () => {
  for (const [locale, theme] of [
    ['en', 'light'],
    ['pt-BR', 'dark'],
  ] as const) {
    test(`${locale}, ${theme}: two instances stack inside the cluster and the estimate prices them`, async ({ page }) => {
      const en = locale === 'en';
      await openProject(page, 'aurora', AURORA, { locale, theme });
      const instance = page.locator('.react-flow__node[data-id="aws_rds_cluster_instance.orders"]');
      const cluster = page.locator('.react-flow__node[data-id="aws_rds_cluster.orders"]');
      await expect(instance).toBeVisible();
      await expect(instance.locator('[data-type-label]')).toHaveText(en ? 'Aurora Instance' : 'Instância Aurora');
      await expect(instance).toHaveAttribute('aria-label', new RegExp(en ? 'in Aurora Cluster orders' : 'em Cluster Aurora orders'));
      // drawn inside the cluster, which is inside the DB subnet group
      const outer = (await cluster.boundingBox())!;
      const inner = (await instance.boundingBox())!;
      expect(inner.x).toBeGreaterThanOrEqual(outer.x);
      expect(inner.y).toBeGreaterThanOrEqual(outer.y);
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
      expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
      // 2 × 730 h × $0.26 (db.r6g.large, Aurora Standard, us-east-1)
      await expect(page.getByTestId('cost-chip')).toHaveText(en ? /^~\$380\/mo/ : /^~US\$\s?380\/mês/);
      expect(await seriousAxeViolations(page, '.react-flow__nodes')).toEqual([]);
    });
  }

  test('pt-BR: the palette adds an instance into the selected cluster, with its engine by reference', async ({ page }) => {
    await openProject(page, 'aurora-add', AURORA.replace(/resource "aws_rds_cluster_instance"[\s\S]*$/, ''), { locale: 'pt-BR' });
    await page.locator('.react-flow__node[data-id="aws_rds_cluster.orders"]').click({ position: { x: 40, y: 12 } });
    await page.getByRole('button', { name: /^Adicionar Instância Aurora/ }).click();
    const added = page.locator('.react-flow__node[data-id="aws_rds_cluster_instance.instance"]');
    await expect(added).toBeVisible();
    await expect(added).toHaveAttribute('aria-label', /em Cluster Aurora orders/);
    await expect
      .poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('cb-projects-v1') ?? '[]')))[0]?.files['main.tf'])
      .toMatch(/cluster_identifier\s*=\s*aws_rds_cluster\.orders\.id[\s\S]*engine\s*=\s*aws_rds_cluster\.orders\.engine/);
  });
});

/* ------------------------------------------------------------ template with count */

test.describe('template: subnets per AZ (count)', () => {
  for (const [locale, theme] of [
    ['en', 'light'],
    ['pt-BR', 'dark'],
  ] as const) {
    test(`${locale}, ${theme}: listed under Networking, it opens with each repeated block drawn once, as a stack of 3`, async ({ page }) => {
      const en = locale === 'en';
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem('cb-tips-dismissed', '1');
          localStorage.setItem('cb-locale', locale);
          localStorage.setItem('cb-theme', theme);
        },
        { locale, theme },
      );
      await page.goto('/dashboard');
      await page.getByRole('button', { name: en ? /^New Project/ : /^Novo projeto/ }).first().click();
      const dialog = page.getByRole('dialog', { name: en ? 'Start from a template' : 'Começar com um template' });
      await dialog.getByRole('button', { name: en ? 'Networking' : 'Redes', exact: true }).click();
      const title = en ? 'Subnets per AZ on AWS' : 'Sub-redes por AZ na AWS';
      const card = dialog.locator('div.group', { has: page.getByRole('heading', { name: title }) });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(en ? 'written with count and cidrsubnet' : 'escrita com count e cidrsubnet');
      await card.getByRole('button', { name: en ? 'Use template' : 'Usar template' }).click();
      await expect(page).toHaveURL(/\/editor\//);

      const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      await expect(node('aws_subnet.public')).toBeVisible();
      for (const id of ['aws_subnet.public', 'aws_subnet.private', 'aws_route_table_association.public', 'aws_route_table_association.private']) {
        await expect(node(id).getByTestId('repeat-badge'), id).toHaveText('×3');
      }
      // the NAT gateway sits in the first public subnet, the subnets in the VPC
      await expect(node('aws_nat_gateway.nat')).toHaveAttribute('aria-label', new RegExp(en ? ', in Subnet public' : ', em Sub-rede public'));
      await expect(node('aws_subnet.private')).toHaveAttribute('aria-label', new RegExp(en ? ', in VPC main' : ', em VPC main'));
      expect(await seriousAxeViolations(page, '.react-flow__nodes')).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------ CIDR planner on repeated subnets */

test.describe('CIDR planner on repeated subnets', () => {
  const files = TEMPLATES.find((t) => t.slug === 'aws-subnets-per-az')!.build('per-az');
  const hcl = Object.entries(files)
    .filter(([name]) => name !== 'versions.tf')
    .map(([, text]) => text)
    .join('\n');

  for (const [locale, theme] of [
    ['en', 'light'],
    ['pt-BR', 'dark'],
  ] as const) {
    test(`${locale}, ${theme}: lists every instance, adds after them, and a counted subnet shows its instances`, async ({ page }) => {
      const en = locale === 'en';
      await openProject(page, 'per-az', hcl, { locale, theme });
      const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      await node('aws_vpc.main').click({ position: { x: 300, y: 12 } });
      await expect(page.getByTestId('inspector-address')).toHaveText('aws_vpc.main');
      const card = page.getByTestId('cidr-planner');
      await expect(card).toContainText(en ? '6 subnets' : '6 sub-redes');
      await expect(card).toContainText(en ? '1,536 allocated' : '1.536 alocados');
      const list = card.getByRole('list', { name: en ? 'subnets' : 'sub-redes' });
      await expect(list.getByRole('listitem')).toHaveCount(6);
      await expect(list.getByRole('listitem').nth(0)).toContainText('public[0]');
      await expect(list.getByRole('listitem').nth(0)).toContainText('10.0.0.0/24 · us-east-1a');
      await expect(list.getByRole('listitem').nth(5)).toContainText('private[2]');
      await expect(list.getByRole('listitem').nth(5)).toContainText('10.0.12.0/24 · us-east-1c');
      expect(await seriousAxeViolations(page, '[data-testid="cidr-planner"]')).toEqual([]);

      // a new subnet goes after the instances, not over public[0]
      await card.getByRole('button', { name: en ? 'Add subnet' : 'Nova sub-rede' }).click();
      await expect(page.locator('[data-bp-live]').getByText(/aws_subnet\.subnet · 10\.0\.13\.0\/24/)).toBeVisible();
      await expect(card).toContainText(en ? '7 subnets' : '7 sub-redes');

      await page.keyboard.press('Escape');
      await node('aws_subnet.private').click({ position: { x: 200, y: 12 } });
      await expect(page.getByTestId('inspector-address')).toHaveText('aws_subnet.private');
      const subnetCard = page.getByTestId('cidr-planner');
      const instances = subnetCard.getByRole('list', { name: en ? '3 instances (count)' : '3 instâncias (count)' });
      await expect(instances.getByRole('listitem')).toHaveCount(3);
      await expect(instances.getByRole('listitem').nth(1)).toContainText('10.0.11.0/24 · us-east-1b');
      await expect(subnetCard).toContainText(en ? 'addresses each' : 'endereços cada');
      await expect(subnetCard).toContainText(en ? 'of VPC, all 3' : 'da VPC, as 3');
      expect(await seriousAxeViolations(page, '[data-testid="cidr-planner"]')).toEqual([]);
    });
  }
});
