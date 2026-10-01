/**
 * Polish, round 2: long type names on canvas nodes, a backup .zip dropped on
 * the dashboard, folder-linked project cards, readable security-lens labels,
 * the Azure rules table on narrow screens, the phone security flow and the
 * Aurora cluster's subnet-group fix.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { canvasStats, SEED_PROJECT, storedProject, storedProjects } from './helpers';

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

/** open a project built from this HCL, in `locale` (fresh context = fresh localStorage) */
async function openProject(page: Page, name: string, text: string, { locale = 'en', theme }: { locale?: string; theme?: string } = {}) {
  const id = `prj_${name}`;
  await page.addInitScript(
    ({ id, name, text, locale, theme }) => {
      localStorage.setItem('cb-locale', locale);
      if (theme) localStorage.setItem('cb-theme', theme);
      if (localStorage.getItem('cb-projects-v1')) return;
      const now = new Date().toISOString();
      localStorage.setItem('cb-seeded-v1', '1');
      localStorage.setItem('cb-tips-dismissed', '1');
      localStorage.setItem(
        'cb-projects-v1',
        JSON.stringify([{ id, name, files: { 'main.tf': text }, providers: [], createdAt: now, updatedAt: now }]),
      );
    },
    { id, name, text, locale, theme },
  );
  await page.goto(`/editor/${id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

/** every catalog type of a provider, read from its catalog file */
function catalogTypes(file: string): string[] {
  const source = readFileSync(new URL(`../src/resources/${file}.ts`, import.meta.url), 'utf8');
  return [...source.matchAll(/^\s{4}type: '([a-z0-9_]+)',$/gm)].map((m) => m[1]);
}

test.describe('long type names on canvas nodes', () => {
  for (const [provider, file] of [
    ['aws', 'aws'],
    ['azure', 'azure'],
    ['gcp', 'gcp'],
  ] as const) {
    for (const locale of ['en', 'pt-BR']) {
      test(`${provider}, ${locale}: every type label fits its node header, whole words, two lines at most`, async ({ page }) => {
        const types = catalogTypes(file);
        expect(types.length).toBeGreaterThan(20);
        const hcl = types.map((type) => `resource "${type}" "db" {\n}\n`).join('\n');
        await openProject(page, `labels-${provider}`, hcl, { locale });
        await expect(page.locator('.react-flow__node')).toHaveCount(types.length);
        const labels = page.locator('.bp-node [data-type-label]');
        await expect(labels.first()).toBeVisible();
        const cut = await labels.evaluateAll((els) =>
          els.flatMap((el) => {
            // 12 px lines under 2 px of padding (nodes.tsx); a third line would be hidden
            const lines = Math.round(((el as HTMLElement).offsetHeight - 2) / 12);
            if (lines > 2) return [`${el.textContent}: ${lines} lines`];
            // a word too wide for its line is broken in the middle: it has a box on each line
            // (after a hyphen is a break like a space: "back-" / "end")
            const text = el.firstChild as Text;
            const broken: string[] = [];
            let at = 0;
            for (const word of text.data.split(/ |(?<=-)/)) {
              const start = text.data.indexOf(word, at);
              const range = document.createRange();
              range.setStart(text, start);
              range.setEnd(text, start + word.length);
              if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) broken.push(`${el.textContent}: "${word}" is broken`);
              at = start + word.length;
            }
            return broken;
          }),
        );
        expect(cut).toEqual([]);
        // a container's type label leaves its name whole (the subtitle gives way first)
        const names = await page
          .locator('.bp-container [data-type-label]')
          .evaluateAll((els) => els.map((el) => el.previousElementSibling as HTMLElement).filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.textContent));
        expect(names).toEqual([]);
        // and nothing pushes the chip off the node
        const chipsInside = await page.locator('.bp-node').evaluateAll((nodes) =>
          nodes.every((node) => {
            const chip = node.querySelector('[data-type-label]')!.previousElementSibling;
            if (!chip) return true;
            return chip.getBoundingClientRect().right <= node.getBoundingClientRect().right;
          }),
        );
        expect(chipsInside).toBe(true);
      });
    }
  }

  test('a short English label keeps its single line, centered on the provider chip', async ({ page }) => {
    await openProject(page, 'one-line', 'resource "aws_instance" "web" {\n  instance_type = "t3.micro"\n}\n');
    const node = page.locator('.react-flow__node[data-id="aws_instance.web"]');
    const label = node.locator('[data-type-label]');
    await expect(label).toHaveText('EC2');
    const centers = await node.evaluate((el) => {
      const label = el.querySelector('[data-type-label]')!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const chip = label.previousElementSibling!.getBoundingClientRect();
      return { text: text.top + text.height / 2, chip: chip.top + chip.height / 2, lines: range.getClientRects().length };
    });
    expect(centers.lines).toBe(1);
    expect(Math.abs(centers.text - centers.chip)).toBeLessThan(0.75);
  });

  for (const theme of ['light', 'dark']) {
    test(`axe, ${theme} theme, pt-BR: two-line node headers`, async ({ page }) => {
      const hcl = ['aws_security_group', 'aws_s3_bucket_public_access_block', 'aws_route_table_association', 'aws_instance']
        .map((type) => `resource "${type}" "web" {\n}\n`)
        .join('\n');
      await openProject(page, `axe-labels-${theme}`, hcl, { locale: 'pt-BR', theme });
      await expect(page.locator('.bp-node [data-type-label]').first()).toBeVisible();
      expect(await seriousAxeViolations(page, '.react-flow__nodes')).toEqual([]);
    });
  }

  test('pt-BR: "Grupo de segurança" takes two lines instead of being cut, and the name and subtitle stay', async ({ page }) => {
    await openProject(page, 'sg-pt', 'resource "aws_security_group" "web" {\n  name = "web"\n}\n', { locale: 'pt-BR' });
    const node = page.locator('.react-flow__node[data-id="aws_security_group.web"]');
    const label = node.locator('[data-type-label]');
    await expect(label).toHaveText('Grupo de segurança');
    expect(await label.evaluate((el) => Math.round(((el as HTMLElement).offsetHeight - 2) / 12))).toBe(2);
    await expect(node.getByText('web', { exact: true })).toBeVisible();
    const inside = await node.evaluate((el) => {
      const box = el.querySelector('.bp-node')!.getBoundingClientRect();
      return [...el.querySelectorAll('.bp-node > div span, .bp-node > div div')].every((c) => {
        const r = c.getBoundingClientRect();
        return r.top >= box.top && r.bottom <= box.bottom;
      });
    });
    expect(inside).toBe(true);
  });
});

/* ------------------------------------------------------------ backup drop */

/** a backup .zip as the app writes it: manifest, README, one folder per project */
function backupZip(projects: Array<{ id: string; name: string }>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const manifest = {
    format: 'cloud-blueprint-backup',
    version: 1,
    app: 'Cloud Blueprint',
    exportedAt: '2026-09-30T10:00:00.000Z',
    projects: projects.map((p) => {
      entries[`${p.name}/main.tf`] = strToU8(`resource "aws_s3_bucket" "${p.name.replace(/-/g, '_')}" {\n  bucket = "${p.name}"\n}\n`);
      return {
        ...p,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-02T00:00:00.000Z',
        hash: '',
        files: [{ name: 'main.tf', path: `${p.name}/main.tf` }],
      };
    }),
  };
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)), 'README.md': strToU8('# backup\n'), ...entries });
}

const TWO_PROJECTS = [
  { id: 'prj_billing', name: 'billing-api' },
  { id: 'prj_lake', name: 'data-lake' },
];

/** drop files on the dashboard the way the OS does (a DataTransfer of Files) */
async function dropFiles(page: Page, files: Array<{ name: string; bytes: Uint8Array }>) {
  await page.evaluate((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: 'application/zip' }));
    const target = document.querySelector('main')!;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
  }, files.map((f) => ({ name: f.name, bytes: [...f.bytes] })));
}

async function openDashboard(page: Page, locale = 'en', theme?: string) {
  await page.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem('cb-locale', locale);
      localStorage.setItem('cb-tips-dismissed', '1');
      if (theme) localStorage.setItem('cb-theme', theme);
    },
    { locale, theme },
  );
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: SEED_PROJECT })).toBeVisible();
}

test.describe('a backup .zip given to the importer', () => {
  test('dropped on the dashboard: the restore dialog opens instead of an import', async ({ page }) => {
    await openDashboard(page);
    await dropFiles(page, [{ name: 'cloud-blueprint-backup-2026-09-30.zip', bytes: backupZip(TWO_PROJECTS) }]);
    const dialog = page.getByRole('dialog', { name: /Restore from backup/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('billing-api').first()).toBeVisible();
    await expect(dialog.getByText('data-lake').first()).toBeVisible();
    // nothing was imported as a Terraform project, and we're still on the dashboard
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await storedProjects(page)).map((p) => p.name)).toEqual([SEED_PROJECT]);

    await dialog.getByRole('button', { name: /^Restore 2 projects/ }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await storedProjects(page)).map((p) => p.name).sort()).toEqual(['billing-api', 'data-lake', SEED_PROJECT]);
  });

  test('picked with "Import .tf": the restore dialog too', async ({ page }) => {
    await openDashboard(page);
    await page.getByLabel('Import Terraform files').setInputFiles({
      name: 'my-backup.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(backupZip(TWO_PROJECTS)),
    });
    await expect(page.getByRole('dialog', { name: /Restore from backup/ })).toBeVisible();
    expect((await storedProjects(page)).map((p) => p.name)).toEqual([SEED_PROJECT]);
  });

  test('from the command palette in the editor: back to the dashboard, restore dialog open', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
    await expect(page).toHaveURL(/\/editor\//);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByPlaceholder('Search or run a command…').fill('import terraform');
    const chooser = page.waitForEvent('filechooser');
    await palette.getByRole('option', { name: /Import Terraform files/ }).click();
    await (await chooser).setFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: Buffer.from(backupZip(TWO_PROJECTS)) });
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('dialog', { name: /Restore from backup/ })).toBeVisible();
  });

  test('a zip of Terraform still imports as one project', async ({ page }) => {
    await openDashboard(page);
    const terraform = zipSync({ 'infra/main.tf': strToU8('resource "aws_vpc" "core" {\n  cidr_block = "10.0.0.0/16"\n}\n') });
    await dropFiles(page, [{ name: 'infra.zip', bytes: terraform }]);
    await expect(page).toHaveURL(/\/editor\//);
    await expect(page.getByRole('dialog', { name: /Restore from backup/ })).toHaveCount(0);
    await expect.poll(async () => (await storedProjects(page)).map((p) => p.name).sort()).toEqual(['infra', SEED_PROJECT]);
  });

  for (const theme of ['light', 'dark']) {
    test(`pt-BR, ${theme}: "Restaurar backup" opens for a dropped backup, and passes axe`, async ({ page }) => {
      await openDashboard(page, 'pt-BR', theme);
      await dropFiles(page, [{ name: 'backup.zip', bytes: backupZip(TWO_PROJECTS) }]);
      const dialog = page.getByRole('dialog', { name: /Restaurar backup/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('billing-api').first()).toBeVisible();
      expect(await seriousAxeViolations(page, '[role="dialog"]')).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------ folder links */

/**
 * As e2e/folder-sync.spec.ts: a fresh persistent profile, and a picker that
 * hands back a real directory handle from the Origin Private File System.
 */
const folderTest = test.extend<{ context: BrowserContext; page: Page }>({
  context: async ({ playwright, baseURL, viewport }, provide) => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-polish-2-'));
    const context = await playwright.chromium.launchPersistentContext(dir, { channel: 'chromium', baseURL, viewport, serviceWorkers: 'block' });
    await provide(context);
    await context.close();
    await rm(dir, { recursive: true, force: true });
  },
  page: async ({ context }, provide) => {
    await provide(context.pages()[0] ?? (await context.newPage()));
  },
});

async function mockPicker(page: Page, { locale = 'en', theme }: { locale?: string; theme?: string } = {}) {
  await page.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem('cb-tips-dismissed', '1');
      localStorage.setItem('cb-locale', locale);
      if (theme) localStorage.setItem('cb-theme', theme);
      const w = window as unknown as { __pick?: string; showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> };
      w.showDirectoryPicker = async () => {
        let dir = await navigator.storage.getDirectory();
        for (const part of (w.__pick ?? 'infra').split('/')) dir = await dir.getDirectoryHandle(part, { create: true });
        return dir;
      };
    },
    { locale, theme },
  );
}

async function putFiles(page: Page, files: Record<string, string>) {
  await page.evaluate(async (entries) => {
    const root = await navigator.storage.getDirectory();
    for (const [path, text] of Object.entries(entries)) {
      const parts = path.split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(parts[parts.length - 1]!, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    }
  }, files);
}

/** the project ids that have a folder link in IndexedDB */
async function linkedIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('cloud-blueprint', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const keys = open.result.transaction('kv').objectStore('kv').getAllKeys();
          keys.onsuccess = () => {
            resolve((keys.result as string[]).filter((k) => k.startsWith('folder-link:')).map((k) => k.slice('folder-link:'.length)));
            open.result.close();
          };
          keys.onerror = () => reject(keys.error);
        };
      }),
  );
}

const MAIN_TF = 'resource "aws_vpc" "core" {\n  cidr_block = "10.1.0.0/16"\n}\n';

folderTest.describe('folder-linked projects on the dashboard', () => {
  folderTest('a linked project’s card names its folder; deleting the project drops the link, not the files', async ({ page }) => {
    await mockPicker(page);
    await page.goto('/dashboard');
    await putFiles(page, { 'infra-prod/main.tf': MAIN_TF });
    await page.evaluate(() => ((window as unknown as { __pick: string }).__pick = 'infra-prod'));
    await page.getByRole('button', { name: 'Open folder…' }).first().click();
    await expect(page).toHaveURL(/\/editor\//);
    await expect(canvasStats(page)).toHaveText(/^1 resource/);
    const project = (await storedProject(page, 'infra-prod'))!;
    await page.goto('/dashboard');

    const card = page.getByRole('article', { name: 'infra-prod' });
    await expect(card.getByText('Synced with the folder infra-prod')).toBeVisible();
    await expect(card.getByText('Synced with the folder infra-prod')).toHaveAttribute('title', 'Synced with the folder “infra-prod”');
    // the seed project isn't linked
    await expect(page.getByRole('article', { name: SEED_PROJECT }).getByText(/Synced with the folder/)).toHaveCount(0);
    expect(await linkedIds(page)).toEqual([project.id]);

    await card.hover();
    await card.getByRole('button', { name: 'Delete project' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete “infra-prod”?' });
    await expect(confirm.getByText('the folder “infra-prod” on your disk is left as it is', { exact: false })).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete project' }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => linkedIds(page)).toEqual([]);

    // the folder is as it was, and opening it again imports it afresh (not "already linked")
    await page.evaluate(() => ((window as unknown as { __pick: string }).__pick = 'infra-prod'));
    await page.getByRole('button', { name: 'Open folder…' }).first().click();
    await expect(page).toHaveURL(/\/editor\//);
    await expect(page.getByText(/already linked/)).toHaveCount(0);
    expect((await storedProject(page, 'infra-prod'))?.files['main.tf']).toBe(MAIN_TF);
  });

  folderTest('a link left by a project deleted elsewhere is cleaned up when the dashboard loads', async ({ page }) => {
    await mockPicker(page);
    await page.goto('/dashboard');
    await putFiles(page, { 'infra/main.tf': MAIN_TF });
    await page.getByRole('button', { name: 'Open folder…' }).first().click();
    await expect(page).toHaveURL(/\/editor\//);
    const project = (await storedProject(page, 'infra'))!;
    // another tab deletes it (straight from storage, as that tab's dashboard would)
    await page.evaluate((id) => {
      const all = JSON.parse(localStorage.getItem('cb-projects-v1')!);
      localStorage.setItem('cb-projects-v1', JSON.stringify(all.filter((p: { id: string }) => p.id !== id)));
    }, project.id);
    expect(await linkedIds(page)).toEqual([project.id]);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: SEED_PROJECT })).toBeVisible();
    await expect.poll(() => linkedIds(page)).toEqual([]);
  });

  folderTest('a change on disk shows up while the tab stays in front (FileSystemObserver)', async ({ page }) => {
    await mockPicker(page);
    await page.goto('/dashboard');
    folderTest.skip(!(await page.evaluate(() => 'FileSystemObserver' in window)), 'this Chromium has no FileSystemObserver');
    await putFiles(page, { 'infra/main.tf': MAIN_TF });
    await page.getByRole('button', { name: 'Open folder…' }).first().click();
    await expect(page).toHaveURL(/\/editor\//);
    await expect(canvasStats(page)).toHaveText(/^1 resource/);
    await expect(page.getByRole('button', { name: 'Synced to folder infra' })).toBeVisible();

    // no focus or visibility event: the observer alone brings the change in
    let focusEvents = 0;
    await page.exposeFunction('__onFocus', () => void (focusEvents += 1));
    await page.evaluate(() => window.addEventListener('focus', () => (window as unknown as { __onFocus(): void }).__onFocus()));
    await putFiles(page, { 'infra/main.tf': `${MAIN_TF}\nresource "aws_sqs_queue" "jobs" {\n  name = "jobs"\n}\n` });
    await expect(canvasStats(page)).toHaveText(/^2 resources/);
    await expect.poll(async () => (await storedProject(page, 'infra'))?.files['main.tf']).toContain('aws_sqs_queue');
    expect(focusEvents).toBe(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // a file the sync doesn't touch changes nothing
    await putFiles(page, { 'infra/README.md': '# notes\n' });
    await page.waitForTimeout(1200);
    expect(Object.keys((await storedProject(page, 'infra'))!.files).sort()).toEqual(['main.tf']);
  });

  for (const theme of ['light', 'dark']) {
    folderTest(`pt-BR, ${theme}: the card says "Sincronizado com a pasta", and passes axe`, async ({ page }) => {
      await mockPicker(page, { locale: 'pt-BR', theme });
      await page.goto('/dashboard');
      await putFiles(page, { 'infra/main.tf': MAIN_TF });
      await page.getByRole('button', { name: 'Abrir pasta…' }).first().click();
      await expect(page).toHaveURL(/\/editor\//);
      await page.goto('/dashboard');
      const card = page.getByRole('article', { name: 'infra' });
      await expect(card.getByText('Sincronizado com a pasta infra')).toBeVisible();
      expect(await seriousAxeViolations(page, 'article[aria-labelledby]')).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------ lens labels */

test.describe('security lens: port labels over their lines', () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: each label is drawn above its edge (nothing crosses the text)`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('cb-tips-dismissed', '1');
        localStorage.setItem('cb-security-lens', '1');
        localStorage.setItem('cb-theme', t);
      }, theme);
      await page.goto('/dashboard');
      await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
      const labels = page.locator('.react-flow__edgelabel-renderer > div');
      await expect(labels.first()).toBeVisible();
      await expect(labels.first()).toHaveText(':80 :443');
      // the edge from the internet runs into a subnet: its line is raised above the containers
      const hidden = await labels.evaluateAll((els) =>
        els
          .map((el) => {
            const r = el.getBoundingClientRect();
            // a few points across the label, where the line would cross it
            const hits = [0.2, 0.5, 0.8].map((fx) => document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2));
            return hits.every((hit) => hit !== null && el.contains(hit)) ? null : `${el.textContent}: under ${hits.map((h) => h?.tagName).join(',')}`;
          })
          .filter(Boolean),
      );
      expect(hidden).toEqual([]);
      // an opaque background in both themes
      const bg = await labels.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toMatch(/^rgb\(/);
    });
  }
});

/* ------------------------------------------------------------ rules table */

const NSG_TF = `resource "azurerm_network_security_group" "web" {
  name                = "web"
  location            = "eastus"
  resource_group_name = "rg"

  security_rule {
    name                       = "https"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "ssh-from-office"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "203.0.113.0/24"
    destination_address_prefix = "*"
  }
}
`;

/** every control of the rules dialog shows its whole value: selects wide enough for their option, nothing off the dialog */
async function rulesReadable(page: Page) {
  return page.getByRole('dialog').evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    const ctx = document.createElement('canvas').getContext('2d')!;
    const problems: string[] = [];
    for (const button of dialog.querySelectorAll('button')) {
      const r = button.getBoundingClientRect();
      if (r.width > 0 && (r.left < box.left - 0.5 || r.right > box.right + 0.5)) problems.push(`${button.textContent?.trim() || button.getAttribute('aria-label')}: outside the dialog`);
    }
    for (const el of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('tr[data-rule] select, tr[data-rule] input')) {
      const r = el.getBoundingClientRect();
      const label = el.getAttribute('aria-label');
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) problems.push(`${label}: outside the dialog`);
      const style = getComputedStyle(el);
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = el instanceof HTMLSelectElement ? el.selectedOptions[0]?.text ?? '' : el.value || el.placeholder;
      // a select's arrow takes ~20 px
      const room = r.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (el instanceof HTMLSelectElement ? 20 : 0);
      if (ctx.measureText(text).width > room + 1) problems.push(`${label}: "${text}" cut`);
    }
    return problems;
  });
}

test.describe('rules editor on narrow screens', () => {
  for (const [width, locale] of [
    [768, 'en'],
    [768, 'pt-BR'],
    [390, 'en'],
    [390, 'pt-BR'],
  ] as const) {
    test(`Azure NSG at ${width} px, ${locale}: each rule is a card with every control readable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openProject(page, `nsg-${width}`, NSG_TF, { locale });
      await page.locator('.react-flow__node[data-id="azurerm_network_security_group.web"]').click();
      await page.getByRole('button', { name: locale === 'en' ? 'Edit rules' : 'Editar regras' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('.bp-rules')).toHaveAttribute('data-stacked');
      await expect(dialog.locator('tr[data-rule]')).toHaveCount(2);
      expect(await rulesReadable(page)).toEqual([]);
      // no sideways scrolling in the rules, and the dialog within the screen
      expect(await dialog.locator('.bp-rules').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      expect(await dialog.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
      // column names show above the fields
      const priority = dialog.locator('tr[data-rule]').first().locator('td[data-cell="priority"]');
      expect(await priority.evaluate((td) => getComputedStyle(td, '::before').content)).toContain(locale === 'en' ? 'Priority' : 'Prioridade');
    });
  }

  test('a security group at 390 px: cards, and the toolbar wraps instead of pushing "Add rule" out', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('cb-tips-dismissed', '1'));
    await page.goto('/dashboard');
    await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
    await page.locator('.react-flow__node[data-id="aws_security_group.web"]').click();
    await page.getByRole('button', { name: 'Edit rules' }).click();
    const dialog = page.getByRole('dialog', { name: /^Rules for/ });
    await expect(dialog.locator('.bp-rules')).toHaveAttribute('data-stacked');
    await expect(dialog.getByRole('button', { name: 'Add rule' })).toBeVisible();
    expect(await rulesReadable(page)).toEqual([]);
  });

  test('at 1440 px the NSG keeps its table, wide enough for Portuguese', async ({ page }) => {
    await openProject(page, 'nsg-wide', NSG_TF, { locale: 'pt-BR' });
    await page.locator('.react-flow__node[data-id="azurerm_network_security_group.web"]').click();
    await page.getByRole('button', { name: 'Editar regras' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('tr[data-rule]')).toHaveCount(2);
    await expect(dialog.locator('.bp-rules')).not.toHaveAttribute('data-stacked');
    expect(await rulesReadable(page)).toEqual([]);
  });

  test('stacked, a rule is still edited in place: the priority lands in the code', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openProject(page, 'nsg-edit', NSG_TF);
    await page.locator('.react-flow__node[data-id="azurerm_network_security_group.web"]').click();
    await page.getByRole('button', { name: 'Edit rules' }).click();
    const dialog = page.getByRole('dialog');
    const priority = dialog.getByRole('textbox', { name: 'Priority' }).first();
    await priority.fill('200');
    await priority.press('Enter');
    await expect.poll(async () => (await storedProject(page, 'nsg-edit'))?.files['main.tf']).toMatch(/priority\s*=\s*200/);
  });

  for (const theme of ['light', 'dark']) {
    test(`axe, ${theme}, pt-BR at 390 px: the stacked rules`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openProject(page, `nsg-axe-${theme}`, NSG_TF, { locale: 'pt-BR', theme });
      await page.locator('.react-flow__node[data-id="azurerm_network_security_group.web"]').click();
      await page.getByRole('button', { name: 'Editar regras' }).click();
      await expect(page.getByRole('dialog').locator('.bp-rules')).toHaveAttribute('data-stacked');
      expect(await seriousAxeViolations(page, '[role="dialog"]')).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------ phone security flow */

test.describe('phone: the security toast’s "Show"', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: /^(Security|Segurança)$/ });
  const inspector = (page: Page) => page.getByRole('complementary', { name: /^(Inspector|Inspetor)$/ });

  /** open SSH to the internet from the rules editor: the edit that raises the toast */
  async function worsen(page: Page, en: boolean) {
    await page.locator('.react-flow__node[data-id="aws_security_group.web"]').click();
    await inspector(page).getByRole('button', { name: en ? 'Edit rules' : 'Editar regras' }).click();
    const dialog = page.getByRole('dialog', { name: en ? /^Rules for/ : /^Regras de/ });
    await dialog.getByRole('button', { name: en ? 'Add rule' : 'Nova regra' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'SSH' }).click();
    const row = dialog.locator('tr[data-rule="aws_security_group.web:ingress:3"]');
    await row.getByRole('button', { name: en ? 'Add source' : 'Adicionar origem' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: en ? /Anywhere, IPv4/ : /Qualquer lugar, IPv4/ }).click();
    return dialog;
  }

  async function openAt390(page: Page, locale = 'en', theme?: string) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      ({ locale, theme }) => {
        localStorage.setItem('cb-tips-dismissed', '1');
        localStorage.setItem('cb-locale', locale);
        if (theme) localStorage.setItem('cb-theme', theme);
      },
      { locale, theme },
    );
    await page.goto('/dashboard');
    await page.getByRole('button', { name: locale === 'en' ? `Open project ${SEED_PROJECT}` : `Abrir projeto ${SEED_PROJECT}` }).click();
    await expect(page.locator('.react-flow__node[data-id="aws_security_group.web"]')).toBeVisible();
  }

  test('one panel at a time: the finding, focused; closing it brings the inspector back', async ({ page }) => {
    await openAt390(page);
    const dialog = await worsen(page, true);
    const toast = page.locator('[data-bp-live]');
    await toast.getByRole('button', { name: 'Show' }).click();
    await expect(dialog).toBeHidden();

    // the panel alone, open on the finding, and focus on it
    await expect(panel(page)).toBeVisible();
    await expect(inspector(page)).toHaveCount(0);
    const finding = panel(page).getByRole('button', { name: /^SSH \(port 22\) is open to the internet/ });
    await expect(finding).toHaveAttribute('aria-expanded', 'true');
    await expect(finding).toBeFocused();

    // closing the panel shows what the finding is about
    await panel(page).getByRole('button', { name: 'Close security panel' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(inspector(page).getByTestId('inspector-address')).toHaveText('aws_instance.web');
  });

  test('a resource picked from the open panel takes over: the panel closes for the inspector', async ({ page }) => {
    await openAt390(page);
    await page.getByRole('button', { name: /^Security grade/ }).click();
    await expect(panel(page)).toBeVisible();
    await expect(inspector(page)).toHaveCount(0);
    await panel(page).getByRole('button', { name: /^Instance metadata allows IMDSv1/ }).click();
    await panel(page).getByRole('button', { name: 'web', exact: true }).first().click();
    await expect(panel(page)).toHaveCount(0);
    await expect(inspector(page).getByTestId('inspector-address')).toHaveText('aws_instance.web');
  });

  for (const theme of ['light', 'dark']) {
    test(`pt-BR, ${theme}: "Mostrar" opens the panel on the finding alone, and passes axe`, async ({ page }) => {
      await openAt390(page, 'pt-BR', theme);
      await worsen(page, false);
      await page.locator('[data-bp-live]').getByRole('button', { name: 'Mostrar' }).click();
      await expect(panel(page)).toBeVisible();
      await expect(inspector(page)).toHaveCount(0);
      await expect(page.locator(':focus')).toHaveAttribute('aria-expanded', 'true');
      expect(await seriousAxeViolations(page, 'aside[aria-label="Segurança"]')).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------ Aurora */

test.describe('Aurora cluster on the canvas', () => {
  /**
   * press on a node and move it over another one, without letting go (as e2e/canvas-arrange.spec.ts);
   * the cluster is a container (its instances go inside), so it's held by its center, the point a drop reads
   */
  async function dragOver(page: Page, id: string, targetId: string) {
    await page.keyboard.press('Escape');
    const box = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!;
    const target = (await page.locator(`.react-flow__node[data-id="${targetId}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 + 10, { steps: 15 });
  }

  for (const [locale, theme] of [
    ['en', 'light'],
    ['pt-BR', 'dark'],
  ] as const) {
    test(`${locale}: on a subnet it asks for a DB subnet group; the fix makes one and suggests a security group`, async ({ page }) => {
      const en = locale === 'en';
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem('cb-tips-dismissed', '1');
          localStorage.setItem('cb-locale', locale);
          localStorage.setItem('cb-theme', theme);
        },
        { locale, theme },
      );
      await page.goto('/dashboard');
      await page.getByRole('button', { name: en ? `Open project ${SEED_PROJECT}` : `Abrir projeto ${SEED_PROJECT}` }).click();
      await expect(page.locator('.react-flow__node[data-id="aws_subnet.public_a"]')).toBeVisible();

      await page.getByRole('button', { name: en ? /^Add Aurora Cluster/ : /^Adicionar Cluster Aurora/ }).click();
      const cluster = page.locator('.react-flow__node[data-id="aws_rds_cluster.cluster"]');
      await expect(cluster).toBeVisible();
      await expect(cluster.locator('[data-type-label]')).toHaveText('Aurora');

      await dragOver(page, 'aws_rds_cluster.cluster', 'aws_subnet.public_a');
      const hint = page.getByTestId('drop-hint');
      await expect(hint).toContainText(
        en ? "An Aurora cluster isn't placed in one subnet" : 'Um cluster Aurora não fica em uma sub-rede só',
      );
      await page.mouse.up();
      await page.getByRole('button', { name: en ? 'Create a DB subnet group in main' : 'Criar um grupo de sub-redes do banco em main' }).click();

      const toast = page.locator('[data-bp-live]');
      await expect(
        toast.getByText(
          en
            ? 'Created aws_db_subnet_group.cluster with public_a and public_b. aws_rds_cluster.cluster is drawn inside it'
            : 'aws_db_subnet_group.cluster criado com public_a e public_b. aws_rds_cluster.cluster aparece dentro dele',
        ),
      ).toBeVisible();
      await expect(
        toast.getByText(
          en
            ? "Tip: connect aws_rds_cluster.cluster to a security group. Without one it gets the VPC's default group"
            : 'Dica: conecte aws_rds_cluster.cluster a um grupo de segurança. Sem um, ele fica com o grupo padrão da VPC',
        ),
      ).toBeVisible();
      await expect.poll(async () => (await storedProject(page, SEED_PROJECT))?.files['main.tf']).toMatch(
        /resource "aws_rds_cluster" "cluster" \{[^}]*db_subnet_group_name\s*=\s*aws_db_subnet_group\.cluster\.name/,
      );
      // no security group was added for it
      expect((await storedProject(page, SEED_PROJECT))!.files['main.tf'].match(/resource "aws_security_group"/g)).toHaveLength(1);
      expect(await seriousAxeViolations(page, '[data-bp-live]')).toEqual([]);
    });
  }
});
