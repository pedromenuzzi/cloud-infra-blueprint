import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility regression suite. Each main route is scanned with axe-core
 * (WCAG 2.1 A + AA, plus best practices). Findings are asserted to be empty
 * so any new violation fails CI loudly.
 *
 * To debug locally:
 *
 *     pnpm --filter @blueprint/web test:e2e tests/e2e/a11y.spec.ts
 *     # then inspect the JSON in the playwright-report.
 */

const ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/editor/demo', name: 'editor' },
  { path: '/this-route-does-not-exist', name: '404' },
] as const;

for (const { path, name } of ROUTES) {
  test(`a11y: ${name} (${path}) has no axe violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      // Scrollbar/contrast issues coming from the Tailwind CSS variables under
      // the test theme are not blocking; we keep these specific rule disabled
      // until we run a curated palette pass with real OKLCH tokens.
      .disableRules([
        // Color-contrast can vary between theme variants and should be
        // checked manually with Lighthouse / axe DevTools, not in CI.
        'color-contrast',
      ])
      .analyze();

    if (results.violations.length > 0) {
      // Surface the violations in CI logs in a readable form.
      console.error(
        `Axe violations on ${name}:\n` +
          results.violations
            .map(
              (v) =>
                `  - ${v.id} (${v.impact}): ${v.help}\n` +
                v.nodes
                  .map(
                    (n, i) =>
                      `      [${i}] target: ${n.target.join(' ')}\n` +
                      `          html: ${n.html.replace(/\s+/g, ' ').slice(0, 180)}\n` +
                      `          fail: ${n.failureSummary?.replace(/\n/g, ' | ').slice(0, 200) ?? ''}`,
                  )
                  .join('\n'),
            )
            .join('\n'),
      );
    }
    expect(results.violations).toEqual([]);
  });
}
