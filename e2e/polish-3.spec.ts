/**
 * Polish, round 3: the editor top bar on tablet and small laptop widths.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { SEED_PROJECT } from './helpers';

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

/** open the seeded project in `locale` (and `theme`), without waiting for Monaco */
async function openSeed(page: Page, { locale = 'en', theme }: { locale?: string; theme?: string } = {}) {
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
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

/** what in the top bar sticks out of the viewport, is squeezed below its size, or leaves the name too narrow */
async function topbarProblems(page: Page): Promise<string[]> {
  return page.locator('header').first().evaluate((header) => {
    const vw = document.documentElement.clientWidth;
    const problems: string[] = [];
    if (header.scrollWidth > header.clientWidth + 1) problems.push(`header scrolls: ${header.scrollWidth} > ${header.clientWidth}`);
    const name = (el: Element) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? el.tagName;
    for (const el of header.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > vw + 0.5 || box.left < -0.5) problems.push(`${name(el)} outside: ${box.left.toFixed(0)}..${box.right.toFixed(0)} of ${vw}`);
    }
    // a flex item can also shrink below its size instead of overflowing: buttons keep theirs
    for (const el of header.querySelectorAll('button, a')) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.width < 26) problems.push(`${name(el)} squeezed to ${box.width.toFixed(0)} px`);
    }
    const input = header.querySelector('input');
    if (input && input.getBoundingClientRect().width < 96) problems.push(`project name only ${input.getBoundingClientRect().width.toFixed(0)} px`);
    return problems;
  });
}

test.describe('editor top bar from tablet to small laptop widths', () => {
  for (const locale of ['en', 'pt-BR']) {
    test(`${locale}: nothing overflows or gets squeezed at 640, 768, 900, 1024, 1100 and 1280 px`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 760 });
      await openSeed(page, { locale });
      for (const width of [640, 768, 900, 1024, 1100, 1280]) {
        await page.setViewportSize({ width, height: 760 });
        await expect.poll(() => topbarProblems(page), { message: `at ${width} px` }).toEqual([]);
      }
    });
  }

  test('below lg the view link moves into ⋯, below md the Layout menu does too; from lg up both are buttons', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void w.__copied.push(t) } });
    });
    await page.setViewportSize({ width: 768, height: 760 });
    await openSeed(page);
    const header = page.locator('header').first();
    await expect(header.getByRole('button', { name: 'Copy view link' })).toBeHidden();
    await expect(header.getByRole('button', { name: 'Layout', exact: true })).toBeVisible();
    await header.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu.getByRole('menuitem', { name: 'Layout…' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Copy view link (read-only)' }).click();
    await expect(page.getByText('View link copied')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0])).toMatch(/\/#view=/);

    await page.setViewportSize({ width: 700, height: 760 });
    await expect(header.getByRole('button', { name: 'Layout', exact: true })).toBeHidden();
    await header.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menu', { name: 'More actions' }).getByRole('menuitem', { name: 'Layout…' }).click();
    await expect(page.getByRole('dialog', { name: 'Layout' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1024, height: 760 });
    await expect(header.getByRole('button', { name: 'More actions' })).toBeHidden();
    await expect(header.getByRole('button', { name: 'Copy view link' })).toBeVisible();
    // icon-only buttons keep their name as a tooltip
    await expect(header.getByRole('button', { name: 'Share' })).toHaveAttribute('title', 'Share');
  });

  test('pt-BR below md: the save state is an icon with its word for screen readers and as a tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 760 });
    await openSeed(page, { locale: 'pt-BR' });
    const status = page.locator('header').first().getByRole('status').filter({ hasText: 'Salvo' });
    await expect(status).toHaveAttribute('title', 'Salvo');
    expect(await status.locator('span').evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [768, 1024]) {
      test(`axe, ${theme} theme, pt-BR, ${width} px: the top bar`, async ({ page }) => {
        await page.setViewportSize({ width, height: 760 });
        await openSeed(page, { locale: 'pt-BR', theme });
        expect(await seriousAxeViolations(page, 'header')).toEqual([]);
      });
    }
  }
});
