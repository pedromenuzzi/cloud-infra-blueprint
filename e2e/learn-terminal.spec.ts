/**
 * The simulated Terraform terminal on a lesson page: init, plan (also by
 * Ctrl+Enter) drawn on the canvas, apply with its approval question, the
 * state it leaves. The lesson page (the player) mounts the terminal: until
 * it does, these skip themselves.
 */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cb-tips-dismissed', '1'));
  await page.goto('/learn/outputs');
  const panel = page.getByTestId('terminal-panel');
  await panel.waitFor({ timeout: 20_000 }).catch(() => undefined);
  test.skip((await panel.count()) === 0, 'enable once the lesson page mounts TerminalPanel');
});

test('runs init, plans on the canvas, applies after the approval and keeps the state', async ({ page }) => {
  const panel = page.getByTestId('terminal-panel');
  const log = panel.getByRole('log');
  const prompt = panel.getByRole('textbox');

  // before init, like the real CLI
  await panel.getByRole('button', { name: 'Run terraform plan' }).click();
  await expect(log.getByText('│ Error: Inconsistent dependency lock file')).toBeVisible();

  await panel.getByRole('button', { name: 'Run terraform init' }).click();
  await expect(log.getByText('Terraform has been successfully initialized!')).toBeVisible();

  // Ctrl+Enter plans from anywhere on the page; the plan shows on the canvas
  await page.keyboard.press('Control+Enter');
  await expect(log.getByText('Plan: 1 to add, 0 to change, 0 to destroy.')).toBeVisible();
  await expect(page.locator('.react-flow__node [data-plan-mark="create"]')).toBeVisible();

  // apply asks first; `yes` goes on
  await prompt.fill('tf apply');
  await prompt.press('Enter');
  await expect(panel.getByRole('button', { name: 'Approve' })).toBeVisible();
  await prompt.fill('yes');
  await prompt.press('Enter');
  await expect(log.getByText('Apply complete! Resources: 1 added, 0 changed, 0 destroyed.')).toBeVisible();
  await expect(page.locator('[data-plan-mark]')).toHaveCount(0);

  await panel.getByRole('tab', { name: /State/ }).click();
  await expect(panel.getByText('aws_s3_bucket.site', { exact: true })).toBeVisible();

  // nothing left to do
  await page.keyboard.press('Control+Enter');
  await expect(log.getByText('No changes. Your infrastructure matches the configuration.')).toBeVisible();
});

test('answers help, history and a mistyped command', async ({ page }) => {
  const panel = page.getByTestId('terminal-panel');
  const log = panel.getByRole('log');
  const prompt = panel.getByRole('textbox');
  await prompt.fill('plan');
  await prompt.press('Enter');
  await expect(log.getByText('zsh: command not found: plan')).toBeVisible();
  await expect(log.getByText('Did you mean terraform plan?')).toBeVisible();
  await prompt.fill('help');
  await prompt.press('Enter');
  await expect(log.getByText('Commands in this simulated terminal:')).toBeVisible();
  await prompt.press('ArrowUp');
  await expect(prompt).toHaveValue('help');
  await prompt.press('ArrowUp');
  await expect(prompt).toHaveValue('plan');
  await prompt.fill('clear');
  await prompt.press('Enter');
  await expect(log.getByText('Commands in this simulated terminal:')).toHaveCount(0);
});
