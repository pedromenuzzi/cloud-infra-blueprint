/**
 * Keyboard-only use: dialogs trap and return focus, Esc closes only the top
 * layer, the palette is one Tab stop, skip links reach the canvas and code.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { canvasStats, openSeedProject, waitForMonaco } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** Press Tab (or Shift+Tab) `times`, checking focus never leaves `container`. */
async function expectTabTrapped(page: Page, container: Locator, times: number, key = 'Tab') {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    const inside = await container.evaluate((el) => el.contains(document.activeElement));
    expect(inside, `${key} #${i + 1} left the dialog`).toBe(true);
  }
}

test.describe('modal dialogs', () => {
  test('templates: focus moves in, Tab is trapped, the page is inert, focus returns', async ({ page }) => {
    await page.goto('/dashboard');
    const trigger = page.getByRole('button', { name: /New Project/ });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Start from a template' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Search templates' })).toBeFocused();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    await expectTabTrapped(page, dialog, 40);
    await expectTabTrapped(page, dialog, 10, 'Shift+Tab');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
    await expect(trigger).toBeFocused();
  });

  test('shortcuts dialog: named, trapped, returns focus to what had it', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const fit = page.getByRole('button', { name: /^Fit view/ });
    await fit.focus();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    // focus starts on the platform switch, at this device's keys
    await expect(dialog.getByRole('radio', { name: 'Windows and Linux' })).toBeFocused();
    await expectTabTrapped(page, dialog, 6);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(fit).toBeFocused();
  });

  test('PDF dialog opened from the Export menu returns focus to the Export button', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    await exportButton.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Export' });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    // arrows move through the menu, Esc closes it and refocuses the trigger
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: /Terraform files/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(exportButton).toBeFocused();

    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: /PDF document/ }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Export PDF document' });
    await expect(dialog.getByLabel('Title')).toBeFocused();
    await expectTabTrapped(page, dialog, 30);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(exportButton).toBeFocused();
  });

  test('Esc closes the rules editor, not the inspector behind it', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    await node(page, 'aws_security_group.web').click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    const editRules = page.getByRole('button', { name: 'Edit rules' });
    await expect(editRules).toBeVisible();
    await editRules.click();
    const rules = page.getByRole('dialog', { name: /^Rules for/ });
    await expect(rules).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(rules).toBeHidden();
    await expect(editRules).toBeVisible();
    await expect(editRules).toBeFocused();
    await expect(inspector).toBeVisible();

    // the next Esc reaches the page: it clears the selection
    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
  });
});

test.describe('command palette', () => {
  test('returns focus to the trigger on close', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const trigger = page.getByRole('button', { name: 'Search or run a command' });
    await trigger.click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Ctrl+K belongs to Monaco inside the code editor; Ctrl+Shift+P opens the palette there', async ({ page }) => {
    await openSeedProject(page);
    await page.locator('[data-testid="monaco"] .view-lines').click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    await expect(palette).toBeHidden();
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+Shift+P');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    // focus is back in the code editor
    await expect(page.locator('[data-testid="monaco"] textarea')).toBeFocused();
  });
});

test.describe('editor navigation', () => {
  test('the resource palette is a single Tab stop with arrow-key navigation', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
    const palette = page.getByRole('complementary', { name: 'Resource palette' });
    const list = palette.getByRole('toolbar');
    const stops = await list.evaluate(
      (el) => [...el.querySelectorAll<HTMLElement>('button')].filter((b) => b.tabIndex >= 0).length,
    );
    expect(stops).toBe(1);

    await palette.getByRole('textbox', { name: 'Search resources' }).focus();
    await page.keyboard.press('Tab'); // the selected provider tab
    await expect(palette.getByRole('tab', { selected: true })).toBeFocused();
    await page.keyboard.press('Tab'); // into the list: its one stop
    const first = list.locator('[data-rove]').first();
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(list.locator('[data-rove]').nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(list.locator('[data-rove]').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();

    // Tab leaves the list in one press
    await page.keyboard.press('Tab');
    expect(await list.evaluate((el) => el.contains(document.activeElement))).toBe(false);

    // Enter adds the focused resource
    await page.keyboard.press('Shift+Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(canvasStats(page)).toHaveText('12 resources, 7 connections');
  });

  test('skip links jump to the canvas and to the code editor', async ({ page }) => {
    await openSeedProject(page);
    await page.locator('body').focus();
    await page.keyboard.press('Tab');
    const toCanvas = page.getByRole('link', { name: 'Skip to canvas' });
    await expect(toCanvas).toBeFocused();
    await expect(toCanvas).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#bp-canvas')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.locator('#bp-canvas').evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.reload();
    await waitForMonaco(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to code' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="monaco"] textarea')).toBeFocused();
  });

  test('the editor has one main landmark and a skip-link-first tab order', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Cloud Blueprint editor');
  });
});

test.describe('small screens', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('topbar keeps the project name readable; Undo, Redo and theme move to ⋯', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const name = page.getByRole('textbox', { name: 'Project name' });
    expect((await name.boundingBox())!.width).toBeGreaterThanOrEqual(90);
    const header = page.locator('header').first();
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    const more = page.getByRole('button', { name: 'More actions' });
    await more.click();
    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu.getByRole('menuitem', { name: 'Undo' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Redo' })).toBeVisible();
    await menu.getByRole('menuitemradio', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(more).toBeFocused();
  });

  test('templates modal and ⌘K palette fit the screen', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /New Project/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Start from a template' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    const pbox = (await palette.boundingBox())!;
    expect(pbox.x).toBeGreaterThanOrEqual(0);
    expect(pbox.x + pbox.width).toBeLessThanOrEqual(390);
    expect(await palette.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
});
