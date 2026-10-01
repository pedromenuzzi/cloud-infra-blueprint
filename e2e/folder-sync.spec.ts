/**
 * Local folder sync. `showDirectoryPicker` is mocked to hand back a real
 * directory handle from the Origin Private File System, so reads, writes,
 * permissions and the IndexedDB-persisted handle all go through the actual
 * File System Access API — only the OS dialog is skipped.
 *
 * Each test runs in a fresh persistent profile, not Playwright's usual
 * incognito-like context: there, Chromium hangs the page when an OPFS handle
 * is read back from IndexedDB (a handle picked by a user isn't affected).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { canvasStats, SEED_PROJECT, storedProject, waitForMonaco } from './helpers';

const test = base.extend<{ context: BrowserContext; page: Page }>({
  // (`provide`, not `use`: the hooks lint rule would take it for React's use())
  context: async ({ playwright, baseURL, viewport }, provide) => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-folder-sync-'));
    const context = await playwright.chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      baseURL,
      viewport,
      serviceWorkers: 'block',
      acceptDownloads: true,
    });
    await provide(context);
    await context.close();
    await rm(dir, { recursive: true, force: true });
  },
  page: async ({ context }, provide) => {
    await provide(context.pages()[0] ?? (await context.newPage()));
  },
});

const MAIN = `resource "aws_vpc" "core" {
  cidr_block = "10.1.0.0/16"
}
`;
const VARS = `variable "region" {
  default = "eu-west-1"
}
`;

/** The picker returns OPFS folder `window.__pick` (default "infra"). */
async function mockPicker(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('cb-tips-dismissed', '1');
    const w = window as unknown as { __pick?: string; showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> };
    w.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      let dir = root;
      for (const part of (w.__pick ?? 'infra').split('/')) dir = await dir.getDirectoryHandle(part, { create: true });
      return dir;
    };
  });
}

/** Write files into an OPFS folder (paths relative to the OPFS root). */
async function putFiles(page: Page, files: Record<string, string>) {
  await page.evaluate(async (entries) => {
    const root = await navigator.storage.getDirectory();
    for (const [path, text] of Object.entries(entries)) {
      const parts = path.split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    }
  }, files);
}

async function readFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (p) => {
    const parts = p.split('/');
    let dir = await navigator.storage.getDirectory();
    try {
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return await (await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile()).text();
    } catch {
      return null;
    }
  }, path);
}

async function listFolder(page: Page, path: string): Promise<string[]> {
  return page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory();
    for (const part of p.split('/')) dir = await dir.getDirectoryHandle(part);
    const names: string[] = [];
    for await (const key of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(key);
    return names.sort();
  }, path);
}

/** Back from another app: the editor looks at the folder again. */
async function refocus(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test.describe('folder sync', () => {
  test.beforeEach(async ({ page }) => {
    await mockPicker(page);
  });

  test('"Open folder…" imports the root module, linked: saves go to the .tf files', async ({ page }) => {
    await page.goto('/dashboard');
    await putFiles(page, {
      'repo/README.md': '# my infra\n',
      'repo/infra/main.tf': `${MAIN}\nmodule "net" {\n  source = "./modules/net"\n}\n`,
      'repo/infra/variables.tf': VARS,
      'repo/infra/modules/net/main.tf': 'resource "aws_subnet" "a" {}\n',
    });
    await page.evaluate(() => ((window as unknown as { __pick: string }).__pick = 'repo'));
    await page.getByRole('button', { name: 'Open folder…' }).first().click();

    await expect(page).toHaveURL(/\/editor\//);
    // a folder link syncs the root module's own files only: the child module stays on disk
    await expect(
      page.getByText("Opened the root module (infra/); 1 file in other folders isn't synced (a folder link keeps only the root module)."),
    ).toBeVisible();
    await expect(canvasStats(page)).toHaveText(/^1 resource/);
    const chip = page.getByRole('button', { name: 'Synced to folder repo/infra' });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Synced to repo/infra');

    // a canvas edit is saved, then written through to main.tf
    await page.getByRole('complementary', { name: 'Resource palette' }).getByText('S3 Bucket').click();
    await expect(canvasStats(page)).toHaveText(/^2 resources/);
    await expect.poll(() => readFile(page, 'repo/infra/main.tf')).toContain('resource "aws_s3_bucket"');
    // only the project's files: nothing else in the folder was touched
    expect(await listFolder(page, 'repo/infra')).toEqual(['main.tf', 'modules', 'variables.tf']);
    expect(await readFile(page, 'repo/README.md')).toBe('# my infra\n');
    expect(await readFile(page, 'repo/infra/variables.tf')).toBe(VARS);

    // opening the same folder again opens the same project
    await page.goto('/dashboard');
    await page.evaluate(() => ((window as unknown as { __pick: string }).__pick = 'repo'));
    await page.getByRole('button', { name: 'Open folder…' }).first().click();
    await expect(page.getByText('“repo/infra” is already linked. Opening its project')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synced to folder repo/infra' })).toBeVisible();
  });

  test('a change made on disk reloads the editor silently; both sides changed asks first', async ({ page }) => {
    await page.goto('/dashboard');
    await putFiles(page, { 'infra/main.tf': MAIN, 'infra/variables.tf': VARS });
    await page.getByRole('button', { name: 'Open folder…' }).first().click();
    await waitForMonaco(page);
    await expect(canvasStats(page)).toHaveText(/^1 resource/);
    await expect(page.getByRole('button', { name: 'Synced to folder infra' })).toBeVisible();

    // another editor adds a resource: back in the app, it's there, no questions
    await putFiles(page, { 'infra/main.tf': `${MAIN}\nresource "aws_sqs_queue" "jobs" {\n  name = "jobs"\n}\n` });
    await refocus(page);
    await expect(canvasStats(page)).toHaveText(/^2 resources/);
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect.poll(async () => (await storedProject(page, 'infra'))?.files['main.tf']).toContain('aws_sqs_queue');

    // now both sides change before a sync sees the other
    await putFiles(page, { 'infra/main.tf': `${MAIN}\n# edited on disk\n` });
    await page.getByRole('complementary', { name: 'Resource palette' }).getByText('S3 Bucket').click();
    const dialog = page.getByRole('alertdialog', { name: /“infra” and the editor both changed/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('main.tf')).toBeVisible();
    await expect(dialog.getByText('changed here · changed in the folder')).toBeVisible();
    // nothing was overwritten while the question is open
    expect(await readFile(page, 'infra/main.tf')).toContain('# edited on disk');

    await dialog.getByRole('button', { name: 'Keep editor version' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => readFile(page, 'infra/main.tf')).toContain('resource "aws_s3_bucket"');
    expect(await readFile(page, 'infra/main.tf')).not.toContain('# edited on disk');
    await expect(page.getByRole('button', { name: 'Synced to folder infra' })).toBeVisible();
  });

  test('"Sync with folder…" links an existing project; a folder with other Terraform asks first', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
    await waitForMonaco(page);

    // an empty folder just receives the project
    await page.evaluate(() => ((window as unknown as { __pick: string }).__pick = 'export'));
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sync with folder…' }).click();
    await expect(page.getByText('Synced to “export”')).toBeVisible();
    const seed = (await storedProject(page, SEED_PROJECT))!;
    expect(await listFolder(page, 'export')).toEqual(Object.keys(seed.files).sort());
    expect(await readFile(page, 'export/main.tf')).toBe(seed.files['main.tf']);

    // a folder with other .tf files: nothing happens until the user picks a side
    await putFiles(page, { 'other/main.tf': MAIN, 'other/legacy.tf': '# keep me?\n' });
    await page.evaluate(() => ((window as unknown as { __pick: string }).__pick = 'other'));
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sync with folder…' }).click();
    const dialog = page.getByRole('dialog', { name: '“other” already has Terraform files' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Overwrites main\.tf and deletes legacy\.tf in the folder\./)).toBeVisible();
    await dialog.getByRole('button', { name: /Write this project to the folder/ }).click();
    await expect(page.getByText('Synced to “other”')).toBeVisible();
    expect(await listFolder(page, 'other')).toEqual(Object.keys(seed.files).sort());
    await expect(page.getByRole('button', { name: 'Synced to folder other' })).toBeVisible();

    // stop syncing: the files stay
    await page.getByRole('button', { name: 'Synced to folder other' }).click();
    await page.getByRole('menuitem', { name: 'Stop syncing' }).click();
    await expect(page.getByRole('button', { name: 'Synced to folder other' })).toBeHidden();
    expect(await listFolder(page, 'other')).toEqual(Object.keys(seed.files).sort());
  });

  test('the folder link survives a reload; access is asked for again when needed', async ({ page }) => {
    await page.goto('/dashboard');
    await putFiles(page, { 'infra/main.tf': MAIN });
    await page.getByRole('button', { name: 'Open folder…' }).first().click();
    await expect(page.getByRole('button', { name: 'Synced to folder infra' })).toBeVisible();

    // the handle comes back from IndexedDB; this time the browser wants a click first
    await page.addInitScript(() => {
      const proto = FileSystemHandle.prototype;
      let granted = false;
      Object.defineProperty(proto, 'queryPermission', { configurable: true, value: async () => (granted ? 'granted' : 'prompt') });
      Object.defineProperty(proto, 'requestPermission', {
        configurable: true,
        value: async () => {
          granted = true;
          return 'granted';
        },
      });
    });
    await page.reload();
    const reconnect = page.getByRole('button', { name: 'Reconnect folder infra' });
    await expect(reconnect).toBeVisible();
    await putFiles(page, { 'infra/main.tf': `${MAIN}\nresource "aws_sns_topic" "alerts" {}\n` });
    await reconnect.click();
    await expect(page.getByRole('button', { name: 'Synced to folder infra' })).toBeVisible();
    await expect(canvasStats(page)).toHaveText(/^2 resources/);
  });
});

test.describe('browsers without folder access', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cb-tips-dismissed', '1');
      // Firefox and Safari have no folder access at all
      delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
      delete (Window.prototype as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    });
  });

  test('hide "Open folder…", explain, and offer the .zip instead', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder…' })).toHaveCount(0);
    await expect(page.getByText(/Folder sync needs Chrome or Edge/)).toBeVisible();

    await page.getByRole('button', { name: `Open project ${SEED_PROJECT}` }).click();
    await waitForMonaco(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sync with folder…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Folder sync needs Chrome or Edge' });
    await expect(dialog).toBeVisible();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download .zip instead' }).click();
    expect((await download).suggestedFilename()).toBe('production-web-terraform.zip');
    await expect(dialog).toBeHidden();
  });
});
