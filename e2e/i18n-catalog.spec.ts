/**
 * The catalog area in Portuguese: the multi-select panel, the CIDR planner,
 * the inspector's "All arguments", validation warnings and the Monaco
 * markers and hovers we generate — which change language in place when the
 * picker switches it. The rest of the suite runs in English.
 *
 * Only text from this area is asserted: the dashboard, canvas chrome and
 * inspector frame are translated elsewhere, so the editor is opened by URL
 * and resources are picked through the canvas and the code.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { focusEndOfCode, insertCode, SEED_PROJECT, storedProject, waitForMonaco } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const planner = (page: Page) => page.getByTestId('cidr-planner');
const schemaFields = (page: Page) => page.getByTestId('schema-fields');
const hover = (page: Page) => page.locator('.monaco-hover:not(.hidden)');

async function openInPortuguese(page: Page, theme?: 'light' | 'dark') {
  await page.addInitScript((t) => {
    localStorage.setItem('cb-locale', 'pt-BR');
    localStorage.setItem('cb-tips-dismissed', '1');
    if (t) localStorage.setItem('cb-theme', t);
  }, theme);
  // the dashboard seeds the demo project on the first visit
  await page.goto('/dashboard');
  await expect.poll(async () => (await storedProject(page, SEED_PROJECT))?.id).toBeTruthy();
  const { id } = (await storedProject(page, SEED_PROJECT))!;
  await page.goto(`/editor/${id}`);
  await waitForMonaco(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(node(page, 'aws_vpc.main')).toBeVisible();
}

async function selectVpc(page: Page) {
  await node(page, 'aws_vpc.main').click({ position: { x: 300, y: 12 } });
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_vpc.main');
  await expect(planner(page)).toBeVisible();
}

async function selectSubnets(page: Page) {
  await node(page, 'aws_subnet.public_a').click({ position: { x: 120, y: 14 } });
  await node(page, 'aws_subnet.public_b').click({ position: { x: 120, y: 14 }, modifiers: ['Control'] });
  const panel = page.getByRole('complementary', { name: '2 recursos selecionados' });
  await expect(panel).toBeVisible();
  return panel;
}

const word = (page: Page, text: string) => page.locator('[data-testid="monaco"] .view-line span', { hasText: text }).last();

/** no Monaco hover left over the code */
async function dismissHover(page: Page) {
  await page.mouse.move(0, 0);
  await expect(hover(page)).toHaveCount(0);
}

/** hover a word of the code and wait for Monaco's hover */
async function hoverWord(page: Page, text: string) {
  await dismissHover(page);
  await word(page, text).hover();
  await expect(hover(page)).toBeVisible();
  return hover(page);
}

/** put the caret on a word (which selects the resource around it) */
async function clickWord(page: Page, text: string) {
  await dismissHover(page);
  await word(page, text).click();
}

async function switchToEnglish(page: Page) {
  await page.getByRole('button', { name: 'Idioma: Português (Brasil)' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}

test('the multi-select panel speaks Portuguese', async ({ page }) => {
  await openInPortuguese(page);
  const panel = await selectSubnets(page);
  await expect(panel.getByRole('heading', { name: '2 recursos selecionados' })).toBeVisible();
  await expect(panel).toContainText('Sub-rede ×2');
  await expect(panel).toContainText('Alinhar e distribuir');
  await expect(panel.getByRole('toolbar', { name: 'Alinhar e distribuir' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Alinhar à esquerda' })).toBeEnabled();
  // distributing needs three: the reason is the tooltip, and the hint under the buttons
  const distribute = panel.getByRole('button', { name: 'Distribuir na horizontal' });
  await expect(distribute).toBeDisabled();
  await expect(distribute).toHaveAttribute('title', 'Selecione pelo menos 3 recursos');
  await expect(panel).toContainText('Configurações em comum');
  await expect(panel.getByRole('textbox', { name: 'Chave da tag para todos' })).toHaveAttribute('placeholder', 'chave');
  await expect(panel.getByRole('button', { name: 'Excluir 2 recursos' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Limpar seleção' })).toBeVisible();
});

test('the CIDR planner speaks Portuguese, with numbers formatted for it', async ({ page }) => {
  await openInPortuguese(page);
  await selectVpc(page);
  const card = planner(page);
  await expect(card).toContainText('Plano de endereços');
  await expect(card).toContainText('65.536 endereços');
  await expect(card).toContainText('512 alocados · 0,8%');
  await expect(card).toContainText('65.024 livres');
  await expect(card).toContainText('2 sub-redes');
  await expect(card.getByLabel('Tamanho da sub-rede')).toBeVisible();
  await expect(card).toContainText('251 utilizáveis por sub-rede: a AWS reserva 5 endereços em cada uma.');
  await card.getByRole('button', { name: 'Nova sub-rede' }).click();
  await expect(card).toContainText('3 sub-redes');
  await expect(page.getByText(/^aws_subnet\.subnet · 10\.0\.3\.0\/24 adicionada em us-east-1c$/)).toBeVisible();

  // a subnet's card
  await card.getByRole('button', { name: /public_b/ }).click();
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_subnet.public_b');
  await expect(planner(page)).toContainText('utilizáveis');
  await expect(planner(page)).toContainText('A AWS reserva 5 endereços em toda sub-rede.');
  await expect(planner(page)).toContainText('em aws_vpc.main (10.0.0.0/16)');
});

test('"All arguments", a validation warning, and the markers and hovers switch language in place', async ({ page }) => {
  await openInPortuguese(page);
  await node(page, 'aws_instance.web').click();
  const fields = schemaFields(page);
  await expect(fields).toBeVisible({ timeout: 15_000 });
  await expect(fields.getByRole('heading', { name: /Todos os argumentos/ })).toBeVisible();
  await expect(fields.getByRole('textbox', { name: 'Buscar em todos os argumentos' })).toHaveAttribute('placeholder', /^Buscar em \d+ argumentos…$/);
  await expect(fields.getByRole('button', { name: /^Mostrar os \d+ argumentos opcionais$/ })).toBeVisible();

  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_s3_bucket" "e2e" { force_destory = true }');
  await page.keyboard.press('Enter');
  await insertCode(page, 'resource "aws_sqs_queue" "e2e" { delay_seconds = 5 }');
  await expect(node(page, 'aws_sqs_queue.e2e')).toBeAttached();
  await expect(page.locator('[data-testid="monaco"] .squiggly-warning').first()).toBeAttached();

  // the marker on the unknown argument
  const pt = 'aws_s3_bucket.e2e: argumento desconhecido "force_destory". Você quis dizer "force_destroy"?';
  await expect(await hoverWord(page, 'force_destory')).toContainText(pt);
  // the hover we build from the schema
  await expect(await hoverWord(page, 'delay_seconds')).toContainText(/delay_seconds · number · opcional/);

  // the warning in the inspector: put the caret in the bucket's block
  await clickWord(page, 'force_destory');
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_s3_bucket.e2e');
  const row = schemaFields(page).getByTestId('schema-arg-force_destory');
  await expect(row).toContainText('desconhecido');
  await expect(row).toContainText('argumento desconhecido "force_destory". Você quis dizer "force_destroy"?');
  await expect(row.getByRole('button', { name: 'Renomear para force_destroy' })).toBeVisible();

  // switching language: same screen, same code, same undo history — new words
  const code = await page.locator('[data-testid="monaco"] .view-lines').innerText();
  await switchToEnglish(page);
  await expect(row).toContainText('unknown argument "force_destory". Did you mean "force_destroy"?');
  await expect(row.getByRole('button', { name: 'Rename to force_destroy' })).toBeVisible();
  await expect(schemaFields(page).getByRole('heading', { name: /All arguments/ })).toBeVisible();
  await expect(await hoverWord(page, 'force_destory')).toContainText(
    'aws_s3_bucket.e2e: unknown argument "force_destory". Did you mean "force_destroy"?',
  );
  await expect(await hoverWord(page, 'delay_seconds')).toContainText(/delay_seconds · number · optional/);
  expect(await page.locator('[data-testid="monaco"] .view-lines').innerText()).toBe(code);
  // the typing is still one undo step away
  await clickWord(page, 'delay_seconds');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-testid="monaco"] .view-lines')).not.toContainText('delay_seconds');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the Portuguese panels pass axe in the ${theme} theme`, async ({ page }) => {
    await openInPortuguese(page, theme);
    await page.addScriptTag({ content: AXE });
    const audit = (selector: string) =>
      page.evaluate(async (sel) => {
        type Result = { violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> };
        const axe = (window as unknown as { axe: { run(ctx: Element, o: object): Promise<Result> } }).axe;
        const { violations } = await axe.run(document.querySelector(sel)!, { resultTypes: ['violations'] });
        return violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      }, selector);

    await selectVpc(page);
    await page.waitForTimeout(400); // the inspector's entry animation
    expect(await audit('[data-testid="cidr-planner"]')).toEqual([]);

    await node(page, 'aws_instance.web').click();
    await expect(schemaFields(page)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expect(await audit('[data-testid="schema-fields"]')).toEqual([]);

    await selectSubnets(page);
    await page.waitForTimeout(400);
    expect(await audit('aside[aria-label="2 recursos selecionados"]')).toEqual([]);
  });
}
