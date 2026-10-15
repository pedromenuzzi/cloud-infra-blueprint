import { strToU8, zipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { encodeShare } from '../src/lib/share';
import { canvasStats, storedProject, storedProjects, waitForMonaco } from './helpers';

const files = {
  'main.tf': [
    'resource "aws_vpc" "shared" {',
    '  cidr_block = "10.9.0.0/16"',
    '}',
    '',
    'resource "aws_subnet" "a" {',
    '  vpc_id     = aws_vpc.shared.id',
    '  cidr_block = "10.9.1.0/24"',
    '}',
    '',
  ].join('\n'),
};
const link = `/#share=${encodeShare({ name: 'shared-from-e2e', files })}`;

test('a share link asks, then imports the project as a local copy', async ({ page }) => {
  await page.goto(link);

  const dialog = page.getByRole('dialog', { name: /Import a copy of shared-from-e2e/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('terraform apply');
  await expect(page).not.toHaveURL(/#share=/);
  await dialog.getByRole('button', { name: 'Import copy' }).click();

  await expect(page).toHaveURL(/\/editor\//);
  await waitForMonaco(page);
  await expect(canvasStats(page)).toHaveText(/^2 resources/);
  await expect
    .poll(async () => (await storedProjects(page)).map((p) => p.name))
    .toContain('shared-from-e2e');
});

test('opening the same link again offers the existing copy instead of a duplicate', async ({ page }) => {
  await page.goto(link);
  await page.getByRole('button', { name: 'Import copy' }).click();
  await expect(page).toHaveURL(/\/editor\//);
  const firstUrl = page.url();

  await page.goto(link);
  const dialog = page.getByRole('dialog', { name: /Import a copy/ });
  await expect(dialog).toContainText('You already imported this link');
  await dialog.getByRole('button', { name: 'Open existing copy' }).click();
  await expect(page).toHaveURL(firstUrl);
  expect((await storedProjects(page)).filter((p) => p.name.startsWith('shared-from-e2e'))).toHaveLength(1);
});

test('a link pasted into a tab that is already open is picked up', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((hash) => {
    location.hash = hash;
  }, link.slice(2));
  await expect(page.getByRole('dialog', { name: /Import a copy of shared-from-e2e/ })).toBeVisible();
});

test('a project imported from a subfolder keeps its root folder through a share link', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void w.__copied.push(t) } });
    localStorage.setItem('cb-tips-dismissed', '1');
  });
  await page.goto('/dashboard');
  await page.getByLabel('Import Terraform files').setInputFiles([
    {
      name: 'shop.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(
        zipSync({
          'shop/envs/prod/main.tf': strToU8('module "net" {\n  source = "../../modules/net"\n}\n'),
          'shop/modules/net/main.tf': strToU8('resource "aws_vpc" "this" {\n  cidr_block = "10.0.0.0/16"\n}\n'),
        }),
      ),
    },
  ]);
  await expect(page).toHaveURL(/\/editor\//);
  await expect.poll(async () => (await storedProject(page, 'shop'))?.rootPath).toBe('shop/envs/prod');
  await page.locator('header').first().getByRole('button', { name: 'Share' }).click();
  await expect(page.getByText(/^Share link copied/)).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0]!);

  // opened elsewhere: the copy keeps it, so its Terraform zip lays the folders out the same
  await page.evaluate(() => localStorage.removeItem('cb-projects-v1'));
  await page.goto(copied);
  await page.getByRole('dialog', { name: /Import a copy of shop/ }).getByRole('button', { name: 'Import copy' }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect
    .poll(async () => (await storedProjects(page)).filter((p) => p.name.startsWith('shop')).map((p) => [p.name, p.rootPath]))
    .toEqual([['shop', 'shop/envs/prod']]);
});

test('a damaged link says so and is cleared from the URL', async ({ page }) => {
  await page.goto(`/#share=${encodeShare({ name: 'x', files }).slice(0, 40)}`);
  await expect(page.getByText('This share link is damaged or incomplete')).toBeVisible();
  await expect(page).not.toHaveURL(/#share=/);
  await expect(page.getByRole('dialog')).toBeHidden();
});
