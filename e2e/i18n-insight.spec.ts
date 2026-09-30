/**
 * Security, cost and the PDF in Brazilian Portuguese: the security panel, a
 * finding with its compliance badges, "Why is this reachable?" in the
 * Inspector, the rules editor, the cost chip and popover, the export dialog
 * and the downloaded document. Switching the language with the panel open
 * re-words it in place and is not taken for a security change.
 *
 * Entry points owned by other areas (the dashboard, the top bar) are reached
 * without their words: the editor by URL, the top bar buttons by their icon.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { SEED_PROJECT } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const securityButton = (page: Page) => page.locator('header button[aria-pressed]:has(svg.lucide-shield-check)');
const exportButton = (page: Page) => page.locator('header button[aria-haspopup="menu"]:has(svg.lucide-download)');
const toasts = (page: Page) => page.locator('[data-bp-live]');

/** the seed project in the editor, in `locale` (and `theme`), without going through the dashboard's words */
async function openSeed(page: Page, { locale = 'pt-BR', theme = 'light' }: { locale?: 'en' | 'pt-BR'; theme?: 'light' | 'dark' } = {}) {
  await page.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem('cb-tips-dismissed', '1');
      localStorage.setItem('cb-theme', theme);
      if (!sessionStorage.getItem('cb-e2e-locale')) {
        // only on the first load: the picker may change it afterwards
        localStorage.setItem('cb-locale', locale);
        sessionStorage.setItem('cb-e2e-locale', '1');
      }
    },
    { locale, theme },
  );
  // the dashboard seeds the project on a first visit
  await page.goto('/dashboard');
  let id: string | null = null;
  await expect
    .poll(async () => {
      id = await page.evaluate((name) => {
        const all = JSON.parse(localStorage.getItem('cb-projects-v1') ?? '[]') as Array<{ id: string; name: string }>;
        return all.find((p) => p.name === name)?.id ?? null;
      }, SEED_PROJECT);
      return id;
    })
    .not.toBeNull();
  await page.goto(`/editor/${id}`);
  await expect(node(page, 'aws_instance.web')).toBeVisible({ timeout: 30_000 });
}

async function switchLanguage(page: Page, label: 'English' | 'Português (Brasil)') {
  await page.getByRole('button', { name: /^(Language|Idioma):/ }).first().click();
  await page.getByRole('menuitemradio', { name: label }).click();
}

async function openPanel(page: Page) {
  await securityButton(page).click();
  const panel = page.getByRole('complementary', { name: 'Segurança' });
  await expect(panel).toBeVisible();
  return panel;
}

async function seriousAxe(page: Page, selector: string) {
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async (sel) => {
    type Violation = { id: string; impact: string; nodes: Array<{ target: string[] }> };
    const axe = (window as unknown as { axe: { run(ctx: Element, o: object): Promise<{ violations: Violation[] }> } }).axe;
    const { violations } = await axe.run(document.querySelector(sel)!, { resultTypes: ['violations'] });
    return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  }, selector);
}

/** every text run of a downloaded (deflated) PDF, WinAnsi-decoded */
function pdfText(pdf: Buffer): string {
  const cp1252 = new TextDecoder('windows-1252');
  const out: string[] = [];
  const raw = pdf.toString('latin1');
  for (const m of raw.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+)>>\nstream\n/g)) {
    const start = m.index + m[0].length;
    const content = inflateSync(pdf.subarray(start, start + Number(m[1]))).toString('latin1');
    for (const t of content.matchAll(/<([0-9a-f]*)> Tj/g)) out.push(cp1252.decode(Buffer.from(t[1], 'hex')));
  }
  return out.join('\n');
}

test('security panel: exposure, the way in, findings with their badges — in Portuguese', async ({ page }) => {
  await openSeed(page);
  const panel = await openPanel(page);
  await expect(panel.getByRole('heading', { name: 'Segurança' })).toBeVisible();
  await expect(panel.getByText('Exposto à internet')).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Achados' })).toBeVisible();
  await expect(panel.getByRole('switch', { name: 'Lente de segurança' })).toBeVisible();

  // why web is reachable: the first port opens on its own, every step in Portuguese
  await panel.getByRole('button', { name: 'Por que web está acessível?' }).click();
  const path = panel.getByRole('list', { name: 'Caminho para :80' });
  await expect(path.getByRole('listitem')).toHaveText([
    /^Internetqualquer endereço IPv4 \(0\.0\.0\.0\/0\)/,
    /^Internet gateway igw/,
    /^Rota 0\.0\.0\.0\/0 → igwtabela de rotas public, associada à sub-rede public_a/,
    /^Sub-rede public_apública · atribui IPs públicos na inicialização/,
    /^Grupo de segurança webingress #1 permite HTTP de 0\.0\.0\.0\/0/,
    /^aws_instance\.webendereço público: map_public_ip_on_launch = true na sub-rede public_a/,
  ]);

  // a finding: title, severity, badges with the control in Portuguese, the explanation and its fix
  const imds = panel.locator('[data-finding="imdsv2:aws_instance.web"]');
  await expect(imds.getByRole('button', { name: /^Metadados da instância aceitam IMDSv1/ })).toBeVisible();
  await expect(imds).toContainText('Média');
  const badge = imds.getByRole('button', { name: /^FSBP EC2\.8/ });
  await badge.hover();
  await expect(page.locator('[data-bp-tooltip]')).toContainText('As instâncias EC2 devem usar o Instance Metadata Service versão 2 (IMDSv2)');
  await imds.getByRole('button', { name: /^Metadados da instância/ }).click();
  await expect(imds).toContainText('web aceita requisições de metadados sem token');
  await expect(imds.getByRole('button', { name: 'Exigir IMDSv2' })).toBeVisible();

  expect(await seriousAxe(page, 'aside[aria-label="Segurança"]')).toEqual([]);
});

test('Inspector: "Why is this reachable?" and what stops the database — in Portuguese', async ({ page }) => {
  await openSeed(page);
  await node(page, 'aws_instance.web').click();
  const why = page.getByTestId('access-explanation').getByRole('region', { name: 'Por que isto está acessível?' });
  await expect(why).toBeVisible();
  const https = why.getByRole('button', { name: /^:443 HTTPS/ });
  await https.click();
  await expect(why.getByRole('list', { name: 'Caminho para :443' }).getByRole('listitem').nth(4)).toHaveText(
    /^Grupo de segurança webingress #2 permite HTTPS de 0\.0\.0\.0\/0, abrir esta regra no editor de regras$/,
  );

  await page.keyboard.press('Escape');
  await node(page, 'aws_db_instance.main').click();
  const blocked = page.getByTestId('access-explanation').getByRole('region', { name: 'Tráfego da internet bloqueado' });
  const entry = blocked.getByRole('button', { name: /^Porta 443 a partir da internet · HTTPS.*sem acesso público/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(blocked.getByRole('list', { name: 'Por que há bloqueio: porta 443' })).toContainText('publicly_accessible não está definido (o padrão é false)');
});

test('rules editor: columns, presets, validation and notices — in Portuguese', async ({ page }) => {
  await openSeed(page);
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Por que web está acessível?' }).click();
  await panel.getByRole('list', { name: 'Caminho para :80' }).getByRole('button', { name: /^Grupo de segurança web/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Regras de web' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Regras · web' })).toBeVisible();
  await expect(dialog).toContainText('Com estado (stateful)');
  for (const header of ['Serviço', 'Protocolo', 'Portas', 'Origem', 'Descrição']) {
    await expect(dialog.getByRole('columnheader', { name: header })).toBeVisible();
  }
  await expect(dialog.getByRole('tab', { name: /^Entrada/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: /^Saída/ })).toBeVisible();
  const row = dialog.locator('tr[data-rule="aws_security_group.web:ingress:0"]');
  await expect(row.getByRole('combobox', { name: 'Serviço' })).toHaveValue('http');
  await expect(row.getByRole('combobox', { name: 'Serviço' }).locator('option[value="all-tcp"]')).toHaveText('Todas as portas TCP');

  await dialog.getByRole('button', { name: 'Nova regra' }).click();
  const menu = page.getByRole('menu', { name: 'Nova regra' });
  await expect(menu.getByRole('menuitem', { name: /^Todo o tráfego/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^SSH/ }).click();
  // SSH starts on the VPC's range, not the internet: the row reads it in Portuguese, the code keeps the ASCII description
  const added = dialog.locator('tr[data-rule]').last();
  await expect(added.getByRole('combobox', { name: 'Serviço' })).toHaveValue('ssh');
  await expect(added.getByRole('textbox', { name: 'Descrição' })).toHaveValue('SSH');
  expect(await seriousAxe(page, '[role="dialog"]')).toEqual([]);
});

test('cost chip, popover and the inspector cost line — in Portuguese, in US dollars', async ({ page }) => {
  await openSeed(page);
  const chip = page.getByTestId('cost-chip');
  await expect(chip).toHaveText(/^~US\$\s\d+\/mês$/);
  await expect(chip).toHaveAccessibleName(/^Estimativa de custo: ~US\$\s\d+\/mês$/);
  await expect(chip).toHaveAccessibleDescription(/preços de tabela sob demanda/);
  await chip.click();
  const popover = page.getByRole('dialog', { name: 'Custo mensal estimado' });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('/ mês');
  await expect(popover.getByRole('heading', { name: 'Por categoria' })).toBeVisible();
  await expect(popover.getByRole('group', { name: 'Ordenar recursos por' }).getByRole('button')).toHaveText(['Custo', 'Nome', 'Categoria']);
  await expect(popover.getByTestId('cost-rows')).toContainText(/t3\.micro 730 h × US\$\s0,\d+ = US\$\s\d+,\d\d/);
  await expect(popover).toContainText('9 sem cobrança própria');
  await expect(popover).toContainText('Uma estimativa, não uma cotação');
  expect(await seriousAxe(page, '[data-testid="cost-popover"]')).toEqual([]);
  await page.keyboard.press('Escape');

  await node(page, 'aws_db_instance.main').click();
  const line = page.getByTestId('cost-line');
  await expect(line).toContainText('Custo estimado');
  await expect(line).toContainText(/~US\$\s\d+,\d\d\/mês/);
  await expect(line).toContainText('storage_type não definido: gp2, o padrão da AWS');
});

test('the PDF export dialog, and a document written in Portuguese', async ({ page }) => {
  await openSeed(page);
  await exportButton(page).click();
  await page.getByRole('menuitem').first().click();
  const dialog = page.getByRole('dialog', { name: 'Exportar documento PDF' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Revisão de segurança' })).toBeChecked();
  await expect(dialog.getByRole('switch', { name: 'Estimativa de custo' })).toBeChecked();
  await expect(dialog).toContainText(/Nota [A-F] · \d+ achados?/);
  await expect(dialog.getByRole('radio', { name: 'Carta' })).toBeVisible();
  expect(await seriousAxe(page, '[role="dialog"]')).toEqual([]);

  await dialog.getByRole('textbox', { name: 'Título' }).fill('Plataforma de pagamentos');
  await dialog.getByRole('textbox', { name: 'Notas para o leitor' }).fill('Revisão: segurança e custo — versão 2.');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Baixar PDF' }).click();
  const file = await download;
  await expect(page.getByText('PDF baixado — pronto para compartilhar')).toBeVisible();
  expect(file.suggestedFilename()).toBe('plataforma-de-pagamentos-arquitetura.pdf');
  const pdf = await readFile((await file.path())!);
  const out = process.env.I18N_SHOTS;
  if (out) await file.saveAs(`${out}/downloaded-pt.pdf`);
  const text = pdfText(pdf);
  for (const s of [
    'Plataforma de pagamentos',
    'Visão geral',
    'NOTAS',
    'Revisão: segurança e custo — versão 2.',
    'Inventário de recursos',
    'Conexões e tráfego',
    'Revisão de segurança',
    'Acessível pela internet',
    'Metadados da instância aceitam IMDSv1',
    'Estimativa de custo',
    'Total dos recursos com preço',
    'Premissas',
  ]) {
    expect(text, s).toContain(s);
  }
  expect(text).toMatch(/Página 1 de \d+/);
  expect(text).toMatch(/Gerado em \d{1,2} de [a-z]{3}\. de \d{4}, \d\d:\d\d com o Cloud Blueprint\./);
  expect(text).toContain('Limite de rede (VPC, sub-rede, grupo)');
});

test('switching the language with the security panel open re-words it in place, with no security toast', async ({ page }) => {
  await openSeed(page, { locale: 'en' });
  await securityButton(page).click();
  const english = page.getByRole('complementary', { name: 'Security' });
  await expect(english.getByRole('heading', { name: 'Findings' })).toBeVisible();
  // open a finding and the way in: both must survive the switch (no remount)
  await english.locator('[data-finding="imdsv2:aws_instance.web"]').getByRole('button', { name: /^Instance metadata allows IMDSv1/ }).click();
  await english.getByRole('button', { name: 'Why is web reachable?' }).click();
  const handle = await english.elementHandle();

  await switchLanguage(page, 'Português (Brasil)');
  const panel = page.getByRole('complementary', { name: 'Segurança' });
  await expect(panel.getByRole('heading', { name: 'Achados' })).toBeVisible();
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
  const imds = panel.locator('[data-finding="imdsv2:aws_instance.web"]');
  await expect(imds).toContainText('web aceita requisições de metadados sem token');
  await expect(panel.getByRole('list', { name: 'Caminho para :80' })).toContainText('Sub-rede public_a');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');

  // an edit, then a switch before it settles: judged by what the findings say, not by their words
  await imds.getByRole('button', { name: 'Exigir IMDSv2' }).click();
  await switchLanguage(page, 'English');
  await expect(page.getByRole('complementary', { name: 'Security' }).getByRole('heading', { name: 'Findings' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(toasts(page).filter({ hasText: /Security grade|security risk|Nota de segurança|risco de segurança/ })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe in Portuguese, ${theme}: security panel with a finding open, and the cost popover`, async ({ page }) => {
    await openSeed(page, { theme });
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
    const panel = await openPanel(page);
    await panel.locator('[data-finding="imdsv2:aws_instance.web"]').getByRole('button', { name: /^Metadados da instância/ }).click();
    await panel.getByRole('button', { name: 'Por que web está acessível?' }).click();
    expect(await seriousAxe(page, 'aside[aria-label="Segurança"]')).toEqual([]);
    await page.getByTestId('cost-chip').click();
    await expect(page.getByTestId('cost-popover')).toBeVisible();
    expect(await seriousAxe(page, '[data-testid="cost-popover"]')).toEqual([]);
  });
}
