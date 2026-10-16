/**
 * Polish, round 4: Monaco's own widgets in Portuguese, one "Import" menu on
 * the dashboard, and the security group a database needs once a fix puts it
 * in a DB subnet group.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { SEED_PROJECT, waitForMonaco } from './helpers';

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

/** first visit in `locale` (kept afterwards: a language switch survives a reload), on the dashboard */
async function visit(page: Page, { locale = 'en', theme }: { locale?: string; theme?: string } = {}) {
  await page.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem('cb-tips-dismissed', '1');
      if (!localStorage.getItem('cb-locale')) localStorage.setItem('cb-locale', locale);
      if (theme) localStorage.setItem('cb-theme', theme);
    },
    { locale, theme },
  );
  await page.goto('/dashboard');
}

async function openSeed(page: Page, options: { locale?: string; theme?: string } = {}) {
  await visit(page, options);
  const en = (options.locale ?? 'en') === 'en';
  await page.getByRole('button', { name: en ? `Open project ${SEED_PROJECT}` : `Abrir projeto ${SEED_PROJECT}` }).click();
  await expect(page).toHaveURL(/\/editor\//);
}

/* ------------------------------------------------------------ Monaco */

test.describe('Monaco in the UI language', () => {
  test('pt-BR: the find widget, the context menu and a problem hover speak Portuguese', async ({ page }) => {
    await openSeed(page, { locale: 'pt-BR' });
    await waitForMonaco(page);
    const code = page.locator('[data-testid="monaco"]');
    await expect(code.locator('textarea').first()).toHaveAttribute('aria-label', 'Conteúdo do editor');

    await code.locator('.view-lines').click();
    await page.keyboard.press('Control+f');
    const find = code.locator('.find-widget');
    await expect(find.getByRole('textbox', { name: 'Buscar' })).toBeFocused();
    await page.keyboard.type('resource');
    await expect(find.locator('.matchesCount')).toHaveText(/^\d+ de \d+$/);
    await expect(find.getByRole('button', { name: 'Fechar (Escape)' })).toBeVisible();
    await expect(find.getByRole('checkbox', { name: /^Diferenciar maiúsculas e minúsculas/ })).toBeVisible();
    await page.keyboard.press('Escape');

    await code.locator('.view-lines').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Copiar' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Alterar todas as ocorrências' })).toBeVisible();
    await page.keyboard.press('Escape');

    // an unknown reference is a problem: its hover and the peek it opens
    await code.locator('.view-lines').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('zzzq ');
    const squiggle = code.locator('.squiggly-error').first();
    await expect(squiggle).toBeVisible();
    await squiggle.hover({ force: true });
    const hover = page.locator('.monaco-hover:visible');
    await expect(hover.getByText('Ver problema')).toBeVisible();
    await hover.getByText('Ver problema').click();
    await expect(code.locator('.peekview-title')).toContainText('1 de 1 problema');
  });

  test('a switch with the editor open offers a reload, which brings Monaco back in the new language', async ({ page }) => {
    await openSeed(page);
    await waitForMonaco(page);
    await page.getByRole('button', { name: 'Language: English' }).first().click();
    await page.getByRole('menuitemradio', { name: 'Português (Brasil)' }).click();
    const toast = page.locator('[data-bp-live]');
    await expect(toast.getByText('Os menus do próprio editor de código (busca, sugestões) mudam de idioma depois de recarregar')).toBeVisible();
    await toast.getByRole('button', { name: 'Recarregar' }).click();

    await waitForMonaco(page);
    const code = page.locator('[data-testid="monaco"]');
    await code.locator('.view-lines').click();
    await page.keyboard.press('Control+f');
    await expect(code.locator('.find-widget').getByRole('textbox', { name: 'Buscar' })).toBeFocused();
    // and back to the language it loaded in: nothing to reload for
    await page.getByRole('button', { name: 'Idioma: Português (Brasil)' }).first().click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(toast.getByText('The code editor’s own menus (find, suggestions) switch language after a reload')).toBeVisible();
    await page.getByRole('button', { name: 'Language: English' }).first().click();
    await page.getByRole('menuitemradio', { name: 'Português (Brasil)' }).click();
    await expect(toast.getByRole('button', { name: 'Recarregar' })).toHaveCount(0);
  });

  for (const theme of ['light', 'dark']) {
    test(`axe, ${theme}, pt-BR: the reload toast`, async ({ page }) => {
      await openSeed(page, { theme });
      await waitForMonaco(page);
      await page.getByRole('button', { name: 'Language: English' }).first().click();
      await page.getByRole('menuitemradio', { name: 'Português (Brasil)' }).click();
      await expect(page.locator('[data-bp-live]').getByRole('button', { name: 'Recarregar' })).toBeVisible();
      expect(await seriousAxeViolations(page, '[data-bp-live]')).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------ Import menu */

test.describe('one Import menu on the dashboard', () => {
  test('keyboard: opens on its first item, arrows move, Esc gives focus back', async ({ page }) => {
    await visit(page);
    const trigger = page.getByRole('button', { name: 'Import', exact: true });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    // the three ways in that used to be separate buttons are its items
    await expect(page.getByRole('button', { name: /^Import from GitHub/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import .tf' })).toHaveCount(0);

    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Import' });
    await expect(menu.getByRole('menuitem')).toHaveText([/^Terraform files…/, /^From GitHub…/, /^From a Terraform state…/, /^Open folder…/]);
    const files = menu.getByRole('menuitem', { name: 'Terraform files…' });
    await expect(files).toBeFocused();
    await expect(files).toHaveAccessibleDescription('.tf files or a .zip, copied into the browser');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('ArrowDown');
    await expect(files).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'From GitHub…' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Import from GitHub/ })).toBeVisible();
  });

  test('"Terraform files…" picks .tf files and imports them as a project', async ({ page }) => {
    await visit(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Terraform files…' }).click();
    await (await chooser).setFiles([{ name: 'main.tf', mimeType: 'text/plain', buffer: Buffer.from('resource "aws_vpc" "picked" {}\n') }]);
    await expect(page).toHaveURL(/\/editor\//);
    await expect(page.locator('.react-flow__node[data-id="aws_vpc.picked"]')).toBeVisible();
  });

  for (const [width, theme] of [
    [390, 'light'],
    [768, 'dark'],
  ] as const) {
    test(`pt-BR at ${width} px, ${theme}: the menu fits the screen and passes axe`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await visit(page, { locale: 'pt-BR', theme });
      const trigger = page.getByRole('button', { name: 'Importar', exact: true });
      const create = page.getByRole('button', { name: 'Novo projeto' });
      // side by side, on one row
      expect(Math.abs((await trigger.boundingBox())!.y - (await create.boundingBox())!.y)).toBeLessThan(2);
      await trigger.click();
      const menu = page.getByRole('menu', { name: 'Importar' });
      await expect(menu.getByRole('menuitem', { name: 'Do GitHub…' })).toHaveAccessibleDescription('Um repositório, pasta, arquivo .tf ou gist');
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(await seriousAxeViolations(page, '[role="menu"]')).toEqual([]);
    });
  }
});
