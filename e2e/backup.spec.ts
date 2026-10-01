/**
 * Your data: back up every project as one .zip, restore it (as copies or
 * replacing), the storage meter and its 70% nudge.
 */
import { readFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { SEED_PROJECT, storedProject, storedProjects } from './helpers';

async function downloadBackup(page: Page, button = page.getByRole('button', { name: 'Back up all projects' })) {
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}

function restoreFile(page: Page, name: string, bytes: Uint8Array) {
  return page.getByLabel('Restore from backup file').setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(bytes) });
}

/** Changes the seed project's main.tf behind the app's back (as another tab would). */
async function editSeed(page: Page, comment: string) {
  await page.evaluate((text) => {
    const all = JSON.parse(localStorage.getItem('cb-projects-v1')!);
    all[0].files['main.tf'] += `\n${text}\n`;
    all[0].rev += 1;
    all[0].updatedAt = new Date().toISOString();
    localStorage.setItem('cb-projects-v1', JSON.stringify(all));
  }, comment);
  await page.reload();
}

test('backs up every project: a folder of .tf files each, and a manifest', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('No backup yet')).toBeVisible();
  const { name, bytes } = await downloadBackup(page);
  expect(name).toMatch(/^cloud-blueprint-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.getByText('Backup downloaded: 1 project')).toBeVisible();
  await expect(page.getByText('Last backup just now')).toBeVisible();

  const entries = unzipSync(new Uint8Array(bytes));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  const seed = (await storedProject(page, SEED_PROJECT))!;
  expect(manifest).toMatchObject({ format: 'cloud-blueprint-backup', version: 1 });
  expect(manifest.projects).toEqual([
    expect.objectContaining({
      id: seed.id,
      name: SEED_PROJECT,
      templateSlug: 'aws-web-app',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  ]);
  for (const file of Object.keys(seed.files)) {
    expect(strFromU8(entries[`production-web/${file}`])).toBe(seed.files[file]);
  }
  expect(entries['README.md']).toBeDefined();
});

test('restore: "add as copies" keeps what is here and adds the backup’s version next to it', async ({ page }) => {
  await page.goto('/dashboard');
  const { bytes } = await downloadBackup(page);
  await editSeed(page, '# edited after the backup');

  await restoreFile(page, 'my-backup.zip', bytes);
  const dialog = page.getByRole('dialog', { name: /Restore from backup/ });
  await expect(dialog.getByText('1 differs from yours')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Add as copies/ })).toBeChecked();
  await expect(dialog.getByText('→ production-web-2')).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore 1 project' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Restored 1 project')).toBeVisible();

  await expect(page.getByRole('article', { name: 'production-web-2' })).toBeVisible();
  const [mine, copy] = [await storedProject(page, SEED_PROJECT), await storedProject(page, 'production-web-2')];
  expect(mine!.files['main.tf']).toContain('# edited after the backup');
  expect(copy!.files['main.tf']).not.toContain('# edited after the backup');
  expect(copy!.id).not.toBe(mine!.id);
});

test('restore: "replace existing" overwrites only after the user says so', async ({ page }) => {
  await page.goto('/dashboard');
  const { bytes } = await downloadBackup(page);
  await editSeed(page, '# edited after the backup');

  await restoreFile(page, 'my-backup.zip', bytes);
  const dialog = page.getByRole('dialog', { name: /Restore from backup/ });
  await dialog.getByRole('radio', { name: /Replace existing/ }).check();
  await expect(dialog.getByText('Replaces yours')).toBeVisible();
  // the copy here is newer than the backup: say what would be lost
  await expect(dialog.getByText(/after this backup\. Replacing loses those changes/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore and replace 1' }).click();
  await expect(page.getByText('Restored 1 project (1 replaced)')).toBeVisible();

  const all = await storedProjects(page);
  expect(all.map((p) => p.name)).toEqual([SEED_PROJECT]);
  expect(all[0].files['main.tf']).not.toContain('# edited after the backup');
});

test('restoring the same backup twice skips what is already here', async ({ page }) => {
  await page.goto('/dashboard');
  const { bytes } = await downloadBackup(page);
  await restoreFile(page, 'my-backup.zip', bytes);
  const dialog = page.getByRole('dialog', { name: /Restore from backup/ });
  await expect(dialog.getByText('1 already here')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /production-web/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Restore 0 projects' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('a zip that is not a backup is explained, and nothing is stored', async ({ page }) => {
  await page.goto('/dashboard');
  await restoreFile(page, 'stack.zip', zipSync({ 'infra/main.tf': strToU8('resource "aws_vpc" "x" {}\n') }));
  const dialog = page.getByRole('dialog', { name: /Restore from backup/ });
  await expect(dialog.getByRole('alert')).toContainText('it’s an export, not a backup');
  await dialog.getByRole('button', { name: 'Close' }).last().click();

  const manifest = { format: 'cloud-blueprint-backup', version: 99, projects: [] };
  await restoreFile(page, 'future.zip', zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }));
  await expect(dialog.getByRole('alert')).toContainText('made by a newer version of Cloud Blueprint');
  expect(await storedProjects(page)).toHaveLength(1);
});

test('a restore that does not fit in browser storage says so and changes nothing', async ({ page }) => {
  await page.goto('/dashboard');
  const { bytes } = await downloadBackup(page);
  await editSeed(page, '# edited');
  const before = await storedProjects(page);
  // the browser refuses any bigger project list from now on
  await page.evaluate((limit) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'cb-projects-v1' && value.length > limit) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
  }, JSON.stringify(before).length + 100);

  await restoreFile(page, 'my-backup.zip', bytes);
  const dialog = page.getByRole('dialog', { name: /Restore from backup/ });
  await dialog.getByRole('button', { name: 'Restore 1 project' }).click();
  await expect(dialog.getByRole('alert')).toContainText('There isn’t enough browser storage for this restore');
  await expect(dialog.getByRole('alert')).toContainText('Nothing was changed');
  expect(await storedProjects(page)).toEqual(before);
  // no "changes aren't being saved" banner: nothing was lost
  await expect(page.getByText('Storage is full: changes aren’t being saved')).toBeHidden();
});

test.describe('storage meter', () => {
  test('shows how much browser storage the projects use', async ({ page }) => {
    await page.goto('/dashboard');
    const meter = page.getByRole('meter', { name: 'Browser storage used' });
    await expect(meter).toBeVisible();
    await expect(meter).toHaveAttribute('aria-valuetext', /^\d+% \([\d.]+ KB of 5 MB\)$/);
    await expect(page.getByText(/^Projects: [\d.]+ KB of ~5 MB this browser allows$/)).toBeVisible();
    await expect(page.getByText(/free on this device/)).toBeVisible();
    // under 70%: no nudge
    await expect(page.getByText(/Browser storage is \d+% full/)).toBeHidden();
  });

  test('from 70% it nudges to back up and free space', async ({ page }) => {
    await page.addInitScript(() => {
      // ~3.8 M characters of someone else's data in this origin's localStorage
      if (!localStorage.getItem('padding')) localStorage.setItem('padding', 'x'.repeat(3_800_000));
    });
    await page.goto('/dashboard');
    const nudge = page.getByRole('status').filter({ hasText: /Browser storage is 7\d% full/ });
    await expect(nudge).toBeVisible();

    const download = page.waitForEvent('download');
    await nudge.getByRole('button', { name: 'Back up and free space' }).click();
    expect((await download).suggestedFilename()).toMatch(/^cloud-blueprint-backup-/);
    const dialog = page.getByRole('dialog', { name: 'Free up browser storage' });
    await expect(dialog.getByText('Backup downloaded')).toBeVisible();
    await dialog.getByRole('checkbox', { name: new RegExp(SEED_PROJECT) }).check();
    await dialog.getByRole('button', { name: 'Delete 1 project' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('article', { name: SEED_PROJECT })).toBeHidden();
    expect(await storedProjects(page)).toEqual([]);

    // dismissed for this session
    await nudge.getByRole('button', { name: 'Dismiss storage warning' }).click();
    await expect(nudge).toBeHidden();
  });

  test('asks the browser to keep the data, with a one-line explanation', async ({ page }) => {
    await page.addInitScript(() => {
      let persisted = false;
      Object.defineProperty(navigator.storage, 'persisted', { value: async () => persisted });
      Object.defineProperty(navigator.storage, 'persist', {
        value: async () => {
          persisted = true;
          return true;
        },
      });
    });
    await page.goto('/dashboard');
    await expect(page.getByText('Asks the browser never to clear your projects when the device runs low on space.')).toBeVisible();
    await page.getByRole('button', { name: 'Keep my data' }).click();
    await expect(page.getByText('Protected storage.')).toBeVisible();
  });
});
