/**
 * The editor in Portuguese: a switch in the middle of an edit changes the
 * words in place (the history, the code, the selection, Monaco and the open
 * panels stay), the inspector, canvas and ⌘K speak Portuguese, axe finds
 * nothing serious in either theme, and on a phone the longer words fit.
 * Plus the palette adding into the selected container, the stats pills
 * keeping to the free canvas, and Esc closing only the top-most layer.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { focusEndOfCode, insertCode, SEED_PROJECT, storedProject, waitForMonaco } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page, name = 'Inspetor') => page.getByRole('complementary', { name });
const stats = (page: Page) => page.getByTestId('canvas').getByText(/^\d+ recursos?, \d+ (conexão|conexões)$/);

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

/** Open the seed project, in Portuguese unless told otherwise, with the tips out of the way. */
async function openSeed(page: Page, { locale = 'pt-BR', theme = 'light', monaco = true } = {}) {
  await page.addInitScript(
    ([l, t]) => {
      localStorage.setItem('cb-locale', l);
      localStorage.setItem('cb-theme', t);
      localStorage.setItem('cb-tips-dismissed', '1');
    },
    [locale, theme],
  );
  await page.goto('/dashboard');
  await page.getByRole('button', { name: locale === 'en' ? `Open project ${SEED_PROJECT}` : `Abrir projeto ${SEED_PROJECT}` }).click();
  await expect(page).toHaveURL(/\/editor\//);
  if (monaco) await waitForMonaco(page);
  await expect(node(page, 'aws_instance.web')).toBeVisible();
}

async function saved(page: Page, word: 'Saved' | 'Salvo') {
  await expect(page.locator('header [role="status"]')).toHaveText(word, { timeout: 5_000 });
}

/** select a resource as a click on its node does — wherever the canvas has scrolled it */
async function select(page: Page, id: string) {
  await node(page, id).dispatchEvent('click');
  await expect(page.getByTestId('inspector-address')).toHaveText(id);
}

async function audit(page: Page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  await page.waitForTimeout(400); // entry animations: axe measures the colors actually painted
  // …and the code pane's short highlight of a selected block
  await expect(page.locator('.bp-code-flash')).toHaveCount(0, { timeout: 4_000 });
  return page.evaluate(async () => {
    type Violation = { id: string; impact: string; nodes: Array<{ target: string[] }> };
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<{ violations: Violation[] }> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test('a switch mid-edit re-words the editor in place: history, code, selection, Monaco and panels stay', async ({ page }) => {
  await openSeed(page, { locale: 'en' });
  await saved(page, 'Saved');
  const initial = (await storedProject(page, SEED_PROJECT))!.files;

  // a canvas edit, then a code edit: two undo steps
  await select(page, 'aws_iam_role.web');
  await page.keyboard.press('Control+d');
  await expect(node(page, 'aws_iam_role.web_copy')).toBeVisible();
  await focusEndOfCode(page);
  await insertCode(page, 'resource "aws_sqs_queue" "jobs" {}');
  await expect(node(page, 'aws_sqs_queue.jobs')).toBeVisible();
  await select(page, 'aws_security_group.web');
  await page.getByRole('button', { name: 'Security grade', exact: false }).click();
  await expect(page.getByRole('complementary', { name: 'Security' })).toBeVisible();
  await saved(page, 'Saved');
  const edited = (await storedProject(page, SEED_PROJECT))!;
  // Monaco is the same editor afterwards, not a new one
  await page.locator('[data-testid="monaco"] .monaco-editor').evaluate((el) => el.setAttribute('data-sweep-mark', '1'));

  await page.getByRole('button', { name: /^Language: / }).click();
  await page.getByRole('menuitemradio', { name: 'Português (Brasil)' }).click();

  // the words changed…
  await expect(inspector(page)).toBeVisible();
  await expect(inspector(page).getByRole('heading', { name: 'Grupo de segurança' })).toBeVisible();
  await expect(inspector(page).getByRole('tab', { name: 'Regras' })).toHaveAttribute('aria-selected', 'true');
  await expect(inspector(page).getByText('Origem: Internet (IPv4)').first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Segurança' })).toBeVisible();
  await expect(node(page, 'aws_security_group.web')).toContainText('3 de entrada · 1 de saída');
  await expect(node(page, 'aws_security_group.web')).toContainText('Grupo de segurança');
  await expect(node(page, 'aws_instance.web')).toHaveAttribute('aria-label', 'Instância EC2 web, em Sub-rede public_a');
  await expect(stats(page)).toHaveText(/^13 recursos, \d+ conexões$/);
  await expect(page.getByRole('button', { name: 'Desfazer', exact: true })).toBeEnabled();
  // …nothing else did: the selection, the panels, Monaco and what is stored
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_security_group.web');
  await expect(page.locator('[data-testid="monaco"] .monaco-editor[data-sweep-mark="1"]')).toHaveCount(1);
  await page.waitForTimeout(800);
  expect(await storedProject(page, SEED_PROJECT)).toEqual(edited);

  // the history still undoes each step, in order
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(node(page, 'aws_sqs_queue.jobs')).toHaveCount(0);
  await expect(node(page, 'aws_iam_role.web_copy')).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(node(page, 'aws_iam_role.web_copy')).toHaveCount(0);
  await saved(page, 'Salvo');
  expect((await storedProject(page, SEED_PROJECT))!.files).toEqual(initial);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  await expect(node(page, 'aws_iam_role.web_copy')).toBeVisible();

  // ⌘K opened afterwards speaks Portuguese, and finds resources by their Portuguese kind
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder('Buscar ou executar um comando…')).toBeVisible();
  await expect(page.getByRole('option', { name: /Auditoria de segurança/ })).toBeVisible();
  await page.keyboard.type('sub-rede');
  await expect(page.getByRole('option', { name: /public_a\s*Sub-rede/ })).toBeVisible();
});

test('the inspector, the canvas and ⌘K in Portuguese', async ({ page }) => {
  await openSeed(page);
  await select(page, 'aws_instance.web');
  const i = inspector(page);
  await expect(i.getByRole('heading', { name: 'Instância EC2' })).toBeVisible();
  await expect(i.getByText('Máquina virtual')).toBeVisible();
  await expect(i.getByRole('tab', { name: 'Propriedades' })).toBeVisible();
  await expect(i.getByText('Nome no Terraform')).toBeVisible();
  await expect(i.getByText(/^Exposto à internet em :80, :443$/)).toBeVisible();
  await expect(i.getByRole('button', { name: 'Excluir recurso' })).toBeVisible();
  await i.getByRole('tab', { name: 'Conexões' }).click();
  await expect(i.getByText(/^Saída \(\d+\)$/)).toBeVisible();

  await select(page, 'aws_db_instance.main');
  await expect(i.getByRole('heading', { name: 'Instância RDS' })).toBeVisible();
  await i.getByRole('tab', { name: 'Propriedades' }).click();
  await expect(i.locator('select').first().locator('option').first()).toHaveText(/— nenhum —|— não definido —/);
  await select(page, 'aws_subnet.public_a');
  await expect(i.getByText('obrigatório', { exact: true }).first()).toBeVisible();

  // canvas: node titles, lens chips (the PDF's words), toolbar, menus
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ajustar à tela  ⇧1' }).click();
  await page.waitForTimeout(500);
  await expect(node(page, 'aws_subnet.public_a')).toContainText('Sub-rede');
  await page.getByRole('button', { name: 'Lente de segurança' }).click();
  await expect(node(page, 'aws_instance.web').locator('.bp-sec-chip')).toHaveText('Público :80, :443');
  await expect(node(page, 'aws_db_instance.main').locator('.bp-sec-chip')).toHaveText('Privado');
  await expect(node(page, 'aws_subnet.public_a')).toContainText('pública');
  await page.getByRole('button', { name: 'Ocultar lente de segurança' }).click();
  await node(page, 'aws_instance.web').click({ button: 'right', position: { x: 16, y: 10 } });
  const menu = page.getByRole('menu', { name: 'Ações do recurso' });
  await expect(menu.getByRole('menuitem', { name: 'Duplicar' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Excluir' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Controles do canvas' }).getByRole('button', { name: 'Organizar' })).toBeVisible();

  // ⌘K: groups, templates and the add page
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await expect(page.getByText('Novo projeto a partir de template')).toBeVisible();
  await expect(page.getByRole('option', { name: /App web na AWS/ })).toBeVisible();
  await page.getByRole('option', { name: /^Adicionar recurso…/ }).click();
  await expect(page.getByPlaceholder('Buscar entre mais de 80 recursos de AWS, Azure e GCP…')).toBeVisible();
  await page.keyboard.type('fila');
  await expect(page.getByRole('option', { name: /Fila SQS/ })).toBeVisible();
});

test('a palette click with a container selected adds into it, as a drop would — one undo step', async ({ page }) => {
  await openSeed(page);
  await select(page, 'aws_subnet.public_b');
  await page.getByRole('button', { name: 'Adicionar Instância EC2 (aws_instance)' }).click();
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_instance.instance');
  await saved(page, 'Salvo');
  const main = (await storedProject(page, SEED_PROJECT))!.files['main.tf'];
  const block = main.slice(main.indexOf('resource "aws_instance" "instance"')).split(/\nresource /)[0];
  expect(block).toMatch(/subnet_id\s*=\s*aws_subnet\.public_b\.id/);
  // drawn inside the subnet
  const subnet = await box(node(page, 'aws_subnet.public_b'));
  const added = await box(node(page, 'aws_instance.instance'));
  expect(added.x).toBeGreaterThanOrEqual(subnet.x);
  expect(added.x + added.width).toBeLessThanOrEqual(subnet.x + subnet.width + 1);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(node(page, 'aws_instance.instance')).toHaveCount(0);

  // a container that can't hold it: beside it, with the reason
  await select(page, 'aws_vpc.main');
  await page.getByRole('button', { name: 'Adicionar Bucket S3 (aws_s3_bucket)' }).click();
  await expect(page.getByTestId('inspector-address')).toHaveText('aws_s3_bucket.bucket');
  await expect(page.getByText(/^Não pode ficar na VPC main/).first()).toBeVisible();
});

test('Esc on the Layout menu closes only it, not the security panel under it', async ({ page }) => {
  await openSeed(page, { monaco: false });
  await page.getByRole('button', { name: 'Segurança, nota', exact: false }).click();
  const security = page.getByRole('complementary', { name: 'Segurança' });
  await expect(security).toBeVisible();
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  const menu = page.getByTestId('layout-menu');
  await menu.locator('[data-preset="default"]').focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(security).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(security).toBeHidden();
});

test('the stats pills stay in the canvas the floating inspector leaves free', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openSeed(page, { monaco: false });
  const canvas = await box(page.getByTestId('canvas'));
  await select(page, 'aws_instance.web');
  const panel = await box(inspector(page));
  await expect.poll(async () => (await box(page.getByTestId('canvas-pills'))).x + (await box(page.getByTestId('canvas-pills'))).width).toBeLessThanOrEqual(panel.x);
  expect((await box(page.getByTestId('canvas-pills'))).x).toBeGreaterThanOrEqual(canvas.x);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds nothing serious in the Portuguese editor (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await openSeed(page, { theme });
    expect(await audit(page), 'editor').toEqual([]);
    await select(page, 'aws_security_group.web');
    expect(await audit(page), 'inspector: rules').toEqual([]);
    await inspector(page).getByRole('tab', { name: 'Propriedades' }).click();
    expect(await audit(page), 'inspector: properties').toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Segurança, nota', exact: false }).click();
    expect(await audit(page), 'security panel').toEqual([]);
    await page.getByRole('button', { name: 'Fechar painel de segurança' }).click();
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    expect(await audit(page), 'layout menu').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    expect(await audit(page), 'command palette').toEqual([]);
  });
}

test.describe('on a phone (390px), in Portuguese', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const overflows = (locator: Locator) =>
    locator.evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));

  test('nothing scrolls sideways; the bar, tabs, toolbar, menus and palette fit', async ({ page }) => {
    await openSeed(page, { monaco: false });
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await sideways()).toBeLessThanOrEqual(0);
    const header = page.locator('header').first();
    expect(await header.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const toolbar = await box(page.getByRole('toolbar', { name: 'Controles do canvas' }));
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(390);

    // the inspector's three tabs, each word whole; the stats pills step aside
    await select(page, 'aws_security_group.web');
    expect(await overflows(inspector(page).getByRole('tab'))).toEqual([]);
    // once it has slid in
    await expect.poll(async () => Math.round((await box(inspector(page))).x + (await box(inspector(page))).width)).toBeLessThanOrEqual(390);
    await expect(page.getByTestId('canvas-pills')).toHaveCSS('visibility', 'hidden');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('canvas-pills')).toHaveCSS('visibility', 'visible');
    const pills = await box(page.getByTestId('canvas-pills'));
    expect(pills.x).toBeGreaterThanOrEqual(0);
    expect(pills.x + pills.width).toBeLessThanOrEqual(390);

    // the ⋯ menu (with the languages), the Layout menu from it, a context menu
    await page.getByRole('button', { name: 'Mais ações' }).click();
    const more = page.getByRole('menu', { name: 'Mais ações' });
    await expect(more.getByRole('menuitemradio', { name: 'Português (Brasil)' })).toHaveAttribute('aria-checked', 'true');
    const m = await box(more);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(390);
    await more.getByRole('menuitem', { name: 'Layout…' }).click();
    const layout = await box(page.getByTestId('layout-menu'));
    expect(layout.x).toBeGreaterThanOrEqual(0);
    expect(layout.x + layout.width).toBeLessThanOrEqual(390);
    expect(await overflows(page.getByTestId('layout-menu').locator('button, label'))).toEqual([]);
    await page.keyboard.press('Escape');
    await node(page, 'aws_instance.web').click({ button: 'right', position: { x: 16, y: 10 } });
    const ctx = await box(page.getByRole('menu'));
    expect(ctx.x + ctx.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');

    // the palette drawer: category headers and names fit (names may truncate, headers don't)
    await page.getByRole('button', { name: /^Paleta de recursos/ }).click();
    const palette = page.getByRole('complementary', { name: 'Paleta de recursos' });
    await expect(palette).toBeVisible();
    expect(await overflows(palette.locator('h3 button span.flex-1'))).toEqual([]);
    expect(await sideways()).toBeLessThanOrEqual(0);
  });

  test('switching back to English from the ⋯ menu', async ({ page }) => {
    await openSeed(page, { monaco: false });
    await page.getByRole('button', { name: 'Mais ações' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
    await expect(page.getByTestId('canvas').getByText(/^\d+ resources?, \d+ connections?$/)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
