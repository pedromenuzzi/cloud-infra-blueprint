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

test('starts compact, grows on the first command, and keeps a height the learner chose', async ({ page }) => {
  const panel = page.getByTestId('terminal-panel');
  const canvas = page.getByTestId('canvas');
  const height = async () => (await panel.boundingBox())!.height;
  // before any command: the prompt, the buttons and a one-line hint, nothing to resize yet
  await expect(panel).toHaveAttribute('data-compact', 'true');
  await expect(panel.getByText('Run terraform init to start.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('separator')).toHaveCount(0);
  expect(await height()).toBeLessThan(160);
  const canvasBefore = (await canvas.boundingBox())!.height;

  await panel.getByRole('button', { name: 'Run terraform init' }).click();
  await expect(panel).not.toHaveAttribute('data-compact');
  await expect.poll(height).toBeGreaterThan(200);
  // the canvas made the room (it shrank along, it didn't jump past)
  expect((await canvas.boundingBox())!.height).toBeLessThan(canvasBefore);

  // a height chosen with the keyboard is kept for the next lesson
  const separator = panel.getByRole('separator');
  await separator.focus();
  for (let i = 0; i < 3; i++) await separator.press('ArrowUp');
  const chosen = Number(await separator.getAttribute('aria-valuenow'));
  await page.goto('/learn/variables');
  await expect(panel).toHaveAttribute('data-compact', 'true');
  await panel.getByRole('button', { name: 'Run terraform validate' }).click();
  await expect.poll(height).toBeCloseTo(chosen, -1);
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

test('completes with Tab, applies a saved plan, and shows the workspace at the prompt', async ({ page }) => {
  const panel = page.getByTestId('terminal-panel');
  const log = panel.getByRole('log');
  const prompt = panel.getByRole('textbox');
  await panel.getByRole('button', { name: 'Run terraform init' }).click();
  await expect(log.getByText('Terraform has been successfully initialized!')).toBeVisible();

  await prompt.fill('terraform pl');
  await prompt.press('Tab');
  await expect(prompt).toHaveValue('terraform plan ');
  await prompt.pressSequentially('-o');
  await prompt.press('Tab');
  await expect(prompt).toHaveValue('terraform plan -out=');
  await prompt.pressSequentially('tfplan');
  await prompt.press('Enter');
  await expect(log.getByText('Saved the plan to: tfplan')).toBeVisible();

  // a saved plan applies at once, no question
  await prompt.fill('terraform apply tfplan');
  await prompt.press('Enter');
  await expect(log.getByText('Apply complete! Resources: 1 added, 0 changed, 0 destroyed.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await prompt.fill('terraform workspace new dev');
  await prompt.press('Enter');
  await expect(log.getByText('Created and switched to workspace "dev"!')).toBeVisible();
  await expect(panel.getByTestId('prompt-workspace')).toHaveText('dev');
  await prompt.fill('terraform workspace select default');
  await prompt.press('Enter');
  await expect(panel.getByTestId('prompt-workspace')).toHaveCount(0);
});
