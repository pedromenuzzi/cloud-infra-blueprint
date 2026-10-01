/**
 * Shortcut labels follow the platform: Ctrl+K on Windows and Linux, ⌘K on a
 * Mac. The landing page names both, and the shortcuts dialog can show either.
 */
import { expect, test, type Page } from '@playwright/test';
import { openSeedProject } from './helpers';

const asMac = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }));

test('on a PC: Ctrl+K in the editor, and the landing page names the Mac key too', async ({ page }) => {
  await openSeedProject(page);
  await expect(page.locator('header kbd').first()).toHaveText('Ctrl+K');
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo (Ctrl+Z)');
  await expect(page.locator('body')).not.toContainText('⌘');

  await page.goto('/');
  await expect(page.getByText(/^Press Ctrl\+K \(⌘K on a Mac\) to add resources/)).toBeVisible();
});

test('on a Mac: ⌘K everywhere, and the landing page names the Windows key', async ({ page }) => {
  await asMac(page);
  await openSeedProject(page);
  await expect(page.locator('header kbd').first()).toHaveText('⌘K');
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo (⌘Z)');

  await page.addInitScript(() => localStorage.setItem('cb-locale', 'pt-BR'));
  await page.goto('/');
  await expect(page.getByText(/^Pressione ⌘K \(Ctrl\+K no Windows e no Linux\) para adicionar recursos/)).toBeVisible();
});

test('the shortcuts dialog shows the keys for Windows and Linux or for macOS', async ({ page }) => {
  await openSeedProject(page);
  await page.locator('.react-flow__pane').click({ position: { x: 40, y: 400 } });
  await page.keyboard.press('Shift+Slash');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const keys = dialog.getByRole('radiogroup', { name: 'Keys for' });
  await expect(keys.getByRole('radio', { name: 'Windows and Linux' })).toBeChecked();
  const redo = dialog.getByRole('listitem').filter({ hasText: /^Redo/ });
  await expect(redo.locator('kbd')).toHaveText(['Ctrl', 'Shift', 'Z']);

  await keys.getByRole('radio', { name: 'macOS' }).click();
  await expect(redo.locator('kbd')).toHaveText(['⌘', '⇧', 'Z']);
});
