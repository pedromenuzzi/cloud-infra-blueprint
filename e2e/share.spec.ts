import { expect, test } from '@playwright/test';
import { encodeShare } from '../src/lib/share';
import { canvasStats, storedProjects, waitForMonaco } from './helpers';

test('a share link imports the project as a local copy', async ({ page }) => {
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

  await page.goto(`/#share=${encodeShare({ name: 'shared-from-e2e', files })}`);

  await expect(page).toHaveURL(/\/editor\//);
  await expect(page).not.toHaveURL(/#share=/);
  await waitForMonaco(page);
  await expect(canvasStats(page)).toHaveText(/^2 resources/);
  await expect
    .poll(async () => (await storedProjects(page)).map((p) => p.name))
    .toContain('shared-from-e2e');
});
