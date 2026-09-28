import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { openSeedProject } from './helpers';

async function exportPdf(page: Page, setup?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: /PDF document/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export PDF document' });
  await expect(dialog).toBeVisible();
  await setup?.(dialog);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF' }).click();
  const file = await download;
  // toasts only last ~3 s — check it before reading the file
  await expect(page.getByText(/^PDF downloaded/)).toBeVisible();
  await expect(dialog).toBeHidden();
  return { name: file.suggestedFilename(), pdf: await readFile((await file.path())!) };
}

/** RGB of the first pixel of the first image in the PDF (the diagram's background) */
function firstImagePixel(pdf: Buffer): [number, number, number] {
  const text = pdf.toString('latin1');
  const m = /\/Subtype \/Image \/Width (\d+) \/Height (\d+).*?\/Length (\d+)>>\nstream\n/.exec(text)!;
  const start = m.index + m[0].length;
  const rgb = inflateSync(pdf.subarray(start, start + Number(m[3])));
  expect(rgb.length).toBe(Number(m[1]) * Number(m[2]) * 3);
  return [rgb[0], rgb[1], rgb[2]];
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
    expect(text).toMatch(/\/Subtype \/Image \/Width \d{3,} \/Height \d{3,}/);
    expect(text).toContain('/Type /Outlines');
  });

  test('captures the diagram in the light theme even when the app is dark', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cb-theme', 'dark'));
    await openSeedProject(page, { monaco: false });
    await expect(page.locator('html')).toHaveClass(/dark/);
    const { pdf } = await exportPdf(page);
    // light --canvas-bg (#eef4fb), not the dark one (#0a1428)
    expect(firstImagePixel(pdf)).toEqual([0xee, 0xf4, 0xfb]);
    // the canvas is back to dark afterwards
    await expect(page.locator('.react-flow__viewport')).not.toHaveClass(/bp-force-light/);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).not.toHaveClass(/bp-exporting/);
  });

  test('remembers which sections to include', async ({ page }) => {
    await openSeedProject(page, { monaco: false });
    await exportPdf(page, async (dialog) => {
      await dialog.getByRole('switch', { name: 'Security review' }).uncheck();
      await dialog.getByRole('radio', { name: 'Letter' }).click();
    });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: /PDF document/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Export PDF document' });
    await expect(dialog.getByRole('switch', { name: 'Security review' })).not.toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Letter' })).toHaveAttribute('aria-checked', 'true');
  });
});
