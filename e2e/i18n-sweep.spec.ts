/**
 * Nothing on screen is left in English. The app is crawled twice, in
 * Portuguese and in English, through the same screens and states — landing,
 * dashboard and its dialogs, tutorials, the editor (seed project and an
 * Azure and a GCP template: palette, inspector tabs, multi-selection,
 * security panel and rules editor, cost, layout presets, ⌘K, context menus,
 * a drop hint, export / PDF / shortcuts dialogs), a project with module
 * calls (module nodes and inspector, an opened local module, "Add module…"),
 * a share link, the viewer and the 404. At each stop every visible text node is collected, with
 * `aria-label`, `title`, `placeholder`, `alt` and tooltip text. A string
 * that reads the same in both languages is an English leak unless it is
 * one of the tokens that are never translated (see ALLOWED and `untranslated`
 * below, and src/i18n/GLOSSARY.md).
 *
 * Not collected: Monaco (Terraform code, and Monaco's own widgets, which only
 * localize at load) and `<pre>` / `<code>` (code and addresses).
 */
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { parseProject } from '../src/hcl/parser';
import type { Expression } from '../src/ir/types';
import { resourceName, resourceShortName, categoryLabel } from '../src/resources/i18n';
import { allDefs } from '../src/resources/registry';
import { FRAMEWORKS } from '../src/security/compliance';
import { CATEGORY_ORDER } from '../src/resources/types';
import { encodeShare } from '../src/lib/share';
import { slugify } from '../src/lib/utils';
import { TEMPLATES } from '../src/templates';
import { templateName } from '../src/templates/i18n';
import { SEED_PROJECT } from './helpers';

type Lang = 'en' | 'pt-BR';

/**
 * Words that are the same in both languages on purpose. Keep it short: a new
 * entry needs a reason (the glossary's "never translate" list).
 */
const ALLOWED = new Set([
  // product, provider and file-format names
  'Cloud Blueprint', 'Cloud', 'Blueprint', 'Terraform', 'GitHub', 'AWS', 'Azure', 'GCP', 'Google', 'Google Cloud', 'Monaco',
  'Aurora', 'Single-AZ', 'Multi-AZ',
  // Terraform provider names and protocol keywords, as written in code
  'aws', 'azurerm', 'google', 'tcp', 'udp', 'icmp',
  // the languages, each named in itself (the flag picker)
  'English', 'Português (Brasil)',
  // loanwords the glossary keeps: "canvas", "layout", "template", "backup", "internet", "gateway", "zoom", "outputs", "gist", "token",
  // "app", "ping", and "Multi" (the multicloud badge)
  'Canvas', 'canvas', 'Layout', 'layout', 'Template', 'Templates', 'template', 'Backup', 'backup', 'Internet', 'internet', 'Zoom',
  'Outputs', 'outputs', 'gist', 'token', 'App', 'ping', 'Multi', 'gateway',
  // units: "8 GiB", "15 min"
  'GiB', 'GB', 'MiB', 'min',
  // the code pane's status bar, as in VS Code's Portuguese: "Ln 12, Col 5"
  'Ln', 'Col',
  // keys
  'Ctrl', 'Esc', 'esc', 'Del', 'Enter', 'Shift', 'Alt', 'Tab',
  // where a module comes from: the Terraform Registry and git (product names), a local folder ("módulo local")
  'Registry', 'Git', 'Local',
]);

/** a token that is never translated: acronyms, identifiers, numbers, addresses, CIDRs, control IDs, file names */
function untranslatedToken(token: string, data: Set<string>): boolean {
  if (ALLOWED.has(token) || data.has(token)) return true;
  if (!/\p{L}/u.test(token)) return true; // numbers, prices, ports, symbols
  if (/^[A-Z]$/.test(token)) return true; // a key (Ctrl K) or a grade (A–F)
  if (/^(Ctrl|⌘|⇧)[A-Z0-9]$/.test(token)) return true; // a shortcut: CtrlD
  if (/\p{Ll}\p{Lu}/u.test(token)) return true; // product names: MongoDB, PostgreSQL, GitHub, CloudFront
  if (/^[A-Z][A-Z0-9]{1,6}s?$/.test(token)) return true; // VPC, NAT, HTTPS, IMDSv2, FSBP, NACL
  if (/[_\d]/.test(token)) return true; // aws_instance, public_a, t3.micro, EC2, IPv4, us-east-1a
  if (/\w[./:]\w/.test(token)) return true; // main.tf, aws_vpc.main, github.com/owner/repo, tag:web
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(token)) return true; // kebab-case names: production-web, orders-api
  return false;
}

/** multi-word names (catalog names that are product names, compliance frameworks): taken out before the words are checked */
let phrases: string[] = [];

function untranslated(text: string, data: Set<string>): boolean {
  if (ALLOWED.has(text) || data.has(text)) return true;
  let rest = text;
  for (const phrase of phrases) if (rest.includes(phrase)) rest = rest.split(phrase).join(' ');
  const tokens = rest.split(/[\s,;·•—–→←↔…()[\]{}"'“”‘’=+×|<>!?*~]+|[:/](?=\s|$)|(?<=\s|^)[:/]/).filter(Boolean);
  return tokens.every((t) => untranslatedToken(t, data));
}

/* ------------------------------------------------------------------ data */

/** a root module calling a local module (kept by the import) and a Registry one */
const MODULE_ROOT = `module "network" {
  source = "./modules/network"
  cidr   = "10.20.0.0/16"
  name   = "prod"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"

  name = "shared"
  cidr = "10.0.0.0/16"
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
  subnet_id     = module.network.private_subnet_ids[0]
}
`;
const MODULE_NETWORK = {
  'main.tf': 'resource "aws_vpc" "this" {\n  cidr_block = var.cidr\n}\n\nresource "aws_subnet" "private" {\n  vpc_id     = aws_vpc.this.id\n  cidr_block = var.cidr\n}\n',
  'variables.tf': 'variable "cidr" {\n  type        = string\n  description = "The VPC address range"\n}\n\nvariable "name" {\n  type = string\n}\n\nvariable "az_count" {\n  type    = number\n  default = 2\n}\n',
  'outputs.tf': 'output "private_subnet_ids" {\n  value = [aws_subnet.private.id]\n}\n',
};

function moduleZip(): Buffer {
  return Buffer.from(
    zipSync({
      'stack/main.tf': strToU8(MODULE_ROOT),
      ...Object.fromEntries(Object.entries(MODULE_NETWORK).map(([f, t]) => [`stack/modules/network/${f}`, strToU8(t)])),
    }),
  );
}

const TEMPLATE_SLUGS = ['aws-web-app', 'azure-web-app', 'gcp-web-app'] as const;

/** everything a project's own code names: ids, types, names, literal values, variables, outputs, files */
function projectData(): Set<string> {
  const out = new Set<string>([SEED_PROJECT]);
  const literals = (e: Expression | undefined): void => {
    if (!e) return;
    if (e.kind === 'literal' && e.value !== null) out.add(String(e.value));
    if (e.kind === 'ref') out.add(e.path);
    if (e.kind === 'list') e.items.forEach(literals);
    if (e.kind === 'object') Object.entries(e.fields).forEach(([k, v]) => (out.add(k), literals(v)));
    if (e.kind === 'block') Object.entries(e.body).forEach(([k, v]) => (out.add(k), literals(v)));
    if (e.kind === 'blocks') e.items.forEach((b) => Object.entries(b).forEach(([k, v]) => (out.add(k), literals(v))));
  };
  // the module project (named after its zip) and its own code: module calls, the child module's blocks
  out.add('stack');
  for (const files of [{ 'main.tf': MODULE_ROOT }, MODULE_NETWORK]) {
    const { ir } = parseProject(files);
    for (const m of ir.modules) {
      out.add(m.id).add(m.name);
      Object.entries(m.args).forEach(([k, v]) => (out.add(k), literals(v)));
    }
    for (const r of ir.resources) out.add(r.id).add(r.name).add(r.type);
    for (const v of ir.variables) {
      out.add(v.name);
      Object.values(v.args).forEach(literals);
      if (v.args.type?.kind === 'ref') out.add(v.args.type.path);
    }
    for (const o of ir.outputs) out.add(o.name);
  }
  for (const slug of TEMPLATE_SLUGS) {
    const t = TEMPLATES.find((x) => x.slug === slug)!;
    const names = slug === 'aws-web-app' ? [SEED_PROJECT] : [templateName(t, 'en'), templateName(t, 'pt-BR')];
    for (const name of names) {
      const files = t.build(slugify(name));
      Object.keys(files).forEach((f) => out.add(f));
      const { ir } = parseProject(files);
      for (const r of ir.resources) {
        out.add(r.id).add(r.name).add(r.type);
        Object.entries(r.args).forEach(([k, v]) => (out.add(k), literals(v)));
      }
      for (const v of ir.variables) out.add(v.name);
      for (const o of ir.outputs) out.add(o.name);
    }
  }
  // catalog names that are product names in both languages ("Application Load Balancer", "NAT gateway"),
  // and the values a select offers ("postgres", "gp3")
  for (const def of allDefs()) {
    for (const pick of [resourceName, resourceShortName]) {
      if (pick(def.type, 'en') === pick(def.type, 'pt-BR')) out.add(pick(def.type, 'en'));
    }
    for (const f of def.fields) f.options?.forEach((o) => out.add(o));
  }
  // compliance frameworks are named by their publishers
  for (const f of FRAMEWORKS) for (const v of Object.values(f)) if (typeof v === 'string') out.add(v);
  for (const c of CATEGORY_ORDER) if (categoryLabel(c, 'en') === categoryLabel(c, 'pt-BR')) out.add(categoryLabel(c, 'en'));
  for (const t of TEMPLATES) if (templateName(t, 'en') === templateName(t, 'pt-BR')) out.add(templateName(t, 'en'));
  return out;
}

/* ------------------------------------------------------------ collecting */

/** visible text nodes plus aria-label / title / placeholder / alt / tooltip, outside Monaco and code */
function collect(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    // Monaco and its widgets, code, and what the page marks as not to be translated or as another language
    const lang = document.documentElement.lang;
    const SKIP = `.monaco-editor, [class*="monaco-"], .overflowingContentWidgets, pre, code, script, style, template, [translate="no"], [lang]:not([lang="${lang}"])`;
    const add = (s: string | null | undefined) => {
      const t = (s ?? '').replace(/\s+/g, ' ').trim();
      if (t) out.add(t);
    };
    const visible = (el: Element) => (el as HTMLElement).checkVisibility?.({ visibilityProperty: true } as never) ?? true;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest(SKIP) || el.tagName === 'OPTION') continue;
      if (visible(el)) add(n.textContent);
    }
    const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'data-tip', 'aria-roledescription', 'aria-description'];
    for (const el of Array.from(document.body.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(', ')))) {
      if (el.closest(SKIP) || !visible(el)) continue;
      for (const attr of ATTRS) add(el.getAttribute(attr));
    }
    // what assistive tech reads out, even when it isn't drawn (React Flow's hidden descriptions)
    for (const el of Array.from(document.body.querySelectorAll('[aria-describedby]'))) {
      if (el.closest(SKIP) || !visible(el)) continue;
      for (const id of (el.getAttribute('aria-describedby') ?? '').split(/\s+/)) add(document.getElementById(id)?.textContent);
    }
    for (const select of Array.from(document.querySelectorAll('select'))) {
      if (visible(select)) for (const option of Array.from(select.options)) add(option.text);
    }
    add(document.title);
    return [...out];
  });
}

/* ------------------------------------------------------------- the crawl */

const MAIN = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`;

function backupZip(): Buffer {
  const now = new Date().toISOString();
  const manifest = {
    format: 'cloud-blueprint-backup',
    version: 1,
    app: 'Cloud Blueprint',
    exportedAt: now,
    projects: [{ id: 'prj_sweep', name: SEED_PROJECT, createdAt: now, updatedAt: now, hash: '', files: [{ name: 'main.tf', path: 'p/main.tf' }] }],
  };
  return Buffer.from(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'p/main.tf': strToU8(MAIN) }));
}

const seedFiles = () => TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build(SEED_PROJECT);

async function crawl(browser: Browser, lang: Lang): Promise<Map<string, string[]>> {
  const context = await browser.newContext({ locale: lang === 'en' ? 'en-US' : 'pt-BR', viewport: { width: 1440, height: 900 } });
  await context.addInitScript((l) => localStorage.setItem('cb-locale', l), lang);
  const page = await context.newPage();
  const L = (en: string, pt: string) => (lang === 'en' ? en : pt);
  const stops = new Map<string, string[]>();
  const stop = async (name: string) => {
    await page.waitForTimeout(250); // entry animations and debounced labels settle
    stops.set(name, await collect(page));
  };
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  const inspector = () => page.getByRole('complementary', { name: L('Inspector', 'Inspetor') });
  const close = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };
  /** every tab of the inspector for each resource */
  const inspect = async (label: string, ids: string[]) => {
    for (const id of ids) {
      await page.keyboard.press('Escape');
      await node(id).click({ position: { x: 16, y: 10 } });
      await expect(inspector().getByTestId('inspector-address')).toHaveText(id);
      const tabs = inspector().getByRole('tab');
      const count = await tabs.count();
      for (let i = 0; i < count; i++) {
        await tabs.nth(i).click();
        const more = inspector().getByTestId('schema-fields').locator('button[aria-expanded="false"]');
        if (await more.count()) await more.first().click();
        await stop(`${label}: inspector ${id} tab ${i}`);
      }
    }
    await page.keyboard.press('Escape');
  };

  try {
    // ------------------------------------------------------------- shell
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await stop('landing');

    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: L(`Open project ${SEED_PROJECT}`, `Abrir projeto ${SEED_PROJECT}`) })).toBeVisible();
    await stop('dashboard + data panel');
    await page.getByRole('button', { name: L('New Project', 'Novo projeto') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('template picker');
    await close();
    await page.getByRole('button', { name: L('Import from GitHub…', 'Importar do GitHub…') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('GitHub import');
    await close();
    await page.getByTestId('restore-input').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: backupZip() });
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('restore dialog');
    await close();

    await page.goto('/tutorials');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await stop('tutorials');
    await page.goto('/tutorials/first-vpc-ec2?step=3');
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await stop('lesson');

    await page.goto('/nothing-here');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await stop('404');

    await page.goto(`/#share=${encodeShare({ name: 'shared-net', files: { 'main.tf': MAIN } })}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('share link dialog');
    await close();

    // ------------------------------------------------------------ viewer
    await page.goto(`/#view=${encodeShare({ name: SEED_PROJECT, files: seedFiles() })}`);
    await expect(node('aws_instance.web')).toBeVisible({ timeout: 15_000 });
    await stop('viewer');
    await node('aws_security_group.web').click({ position: { x: 16, y: 10 } });
    await expect(inspector()).toBeVisible();
    await stop('viewer: inspector');
    await close();
    await page.getByRole('button', { name: L('Export', 'Exportar'), exact: true }).click();
    await stop('viewer: export menu');
    await close();

    // ------------------------------------------------------ editor (seed)
    await page.goto('/dashboard');
    await page.getByRole('button', { name: L(`Open project ${SEED_PROJECT}`, `Abrir projeto ${SEED_PROJECT}`) }).click();
    await expect(page.locator('[data-testid="monaco"] .monaco-editor')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('cost-chip')).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 });
    await stop('editor: default, tips');
    for (const provider of ['Azure', 'GCP']) {
      await page.getByRole('tab', { name: provider, exact: true }).click();
      await stop(`editor: palette ${provider}`);
    }
    await page.getByRole('tab', { name: 'AWS', exact: true }).click();

    await inspect('seed', ['aws_instance.web', 'aws_subnet.public_a', 'aws_db_instance.main', 'aws_security_group.web', 'aws_iam_role.web', 'aws_vpc.main']);

    await node('aws_instance.web').click({ position: { x: 16, y: 10 } });
    await node('aws_internet_gateway.igw').click({ position: { x: 16, y: 10 }, modifiers: ['Control'] });
    await expect(page.getByTestId('canvas').locator('.react-flow__node.selected')).toHaveCount(2);
    await stop('multi-selection');
    await node('aws_internet_gateway.igw').click({ button: 'right', position: { x: 16, y: 10 } });
    await expect(page.getByRole('menu')).toBeVisible();
    await stop('multi-selection: context menu');
    await close();
    await close();

    await node('aws_instance.web').click({ button: 'right', position: { x: 16, y: 10 } });
    await expect(page.getByRole('menu')).toBeVisible();
    await stop('node context menu');
    await close();
    await close();
    await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 60, y: 700 } });
    await expect(page.getByRole('menu')).toBeVisible();
    await stop('canvas context menu');
    await close();

    // a drop hint: drag the instance over the other subnet, then back where it was
    const from = (await node('aws_instance.web').boundingBox())!;
    const to = (await node('aws_subnet.public_b').boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 30, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await expect(page.getByTestId('drop-hint')).toBeVisible();
    await stop('drop hint');
    await page.mouse.move(from.x + 20, from.y + 12, { steps: 10 });
    await page.mouse.up();
    await close();

    await page.locator('[data-overview-toggle]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('project overview');
    await close();

    await page.getByTestId('cost-chip').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('cost popover');
    await close();

    await page.getByRole('button', { name: L('Security lens', 'Lente de segurança') }).click();
    await expect(page.locator('.bp-sec-chip').first()).toBeVisible();
    await stop('security lens');
    await page.getByRole('button', { name: L('Hide security lens', 'Ocultar lente de segurança') }).click();

    await page.getByRole('button', { name: L('Security grade', 'Segurança, nota'), exact: false }).first().click();
    const security = page.getByRole('complementary', { name: L('Security', 'Segurança') });
    await expect(security).toBeVisible();
    await stop('security panel');
    await security.locator('[data-finding] button[aria-expanded]').first().click();
    await stop('security panel: a finding');
    await security.locator('[data-exposed] button[aria-expanded]').first().click();
    await stop('security panel: why reachable');
    await security.getByRole('button', { name: L('Close security panel', 'Fechar painel de segurança') }).click();

    await node('aws_security_group.web').click({ position: { x: 16, y: 10 } });
    await inspector().getByRole('button', { name: L('Edit rules', 'Editar regras') }).click();
    const rules = page.getByRole('dialog');
    await expect(rules).toBeVisible();
    await stop('rules editor');
    await rules.getByRole('button', { name: L('Add rule', 'Nova regra') }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await stop('rules editor: add rule');
    await close();
    await close();
    await close();

    const layoutButton = page.getByRole('button', { name: 'Layout', exact: true });
    await layoutButton.click();
    await expect(page.getByTestId('layout-menu')).toBeVisible();
    await stop('layout menu');
    for (const preset of ['code-left', 'canvas-focus', 'code-focus', 'default']) {
      await page.getByTestId('layout-menu').locator(`[data-preset="${preset}"]`).click();
      await close();
      await stop(`layout preset ${preset}`);
      await layoutButton.click();
    }
    await close();

    await page.getByRole('button', { name: L('Export', 'Exportar'), exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await stop('export menu');
    await page.getByRole('menuitem').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('PDF dialog');
    await close();

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await stop('shortcuts dialog');
    await close();

    await page.keyboard.press('Control+k');
    await expect(page.locator('[cmdk-input]')).toBeVisible();
    await stop('command palette');
    await page.keyboard.type('subnet');
    await stop('command palette: a query');
    await page.locator('[cmdk-input]').fill('');
    await page.locator('[cmdk-item][data-value="add-resource"]').click();
    await stop('command palette: add resource');
    await close();

    // --------------------------------------------- templates on Azure and GCP
    for (const [slug, ids] of [
      ['azure-web-app', ['azurerm_linux_virtual_machine.app', 'azurerm_network_security_group.app', 'azurerm_subnet.app']],
      ['gcp-web-app', ['google_compute_instance.web', 'google_compute_firewall.allow_http', 'google_sql_database_instance.main']],
    ] as const) {
      await page.keyboard.press('Control+k');
      await page.locator(`[cmdk-item][data-value="template ${slug}"]`).click();
      await expect(node(ids[0])).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);
      await stop(`${slug}: canvas`);
      await inspect(slug, [...ids]);
      await page.getByRole('button', { name: L('Security lens', 'Lente de segurança') }).click();
      await stop(`${slug}: security lens`);
      await page.getByRole('button', { name: L('Hide security lens', 'Ocultar lente de segurança') }).click();
    }

    // ------------------------------------------------------------- modules
    await page.goto('/dashboard');
    await page.getByLabel(L('Import Terraform files', 'Importar arquivos Terraform')).setInputFiles([
      { name: 'stack.zip', mimeType: 'application/zip', buffer: moduleZip() },
    ]);
    await expect(node('module.network')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    await stop('modules: canvas and import note');
    const moduleInspector = page.getByRole('complementary', { name: L('Module inspector', 'Inspetor do módulo') });
    for (const id of ['module.network', 'module.vpc']) {
      await page.keyboard.press('Escape');
      await node(id).click({ position: { x: 16, y: 10 } });
      await expect(moduleInspector.getByTestId('inspector-address')).toHaveText(id);
      const optional = moduleInspector.locator('details > summary');
      if (await optional.count()) await optional.first().click();
      await stop(`modules: inspector ${id}`);
    }
    await page.keyboard.press('Escape');
    await node('module.vpc').click({ button: 'right', position: { x: 16, y: 10 } });
    await expect(page.getByRole('menu')).toBeVisible();
    await stop('modules: context menu');
    await close();
    await close();
    await node('module.network').dblclick({ position: { x: 16, y: 10 } });
    await expect(page.getByTestId('module-view')).toBeVisible();
    await page.waitForTimeout(600);
    await stop('modules: an opened module');
    await close();
    await expect(page.getByTestId('module-view')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.getByTestId('cost-chip').click();
    await expect(page.getByTestId('modules-note-cost')).toBeVisible();
    await stop('modules: cost popover');
    await close();
    await page.getByRole('button', { name: L('Security lens', 'Lente de segurança') }).click();
    await stop('modules: security lens');
    await page.getByRole('button', { name: L('Hide security lens', 'Ocultar lente de segurança') }).click();
    await page.getByRole('button', { name: L('Security grade', 'Segurança, nota'), exact: false }).first().click();
    await expect(page.getByTestId('modules-note-security')).toBeVisible();
    await stop('modules: security panel');
    await page.getByRole('button', { name: L('Close security panel', 'Fechar painel de segurança') }).click();
    await page.keyboard.press('Control+k');
    await page.locator('[cmdk-item][data-value="add-module"]').click();
    const addModule = page.getByRole('dialog', { name: L('Add module', 'Adicionar módulo') });
    await expect(addModule).toBeVisible();
    await stop('modules: Add module dialog');
    await addModule.getByText(L('Custom source', 'Origem personalizada')).click();
    await stop('modules: Add module dialog, custom source');
    await close();
  } finally {
    await context.close();
  }
  return stops;
}

test('no English is left on screen in Portuguese (every string differs, or is never translated)', async ({ browser }) => {
  test.setTimeout(420_000);
  const [pt, en] = await Promise.all([crawl(browser, 'pt-BR'), crawl(browser, 'en')]);
  const data = projectData();
  phrases = [...data, ...ALLOWED].filter((p) => p.includes(' ')).sort((a, b) => b.length - a.length);
  const leaks: string[] = [];
  const kept = new Set<string>();
  for (const [name, strings] of pt) {
    const english = new Set(en.get(name) ?? []);
    for (const s of strings) {
      if (!english.has(s)) continue;
      if (untranslated(s, data)) kept.add(s);
      else leaks.push(`${name}: ${JSON.stringify(s)}`);
    }
  }
  // SWEEP_DEBUG=1: what was the same in both languages and let through, to review the allowlist
  if (process.env.SWEEP_DEBUG) {
    await test.info().attach('same-in-both.json', { body: JSON.stringify([...kept].sort(), null, 1), contentType: 'application/json' });
  }
  expect([...pt.keys()]).toEqual([...en.keys()]);
  expect([...new Set(leaks)], 'strings that read the same in English and Portuguese').toEqual([]);
});

test('the sweep would catch a leak', () => {
  const data = new Set(['web', 'igw', 'NAT gateway']);
  phrases = ['NAT gateway'];
  expect(untranslated('NAT gateway igw', data)).toBe(true);
  expect(untranslated('Internet gateway igw', data)).toBe(true);
  expect(untranslated('Moved selected node up', data)).toBe(false);
  expect(untranslated('Delete resource', data)).toBe(false);
  expect(untranslated('required', data)).toBe(false);
  expect(untranslated('aws_instance.web', data)).toBe(true);
  expect(untranslated('web', data)).toBe(true);
  expect(untranslated('Ctrl K', data)).toBe(true);
  expect(untranslated(':80, :443', data)).toBe(true);
  expect(untranslated('HTTPS 443', data)).toBe(true);
  expect(readFileSync(new URL('../src/i18n/GLOSSARY.md', import.meta.url), 'utf8')).toContain('i18n-sweep');
});
