/**
 * axe-core audit of every main screen and dialog, in both themes. axe
 * (a dev dependency, never in the app bundle) is injected into the page.
 *
 * Fails on any serious / critical violation, except the ALLOW entries below:
 * known issues in files other engineers own, each with its fix. Delete an
 * entry once its fix lands — the test then guards it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { openSeedProject } from './helpers';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface Allow {
  rule: string;
  /** the failing element matches, or sits inside, this selector */
  within: string;
  owner: string;
}

const ALLOW: Allow[] = [
  {
    rule: 'color-contrast',
    within: '.react-flow__node',
    owner:
      'nodes.tsx (lead): category label → text-(--cat-text) with --cat-text: var(--cat-text-<category>); ProviderChip below',
  },
  {
    rule: 'color-contrast',
    within: '[class*="rounded-[4px]"][class*="text-[9px]"]',
    owner: 'ProviderChip (resources/icons.tsx): color: var(--<provider>-text) instead of the brand color',
  },
  {
    rule: 'color-contrast',
    within: '[class*="text-[9px]"][class*="tracking-[0.07em]"]',
    owner: 'LandingPage hero art: category label color → var(--cat-text-<category>)',
  },
  {
    rule: 'nested-interactive',
    within: '[class*="cursor-pointer"][class*="rounded-[14px]"]',
    owner: 'DashboardPage project card: clickable div wrapping buttons',
  },
];

interface Finding {
  id: string;
  impact: string;
  help: string;
  targets: string[];
}

async function audit(page: Page): Promise<Finding[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async (allow) => {
    type AxeNode = { target: string[] };
    type AxeViolation = { id: string; impact: string; help: string; nodes: AxeNode[] };
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<{ violations: AxeViolation[] }> } }).axe;
    const { violations } = await axe.run(document, { resultTypes: ['violations'] });
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes
          .filter((n) => {
            const el = document.querySelector(n.target[0]!);
            return !allow.some((a) => a.rule === v.id && el?.closest(a.within));
          })
          .map((n) => n.target.join(' ')),
      }))
      .filter((v) => v.targets.length > 0);
  }, ALLOW);
}

async function expectAccessible(page: Page, screen: string) {
  // let entry animations settle: axe measures the colors actually painted
  await page.waitForTimeout(400);
  const findings = await audit(page);
  expect(findings, `${screen}: serious/critical axe violations`).toEqual([]);
}

/** Click a canvas-toolbar button; count the distinct viewport transforms painted over 600 ms. */
async function framesAfter(page: Page, button: string): Promise<number> {
  return page.evaluate(async (label) => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!;
    const seen = new Set<string>();
    document.querySelector<HTMLButtonElement>(`[aria-label^="${label}"]`)!.click();
    const start = performance.now();
    await new Promise<void>((done) => {
      const tick = () => {
        seen.add(viewport.style.transform);
        if (performance.now() - start < 600) requestAnimationFrame(tick);
        else done();
      };
      tick();
    });
    return seen.size;
  }, button);
}

test.describe('reduced motion', () => {
  test('canvas toolbar zoom and fit view jump instead of animating', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    // baseline: without the preference the viewport animates over many frames
    expect(await framesAfter(page, 'Zoom in')).toBeGreaterThan(3);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await framesAfter(page, 'Zoom in')).toBeLessThanOrEqual(2);
    expect(await framesAfter(page, 'Fit view')).toBeLessThanOrEqual(2);
    expect(await framesAfter(page, 'Reset zoom')).toBeLessThanOrEqual(2);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cb-theme', t), theme);
    });

    test('landing and dashboard', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('main')).toBeVisible();
      await expectAccessible(page, 'landing');

      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
      await expectAccessible(page, 'dashboard');
    });

    test('templates modal', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByRole('button', { name: /New Project/ }).click();
      await expect(page.getByRole('dialog', { name: 'Start from a template' })).toBeVisible();
      await expectAccessible(page, 'templates modal');
    });

    test('editor, command palette and PDF dialog', async ({ page }) => {
      await openSeedProject(page);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
      await expectAccessible(page, 'editor');

      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
      await expectAccessible(page, '⌘K palette');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: /PDF document/ }).click();
      await expect(page.getByRole('dialog', { name: 'Export PDF document' })).toBeVisible();
      await expectAccessible(page, 'PDF dialog');
    });

    test('keyboard shortcuts dialog and 404', async ({ page }) => {
      await openSeedProject(page, { monaco: false });
      await page.getByRole('button', { name: /^Fit view/ }).focus();
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      await expectAccessible(page, 'shortcuts dialog');

      await page.goto('/this-page-does-not-exist');
      await expect(page.getByRole('main')).toContainText('Page not found');
      await expectAccessible(page, '404');
    });
  });
}
