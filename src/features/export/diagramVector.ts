/**
 * The diagram as vectors for the PDF: node cards, containers, icons, edges and
 * the security lens, drawn from the live React Flow geometry (see
 * captureDiagram.ts) in the light theme. Text stays sharp and searchable, a
 * diagram of any size is drawn in milliseconds, and the same drawing can be
 * cut into page-sized tiles.
 */
import type { NodeSecurity } from '@/features/editor/nodes';
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import type { Provider } from '@/ir/types';
import { fitText, textWidth } from '@/lib/pdf/metrics';
import type { PathSeg } from '@/lib/pdf/svgPath';
import { pathEnd, pointOnPath } from '@/lib/pdf/svgPath';
import type { PdfColor, PdfPage, PathTransform } from '@/lib/pdf/writer';
import { CATEGORY_COLORS, PROVIDER_COLORS, PROVIDER_LABELS } from '@/resources/icons';
import { DATA_TILE } from '@/features/data-sources/tile';
import type { Category } from '@/resources/types';
import { portText } from '@/security/model';
import { docMessages } from './archDoc.messages';

export interface DiagramPalette {
  canvas: PdfColor;
  node: PdfColor;
  nodeBorder: PdfColor;
  text: PdfColor;
  muted: PdfColor;
  border: PdfColor;
  edgeRef: PdfColor;
  edgeSecurity: PdfColor;
}

/** the light theme (global.css `:root`) — used when the tokens can't be read */
export const LIGHT_PALETTE: DiagramPalette = {
  canvas: '#eef4fb',
  node: '#ffffff',
  nodeBorder: '#d5deea',
  text: '#0f172a',
  muted: '#475569',
  border: '#e2e8f0',
  edgeRef: '#3b82f6',
  edgeSecurity: '#f59e0b',
};

/** an icon glyph in its 24 × 24 box */
export interface DiagramGlyph {
  strokeWidth: number;
  parts: Array<{ path: PathSeg[]; fill: boolean; stroke: boolean }>;
}

export interface DiagramNode {
  id: string;
  kind: 'resource' | 'container' | 'internet';
  /** absolute position and size, in canvas units */
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle?: string;
  typeLabel?: string;
  category: Category;
  provider: Provider;
  /** key into DiagramVector.glyphs */
  glyph?: string;
  warn?: boolean;
  security?: NodeSecurity;
  /** `count` / `for_each` badge ("×3"), and whether the other instances are drawn stacked behind, like the canvas */
  repeat?: string;
  repeatStack?: boolean;
  /** a data source: drawn lighter, dashed, on its cyan tile (it is read, never created) */
  lookup?: boolean;
}

export interface DiagramEdge {
  id: string;
  /** reference, security-group link, or allowed traffic (security lens) */
  kind: 'ref' | 'security' | 'traffic';
  /** in canvas units */
  path: PathSeg[];
  /** traffic tone */
  color?: PdfColor;
  /** traffic ports, e.g. ":80 :443" */
  label?: string;
  /** the security lens pushes references into the background */
  dimmed?: boolean;
}

export interface DiagramVector {
  /** extent of every node, in canvas units */
  bounds: { x: number; y: number; width: number; height: number };
  /** parents before children, the order the canvas paints them */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  glyphs: Record<string, DiagramGlyph>;
  palette: DiagramPalette;
  /** the security lens was on */
  lens: boolean;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RISK_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' } as const;
const WARNING = '#f59e0b';
const INTERNET_BLUE = '#0ea5e9';
/** node text block: type row (16) + gap (1) + title (16.25) + subtitle (15.1) */
const TEXT_BLOCK_H = 48.35;

const intersects = (a: Region, b: Region) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** the security chip under a node — same rules as the canvas (nodes.tsx SecurityChip), in the document's language */
function securityChip(security: NodeSecurity, locale: Locale): { tone: PdfColor; label: string } | undefined {
  const t = messagesFor(docMessages, locale);
  const risky = security.risk === 'critical' || security.risk === 'high';
  if (security.rules !== undefined) return { tone: security.risk ? RISK_COLOR[security.risk] : '#64748b', label: security.rules };
  if (security.exposure?.level === 'internet') {
    const ports = security.exposure.ports.map((p) => (/^\d/.test(p) ? p : portText(p, locale)));
    return {
      tone: risky ? RISK_COLOR[security.risk!] : INTERNET_BLUE,
      label: t.chipPublic(`:${ports.slice(0, 3).join(', :')}${ports.length > 3 ? '…' : ''}`),
    };
  }
  if (security.exposure?.level === 'restricted') return { tone: '#10b981', label: t.chipPrivate };
  if (security.exposure?.level === 'isolated') return { tone: '#64748b', label: t.chipNoInbound };
  if (security.risk) return { tone: RISK_COLOR[security.risk], label: security.risk === 'low' ? t.chipReview : t.chipAtRisk };
  return undefined;
}

class Painter {
  readonly s: number;
  constructor(
    readonly page: PdfPage,
    readonly d: DiagramVector,
    readonly t: PathTransform,
    readonly locale: Locale,
  ) {
    this.s = t.scale;
  }

  X(v: number) {
    return this.t.dx + v * this.s;
  }
  Y(v: number) {
    return this.t.dy + v * this.s;
  }
  S(v: number) {
    return v * this.s;
  }

  /** text at canvas coordinates, cut to `max` canvas units */
  text(
    text: string,
    x: number,
    y: number,
    size: number,
    color: PdfColor,
    opts: { font?: 'regular' | 'bold' | 'mono'; max?: number; align?: 'left' | 'right' | 'center' } = {},
  ) {
    const font = opts.font ?? 'regular';
    const value = opts.max !== undefined ? fitText(text, opts.max, font, size) : text;
    if (!value || value === '…') return;
    this.page.text(value, this.X(x), this.Y(y), { font, size: this.S(size), color, align: opts.align });
  }

  pill(x: number, y: number, w: number, h: number, fill: PdfColor, fillOpacity: number, ring?: { color: PdfColor; opacity: number }) {
    this.page.rect(this.X(x), this.Y(y), this.S(w), this.S(h), { fill, opacity: fillOpacity, radius: this.S(h / 2) });
    if (ring) {
      this.page.rect(this.X(x + 0.5), this.Y(y + 0.5), this.S(w - 1), this.S(h - 1), {
        stroke: ring.color,
        opacity: ring.opacity,
        lineWidth: this.S(1),
        radius: this.S((h - 1) / 2),
      });
    }
  }

  /** the category-colored gradient tile with the service glyph (icons.tsx ResourceIcon) */
  icon(node: DiagramNode, x: number, y: number, size: number, from: PdfColor, to: PdfColor, radius: number) {
    this.page.gradientRect(this.X(x), this.Y(y), this.S(size), this.S(size), { from, to, angle: 145 }, this.S(radius));
    const glyph = node.glyph ? this.d.glyphs[node.glyph] : undefined;
    if (!glyph) return;
    const box = size * 0.58;
    const k = box / 24;
    const t: PathTransform = { dx: this.X(x + (size - box) / 2), dy: this.Y(y + (size - box) / 2), scale: this.S(k) };
    for (const part of glyph.parts) {
      this.page.path(
        part.path,
        {
          fill: part.fill ? '#ffffff' : undefined,
          stroke: part.stroke ? '#ffffff' : undefined,
          lineWidth: this.S(glyph.strokeWidth * k),
          lineCap: 'round',
          lineJoin: 'round',
        },
        t,
      );
    }
  }

  providerChip(provider: Provider, right: number, top: number): number {
    if (provider === 'other') return 0;
    const color = PROVIDER_COLORS[provider];
    const label = PROVIDER_LABELS[provider].toUpperCase();
    const w = textWidth(label, 'bold', 9) + 8;
    const x = right - w;
    this.page.rect(this.X(x), this.Y(top), this.S(w), this.S(16), { fill: color, opacity: 0.13, radius: this.S(4) });
    this.page.rect(this.X(x + 0.5), this.Y(top + 0.5), this.S(w - 1), this.S(15), {
      stroke: color,
      opacity: 0.3,
      lineWidth: this.S(1),
      radius: this.S(3.5),
    });
    this.text(label, x + 4, top + 11.2, 9, color, { font: 'bold' });
    return w;
  }

  shadow(x: number, y: number, w: number, h: number, radius: number, strength = 1) {
    // a soft drop shadow, approximated by two offset layers
    this.page.rect(this.X(x - 0.5), this.Y(y + 1.5), this.S(w + 1), this.S(h), { fill: '#0f172a', opacity: 0.045 * strength, radius: this.S(radius + 0.5) });
    this.page.rect(this.X(x), this.Y(y + 0.8), this.S(w), this.S(h), { fill: '#0f172a', opacity: 0.06 * strength, radius: this.S(radius) });
  }

  resource(n: DiagramNode) {
    const { palette } = this.d;
    const cat = CATEGORY_COLORS[n.category] ?? CATEGORY_COLORS.compute;
    const sec = n.security;
    const dim = sec?.dim;
    if (dim) {
      this.page.save();
      this.page.setOpacity(0.38);
    }
    if (n.repeat && n.repeatStack) {
      // the other instances, stacked behind (RepeatStack on the canvas)
      for (const [offset, opacity] of [[10, 0.55], [5, 0.85]] as const) {
        this.page.rect(this.X(n.x + offset), this.Y(n.y + offset), this.S(n.w), this.S(n.h), {
          fill: palette.node,
          stroke: palette.nodeBorder,
          lineWidth: this.S(1),
          radius: this.S(12),
          opacity,
        });
      }
    }
    if (!n.lookup) this.shadow(n.x, n.y, n.w, n.h, 12);
    if (!dim && (sec?.risk === 'critical' || sec?.risk === 'high')) {
      this.page.rect(this.X(n.x - 1), this.Y(n.y - 1), this.S(n.w + 2), this.S(n.h + 2), {
        stroke: '#ef4444',
        opacity: 0.7,
        lineWidth: this.S(2),
        radius: this.S(13),
      });
    }
    if (n.lookup) {
      this.page.rect(this.X(n.x), this.Y(n.y), this.S(n.w), this.S(n.h), { fill: palette.node, radius: this.S(12) });
      this.page.rect(this.X(n.x + 0.75), this.Y(n.y + 0.75), this.S(n.w - 1.5), this.S(n.h - 1.5), {
        stroke: DATA_TILE.border,
        lineWidth: this.S(1.5),
        dash: [this.S(4), this.S(2.5)],
        radius: this.S(11.25),
      });
    } else {
      this.page.rect(this.X(n.x), this.Y(n.y), this.S(n.w), this.S(n.h), {
        fill: palette.node,
        stroke: palette.nodeBorder,
        lineWidth: this.S(1),
        radius: this.S(12),
      });
    }
    const tile = n.lookup ? DATA_TILE : cat;
    this.icon(n, n.x + 10, n.y + (n.h - 40) / 2, 40, dim ? tile.solid : tile.from, dim ? tile.solid : tile.to, 10);

    const tx = n.x + 60;
    const right = n.x + n.w - 10;
    const top = n.y + (n.h - TEXT_BLOCK_H) / 2;
    const chip = this.providerChip(n.provider, right, top);
    if (n.typeLabel) {
      this.text(n.typeLabel.toUpperCase(), tx, top + 11.3, 9.5, n.lookup ? DATA_TILE.text : cat.solid, { font: 'bold', max: right - tx - chip - 4 });
    }
    this.text(n.title, tx, top + 28.4, 13, palette.text, { font: 'bold', max: right - tx });
    if (n.subtitle) this.text(n.subtitle, tx, top + 43.6, 11, palette.muted, { max: right - tx });

    if (n.warn) {
      const cx = n.x + n.w - 3;
      const cy = n.y + 3;
      this.page.circle(this.X(cx), this.Y(cy), this.S(11), { fill: palette.node });
      this.page.circle(this.X(cx), this.Y(cy), this.S(9), { fill: WARNING });
      this.text('!', cx, cy + 3.6, 10, '#ffffff', { font: 'bold', align: 'center' });
    }
    if (sec) this.securityChip(sec, n.x + 10, n.y + n.h + 10);
    if (n.repeat) {
      const label = fitText(n.repeat, 140, 'mono', 10);
      const w = textWidth(label, 'mono', 10) + 12;
      this.pill(n.x + 12, n.y - 8, w, 16, palette.node, 1, { color: cat.solid, opacity: 0.45 });
      this.text(label, n.x + 18, n.y + 3.4, 10, cat.solid, { font: 'mono' });
    }
    if (dim) this.page.restore();
  }

  securityChip(security: NodeSecurity, left: number, bottom: number) {
    const chip = securityChip(security, this.locale);
    if (!chip) return;
    const label = chip.label.toUpperCase();
    const h = 17;
    const w = 6 + 10 + 4 + textWidth(label, 'bold', 9.5) + 6 + 2;
    const y = bottom - h;
    this.page.rect(this.X(left), this.Y(y), this.S(w), this.S(h), { fill: this.d.palette.node, radius: this.S(h / 2) });
    this.page.rect(this.X(left + 0.5), this.Y(y + 0.5), this.S(w - 1), this.S(h - 1), {
      stroke: chip.tone,
      opacity: 0.45,
      lineWidth: this.S(1),
      radius: this.S((h - 1) / 2),
    });
    this.page.circle(this.X(left + 12), this.Y(y + h / 2), this.S(3), { fill: chip.tone });
    this.text(label, left + 21, y + h / 2 + 3.3, 9.5, chip.tone, { font: 'bold' });
  }

  container(n: DiagramNode) {
    const { palette } = this.d;
    const cat = CATEGORY_COLORS[n.category] ?? CATEGORY_COLORS.network;
    const dim = n.security?.dim;
    if (dim) {
      this.page.save();
      this.page.setOpacity(0.38);
    }
    const r = this.S(16);
    this.page.rect(this.X(n.x), this.Y(n.y), this.S(n.w), this.S(n.h), { fill: cat.solid, opacity: 0.06, radius: r });
    this.page.rect(this.X(n.x + 0.75), this.Y(n.y + 0.75), this.S(n.w - 1.5), this.S(n.h - 1.5), {
      stroke: cat.solid,
      opacity: 0.45,
      lineWidth: this.S(1.5),
      dash: [this.S(4), this.S(2.5)],
      radius: this.S(15.25),
    });

    // header row: icon, title, type, subtitle … badges, provider
    const rowTop = n.y + 10;
    const mid = rowTop + 12;
    this.icon(n, n.x + 12, rowTop, 24, cat.from, cat.to, 6);
    const right = n.x + n.w - 12;
    let end = right - this.providerChip(n.provider, right, mid - 8);
    if (n.warn) {
      end -= 8 + 14;
      this.page.polygon(
        [
          [this.X(end + 7), this.Y(mid - 6)],
          [this.X(end + 14), this.Y(mid + 6)],
          [this.X(end), this.Y(mid + 6)],
        ],
        { fill: WARNING },
      );
    }
    const badge = (label: string, color: PdfColor, bg: PdfColor, bgOpacity: number) => {
      const w = textWidth(label, 'bold', 9.5) + 12 + 14;
      end -= w + 8;
      this.pill(end, mid - 8, w, 16, bg, bgOpacity);
      this.page.circle(this.X(end + 9), this.Y(mid), this.S(2.6), { fill: color });
      this.text(label, end + 16, mid + 3.3, 9.5, color, { font: 'bold' });
    };
    if (n.security?.nacls) badge('NACL', '#ef4444', '#ef4444', 0.1);
    if (n.repeat) badge(fitText(n.repeat, 120, 'bold', 9.5), cat.solid, cat.solid, 0.1);
    const words = messagesFor(docMessages, this.locale).subnetBadge;
    if (n.security?.subnet === 'public') badge(words.public.toUpperCase(), '#0284c7', '#0ea5e9', 0.14);
    if (n.security?.subnet === 'private') badge(words.private.toUpperCase(), '#059669', '#10b981', 0.14);

    let x = n.x + 44;
    const typeLabel = n.typeLabel?.toUpperCase() ?? '';
    const typeW = typeLabel ? textWidth(typeLabel, 'bold', 9.5) : 0;
    const room = end - 8 - x;
    const titleW = Math.min(textWidth(n.title, 'bold', 12.5), Math.max(24, room - (typeW ? typeW + 8 : 0)));
    this.text(n.title, x, mid + 4.4, 12.5, palette.text, { font: 'bold', max: titleW });
    x += titleW + 8;
    if (typeLabel && x + typeW <= end) {
      this.text(typeLabel, x, mid + 3.3, 9.5, cat.solid, { font: 'bold' });
      x += typeW + 8;
    }
    if (n.subtitle) {
      const text = fitText(n.subtitle, end - 8 - x - 12, 'mono', 10.5);
      if (text && text !== '…') {
        const w = textWidth(text, 'mono', 10.5) + 12;
        this.page.rect(this.X(x), this.Y(mid - 8), this.S(w), this.S(16), {
          fill: palette.node,
          opacity: 0.7,
          stroke: palette.border,
          lineWidth: this.S(1),
          radius: this.S(5),
        });
        this.text(text, x + 6, mid + 3.6, 10.5, palette.muted, { font: 'mono' });
      }
    }
    if (dim) this.page.restore();
  }

  internet(n: DiagramNode) {
    const { palette } = this.d;
    this.shadow(n.x, n.y, n.w, n.h, n.h / 2, 1.4);
    this.page.rect(this.X(n.x), this.Y(n.y), this.S(n.w), this.S(n.h), { fill: palette.node, radius: this.S(n.h / 2) });
    this.page.rect(this.X(n.x + 1), this.Y(n.y + 1), this.S(n.w - 2), this.S(n.h - 2), {
      stroke: INTERNET_BLUE,
      opacity: 0.55,
      lineWidth: this.S(2),
      dash: [this.S(5), this.S(3)],
      radius: this.S(n.h / 2 - 1),
    });
    const size = 44;
    const ix = n.x + 14;
    const iy = n.y + (n.h - size) / 2;
    this.page.gradientRect(this.X(ix), this.Y(iy), this.S(size), this.S(size), { from: '#38bdf8', to: '#2563eb', angle: 145 }, this.S(size / 2));
    // the globe: a 24 px glyph centered in the 44 px disc
    const glyph = n.glyph ? this.d.glyphs[n.glyph] : undefined;
    if (glyph) {
      const t: PathTransform = { dx: this.X(ix + 10), dy: this.Y(iy + 10), scale: this.s };
      for (const part of glyph.parts) {
        this.page.path(
          part.path,
          {
            fill: part.fill ? '#ffffff' : undefined,
            stroke: part.stroke ? '#ffffff' : undefined,
            lineWidth: this.S(glyph.strokeWidth),
            lineCap: 'round',
            lineJoin: 'round',
          },
          t,
        );
      }
    }
    this.text(n.title || 'Internet', n.x + 70, n.y + 33.2, 13.5, palette.text, { font: 'bold', max: n.w - 84 });
    this.text('0.0.0.0/0', n.x + 70, n.y + 49.2, 11, palette.muted, { font: 'mono' });
  }

  arrow(path: PathSeg[], color: PdfColor, strokeWidth: number, opacity?: number) {
    const end = pathEnd(path);
    if (!end) return;
    // React Flow's ArrowClosed marker: a 20-unit viewBox drawn 16 × stroke width wide
    const u = (16 * strokeWidth) / 20;
    const { dx, dy } = end;
    const P = (lx: number, ly: number): [number, number] => [
      this.X(end.x + (lx * dx - ly * dy) * u),
      this.Y(end.y + (lx * dy + ly * dx) * u),
    ];
    this.page.polygon([P(-5, -4), P(0, 0), P(-5, 4)], { fill: color, stroke: color, lineWidth: this.S(u), lineJoin: 'round', opacity });
  }

  edge(e: DiagramEdge) {
    const { palette } = this.d;
    if (e.kind === 'traffic') {
      const color = e.color ?? '#10b981';
      this.page.path(e.path, { stroke: color, lineWidth: this.S(2.25), dash: [this.S(7), this.S(5)] }, this.t);
      this.arrow(e.path, color, 2.25);
      return;
    }
    const color = e.kind === 'security' ? palette.edgeSecurity : palette.edgeRef;
    const opacity = e.dimmed ? 0.14 : 0.62;
    this.page.path(
      e.path,
      { stroke: color, lineWidth: this.S(1.5), dash: e.kind === 'security' ? [this.S(6), this.S(5)] : undefined, opacity },
      this.t,
    );
    this.arrow(e.path, color, 1.5, opacity);
  }

  trafficLabel(e: DiagramEdge) {
    if (!e.label) return;
    const mid = pointOnPath(e.path, 0.5);
    if (!mid) return;
    const color = e.color ?? '#10b981';
    const width = textWidth(e.label, 'mono', 10.5) + 16;
    const h = 18;
    const x = mid.x - width / 2;
    const y = mid.y - h / 2;
    this.page.rect(this.X(x), this.Y(y + 0.8), this.S(width), this.S(h), { fill: '#0f172a', opacity: 0.06, radius: this.S(h / 2) });
    this.pill(x, y, width, h, this.d.palette.node, 1, { color, opacity: 0.45 });
    this.text(e.label, mid.x, y + 12.6, 10.5, color, { font: 'mono', align: 'center' });
  }
}

/** a node's footprint including the chips and badges that stick out of it */
function footprint(n: DiagramNode): Region {
  return { x: n.x - 8, y: n.y - 8, w: n.w + 16, h: n.h + 22 };
}

function pathBox(path: PathSeg[]): Region | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const s of path) {
    if (s.op === 'Z') continue;
    add(s.x, s.y);
    if (s.op === 'C') {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    }
  }
  return Number.isFinite(minX) ? { x: minX - 12, y: minY - 12, w: maxX - minX + 24, h: maxY - minY + 24 } : undefined;
}

/**
 * Draw the part of the diagram inside `region` (canvas units) at `scale`,
 * with the region's top-left corner at page point (`x`, `y`). The caller clips.
 * Anything entirely outside the region is left out, so tiles stay small and
 * text search only finds what is visible.
 */
export function drawDiagram(
  page: PdfPage,
  d: DiagramVector,
  view: { x: number; y: number; scale: number; region: Region; locale?: Locale },
): void {
  const { region, scale } = view;
  const t: PathTransform = { dx: view.x - region.x * scale, dy: view.y - region.y * scale, scale };
  const p = new Painter(page, d, t, view.locale ?? currentLocale());

  const visible = (r: Region | undefined) => !!r && intersects(r, region);

  for (const n of d.nodes) if (n.kind === 'container' && visible(footprint(n))) p.container(n);
  for (const e of d.edges) if (e.kind !== 'traffic' && visible(pathBox(e.path))) p.edge(e);
  for (const n of d.nodes) {
    if (!visible(footprint(n))) continue;
    if (n.kind === 'resource') p.resource(n);
    else if (n.kind === 'internet') p.internet(n);
  }
  const traffic = d.edges.filter((e) => e.kind === 'traffic' && visible(pathBox(e.path)));
  for (const e of traffic) p.edge(e);
  for (const e of traffic) p.trafficLabel(e);
}
