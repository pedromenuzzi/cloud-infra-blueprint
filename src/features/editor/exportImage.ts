import type { Rect } from '@xyflow/react';
import { slugify } from '@/lib/utils';

const PAD = 48;

/**
 * Render the whole diagram (not just the visible viewport) to PNG or SVG.
 * html-to-image is loaded on demand — it's only needed when exporting.
 */
export async function exportDiagramImage(
  bounds: Rect,
  format: 'png' | 'svg',
  projectName: string,
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport) throw new Error('canvas not mounted');
  const { toPng, toSvg } = await import('html-to-image');

  const width = Math.ceil(bounds.width + PAD * 2);
  const height = Math.ceil(bounds.height + PAD * 2);
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue('--canvas-bg')
    .trim();
  const options = {
    backgroundColor: background || '#ffffff',
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${PAD - bounds.x}px, ${PAD - bounds.y}px) scale(1)`,
    },
  };
  // hide hover-only chrome (handles) that html-to-image would copy from computed styles
  document.documentElement.classList.add('bp-exporting');
  let dataUrl: string;
  try {
    dataUrl = format === 'png' ? await toPng(viewport, options) : await toSvg(viewport, options);
  } finally {
    document.documentElement.classList.remove('bp-exporting');
  }

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${slugify(projectName) || 'blueprint'}-diagram.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
