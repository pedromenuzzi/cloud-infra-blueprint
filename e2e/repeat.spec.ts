/**
 * Resources with `count` / `for_each`: drawn as a stack with a badge, the
 * inspector's Repeat section (count, keys, moved block, one undo step), and
 * renames that keep the state with a `moved {}` block — in English and
 * Portuguese, with axe in both themes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, storedProject } from './helpers';

const NAME = 'repeat-demo';

const REPEAT_TF = `provider "aws" {
  region = "us-east-1"
}

variable "azs" {
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = var.azs[count.index]
}

resource "aws_instance" "app" {
  count         = 3
  ami           = "ami-0abc"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.private[count.index].id
}

resource "aws_instance" "bastion" {
  count         = var.enable_bastion ? 1 : 0
  ami           = "ami-0abc"
  instance_type = "t3.nano"
  subnet_id     = aws_subnet.private[0].id
}

resource "aws_s3_bucket" "logs" {
  for_each = toset(["raw", "clean"])
  bucket   = "logs-\${each.key}"
}

resource "aws_sqs_queue" "jobs" {
  for_each = var.queues
  name     = each.key
}

resource "aws_instance" "web" {
  ami           = "ami-0abc"
  instance_type = "t3.micro"
}

output "web_ip" {
  value = aws_instance.web.public_ip
}
`;

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: /^(Inspector|Inspetor)$/ });
const repeat = (page: Page) => page.getByTestId('repeat-section');
const mainTf = async (page: Page) => (await storedProject(page, NAME))?.files['main.tf'] ?? '';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function seriousAxeViolations(page: Page, within: string) {
  // the section's entry animations must end before colors are measured
  await page.waitForTimeout(500);
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

async function openRepeatProject(page: Page, { locale = 'en', theme = 'light' }: { locale?: string; theme?: string } = {}) {
  const now = new Date().toISOString();
  const project = { id: 'prj_repeat', name: NAME, files: { 'main.tf': REPEAT_TF }, providers: ['aws'], createdAt: now, updatedAt: now };
  await page.addInitScript(
    ({ p, l, t }) => {
      localStorage.setItem('cb-locale', l);
      localStorage.setItem('cb-theme', t);
      if (sessionStorage.getItem('cb-e2e-seeded')) return;
      sessionStorage.setItem('cb-e2e-seeded', '1');
      localStorage.setItem('cb-tips-dismissed', '1');
      localStorage.setItem('cb-seeded-v1', '1');
      localStorage.setItem('cb-projects-v1', JSON.stringify([p]));
    },
    { p: project, l: locale, t: theme },
  );
  await page.goto('/dashboard');
  await page.getByRole('button', { name: new RegExp(`^(Open project|Abrir projeto) ${NAME}`) }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(node(page, 'aws_instance.web')).toBeVisible();
}

async function select(page: Page, id: string) {
  await node(page, id).click();
  await expect(inspector(page).getByTestId('inspector-address')).toHaveText(id);
}

test.describe('repeated resources', () => {
  test('are one node each, drawn as a stack with a badge and an accessible count', async ({ page }) => {
    await openRepeatProject(page);
    // blocks, not instances
    await expect(canvasStats(page)).toHaveText(/^7 resources/);
    const badge = (id: string) => node(page, id).getByTestId('repeat-badge');
    await expect(badge('aws_instance.app')).toHaveText('×3');
    await expect(badge('aws_subnet.private')).toHaveText('×3');
    await expect(badge('aws_s3_bucket.logs')).toHaveText('×2');
    await expect(badge('aws_instance.bastion')).toHaveText('×0–1');
    await expect(badge('aws_sqs_queue.jobs')).toHaveText('for_each: var.queues');
    await expect(badge('aws_instance.web')).toHaveCount(0);
    await expect(badge('aws_s3_bucket.logs')).toHaveAttribute('title', /Keys: raw, clean/);
    await expect(node(page, 'aws_instance.app')).toHaveAttribute('aria-label', /3 instances$/);
    await expect(node(page, 'aws_instance.bastion')).toHaveAttribute('aria-label', /optional$/);
    // containment through indexed references
    await expect(node(page, 'aws_subnet.private').locator('..')).toBeVisible();
    const app = await node(page, 'aws_instance.app').boundingBox();
    const subnet = await node(page, 'aws_subnet.private').boundingBox();
    expect(app!.x).toBeGreaterThan(subnet!.x);
    expect(app!.y).toBeGreaterThan(subnet!.y);
  });

  test('the Repeat section adds count with a moved block — one undo step', async ({ page }) => {
    await openRepeatProject(page);
    await select(page, 'aws_instance.web');
    const section = repeat(page);
    await expect(section.getByRole('radio', { name: 'One' })).toBeChecked();
    await section.getByRole('radio', { name: 'count' }).check();
    await section.getByLabel('How many').fill('2');
    // a design that was never applied doesn't keep the state by default
    const keep = inspector(page).getByTestId('keep-state');
    await expect(keep).not.toBeChecked();
    await expect(section.getByTestId('no-moved')).toContainText('No moved block');
    await keep.check();
    await expect(section.getByTestId('moved-preview')).toContainText(/from = aws_instance\.web\s+to\s+= aws_instance\.web\[0\]/, { useInnerText: true });
    await expect(section).toContainText('aws_instance.web.id → aws_instance.web[0].id');
    await section.getByRole('button', { name: 'Apply' }).click();

    await expect(node(page, 'aws_instance.web').getByTestId('repeat-badge')).toHaveText('×2');
    await expect.poll(() => mainTf(page)).toContain('resource "aws_instance" "web" {\n  count = 2\n\n  ami');
    const tf = await mainTf(page);
    expect(tf).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.web[0]\n}');
    expect(tf).toContain('value = aws_instance.web[0].public_ip');

    await page.keyboard.press('Control+z');
    await expect.poll(() => mainTf(page)).toBe(REPEAT_TF);
    await expect(node(page, 'aws_instance.web').getByTestId('repeat-badge')).toHaveCount(0);
  });

  test('for_each asks which key the existing instance takes; removing asks which instance stays', async ({ page }) => {
    await openRepeatProject(page);
    await select(page, 'aws_instance.web');
    const section = repeat(page);
    await section.getByRole('radio', { name: 'for_each' }).check();
    for (const key of ['blue', 'green']) {
      await section.getByRole('textbox', { name: 'Keys' }).fill(key);
      await section.getByRole('button', { name: 'Add key' }).click();
    }
    await inspector(page).getByTestId('keep-state').check();
    await section.getByLabel('The existing instance becomes').selectOption('green');
    await expect(section.getByTestId('moved-preview')).toContainText(/from = aws_instance\.web\s+to\s+= aws_instance\.web\["green"\]/, { useInnerText: true });
    await section.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => mainTf(page)).toContain('for_each = toset(["blue", "green"])');
    expect(await mainTf(page)).toContain('to   = aws_instance.web["green"]');
    await expect(node(page, 'aws_instance.web').getByTestId('repeat-badge')).toHaveText('×2');

    // and back: the block this session wrote collapses away
    await section.getByRole('radio', { name: 'One' }).check();
    await expect(section.getByLabel('Keep instance')).toHaveValue('green');
    await section.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => mainTf(page)).toBe(REPEAT_TF);
  });

  test('renaming writes a moved block (F2), undo takes it back, renaming back removes it', async ({ page }) => {
    await openRepeatProject(page);
    await select(page, 'aws_instance.web');
    await inspector(page).getByTestId('keep-state').check();
    await page.keyboard.press('Escape');
    await select(page, 'aws_instance.web');
    await page.keyboard.press('F2');
    const name = inspector(page).locator('#inspector-tf-name');
    await expect(name).toBeFocused();
    await name.fill('api');
    await name.press('Enter');
    await expect(inspector(page).getByTestId('inspector-address')).toHaveText('aws_instance.api');
    await expect.poll(() => mainTf(page)).toContain('moved {\n  from = aws_instance.web\n  to   = aws_instance.api\n}');
    expect(await mainTf(page)).toContain('value = aws_instance.api.public_ip');

    await page.keyboard.press('Control+z');
    await expect.poll(() => mainTf(page)).toBe(REPEAT_TF);
    await page.keyboard.press('Control+y');
    await expect.poll(() => mainTf(page)).toContain('to   = aws_instance.api');

    await select(page, 'aws_instance.api');
    await name.fill('web');
    await name.press('Enter');
    await expect.poll(() => mainTf(page)).toBe(REPEAT_TF);
  });

  test('in Portuguese', async ({ page }) => {
    await openRepeatProject(page, { locale: 'pt-BR' });
    await expect(node(page, 'aws_instance.app')).toHaveAttribute('aria-label', /3 instâncias$/);
    await select(page, 'aws_instance.web');
    const section = repeat(page);
    await expect(section.getByRole('heading', { name: 'Repetição' })).toBeVisible();
    await section.getByRole('radio', { name: 'count' }).check();
    await expect(section.getByLabel('Quantas')).toHaveValue('2');
    await inspector(page).getByTestId('keep-state').check();
    await expect(inspector(page)).toContainText('Manter o estado (escrever um bloco moved)');
    await expect(section.getByTestId('moved-preview')).toContainText('Escreve um bloco moved:');
    await section.getByRole('button', { name: 'Aplicar' }).click();
    await expect(node(page, 'aws_instance.web').getByTestId('repeat-badge')).toHaveText('×2');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe, ${theme} theme: the Repeat section with a change pending, and a repeated node`, async ({ page }) => {
      await openRepeatProject(page, { theme });
      await select(page, 'aws_instance.app');
      await repeat(page).getByRole('radio', { name: 'One' }).check();
      await inspector(page).getByTestId('keep-state').check();
      await expect(repeat(page).getByTestId('moved-preview')).toBeVisible();
      expect(await seriousAxeViolations(page, 'aside[aria-label="Inspector"]')).toEqual([]);
      expect(await seriousAxeViolations(page, '.react-flow__node[data-id="aws_instance.app"]')).toEqual([]);
    });
  }
});
