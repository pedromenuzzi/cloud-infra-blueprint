/**
 * Security explained: "Why is this reachable?" paths (Inspector and Security
 * panel), steps that lead back to the resource or the rule row, compliance
 * badges, and the toast after an edit that makes the design less safe.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { openSeedProject } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Security' });
const rulesDialog = (page: Page) => page.getByRole('dialog', { name: /^Rules for/ });
const toasts = (page: Page) => page.locator('[data-bp-live]');

/** fail on console errors (React warnings included) */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

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

test('Inspector: "Why is this reachable?" on the seed, one path per port, and every step leads somewhere', async ({ page }) => {
  const errors = watchConsole(page);
  await openSeedProject(page, { monaco: false });
  await node(page, 'aws_instance.web').click();
  const why = inspector(page).getByRole('region', { name: 'Why is this reachable?' });
  await expect(why).toBeVisible();
  await expect(why.getByRole('button', { name: /^:80 HTTP/ })).toBeVisible();

  const https = why.getByRole('button', { name: /^:443 HTTPS/ });
  await expect(https).toHaveAttribute('aria-expanded', 'false');
  await https.click();
  await expect(https).toHaveAttribute('aria-expanded', 'true');
  const path = why.getByRole('list', { name: 'Path for :443' });
  await expect(path.getByRole('listitem')).toHaveText([
    /^Internetany IPv4 address/,
    /^Internet gateway igw/,
    /^Route 0\.0\.0\.0\/0 → igwroute table public, associated with subnet public_a/,
    /^Subnet public_apublic · assigns public IPs on launch/,
    /^Security group webingress #2 allows HTTPS from 0\.0\.0\.0\/0/,
    /^aws_instance\.webpublic address: map_public_ip_on_launch = true on subnet public_a/,
  ]);

  // a resource step selects that resource
  await path.getByRole('button', { name: /^Internet gateway igw/ }).click();
  await expect(inspector(page).getByTestId('inspector-address')).toHaveText('aws_internet_gateway.igw');

  // a rule step opens the rules editor on that row, with focus in it
  await node(page, 'aws_instance.web').click();
  await inspector(page).getByRole('button', { name: /^:443 HTTPS/ }).click();
  await inspector(page).getByRole('list', { name: 'Path for :443' }).getByRole('button', { name: /^Security group web/ }).click();
  const dialog = rulesDialog(page);
  await expect(dialog).toBeVisible();
  const row = dialog.locator('tr[data-rule="aws_security_group.web:ingress:1"]');
  await expect(row).toHaveAttribute('data-highlighted', '');
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('data-rule'))).toBe(
    'aws_security_group.web:ingress:1',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // the database shares the web SG but has no public endpoint: that is what stops it
  await page.keyboard.press('Escape'); // the inspector covers the database node
  await expect(inspector(page)).toBeHidden();
  await node(page, 'aws_db_instance.main').click();
  const blocked = inspector(page).getByRole('region', { name: 'Blocked from the internet' });
  await expect(blocked.getByRole('button', { name: /^Port 443 from the internet · HTTPS.*not publicly accessible/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Security panel: why each exposed resource is reachable, compliance badges and the framework filter', async ({ page }) => {
  const errors = watchConsole(page);
  await openSeedProject(page, { monaco: false });
  await page.getByRole('button', { name: /^Security grade/ }).click();
  const p = panel(page);
  await expect(p).toBeVisible();

  const toggle = p.getByRole('button', { name: 'Why is web reachable?' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // the first port opens on its own
  const path = p.getByRole('list', { name: 'Path for :80' });
  await expect(path.getByRole('button', { name: /^Subnet public_a/ })).toBeVisible();
  await path.getByRole('button', { name: /^Security group web/ }).click();
  await expect(rulesDialog(page).locator('tr[data-rule="aws_security_group.web:ingress:0"]')).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Escape');
  await expect(rulesDialog(page)).toBeHidden();

  // findings carry the controls they fail
  const imds = p.locator('[data-finding="imdsv2:aws_instance.web"]');
  const badge = imds.getByRole('button', { name: /^FSBP EC2\.8/ });
  await expect(badge).toBeVisible();
  await badge.hover();
  await expect(page.locator('[data-bp-tooltip]')).toContainText('EC2 instances should use Instance Metadata Service Version 2 (IMDSv2)');
  // Esc closes the tooltip, not the panel
  await badge.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-bp-tooltip]')).toHaveCount(0);
  await expect(p).toBeVisible();

  const filter = p.getByRole('group', { name: 'Filter findings by framework' });
  await filter.getByRole('button', { name: /^FSBP/ }).click();
  await expect(filter.getByRole('button', { name: /^FSBP/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator('[data-finding]')).toHaveCount(2);
  expect(await seriousAxeViolations(page, 'aside[aria-label="Security"]')).toEqual([]);
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe, ${theme} theme: the paths in the inspector and the panel`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cb-theme', t), theme);
    await openSeedProject(page, { monaco: false });
    await node(page, 'aws_instance.web').click();
    await inspector(page).getByRole('button', { name: /^:443 HTTPS/ }).click();
    expect(await seriousAxeViolations(page, 'aside[aria-label="Inspector"]')).toEqual([]);
    await page.getByRole('button', { name: /^Security grade/ }).click();
    await panel(page).getByRole('button', { name: 'Why is web reachable?' }).click();
    expect(await seriousAxeViolations(page, 'aside[aria-label="Security"]')).toEqual([]);
  });
}

test('delta toast: adding SSH from anywhere says what got worse, Show jumps to it, undo stays quiet', async ({ page }) => {
  const errors = watchConsole(page);
  await openSeedProject(page, { monaco: false });
  await node(page, 'aws_security_group.web').click();
  await inspector(page).getByRole('button', { name: 'Edit rules' }).click();
  const dialog = rulesDialog(page);
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menu', { name: 'Add rule' }).getByRole('menuitem', { name: 'SSH' }).click();
  // the preset starts private; opening it to the internet is the edit that hurts
  const row = dialog.locator('tr[data-rule="aws_security_group.web:ingress:3"]');
  await row.getByRole('button', { name: 'Add source' }).click();
  await page.getByRole('menu', { name: 'Choose source' }).getByRole('menuitem', { name: /Anywhere, IPv4/ }).click();

  const toast = toasts(page).getByText('Security grade A → C: SSH (22) is now open to the internet on aws_instance.web');
  await expect(toast).toBeVisible();
  await expect(toasts(page).getByText('Ctrl Z to undo')).toBeVisible();
  await expect(toasts(page).getByText(/^Security grade/)).toHaveCount(1);

  // Show: out of the dialog, onto the resource, the panel open on the finding
  await toasts(page).getByRole('button', { name: 'Show' }).click();
  await expect(dialog).toBeHidden();
  await expect(inspector(page).getByTestId('inspector-address')).toHaveText('aws_instance.web');
  await expect(panel(page).getByRole('button', { name: /^SSH \(port 22\) is open to the internet/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(toast).toBeHidden();

  // undo takes the rule back without another toast
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: /^Security grade A/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(toasts(page).getByText(/^Security grade/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('delta toast: code that parses counts as an edit', async ({ page }) => {
  await openSeedProject(page);
  const editor = page.locator('[data-testid="monaco"] .view-lines');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  // one line (see insertCode): the rules as an attribute list of objects
  await page.keyboard.insertText(
    'resource "aws_security_group" "admin" { ingress = [{ from_port = 3389, to_port = 3389, protocol = "tcp", cidr_blocks = ["0.0.0.0/0"] }] }',
  );
  await expect(toasts(page).getByText('Security grade A → C: RDP (3389) is now open to the internet in aws_security_group.admin')).toBeVisible();
});
