/**
 * Capture the whole diagram for the PDF: always in the light theme (it goes on
 * a white page and may be printed), sharp enough for paper, and within the
 * canvas size limits of every browser.
 */
import type { Rect } from '@xyflow/react';
import { zlib, zlibSync } from 'fflate';
import type { DiagramImage } from './archDoc';

const PAD = 48;
/** long side we aim for: ~300 dpi across an A4 landscape page */
const TARGET_LONG_SIDE = 3300;
/** Safari refuses canvases above ~16.7 M pixels */
const MAX_PIXELS = 16_000_000;

export function pickPixelRatio(width: number, height: number): number {
  let ratio = Math.min(3, Math.max(1, TARGET_LONG_SIDE / Math.max(width, height)));
  if (width * height * ratio * ratio > MAX_PIXELS) ratio = Math.sqrt(MAX_PIXELS / (width * height));
  return ratio;
}

function deflate(data: Uint8Array): Promise<Uint8Array> {
  // off the main thread when workers are available
  return new Promise((resolve) => {
    try {
      zlib(data, { level: 6 }, (err, out) => resolve(err ? zlibSync(data, { level: 6 }) : out));
    } catch {
      resolve(zlibSync(data, { level: 6 }));
    }
  });
}

/** hide the canvas while it is briefly re-themed for the capture */
function coverCanvas(flow: HTMLElement): () => void {
  if (!document.documentElement.classList.contains('dark')) return () => {};
  const r = flow.getBoundingClientRect();
  const cover = document.createElement('div');
  cover.setAttribute('aria-hidden', 'true');
  Object.assign(cover.style, {
    position: 'fixed',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    zIndex: '45',
    background: getComputedStyle(flow).getPropertyValue('--canvas-bg') || '#0a1428',
  });
  document.body.appendChild(cover);
  return () => cover.remove();
}

/** `bounds`: the diagram's extent in canvas coordinates (every node, children included) */
export async function captureDiagram(bounds: Rect, lens: boolean): Promise<DiagramImage> {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  const flow = viewport?.closest<HTMLElement>('.react-flow');
  if (!viewport || !flow) throw new Error('canvas not mounted');
  const { toCanvas } = await import('html-to-image');

  const width = Math.ceil(bounds.width + PAD * 2);
  const height = Math.ceil(bounds.height + PAD * 2);
  const pixelRatio = pickPixelRatio(width, height);

  const uncover = coverCanvas(flow);
  viewport.classList.add('bp-force-light');
  document.documentElement.classList.add('bp-exporting');
  let canvas: HTMLCanvasElement;
  let background: string;
  try {
    const token = getComputedStyle(viewport).getPropertyValue('--canvas-bg').trim();
    background = /^#[0-9a-f]{6}$/i.test(token) ? token : '#eef4fb';
    canvas = await toCanvas(viewport, {
      backgroundColor: background,
      width,
      height,
      pixelRatio,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${PAD - bounds.x}px, ${PAD - bounds.y}px) scale(1)`,
      },
    });
  } finally {
    viewport.classList.remove('bp-force-light');
    document.documentElement.classList.remove('bp-exporting');
    uncover();
  }

  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) throw new Error('the browser could not render the diagram');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return {
    width: canvas.width,
    height: canvas.height,
    scale: canvas.width / width,
    data: await deflate(rgb),
    background,
    lens,
  };
}
