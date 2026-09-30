/**
 * Read-only view links (`/#view=…`): the viewer, what it refuses, "Make a
 * copy to edit", the editor's "Copy view link" and the iframe embed.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { encodeShare } from '../src/lib/share';
import { getTemplate } from '../src/templates';
import { canvasStats, openSeedProject, storedProjects, SEED_PROJECT } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const files = getTemplate('aws-web-app')!.build(SEED_PROJECT);
const payload = encodeShare({ name: SEED_PROJECT, files });
const viewLink = `/#view=${payload}`;

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function localStorageKeys(page: Page) {
  return page.evaluate(() => Object.keys(localStorage).sort());
}

async function openView(page: Page) {
  await page.goto(viewLink);
  // the viewer and canvas chunks load lazily — room for a busy machine, as for Monaco
  await expect(page.getByRole('heading', { name: /Viewing production-web/ })).toBeVisible({ timeout: 15_000 });
  await expect(canvasStats(page)).toHaveText(/^11 resources/);
}

test('the viewer shows the project read-only: drag, delete, connect and typing change nothing, nothing is stored', async ({
  page,
}) => {
  await openView(page);
  await expect(page.getByText('read-only', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="monaco"] .monaco-editor')).toBeVisible({ timeout: 15_000 });
  const ec2 = node(page, 'aws_instance.web');
  const box = (await ec2.boundingBox())!;
  // a node's place in the diagram (dragging a node that can't move pans the view instead)
  const placeOf = () => ec2.evaluate((el) => (el as HTMLElement).style.transform);
  const before = await placeOf();

  // drag: the node stays where it is in the diagram
  await page.mouse.move(box.x + 60, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 12 });
  await page.mouse.up();
  expect(await placeOf()).toBe(before);

  // selecting works; the inspector is read-only and has no delete
  await ec2.click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Read-only view — make a copy to edit.');
  await expect(page.locator('#inspector-tf-name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete resource' })).toHaveCount(0);

  // Delete / Backspace and arrow keys do nothing
  await ec2.focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowRight');
  await expect(canvasStats(page)).toHaveText(/^11 resources/);
  await expect(node(page, 'aws_instance.web')).toBeVisible();
  expect(await placeOf()).toBe(before);

  // the menus only offer what looks; no tidy, no connecting handles to drag from
  await ec2.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Resource actions' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Show in code', 'Copy address', 'Terraform docs']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Auto-arrange' })).toHaveCount(0);
  const vpc = node(page, 'aws_vpc.main');
  await vpc.click({ position: { x: 60, y: 12 } });
  await expect(vpc.locator('.react-flow__resize-control')).toHaveCount(0);

  // the code can't be typed into
  const code = page.locator('[data-testid="monaco"] .view-lines');
  // Monaco only draws the lines in view, and reuses their elements in any order:
  // compare from the top, line by line in the order they're drawn
  const drawn = () =>
    code.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>('.view-line'))
        .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
        .map((line) => (line.textContent ?? '').replace(/\u00a0/g, ' ')) // Monaco draws spaces as no-break spaces
        .join('\n'),
    );
  /** what is drawn once the (smooth) scroll to the top has stopped */
  const settled = async () => {
    let previous = await drawn();
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(150);
      const now = await drawn();
      if (now === previous) return now;
      previous = now;
    }
    return previous;
  };
  /** scrolled to the very top (a reveal still gliding from the clicks above can win over one Ctrl+Home) */
  const top = async () => {
    let text = '';
    await expect(async () => {
      await page.keyboard.press('Control+Home');
      text = await settled();
      expect(text.split('\n')[0]).toBe(files['main.tf'].split('\n')[0]);
    }).toPass({ timeout: 10_000 });
    return text;
  };
  await code.click();
  const text = await top();
  await page.keyboard.type('zzz_typed');
  await page.keyboard.press('Enter');
  await expect(code).not.toContainText('zzz_typed');
  expect(await top()).toBe(text);

  // double-click doesn't open "add resource"
  const pane = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.dblclick(pane.x + 20, pane.y + pane.height - 120);
  await expect(page.getByRole('dialog', { name: 'Quick add resource' })).toHaveCount(0);

  // nothing was written: no project, no seed, not even a preference
  expect(await localStorageKeys(page)).toEqual([]);
  await page.reload();
  await expect(canvasStats(page)).toHaveText(/^11 resources/);
  expect(await localStorageKeys(page)).toEqual([]);
});

test('the viewer exports: PNG and the PDF dialog', async ({ page }) => {
  await openView(page);
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  await exportButton.click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Diagram as PNG' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await exportButton.click();
  await page.getByRole('menuitem', { name: 'PDF document…' }).click();
  await expect(page.getByRole('dialog', { name: /PDF/ })).toBeVisible();
});

test('"Make a copy to edit" asks first, imports once, then offers that copy', async ({ page }) => {
  await openView(page);
  await page.getByRole('button', { name: 'Make a copy to edit' }).click();
  const ask = page.getByRole('dialog', { name: /Import a copy of production-web/ });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Import copy' }).click();
  await expect(page).toHaveURL(/\/editor\//);
  const editorUrl = page.url();
  await expect(canvasStats(page)).toHaveText(/^11 resources/);
  const stored = await storedProjects(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]!.files).toEqual(files);

  await page.goto(viewLink);
  await page.getByRole('button', { name: 'Make a copy to edit' }).click();
  const again = page.getByRole('dialog', { name: /Import a copy/ });
  await expect(again).toContainText('You already imported this link');
  await again.getByRole('button', { name: 'Open existing copy' }).click();
  await expect(page).toHaveURL(editorUrl);
  expect(await storedProjects(page)).toHaveLength(1);
});

test('"Copy view link" in the editor makes a link that opens this viewer', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void w.__copied.push(t) },
    });
  });
  await openSeedProject(page, { monaco: false });
  await page.getByRole('button', { name: 'Copy view link' }).click();
  await expect(page.getByText('View link copied')).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0]!);
  expect(copied).toMatch(/\/#view=[A-Za-z0-9_-]+$/);
  await page.goto(copied);
  await expect(page.getByRole('heading', { name: /Viewing production-web/ })).toBeVisible();
  await expect(canvasStats(page)).toHaveText(/^11 resources/);

  // and the viewer's own share menu hands out the embed code
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('menuitem', { name: 'Copy embed code' }).click();
  const snippet = await page.evaluate(() => {
    const copied = (window as unknown as { __copied: string[] }).__copied;
    return copied[copied.length - 1]!;
  });
  expect(snippet).toMatch(/^<iframe src="http:\/\/localhost:\d+\/#view=[A-Za-z0-9_-]+&embed=1" title="production-web — Cloud Blueprint"/);
});

test('embed mode: the diagram only, fitted, inside an iframe — no focus taken, no dialogs', async ({ page, baseURL }) => {
  await page.setContent(`<!doctype html>
    <html><body style="margin:0;padding:24px">
      <label>Notes <input id="notes" autofocus></label>
      <iframe id="embed" src="${baseURL}/#view=${payload}&embed=1" width="720" height="420" style="border:0"></iframe>
    </body></html>`);
  await page.locator('#notes').focus();
  const frame = page.frameLocator('#embed');
  await expect(frame.locator('.react-flow__node')).toHaveCount(11, { timeout: 15_000 });
  await page.waitForTimeout(800);

  // no app chrome: no topbar, no copy button, no code, no dialog — just the diagram and an Open link
  await expect(frame.getByRole('button', { name: /Make a copy/ })).toHaveCount(0);
  await expect(frame.getByRole('heading', { name: /Viewing/ })).toHaveCount(0);
  await expect(frame.locator('[data-testid="monaco"]')).toHaveCount(0);
  await expect(frame.getByRole('dialog')).toHaveCount(0);
  const open = frame.getByRole('link', { name: /Open/ });
  await expect(open).toHaveAttribute('target', '_blank');
  expect(await open.getAttribute('href')).toMatch(/\/#view=[A-Za-z0-9_-]+$/);

  // focus stayed on the host page
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('notes');

  // the whole diagram fits in the frame
  const box = (await page.locator('#embed').boundingBox())!;
  for (const n of await frame.locator('.react-flow__node').all()) {
    const b = (await n.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(b.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }

  // read-only in there too, and the palette shortcut doesn't open chrome
  await frame.locator('.react-flow__node[data-id="aws_instance.web"]').click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+k');
  await expect(frame.locator('.react-flow__node')).toHaveCount(11);
  await expect(frame.getByRole('dialog')).toHaveCount(0);
});

test('a damaged view link says so', async ({ page }) => {
  await page.goto(`/#view=${payload.slice(0, 50)}`);
  await expect(page.getByRole('heading', { name: 'Can’t open this view' })).toBeVisible();
  await expect(page.getByText('This view link is damaged or incomplete')).toBeVisible();
  await page.getByRole('link', { name: 'Go to Cloud Blueprint' }).click();
  await expect(page).toHaveURL(/\/$/);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the viewer is accessible (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openView(page);
    await node(page, 'aws_instance.web').click();
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
    await page.waitForTimeout(500);
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run(ctx: Document): Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
      const { violations } = await axe.run(document);
      return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    });
    expect(violations).toEqual([]);
  });
}
