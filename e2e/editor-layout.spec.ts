/**
 * Editor layout: every section hides and comes back (the canvas too), the
 * resource palette and the code pane change sides from the Layout menu, by
 * dragging their grip or from the keyboard, the layout survives a reload
 * (and migrates the v1 key), a drag never opens the inspector, the
 * inspector never covers the resource it shows, docks beside the canvas,
 * and its Code button reveals the block in the code editor.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { canvasStats, openSeedProject, waitForMonaco } from './helpers';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const palette = (page: Page) => page.getByRole('complementary', { name: 'Resource palette' });
const monaco = (page: Page) => page.getByTestId('monaco');
const layoutMenu = (page: Page) => page.getByRole('dialog', { name: 'Layout' });
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('cb-layout-v2') ?? 'null'));

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, 'element has a box').not.toBeNull();
  return b!;
}

async function openLayoutMenu(page: Page) {
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await expect(layoutMenu(page)).toBeVisible();
  return layoutMenu(page);
}

/** the hidden canvas stays mounted (exports keep working) but inert and invisible */
const canvasHidden = (page: Page) =>
  page.locator('#bp-canvas').evaluate((el) => el.hasAttribute('inert') && getComputedStyle(el).opacity === '0');

test.describe('sections', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page);
    await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
  });

  test('each panel hides from its header and comes back from the strip it leaves', async ({ page }) => {
    const paletteToggle = page.getByRole('button', { name: /^Resource palette/ });
    await expect(paletteToggle).toHaveAttribute('aria-pressed', 'true');
    await palette(page).getByRole('button', { name: /^Hide resource palette/ }).click();
    await expect(palette(page)).toBeHidden();
    await expect(paletteToggle).toHaveAttribute('aria-pressed', 'false');
    const paletteStrip = page.getByRole('button', { name: 'Show resources' });
    // the keyboard lands on the strip that replaced the panel
    await expect(paletteStrip).toBeFocused();
    await paletteStrip.click();
    await expect(palette(page)).toBeVisible();

    await page.getByRole('button', { name: /^Hide code editor/ }).click();
    await expect(monaco(page)).toBeHidden();
    await expect(page.getByRole('button', { name: /^Code editor/ })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Show code' }).click();
    await waitForMonaco(page);

    // the canvas: from its corner, and the code takes the room
    const before = await box(monaco(page));
    await page.getByRole('group', { name: 'Canvas layout' }).getByRole('button', { name: 'Hide canvas' }).click();
    await expect.poll(() => canvasHidden(page)).toBe(true);
    await expect(page.getByRole('button', { name: 'Canvas', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await box(monaco(page))).width).toBeGreaterThan(before.width + 300);
    await page.getByRole('button', { name: 'Show canvas' }).click();
    await expect.poll(() => canvasHidden(page)).toBe(false);
    await expect(canvasStats(page)).toBeVisible();
  });

  test('the canvas and the code are never both hidden', async ({ page }) => {
    await page.getByRole('button', { name: /^Hide code editor/ }).click();
    await expect(monaco(page)).toBeHidden();
    // hiding the canvas now brings the code back
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
    await waitForMonaco(page);
    await expect.poll(() => canvasHidden(page)).toBe(true);
    // …and hiding the code (Ctrl+J, from outside the editor) brings the canvas back
    await page.getByRole('button', { name: 'Canvas', exact: true }).focus();
    await page.keyboard.press('Control+j');
    await expect.poll(() => canvasHidden(page)).toBe(false);
    await expect(monaco(page)).toBeHidden();

    const menu = await openLayoutMenu(page);
    await menu.getByRole('switch', { name: 'Canvas' }).click();
    await expect(menu.getByRole('switch', { name: 'Canvas' })).not.toBeChecked();
    await expect(menu.getByRole('switch', { name: 'Code' })).toBeChecked();
    await menu.getByRole('switch', { name: 'Code' }).click();
    await expect(menu.getByRole('switch', { name: 'Canvas' })).toBeChecked();
  });

  test('canvas focus hides resources and code, and brings them back', async ({ page }) => {
    const controls = page.getByRole('group', { name: 'Canvas layout' });
    await controls.getByRole('button', { name: /^Canvas focus/ }).click();
    await expect(palette(page)).toBeHidden();
    await expect(monaco(page)).toBeHidden();
    await controls.getByRole('button', { name: /^Show resources and code again/ }).click();
    await expect(palette(page)).toBeVisible();
    await waitForMonaco(page);
  });

  test('presets and reset from the Layout menu', async ({ page }) => {
    let menu = await openLayoutMenu(page);
    await expect(menu.getByRole('button', { name: 'Default' })).toHaveAttribute('aria-pressed', 'true');
    await menu.getByRole('button', { name: 'Code focus' }).click();
    await expect(menu.getByRole('button', { name: 'Code focus' })).toHaveAttribute('aria-pressed', 'true');
    await expect(palette(page)).toBeHidden();
    await expect.poll(() => canvasHidden(page)).toBe(true);
    await menu.getByRole('button', { name: 'Canvas focus' }).click();
    await expect.poll(() => canvasHidden(page)).toBe(false);
    await expect(monaco(page)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // focus goes back to the trigger
    await expect(page.getByRole('button', { name: 'Layout', exact: true })).toBeFocused();

    menu = await openLayoutMenu(page);
    await menu.getByRole('button', { name: 'Reset layout' }).click();
    await expect(palette(page)).toBeVisible();
    await waitForMonaco(page);
    expect(await stored(page)).toMatchObject({ palette: true, canvas: true, code: true, paletteSide: 'left', codeSide: 'right' });
  });
});

test.describe('sides', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page);
  });

  test('the Layout menu puts resources and code on either side, and it survives a reload', async ({ page }) => {
    const menu = await openLayoutMenu(page);
    await menu.getByRole('radiogroup', { name: 'Resources panel' }).getByRole('radio', { name: 'Right' }).check();
    await menu.getByRole('radiogroup', { name: 'Code editor' }).getByRole('radio', { name: 'Left' }).check();
    await expect(menu.getByRole('button', { name: 'Code on the left' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    const check = async () => {
      const canvas = await box(page.getByTestId('canvas'));
      expect((await box(monaco(page))).x).toBeLessThan(canvas.x);
      expect((await box(palette(page))).x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
    };
    await check();
    expect(await stored(page)).toMatchObject({ v: 2, paletteSide: 'right', codeSide: 'left' });

    await page.reload();
    await waitForMonaco(page);
    await check();

    // the splitter still resizes the code pane from the left
    const code = await box(page.locator('#bp-code'));
    const splitter = await box(page.getByRole('separator', { name: 'Resize code panel' }));
    await page.mouse.move(splitter.x + 2, splitter.y + 200);
    await page.mouse.down();
    await page.mouse.move(splitter.x + 122, splitter.y + 200, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await box(page.locator('#bp-code'))).width).toBeGreaterThan(code.width + 80);
  });

  test('dragging a panel by its grip moves it; drop zones light up; Esc cancels', async ({ page }) => {
    const grip = palette(page).getByRole('button', { name: /^Move resource palette to the right/ });
    const g = await box(grip);
    const workspace = await box(page.locator('#bp-workspace'));

    // Esc mid-drag: nothing moves
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(workspace.x + workspace.width - 200, workspace.y + 300, { steps: 8 });
    await expect(page.getByTestId('panel-drop-zones')).toBeVisible();
    await expect(page.locator('[data-drop="right"]')).toHaveAttribute('data-over', 'true');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.getByTestId('panel-drop-zones')).toBeHidden();
    expect((await box(palette(page))).x).toBeLessThan(100);

    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(workspace.x + workspace.width - 200, workspace.y + 300, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('panel-drop-zones')).toBeHidden();
    await expect.poll(async () => (await box(palette(page))).x).toBeGreaterThan(workspace.width - 300);

    // the grip from the keyboard: ← puts it back, focus stays on it
    const moved = palette(page).getByRole('button', { name: /^Move resource palette to the left/ });
    await moved.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await box(palette(page))).x).toBeLessThan(100);
    await expect(palette(page).getByRole('button', { name: /^Move resource palette to the right/ })).toBeFocused();

    // the code pane's grip: a click moves it to the other side of the canvas
    await page.getByRole('button', { name: /^Move code editor to the left/ }).click();
    await expect
      .poll(async () => (await box(monaco(page))).x < (await box(page.getByTestId('canvas'))).x)
      .toBe(true);
  });
});

test('the command palette runs layout commands', async ({ page }) => {
  await openSeedProject(page);
  await page.getByRole('button', { name: 'Search or run a command' }).click();
  await page.getByPlaceholder('Search or run a command…').fill('Layout: Code on the left');
  await page.getByRole('option', { name: /Layout: Code on the left/ }).click();
  await expect.poll(async () => (await box(monaco(page))).x < (await box(page.getByTestId('canvas'))).x).toBe(true);
  expect(await stored(page)).toMatchObject({ paletteSide: 'right', codeSide: 'left' });

  await page.getByRole('button', { name: 'Search or run a command' }).click();
  await page.getByPlaceholder('Search or run a command…').fill('Toggle canvas');
  await page.getByRole('option', { name: /Toggle canvas/ }).click();
  await expect.poll(() => canvasHidden(page)).toBe(true);
});

test.describe('migration', () => {
  test('the v1 panel toggles carry over once', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('cb-panels-v1', JSON.stringify({ palette: true, code: false, inspector: true }));
        localStorage.setItem('cb-split-pct', '50');
        sessionStorage.setItem('seeded', '1');
      }
    });
    await openSeedProject(page, { monaco: false });
    await expect(monaco(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show code' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cb-panels-v1'))).toBeNull();
    expect(await stored(page)).toMatchObject({ v: 2, code: false, split: 50 });
  });
});

test.describe('the inspector stays out of the way', () => {
  test.beforeEach(async ({ page }) => {
    await openSeedProject(page);
    await expect(canvasStats(page)).toHaveText('11 resources, 7 connections');
  });

  test('a drag moves a node without opening the inspector; a click opens it', async ({ page }) => {
    const role = node(page, 'aws_iam_role.web');
    const b = await box(role);
    await page.mouse.move(b.x + 60, b.y + 30);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 150, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(inspector(page)).toBeHidden();
    await expect(role).not.toHaveClass(/selected/);

    await role.click();
    await expect(inspector(page)).toBeVisible();
    await expect(role).toHaveClass(/selected/);
  });

  test('while a node is dragged the inspector turns see-through and lets the pointer pass', async ({ page }) => {
    await node(page, 'aws_db_instance.main').click();
    await expect(inspector(page)).toBeVisible();
    await page.waitForTimeout(500);
    const floating = inspector(page).locator('xpath=../..');
    const style = () => floating.evaluate((el) => ({ opacity: Number(getComputedStyle(el).opacity), events: getComputedStyle(el).pointerEvents }));
    expect(await style()).toEqual({ opacity: 1, events: 'auto' });

    const b = await box(node(page, 'aws_db_instance.main'));
    await page.mouse.move(b.x + 40, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + 200, b.y + 60, { steps: 10 });
    await expect.poll(async () => (await style()).opacity).toBeLessThan(0.5);
    expect((await style()).events).toBe('none');
    await page.mouse.up();
    await expect.poll(async () => (await style()).opacity).toBe(1);
    await expect(inspector(page)).toBeVisible();
  });

  test('a resource dragged from the palette drops onto the canvas under the inspector', async ({ page }) => {
    await node(page, 'aws_db_instance.main').click();
    await expect(inspector(page)).toBeVisible();
    await page.waitForTimeout(500);
    const target = await box(inspector(page));
    const bucket = palette(page).getByRole('button', { name: /^Add S3 Bucket/ });
    await bucket.hover();
    await page.mouse.down();
    await page.mouse.move(target.x + 120, target.y + target.height - 160, { steps: 12 });
    await page.mouse.up();
    // the drop reached the canvas (the inspector let it through), and the new bucket is selected
    await expect(canvasStats(page)).toHaveText(/^12 resources/);
    await expect(page.locator('.react-flow__node[data-id^="aws_s3_bucket."]')).toHaveCount(1);
    await expect(inspector(page)).toContainText('S3 Bucket');
  });

  test('selecting a node the inspector would cover pans it into view; so does reopening the inspector', async ({ page }) => {
    const db = node(page, 'aws_db_instance.main');
    await db.click();
    await expect(inspector(page)).toBeVisible();
    await expect
      .poll(async () => (await box(db)).x + (await box(db)).width)
      .toBeLessThanOrEqual((await box(inspector(page))).x);

    // minimize, move the node back under where the inspector sits, reopen from the tab
    await inspector(page).getByRole('button', { name: 'Minimize inspector' }).click();
    await expect(inspector(page)).toBeHidden();
    const canvas = await box(page.getByTestId('canvas'));
    await page.mouse.move(canvas.x + 150, canvas.y + 140);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 450, canvas.y + 140, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await box(db)).x + (await box(db)).width).toBeGreaterThan(canvas.x + canvas.width - 300);
    await page.getByRole('button', { name: 'Show inspector' }).click();
    await expect(inspector(page)).toBeVisible();
    await expect
      .poll(async () => (await box(db)).x + (await box(db)).width)
      .toBeLessThanOrEqual((await box(inspector(page))).x);
  });

  test('docked, the inspector gets a column of its own beside the canvas', async ({ page }) => {
    const menu = await openLayoutMenu(page);
    await menu.getByRole('radiogroup', { name: 'Inspector' }).getByRole('radio', { name: 'Docked' }).check();
    await page.keyboard.press('Escape');
    const column = page.getByTestId('docked-inspector');
    await expect(column).toContainText('Select a resource on the canvas');

    await node(page, 'aws_db_instance.main').click();
    await expect(column.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
    const canvas = await box(page.getByTestId('canvas'));
    expect(canvas.x + canvas.width).toBeLessThanOrEqual((await box(column)).x + 1);

    await inspector(page).getByRole('button', { name: 'Minimize inspector' }).click();
    await expect(column).toBeHidden();
    await page.getByRole('button', { name: 'Show inspector' }).click();
    await expect(inspector(page)).toBeVisible();
    expect(await stored(page)).toMatchObject({ inspectorMode: 'docked', inspector: true });
  });

  test('Code shows the block in the code editor, highlighted — opening the editor when hidden', async ({ page }) => {
    const header = page.locator('[data-testid="monaco"] .view-line', { hasText: 'resource "aws_db_instance" "main"' });
    await node(page, 'aws_db_instance.main').click();
    await inspector(page).getByRole('button', { name: 'Code', exact: true }).click();
    await expect(header).toBeVisible();
    await expect(page.locator('[data-testid="monaco"] .bp-code-flash').first()).toBeAttached();

    await page.getByRole('button', { name: /^Hide code editor/ }).click();
    await expect(monaco(page)).toBeHidden();
    await node(page, 'aws_iam_role.web').click();
    await inspector(page).getByRole('button', { name: 'Code', exact: true }).click();
    await waitForMonaco(page);
    await expect(page.locator('[data-testid="monaco"] .view-line', { hasText: 'resource "aws_iam_role" "web"' })).toBeVisible();
    await expect(page.locator('[data-testid="monaco"] .bp-code-flash').first()).toBeAttached();
    // the old clipped preview is gone
    await expect(inspector(page).getByRole('tab', { name: /code/i })).toHaveCount(0);
  });
});

test.describe('phones (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the Layout menu opens from ⋯; code focus fills the screen; drawers open from their side', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Layout…' }).click();
    const menu = layoutMenu(page);
    await expect(menu).toBeVisible();
    const m = await box(menu);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(390);

    await menu.getByRole('button', { name: 'Code focus' }).click();
    await waitForMonaco(page);
    expect((await box(monaco(page))).width).toBeGreaterThan(360);
    await menu.getByRole('radiogroup', { name: 'Resources panel' }).getByRole('radio', { name: 'Right' }).check();
    // canvas focus keeps the sides as they are
    await menu.getByRole('button', { name: 'Canvas focus' }).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => canvasHidden(page)).toBe(false);

    // the palette drawer opens from the right edge now
    await page.getByRole('button', { name: /^Resource palette/ }).click();
    await expect(palette(page)).toBeVisible();
    await expect.poll(async () => {
      const p = await box(palette(page));
      return Math.round(p.x + p.width);
    }).toBe(390);
    await palette(page).getByText('S3 Bucket', { exact: true }).click();
    await expect(canvasStats(page)).toHaveText(/^12 resources/);
  });
});

/* ------------------------------------------------------------------ axe */

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function seriousViolations(page: Page) {
  await page.waitForTimeout(400);
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    type V = { id: string; impact: string; nodes: Array<{ target: string[] }> };
    const axe = (window as unknown as { axe: { run(d: Document, o: object): Promise<{ violations: V[] }> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`layout chrome passes axe (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((t) => localStorage.setItem('cb-theme', t), theme);
    await openSeedProject(page);
    await openLayoutMenu(page);
    expect(await seriousViolations(page), 'layout menu').toEqual([]);
    await page.keyboard.press('Escape');

    // collapsed strips, a minimized inspector's tab, a docked column
    await palette(page).getByRole('button', { name: /^Hide resource palette/ }).click();
    await page.getByRole('button', { name: /^Hide code editor/ }).click();
    await node(page, 'aws_db_instance.main').click();
    await inspector(page).getByRole('button', { name: 'Minimize inspector' }).click();
    expect(await seriousViolations(page), 'collapsed').toEqual([]);

    const menu = await openLayoutMenu(page);
    await menu.getByRole('button', { name: 'Default' }).click();
    await menu.getByRole('radiogroup', { name: 'Inspector' }).getByRole('radio', { name: 'Docked' }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('docked-inspector')).toBeVisible();
    expect(await seriousViolations(page), 'docked').toEqual([]);

    // the canvas hidden: code only
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
    expect(await seriousViolations(page), 'code focus').toEqual([]);
  });
}
