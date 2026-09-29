/**
 * The app shell in Portuguese: switching with the flag picker (dashboard and
 * landing), every translated page and dialog, the choice surviving a reload,
 * <html lang>, switching back, axe in both themes, no sideways scroll on a
 * phone — and a Portuguese browser opening in Portuguese on its first visit.
 * The rest of the suite runs in English (the config pins en-US).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { encodeShare } from '../src/lib/share';
import { SEED_PROJECT } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const MAIN = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`;

/** Pick a language from the flag menu (the rail's compact picker, or the landing header's). */
async function pickLanguage(page: Page, name: 'Português (Brasil)' | 'English') {
  await page.getByRole('button', { name: /^(Language|Idioma): / }).first().click();
  await page.getByRole('menuitemradio', { name }).click();
}

/** Start in Portuguese without going through the picker (a stored choice). */
async function inPortuguese(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((t) => {
    localStorage.setItem('cb-locale', 'pt-BR');
    localStorage.setItem('cb-theme', t);
  }, theme);
}

async function audit(page: Page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  await page.waitForTimeout(400); // entry animations: axe measures the colors actually painted
  return page.evaluate(async () => {
    type Violation = { id: string; impact: string; nodes: Array<{ target: string[] }> };
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<{ violations: Violation[] }> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

async function sidewaysScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

function backupZip(): Buffer {
  const now = new Date().toISOString();
  const manifest = {
    format: 'cloud-blueprint-backup',
    version: 1,
    app: 'Cloud Blueprint',
    exportedAt: now,
    projects: [{ id: 'prj_backup', name: 'rede', createdAt: now, updatedAt: now, hash: '', files: [{ name: 'main.tf', path: 'rede/main.tf' }] }],
  };
  return Buffer.from(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'rede/main.tf': strToU8(MAIN) }));
}

test('the dashboard switches to Portuguese in place, keeps it after a reload and switches back', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // state typed before the switch survives it (no reload, no remount)
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('prod');

  await pickLanguage(page, 'Português (Brasil)');
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page).toHaveTitle('Projetos — Cloud Blueprint');
  await expect(page.getByRole('searchbox', { name: 'Buscar projetos' })).toHaveValue('prod');
  await expect(page.getByRole('button', { name: `Abrir projeto ${SEED_PROJECT}` })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Início rápido' })).toBeVisible();
  await expect(page.getByText('Atualizado agora', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^\d+ recursos$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo projeto' })).toBeVisible();
  // the data panel
  await expect(page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
  await expect(page.getByText('Nenhum backup ainda')).toBeVisible();
  await expect(page.getByRole('button', { name: /Fazer backup de todos os projetos/ })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Armazenamento do navegador em uso' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  expect(await page.evaluate(() => localStorage.getItem('cb-locale'))).toBe('pt-BR');

  await pickLanguage(page, 'English');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.getByText('No backup yet')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Projects — Cloud Blueprint');
});

test('the landing page switches from its header picker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open the app' })).toBeVisible();
  await pickLanguage(page, 'Português (Brasil)');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Desenhe sua nuvem. Gere o Terraform na hora.');
  await expect(page.getByRole('button', { name: 'Abrir o app' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Comece a criar — é grátis/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bidirecional de verdade' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Três passos. Sem enrolação.' })).toBeVisible();
  // template cards in the UI language
  await expect(page.getByRole('heading', { name: 'API serverless na AWS' })).toBeVisible();
  await expect(page).toHaveTitle('Cloud Blueprint — Desenhe sua nuvem. Gere o Terraform na hora.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
});

test('dashboard dialogs in Portuguese: templates, restore, GitHub import', async ({ page }) => {
  await inPortuguese(page);
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Novo projeto' }).click();
  const templates = page.getByRole('dialog', { name: 'Começar com um template' });
  await expect(templates.getByRole('button', { name: 'Sites estáticos' })).toBeVisible();
  await templates.getByPlaceholder('Buscar templates…').fill('estático');
  await expect(templates.getByRole('heading', { name: 'Site estático no Azure' })).toBeVisible();
  // English words still find templates
  await templates.getByPlaceholder('Buscar templates…').fill('serverless');
  await expect(templates.getByRole('heading', { name: 'API serverless na AWS' })).toBeVisible();
  await templates.getByRole('button', { name: 'Fechar' }).click();

  await page.getByTestId('restore-input').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: backupZip() });
  const restore = page.getByRole('dialog', { name: /Restaurar backup/ });
  await expect(restore.getByText('1 novo')).toBeVisible();
  await expect(restore.getByRole('button', { name: 'Restaurar 1 projeto' })).toBeVisible();
  await restore.getByRole('button', { name: 'Cancelar' }).click();

  const exportZip = Buffer.from(zipSync({ 'infra/main.tf': strToU8(MAIN) }));
  await page.getByTestId('restore-input').setInputFiles({ name: 'export.zip', mimeType: 'application/zip', buffer: exportZip });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('é uma exportação, não um backup');
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();

  await page.getByRole('button', { name: 'Importar do GitHub…' }).click();
  const github = page.getByRole('dialog', { name: /Importar do GitHub/ });
  await github.getByLabel('Link do GitHub ou owner/repo').fill('https://gitlab.com/acme/infra');
  await github.getByRole('button', { name: 'Procurar Terraform' }).click();
  await expect(github.getByRole('alert')).toContainText('Por enquanto só o GitHub é suportado');
  await expect(github.getByText('60 requisições por hora')).toBeVisible();
});

test('tutorials, a lesson, the viewer and the 404 in Portuguese', async ({ page }) => {
  await inPortuguese(page);
  await page.goto('/tutorials');
  await expect(page.getByRole('heading', { name: 'Tutoriais', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Começar o tutorial Sua primeira VPC + EC2' })).toBeVisible();
  await expect(page.getByText('Iniciante').first()).toBeVisible();

  await page.getByRole('button', { name: 'Começar o tutorial Sua primeira VPC + EC2' }).click();
  await expect(page.getByText(/^Passo 1 de 5$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Providers e versões', level: 2 })).toBeVisible();
  // the prose is translated, the code in it is not
  await expect(page.getByRole('complementary', { name: 'Lição' }).locator('code').first()).toHaveText('provider "aws"');
  await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.getByText(/^Passo 2 de 5$/)).toBeVisible();
  await expect(page).toHaveTitle('Sua primeira VPC + EC2 — Tutoriais — Cloud Blueprint');
  // switching language keeps the step
  await pickLanguage(page, 'English');
  await expect(page.getByText(/^Step 2 of 5$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The VPC', level: 2 })).toBeVisible();
  await pickLanguage(page, 'Português (Brasil)');
  await expect(page.getByRole('heading', { name: 'A VPC', level: 2 })).toBeVisible();

  await page.goto(`/#view=${encodeShare({ name: 'rede', files: { 'main.tf': MAIN } })}`);
  await expect(page.getByRole('heading', { name: /Visualizando rede/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('somente leitura', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fazer uma cópia para editar' })).toBeVisible();
  await page.getByRole('button', { name: 'Compartilhar' }).click();
  await expect(page.getByRole('menuitem', { name: 'Copiar link de visualização' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveTitle('rede (visualização) — Cloud Blueprint');

  await page.goto('/#view=AAAA');
  await expect(page.getByRole('heading', { name: 'Não foi possível abrir esta visualização' })).toBeVisible();

  await page.goto('/nada-por-aqui');
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voltar aos projetos' })).toBeVisible();
  await expect(page).toHaveTitle('Página não encontrada — Cloud Blueprint');
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds nothing serious in Portuguese (${theme})`, async ({ page }) => {
    test.setTimeout(120_000); // eight screens, each audited
    await inPortuguese(page, theme);
    const screens: Array<[string, () => Promise<void>]> = [
      ['landing', () => page.goto('/').then(() => undefined)],
      ['dashboard', () => page.goto('/dashboard').then(() => undefined)],
      [
        'template picker',
        async () => {
          await page.goto('/dashboard');
          await page.getByRole('button', { name: 'Novo projeto' }).click();
          await expect(page.getByRole('dialog', { name: 'Começar com um template' })).toBeVisible();
        },
      ],
      [
        'restore dialog',
        async () => {
          await page.goto('/dashboard');
          await page.getByTestId('restore-input').setInputFiles({ name: 'b.zip', mimeType: 'application/zip', buffer: backupZip() });
          await expect(page.getByRole('dialog').getByRole('button', { name: 'Restaurar 1 projeto' })).toBeVisible();
        },
      ],
      [
        'GitHub import',
        async () => {
          await page.goto('/dashboard');
          await page.getByRole('button', { name: 'Importar do GitHub…' }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
        },
      ],
      ['tutorials', () => page.goto('/tutorials').then(() => undefined)],
      ['lesson', () => page.goto('/tutorials/first-vpc-ec2?step=3').then(() => undefined)],
      ['404', () => page.goto('/nada').then(() => undefined)],
    ];
    for (const [name, open] of screens) {
      await open();
      expect(await audit(page), `${name} (${theme})`).toEqual([]);
    }
  });
}

test.describe('on a phone (390px), in Portuguese', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nothing scrolls sideways', async ({ page }) => {
    await inPortuguese(page);
    for (const path of ['/', '/dashboard', '/dashboard?new=1', '/tutorials', '/tutorials/first-vpc-ec2?step=5', '/nada']) {
      await page.goto(path);
      await page.waitForTimeout(300);
      expect(await sidewaysScroll(page), path).toBeLessThanOrEqual(0);
    }
    // the landing header keeps to one line: the button sits beside the logo
    await page.goto('/');
    const button = (await page.getByRole('button', { name: 'Abrir o app' }).boundingBox())!;
    expect(button.height).toBeLessThan(40);
    expect(button.x + button.width).toBeLessThanOrEqual(390);
  });
});

test.describe('a Portuguese browser', () => {
  test.use({ locale: 'pt-BR' });

  test('opens in Portuguese on its first visit', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    // the seeded demo is described in the language it was created in
    await expect(page.getByText(/^Projeto de demonstração — /)).toBeVisible();
  });
});
