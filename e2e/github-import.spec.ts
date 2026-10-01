/**
 * "Import from GitHub": the dialog end to end, the `#gh=` deep link, errors
 * and cancel — against a fake GitHub (e2e/githubMock.ts), never the network.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, storedProjects } from './helpers';
import { INFRA_REPO, mockGithub } from './githubMock';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function seriousViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(ctx: Document): Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const { violations } = await axe.run(document);
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

function dialog(page: Page) {
  return page.getByRole('dialog', { name: /Import from GitHub/ });
}

async function openFromDashboard(page: Page) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Import from GitHub…' }).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}

test('imports a picked root module from a repository, then offers that copy instead of a duplicate', async ({ page }) => {
  const gh = await mockGithub(page, { 'acme/infra': INFRA_REPO });
  const d = await openFromDashboard(page);
  await expect(d.getByLabel('GitHub link or owner/repo')).toBeFocused();
  await d.getByLabel('GitHub link or owner/repo').fill('https://github.com/acme/infra');
  await d.getByRole('button', { name: 'Find Terraform' }).click();

  const modules = d.getByRole('radiogroup');
  await expect(modules.getByRole('radio')).toHaveCount(2);
  await expect(modules).toContainText('Repository root');
  await expect(modules).toContainText('envs/prod');
  await expect(d).toContainText('2 .tf files in modules/ folders: the child modules the root module calls');
  await expect(d.getByTestId('gh-rate')).toHaveText('58 of 60 requests left');
  await expect(modules.getByRole('radio').first()).toBeFocused();

  await modules.getByText('envs/prod').click();
  await d.getByRole('button', { name: 'Import 2 files' }).click();

  await expect(page).toHaveURL(/\/editor\//);
  await expect(canvasStats(page)).toHaveText(/^2 resources/);
  await expect(page.getByText('Imported the root module (envs/prod/); 2 other files were left out.')).toBeVisible();
  const imported = (await storedProjects(page)).find((p) => p.name === 'infra/envs/prod') as
    | { files: Record<string, string>; origin?: string }
    | undefined;
  expect(Object.keys(imported!.files).sort()).toEqual(['main.tf', 'variables.tf']);
  expect(imported!.origin).toBe('github:acme/infra/envs/prod@main');
  // state, the lock file and .terraform/ were never downloaded (counting a pick reads its .tf files only)
  const fetched = gh.requests.map((r) => r.url()).filter((u) => u.startsWith('https://raw.githubusercontent.com/'));
  expect(fetched).toEqual(
    expect.arrayContaining([
      'https://raw.githubusercontent.com/acme/infra/main/envs/prod/main.tf',
      'https://raw.githubusercontent.com/acme/infra/main/envs/prod/variables.tf',
    ]),
  );
  expect(fetched.every((u) => u.endsWith('.tf') && !u.includes('/.terraform/'))).toBe(true);

  // the same version again: open the copy instead of making another
  const again = await openFromDashboard(page);
  await again.getByLabel('GitHub link or owner/repo').fill('acme/infra/envs/prod');
  await again.getByRole('button', { name: 'Find Terraform' }).click();
  await again.getByRole('button', { name: 'Import 2 files' }).click();
  await expect(again).toContainText('You already imported this exact version as “infra/envs/prod”');
  await expect(again.getByRole('button', { name: 'Open existing copy' })).toBeFocused();
  await again.getByRole('button', { name: 'Open existing copy' }).click();
  await expect(page).toHaveURL(/\/editor\//);
  expect((await storedProjects(page)).filter((p) => p.name.startsWith('infra/envs/prod'))).toHaveLength(1);
});

test('a #gh= deep link opens the dialog prefilled — and asks GitHub nothing until you confirm', async ({ page }) => {
  const gh = await mockGithub(page, { 'acme/infra': INFRA_REPO });
  await page.goto('/#gh=acme/infra/envs/prod@main');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByLabel('GitHub link or owner/repo')).toHaveValue('acme/infra/envs/prod@main');
  await expect(page).not.toHaveURL(/#gh=/);
  await expect(d.getByRole('button', { name: 'Find Terraform' })).toBeFocused();
  expect(gh.requests).toHaveLength(0);

  await page.keyboard.press('Enter');
  const modules = d.getByRole('radiogroup');
  await expect(modules.getByRole('radio')).toHaveCount(1);
  await expect(modules).toContainText('from your link');
  // an explicit ref: one API request for the whole listing
  expect(gh.requests.filter((r) => r.url().startsWith('https://api.github.com'))).toHaveLength(1);
  await d.getByRole('button', { name: 'Import 2 files' }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(canvasStats(page)).toHaveText(/^2 resources/);
});

test('the command palette opens it too', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search or run a command…').fill('github');
  await page.getByRole('option', { name: /Import from GitHub/ }).click();
  await expect(dialog(page)).toBeVisible();
});

test('private repositories: a clear 404, then a memory-only token opens them', async ({ page }) => {
  const token = 'github_pat_E2E_SECRET';
  const gh = await mockGithub(page, { 'acme/secret': { ...INFRA_REPO, privateToken: token } });
  const d = await openFromDashboard(page);
  await d.getByLabel('GitHub link or owner/repo').fill('acme/secret');
  await d.getByRole('button', { name: 'Find Terraform' }).click();
  await expect(d.getByRole('alert')).toContainText("Couldn't find acme/secret. Check the spelling. If it's private, add a token below.");

  await d.getByRole('button', { name: 'Add a token' }).click();
  const field = d.getByLabel('Personal access token (optional)');
  await expect(field).toBeFocused();
  await expect(d).toContainText('Memory only: never saved, never put in a link');
  await field.fill(token);
  await d.getByRole('button', { name: 'Find Terraform' }).click();
  await expect(d.getByRole('radio')).toHaveCount(2);
  await expect(d.getByTestId('gh-rate')).toHaveText('4,990 of 5,000 requests left');
  await d.getByText('envs/prod').click();
  await d.getByRole('button', { name: 'Import 2 files' }).click();

  // contents came from the API (the token never goes to another host), and it was never stored
  await expect(page).toHaveURL(/\/editor\//);
  const urls = gh.requests.map((r) => r.url());
  expect(urls.every((u) => u.startsWith('https://api.github.com/'))).toBe(true);
  expect(urls.some((u) => u.includes(token))).toBe(false);
  expect(page.url()).not.toContain(token);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(token);
});

test('an exhausted rate limit says when it resets', async ({ page }) => {
  const gh = await mockGithub(page, { 'acme/infra': INFRA_REPO });
  gh.exhaustRateLimit();
  const d = await openFromDashboard(page);
  await d.getByLabel('GitHub link or owner/repo').fill('acme/infra');
  await d.getByRole('button', { name: 'Find Terraform' }).click();
  await expect(d.getByRole('alert')).toContainText(/limit of 60 requests an hour without a token is used up\. It resets at/);
  await expect(d.getByTestId('gh-rate')).toContainText('Rate limit reached · resets');
  await expect(d.getByRole('button', { name: 'Add a token' })).toBeVisible();
});

test('bad input, offline, and Cancel while GitHub is slow', async ({ page, context }) => {
  const gh = await mockGithub(page, { 'acme/infra': INFRA_REPO });
  const d = await openFromDashboard(page);
  const input = d.getByLabel('GitHub link or owner/repo');

  await input.fill('https://gitlab.com/acme/infra');
  await d.getByRole('button', { name: 'Find Terraform' }).click();
  await expect(d.getByRole('alert')).toContainText('Only GitHub is supported');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(gh.requests).toHaveLength(0);

  await context.setOffline(true);
  gh.setOffline(true);
  await input.fill('acme/infra');
  await d.getByRole('button', { name: 'Find Terraform' }).click();
  await expect(d.getByRole('alert')).toContainText("You're offline");
  await expect(d.getByRole('button', { name: 'Try again' })).toBeVisible();
  await context.setOffline(false);
  gh.setOffline(false);

  gh.hang();
  await d.getByRole('button', { name: 'Find Terraform' }).click();
  await expect(d.getByRole('status')).toContainText('Looking for Terraform in acme/infra');
  await expect(d.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(input).toHaveValue('acme/infra');
  await expect(input).toBeFocused();
  await expect(d.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
});

for (const theme of ['light', 'dark'] as const) {
  test(`the dialog is accessible (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await mockGithub(page, { 'acme/infra': INFRA_REPO });
    const d = await openFromDashboard(page);
    await page.waitForTimeout(300);
    expect(await seriousViolations(page)).toEqual([]);
    await d.getByLabel('GitHub link or owner/repo').fill('acme/infra');
    await d.getByRole('button', { name: 'Find Terraform' }).click();
    await expect(d.getByRole('radio')).toHaveCount(2);
    await page.waitForTimeout(300);
    expect(await seriousViolations(page)).toEqual([]);
  });
}
