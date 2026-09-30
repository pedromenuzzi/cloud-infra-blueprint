/**
 * Polish, round 2: long type names on canvas nodes, a backup .zip dropped on
 * the dashboard, folder-linked project cards, readable security-lens labels,
 * the Azure rules table on narrow screens, the phone security flow and the
 * Aurora cluster's subnet-group fix.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

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
