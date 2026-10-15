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
