import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { canvasStats, openSeedProject } from './helpers';

async function openExportDialog(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: /PDF document/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export PDF document' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function exportPdf(page: Page, setup?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  const dialog = await openExportDialog(page);
  await setup?.(dialog);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF' }).click();
  const file = await download;
  // toasts only last ~3 s — check it before reading the file
  await expect(page.getByText(/^PDF downloaded/)).toBeVisible();
  await expect(dialog).toBeHidden();
  return { name: file.suggestedFilename(), pdf: await readFile((await file.path())!) };
}

/** the inflated content stream of every page, in file order (page 1 first) */
function pageContents(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of text.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+)>>\nstream\n/g)) {
    const start = m.index + m[0].length;
    out.push(inflateSync(pdf.subarray(start, start + Number(m[1]))).toString('latin1'));
  }
  return out;
}

/** the text runs drawn by a content stream */
function textRuns(content: string): string[] {
  return [...content.matchAll(/<([0-9a-f]*)> Tj/g)].map((m) =>
    Buffer.from(m[1], 'hex').toString('latin1'),
  );
}

/** stroke color operator for '#rrggbb', as the writer prints it */
function strokeOp(hex: string): string {
  return `${[1, 3, 5].map((i) => String(Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000)).join(' ')} RG`;
}

/** a VPC with 12 subnets of 12 instances, each tied to one of 5 security groups: 162 resources */
function largeProject(): { text: string; count: number } {
  const perSubnet = 12;
  const subnets = 12;
  const instances = perSubnet * subnets;
  const out: string[] = ['provider "aws" {\n  region = "us-east-1"\n}\n'];
  const subW = 4 * 240 + 40;
  const subH = 3 * 110 + 70;
  const vpcW = 3 * (subW + 40) + 40;
  const vpcH = Math.ceil(subnets / 3) * (subH + 40) + 80;
  out.push(`# @blueprint:pos=0,0,${vpcW},${vpcH}\nresource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n`);
  for (let g = 0; g < 5; g++) {
    out.push(`# @blueprint:pos=${vpcW + 80},${g * 120}\nresource "aws_security_group" "sg${g}" {\n  name   = "sg${g}"\n  vpc_id = aws_vpc.main.id\n}\n`);
  }
  let i = 0;
  for (let s = 0; s < subnets; s++) {
    const sx = 40 + (s % 3) * (subW + 40);
    const sy = 60 + Math.floor(s / 3) * (subH + 40);
    out.push(`# @blueprint:pos=${sx},${sy},${subW},${subH}\nresource "aws_subnet" "s${s}" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.${s}.0/24"\n}\n`);
    for (let k = 0; k < perSubnet && i < instances; k++, i++) {
      const x = 20 + (k % 4) * 240;
      const y = 50 + Math.floor(k / 4) * 110;
      out.push(
        `# @blueprint:pos=${x},${y}\nresource "aws_instance" "web${i}" {\n  ami                    = "ami-0abc${i}"\n  instance_type          = "t3.micro"\n  subnet_id              = aws_subnet.s${s}.id\n  vpc_security_group_ids = [aws_security_group.sg${i % 5}.id]\n}\n`,
      );
    }
  }
  return { text: out.join('\n'), count: 1 + 5 + subnets + instances };
}

async function openLargeProject(page: Page) {
  const now = new Date().toISOString();
  const { text, count } = largeProject();
  const project = { id: 'prj_large', name: 'large-project', files: { 'main.tf': text }, providers: ['aws'], createdAt: now, updatedAt: now };
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('cb-e2e-seeded')) return;
    sessionStorage.setItem('cb-e2e-seeded', '1');
    localStorage.setItem('cb-tips-dismissed', '1');
    localStorage.setItem('cb-seeded-v1', '1');
    localStorage.setItem('cb-projects-v1', JSON.stringify([p]));
  }, project);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open project large-project' }).click();
  await expect(canvasStats(page)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(count, { timeout: 15_000 });
  return count;
}

/** hold the PDF writer's code back, so an export is still running when the test cancels it */
async function holdPdfWriter(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/assets\/archDoc-[\w-]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

test.describe('PDF document export', () => {
  test('downloads a shareable architecture document with the diagram', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const { name, pdf } = await exportPdf(page, async (dialog) => {
      await expect(dialog.getByLabel('Title')).toHaveValue('production-web');
      await dialog.getByLabel('Title').fill('Produção web — review');
      await dialog.getByLabel('Notes for the reader').fill('Please review before Friday.');
      await dialog.getByRole('switch', { name: 'Terraform source' }).check();
    });
    expect(name).toBe('producao-web-review-architecture.pdf');
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Outlines');
    // the diagram is vector art: sharp, searchable, with the real icon glyphs
    expect(text).not.toContain('/Subtype /Image');
    const [diagram] = pageContents(pdf);
    const labels = textRuns(diagram);
    for (const label of ['main', 'public_a', 'public_b', 'web', 'VPC', 'SUBNET', 'EC2', 'SECURITY GROUP']) expect(labels, label).toContain(label);
    expect(diagram).toMatch(/\/Sh\d+ sh/); // gradient icon tiles
    expect(diagram.match(/ c /g)?.length ?? 0).toBeGreaterThan(50); // glyph and edge curves
  });

  test('draws the diagram in the light theme even when the app is dark', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cb-theme', 'dark'));
    await openSeedProject(page, { monaco: false });
    await expect(page.locator('html')).toHaveClass(/dark/);
    const { pdf } = await exportPdf(page);
    const [diagram] = pageContents(pdf);
    // light canvas (#eef4fb) and node borders (#d5deea) — nothing of the dark theme
    expect(diagram).toContain('0.933 0.957 0.984 rg');
    expect(diagram.split(strokeOp('#d5deea')).length - 1).toBeGreaterThanOrEqual(4);
    for (const dark of ['#243a5c', '#0f1d33', '#0a1428']) expect(diagram, dark).not.toContain(strokeOp(dark).replace(' RG', ''));
    // the canvas is untouched and still dark
    await expect(page.locator('.react-flow__viewport')).not.toHaveClass(/bp-force-light/);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).not.toHaveClass(/bp-exporting/);
  });

  test('leaves the selection out of the document and puts it back afterwards', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    // a box selection of every node
    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const selected = page.locator('.react-flow__node.selected');
    await expect(selected).toHaveCount(11);

    const { pdf } = await exportPdf(page);
    const [diagram] = pageContents(pdf);
    // no selection rings (2 px strokes in a category color) and no active-edge labels
    expect(diagram).not.toMatch(/ 2(?:\.\d+)? w (?:0\.976 0\.451 0\.086|0\.576 0\.2 0\.918|0\.863 0\.149 0\.149) RG/);
    expect(textRuns(diagram)).not.toContain('subnet_id');
    await expect(selected).toHaveCount(11);
  });

  test('exports a large project quickly, without freezing the tab, in readable tiles', async ({ page }) => {
    test.setTimeout(90_000);
    await openLargeProject(page);
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__long.push(e.duration);
      }).observe({ type: 'longtask' });
    });
    const started = Date.now();
    const { pdf } = await exportPdf(page);
    expect(Date.now() - started).toBeLessThan(20_000);
    const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long));
    expect(longest).toBeLessThan(1_000);

    const pages = pageContents(pdf);
    const areas = pages.filter((c) => textRuns(c).some((t) => /^Diagram \x97 area \d+ of \d+$/.test(t)));
    expect(areas.length).toBeGreaterThan(1);
    // every instance is on an area page, at a readable size
    const onAreas = new Set(areas.flatMap(textRuns));
    for (const n of [0, 57, 138]) expect(onAreas.has(`web${n}`), `web${n}`).toBe(true);
    const sizes = areas.flatMap((c) => [...c.matchAll(/\/F\d ([\d.]+) Tf/g)].map((m) => Number(m[1])));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(4.7);
  });

  for (const how of ['the Cancel button', 'Esc'] as const) {
    test(`stops an export in progress with ${how}`, async ({ page }) => {
      await openSeedProject(page, { monaco: false });
      const release = await holdPdfWriter(page);
      let downloads = 0;
      page.on('download', () => downloads++);
      const dialog = await openExportDialog(page);
      await dialog.getByRole('button', { name: 'Download PDF' }).click();
      await expect(dialog.getByRole('button', { name: /Writing PDF/ })).toBeVisible();
      if (how === 'Esc') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText('PDF export cancelled')).toBeVisible();
      release();
      await page.waitForTimeout(1_500);
      expect(downloads).toBe(0);
      // the next export runs normally
      const { pdf } = await exportPdf(page);
      expect(pdf.toString('latin1').startsWith('%PDF-1.4')).toBe(true);
      expect(downloads).toBe(1);
    });
  }

  test('warns when the title or notes use characters the PDF cannot print', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    const dialog = await openExportDialog(page);
    const warning = dialog.getByRole('status').filter({ hasText: /can't show/ });
    await expect(warning).toBeHidden();
    await dialog.getByLabel('Title').fill('Produção — café');
    await expect(warning).toBeHidden();
    await dialog.getByLabel('Notes for the reader').fill('生产环境 🚀');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('生');
  });

  test('remembers which sections to include', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    await exportPdf(page, async (dialog) => {
      await dialog.getByRole('switch', { name: 'Security review' }).uncheck();
      await dialog.getByRole('radio', { name: 'Letter' }).click();
    });
    const dialog = await openExportDialog(page);
    await expect(dialog.getByRole('switch', { name: 'Security review' })).not.toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Letter' })).toHaveAttribute('aria-checked', 'true');
  });
});
