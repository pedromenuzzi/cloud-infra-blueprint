/**
 * A small PDF 1.4 writer: pages of text, vector shapes, RGB images, links and
 * bookmarks. Coordinates are in points with the origin at the TOP-left of the
 * page (y grows down) and are flipped when written. Text uses the standard
 * Helvetica / Courier fonts, so nothing is embedded; see metrics.ts.
 *
 *   const doc = new PdfDocument({ title: 'My infra' });
 *   const page = doc.addPage(595.28, 841.89);
 *   page.text('Hello', 40, 60, { font: 'bold', size: 18 });
 *   downloadBytes(doc.save(), 'hello.pdf', 'application/pdf');
 */
import { zlibSync } from 'fflate';
import { encodeWinAnsi, textWidth, type PdfFont } from './metrics';

/** '#rrggbb' */
export type PdfColor = string;

export interface ShapeStyle {
  fill?: PdfColor;
  stroke?: PdfColor;
  lineWidth?: number;
  dash?: number[];
  /** corner radius (rect only) */
  radius?: number;
}

export interface TextStyle {
  font?: PdfFont;
  size?: number;
  color?: PdfColor;
  /** `x` is the left edge, the right edge or the center of the text */
  align?: 'left' | 'right' | 'center';
}

export interface PdfImage {
  readonly id: number;
  readonly width: number;
  readonly height: number;
}

export const PAPER = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

const FONTS: Record<PdfFont, { res: string; base: string }> = {
  regular: { res: 'F1', base: 'Helvetica' },
  bold: { res: 'F2', base: 'Helvetica-Bold' },
  mono: { res: 'F3', base: 'Courier' },
};

/** bezier handle length for quarter circles */
const KAPPA = 0.5523;

function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function rgb(hex: PdfColor): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '0 0 0';
  return m
    .slice(1)
    .map((h) => String(Math.round((parseInt(h, 16) / 255) * 1000) / 1000))
    .join(' ');
}

/** mix `hex` with white; amount 0 = unchanged, 1 = white */
export function tint(hex: PdfColor, amount: number): PdfColor {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `#${m
    .slice(1)
    .map((h) => {
      const c = parseInt(h, 16);
      return Math.round(c + (255 - c) * amount)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/** PDF text string that keeps full Unicode (UTF-16BE with BOM) — for metadata and bookmarks */
function textString(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}

function asciiString(s: string): string {
  const safe = s.replace(/[^\x20-\x7e]/g, (c) => encodeURIComponent(c));
  return `(${safe.replace(/[\\()]/g, '\\$&')})`;
}

function pdfDate(d: Date): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

interface PageLink {
  x: number;
  y: number;
  w: number;
  h: number;
  url?: string;
  dest?: { page: PdfPage; y: number };
}

export class PdfPage {
  /** @internal content stream operators */
  readonly ops: string[] = [];
  /** @internal */
  readonly links: PageLink[] = [];
  /** @internal image ids drawn on this page */
  readonly images = new Set<number>();

  constructor(
    readonly width: number,
    readonly height: number,
    /** 0-based position in the document */
    readonly index: number,
  ) {}

  private y(v: number): number {
    return this.height - v;
  }

  /** draw text with its baseline at `y` */
  text(text: string, x: number, y: number, style: TextStyle = {}): void {
    const { font = 'regular', size = 10, color = '#000000', align = 'left' } = style;
    const codes = encodeWinAnsi(text);
    if (codes.length === 0) return;
    let left = x;
    if (align !== 'left') {
      const w = textWidth(text, font, size);
      left = align === 'right' ? x - w : x - w / 2;
    }
    const hex = codes.map((c) => c.toString(16).padStart(2, '0')).join('');
    this.ops.push(
      `BT /${FONTS[font].res} ${num(size)} Tf ${rgb(color)} rg ${num(left)} ${num(this.y(y))} Td <${hex}> Tj ET`,
    );
  }

  rect(x: number, y: number, w: number, h: number, style: ShapeStyle): void {
    const r = Math.min(style.radius ?? 0, w / 2, h / 2);
    if (r <= 0) {
      this.paint(`${num(x)} ${num(this.y(y + h))} ${num(w)} ${num(h)} re`, style);
      return;
    }
    const k = r * KAPPA;
    const b = this.y(y + h);
    const t = this.y(y);
    const R = x + w;
    const P = (px: number, py: number) => `${num(px)} ${num(py)}`;
    this.paint(
      [
        `${P(x + r, b)} m`,
        `${P(R - r, b)} l`,
        `${P(R - r + k, b)} ${P(R, b + r - k)} ${P(R, b + r)} c`,
        `${P(R, t - r)} l`,
        `${P(R, t - r + k)} ${P(R - r + k, t)} ${P(R - r, t)} c`,
        `${P(x + r, t)} l`,
        `${P(x + r - k, t)} ${P(x, t - r + k)} ${P(x, t - r)} c`,
        `${P(x, b + r)} l`,
        `${P(x, b + r - k)} ${P(x + r - k, b)} ${P(x + r, b)} c`,
        'h',
      ].join(' '),
      style,
    );
  }

  circle(cx: number, cy: number, r: number, style: ShapeStyle): void {
    const k = r * KAPPA;
    const y = this.y(cy);
    const P = (px: number, py: number) => `${num(px)} ${num(py)}`;
    this.paint(
      [
        `${P(cx + r, y)} m`,
        `${P(cx + r, y + k)} ${P(cx + k, y + r)} ${P(cx, y + r)} c`,
        `${P(cx - k, y + r)} ${P(cx - r, y + k)} ${P(cx - r, y)} c`,
        `${P(cx - r, y - k)} ${P(cx - k, y - r)} ${P(cx, y - r)} c`,
        `${P(cx + k, y - r)} ${P(cx + r, y - k)} ${P(cx + r, y)} c`,
        'h',
      ].join(' '),
      style,
    );
  }

  /** closed shape through `points` */
  polygon(points: Array<[number, number]>, style: ShapeStyle): void {
    if (points.length < 2) return;
    const path = points.map(([px, py], i) => `${num(px)} ${num(this.y(py))} ${i === 0 ? 'm' : 'l'}`);
    this.paint(`${path.join(' ')} h`, style);
  }

  line(x1: number, y1: number, x2: number, y2: number, style: { color: PdfColor; width?: number; dash?: number[] }): void {
    this.paint(`${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l`, {
      stroke: style.color,
      lineWidth: style.width,
      dash: style.dash,
    });
  }

  image(img: PdfImage, x: number, y: number, w: number, h: number): void {
    this.images.add(img.id);
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.y(y + h))} cm /Im${img.id} Do Q`);
  }

  /** clickable area that opens `url` */
  link(x: number, y: number, w: number, h: number, url: string): void {
    this.links.push({ x, y, w, h, url });
  }

  /** clickable area that jumps to `y` on another page */
  linkTo(x: number, y: number, w: number, h: number, page: PdfPage, top = 0): void {
    this.links.push({ x, y, w, h, dest: { page, y: top } });
  }

  private paint(path: string, style: ShapeStyle): void {
    const parts = ['q'];
    if (style.stroke) parts.push(`${num(style.lineWidth ?? 1)} w ${rgb(style.stroke)} RG`);
    if (style.dash?.length) parts.push(`[${style.dash.map(num).join(' ')}] 0 d`);
    if (style.fill) parts.push(`${rgb(style.fill)} rg`);
    parts.push(path, style.fill && style.stroke ? 'B' : style.fill ? 'f' : 'S', 'Q');
    this.ops.push(parts.join(' '));
  }
}

class ByteSink {
  private chunks: Uint8Array[] = [];
  length = 0;

  str(s: string): void {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    this.bytes(bytes);
  }

  bytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

export interface PdfInfo {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  created?: Date;
}

export class PdfDocument {
  private readonly pageList: PdfPage[] = [];
  private readonly imageData: Array<PdfImage & { data: Uint8Array }> = [];
  private readonly bookmarks: Array<{ title: string; page: PdfPage; y: number }> = [];

  constructor(
    private readonly info: PdfInfo = {},
    /** deflate content streams (off in tests, so the operators stay readable) */
    private readonly compress = true,
  ) {}

  get pages(): readonly PdfPage[] {
    return this.pageList;
  }

  get pageCount(): number {
    return this.pageList.length;
  }

  addPage(width: number, height: number): PdfPage {
    const page = new PdfPage(width, height, this.pageList.length);
    this.pageList.push(page);
    return page;
  }

  /** register an image: 8-bit RGB pixels (width × height × 3 bytes), zlib-compressed */
  addImage(width: number, height: number, zlibRgb: Uint8Array): PdfImage {
    const img = { id: this.imageData.length + 1, width, height, data: zlibRgb };
    this.imageData.push(img);
    return img;
  }

  /** a bookmark in the viewer's outline, pointing at `y` on `page` */
  bookmark(title: string, page: PdfPage, y = 0): void {
    this.bookmarks.push({ title, page, y });
  }

  save(): Uint8Array {
    const out = new ByteSink();
    const offsets: number[] = [];
    let next = 1;
    const alloc = () => next++;

    const CATALOG = alloc();
    const PAGES = alloc();
    const fontObj = { regular: alloc(), bold: alloc(), mono: alloc() };
    const INFO = alloc();
    const imageObj = new Map(this.imageData.map((img) => [img.id, alloc()] as const));
    const pageObj = this.pageList.map(() => alloc());
    const contentObj = this.pageList.map(() => alloc());

    const write = (id: number, body: string) => {
      offsets[id] = out.length;
      out.str(`${id} 0 obj\n${body}\nendobj\n`);
    };
    const writeStream = (id: number, dict: string, data: Uint8Array) => {
      offsets[id] = out.length;
      out.str(`${id} 0 obj\n<<${dict} /Length ${data.length}>>\nstream\n`);
      out.bytes(data);
      out.str('\nendstream\nendobj\n');
    };
    const dest = (page: PdfPage, y: number) => `[${pageObj[page.index]} 0 R /XYZ 0 ${num(page.height - y)} null]`;

    out.str('%PDF-1.4\n');
    out.bytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

    for (const [font, id] of Object.entries(fontObj) as Array<[PdfFont, number]>) {
      write(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[font].base} /Encoding /WinAnsiEncoding >>`);
    }

    const { title, author, subject, creator, created = new Date() } = this.info;
    write(
      INFO,
      `<< /Producer ${textString('Cloud Blueprint')} /CreationDate ${pdfDate(created)}${title ? ` /Title ${textString(title)}` : ''}${
        author ? ` /Author ${textString(author)}` : ''
      }${subject ? ` /Subject ${textString(subject)}` : ''}${creator ? ` /Creator ${textString(creator)}` : ''} >>`,
    );

    for (const img of this.imageData) {
      writeStream(
        imageObj.get(img.id)!,
        ` /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
        img.data,
      );
    }

    const fontRes = Object.entries(fontObj)
      .map(([font, id]) => `/${FONTS[font as PdfFont].res} ${id} 0 R`)
      .join(' ');
    this.pageList.forEach((page, i) => {
      const annots = page.links.map((l) => {
        const id = alloc();
        const x2 = l.x + l.w;
        const rect = `[${num(l.x)} ${num(page.height - l.y - l.h)} ${num(x2)} ${num(page.height - l.y)}]`;
        const target = l.url ? `/A << /S /URI /URI ${asciiString(l.url)} >>` : `/Dest ${dest(l.dest!.page, l.dest!.y)}`;
        write(id, `<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] ${target} >>`);
        return id;
      });
      const xobjects = [...page.images].map((imgId) => `/Im${imgId} ${imageObj.get(imgId)} 0 R`).join(' ');
      write(
        pageObj[i],
        `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << ${fontRes} >>${
          xobjects ? ` /XObject << ${xobjects} >>` : ''
        } /ProcSet [/PDF /Text /ImageC] >> /Contents ${contentObj[i]} 0 R${
          annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''
        } >>`,
      );
      const content = new ByteSink();
      content.str(page.ops.join('\n'));
      const raw = content.concat();
      if (this.compress) writeStream(contentObj[i], ' /Filter /FlateDecode', zlibSync(raw, { level: 6 }));
      else writeStream(contentObj[i], '', raw);
    });

    write(PAGES, `<< /Type /Pages /Kids [${pageObj.map((id) => `${id} 0 R`).join(' ')}] /Count ${this.pageList.length} >>`);

    let outlines = '';
    if (this.bookmarks.length > 0) {
      const root = alloc();
      const items = this.bookmarks.map(() => alloc());
      this.bookmarks.forEach((b, i) => {
        const links = [
          i > 0 ? ` /Prev ${items[i - 1]} 0 R` : '',
          i < items.length - 1 ? ` /Next ${items[i + 1]} 0 R` : '',
        ].join('');
        write(items[i], `<< /Title ${textString(b.title)} /Parent ${root} 0 R${links} /Dest ${dest(b.page, b.y)} >>`);
      });
      write(root, `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`);
      outlines = ` /Outlines ${root} 0 R`;
    }
    write(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R${outlines} /ViewerPreferences << /DisplayDocTitle true >> >>`);

    const xref = out.length;
    out.str(`xref\n0 ${next}\n0000000000 65535 f \n`);
    for (let id = 1; id < next; id++) out.str(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    out.str(`trailer\n<< /Size ${next} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return out.concat();
  }
}
