/**
 * Polish, round 2: long type names on canvas nodes, a backup .zip dropped on
 * the dashboard, folder-linked project cards, readable security-lens labels,
 * the Azure rules table on narrow screens, the phone security flow and the
 * Aurora cluster's subnet-group fix.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { SEED_PROJECT, storedProjects } from './helpers';

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
