/**
 * Architecture document: a shareable PDF of the design — the diagram, then a
 * readable summary for people who will never open the editor (inventory,
 * connections, allowed traffic, security review, optionally the source).
 *
 * Pure: IR + audit + a captured diagram in, PDF bytes out. The diagram is
 * captured from the live canvas by captureDiagram.ts.
 */
import { exprPreview, refTargetAddress } from '@/ir/expr';
import type { Expression, IR, IREdge, Provider, ResourceNode } from '@/ir/types';
import { providerOfSourceName } from '@/ir/types';
import { fitText, textWidth, wrapText, type PdfFont } from '@/lib/pdf/metrics';
import { PAPER, PdfDocument, tint, type PdfColor, type PdfPage } from '@/lib/pdf/writer';
import { CATEGORY_COLORS } from '@/resources/icons';
import { docsUrl, getDef } from '@/resources/registry';
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category } from '@/resources/types';
import { SEVERITY_ORDER, type AuditResult, type Severity } from '@/security/audit';

export type Paper = keyof typeof PAPER;

export interface DocSections {
  inventory: boolean;
  connections: boolean;
  security: boolean;
  code: boolean;
}

export interface DiagramImage {
  /** pixel size */
  width: number;
  height: number;
  /** pixels per canvas unit — caps how far a small diagram is blown up */
  scale: number;
  /** 8-bit RGB pixels, zlib-compressed */
  data: Uint8Array;
  /** canvas background color ('#rrggbb'), painted around the image */
  background: PdfColor;
  /** the security lens was on when the diagram was captured */
  lens: boolean;
}

export interface ArchDocInput {
  title: string;
  notes?: string;
  ir: IR;
  edges: IREdge[];
  /** .tf files in display order */
  files: Array<[name: string, text: string]>;
  audit: AuditResult;
  diagram: DiagramImage | null;
  sections: DocSections;
  paper: Paper;
  generatedAt: Date;
  /** deflate page content (tests turn it off to read the text back) */
  compress?: boolean;
}

// ------------------------------------------------------------------ style

const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#94a3b8';
const LINE = '#e2e8f0';
const SOFT = '#f1f5f9';
const PRIMARY = '#2563eb';
const EDGE_REF = '#3b82f6';
const EDGE_SECURITY = '#f59e0b';

const MARGIN = 40;
/** content stops this far above the bottom edge; the footer lives below */
const BOTTOM_SPACE = 52;
/** footer baseline, from the bottom edge */
const FOOTER_BASELINE = 24;

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', other: 'Other' };
const PROVIDER_COLOR: Record<Provider, PdfColor> = { aws: '#ff9900', azure: '#0078d4', gcp: '#4285f4', other: '#64748b' };
const SEVERITY_COLOR: Record<Severity, PdfColor> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' };
const GRADE_COLOR: Record<string, PdfColor> = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#f97316', F: '#ef4444' };
const TRAFFIC_COLOR = { internet: '#0ea5e9', internal: '#10b981', risky: '#ef4444' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDocDate(d: Date): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** baseline for text of `size` vertically centered in a line box starting at `top` */
const baseline = (top: number, size: number, lineHeight: number) => top + (lineHeight - size * 0.925) / 2 + size * 0.718;

// ------------------------------------------------------------------ secrets
//
// The document is meant to be forwarded, so no secret value may reach it —
// whatever the expression looks like (literal, interpolation, list, object).

const MASK = '••••••';
const SCRIPT_HIDDEN = '(script hidden)';

/** names (arguments, variables, outputs, object keys) whose values are secrets */
const SECRET_NAME =
  /pass(?:word|wd|phrase)?|pwd|secret|token|private_?key|api_?key|access_?key|account_?key|master_?key|signing_?key|auth_?key|shared_?key|license_?key|credential|connection_?string|keytab|plaintext/i;

/** boot scripts: routinely carry exported passwords and keys */
const SCRIPT_ARG = /^(?:user_data|user_data_base64|custom_data|metadata_startup_script|startup_script)$/;

/** secret-bearing arguments of specific resource types, whatever they are called */
const SECRET_TYPE_ARGS: Array<[type: RegExp, arg: RegExp]> = [
  [/^aws_ssm_parameter$/, /^(?:value|insecure_value)$/],
  [/^azurerm_key_vault_secret$/, /^value$/],
  [/_secret_version$/, /^secret_(?:data|string|binary)$/],
  [/^kubernetes_secret(?:_v1)?$/, /^(?:data|binary_data)$/],
];

/** `scheme://user:password@host` */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^\s:@/'"]+):([^\s@/'"]+)@/gi;
/** `DB_PASS=…`, `Password=…;`, `token: …` inside a value */
const INLINE_SECRET =
  /\b([\w.-]*(?:pass(?:word|wd)?|pwd|secret|token|api_?key|access_?key|private_?key|account_?key)[\w.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s;,&'"]+)/gi;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

function isSecretArg(type: string, key: string): boolean {
  return SECRET_NAME.test(key) || SECRET_TYPE_ARGS.some(([t, a]) => t.test(type) && a.test(key));
}

/** credentials embedded in URLs; `inline` also masks `KEY=value` pairs (off for prose) */
export function redactSecrets(text: string, inline = true): string {
  const out = text.replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => `${scheme}${user}:${MASK}@`);
  return inline ? out.replace(INLINE_SECRET, (_m, key: string, sep: string) => `${key}${sep}${MASK}`) : out;
}

/** exprPreview with the values of secret-named object keys masked */
function safePreview(e: Expression | undefined): string {
  if (!e) return '';
  switch (e.kind) {
    case 'list':
      return `[${e.items.map(safePreview).join(', ')}]`;
    case 'object': {
      const inner = Object.entries(e.fields)
        .map(([k, v]) => `${k} = ${SCRIPT_ARG.test(k) ? SCRIPT_HIDDEN : SECRET_NAME.test(k) ? MASK : safePreview(v)}`)
        .join(', ');
      return `{ ${inner} }`;
    }
    default:
      return exprPreview(e);
  }
}

// ------------------------------------------------------------------ facts

type CategoryKey = Category | 'other';

function categoryOf(r: ResourceNode): CategoryKey {
  return getDef(r.type)?.category ?? 'other';
}

function categoryLabel(c: CategoryKey): string {
  return c === 'other' ? 'Other' : CATEGORY_LABELS[c];
}

function categoryColor(c: CategoryKey): PdfColor {
  return c === 'other' ? '#64748b' : CATEGORY_COLORS[c].solid;
}

function serviceName(type: string): string {
  return getDef(type)?.displayName ?? type.replace(/^(aws|azurerm|google)_/, '').replace(/_/g, ' ');
}

function shortName(type: string): string {
  return getDef(type)?.shortName ?? serviceName(type);
}

/** literal value of an expression, following `var.x` to its default */
function resolveLiteral(e: Expression | undefined, ir: IR): string | undefined {
  if (!e) return undefined;
  if (e.kind === 'literal') return e.value === null ? undefined : String(e.value);
  if (e.kind === 'ref' && e.path.startsWith('var.')) {
    const v = ir.variables.find((d) => d.name === e.path.slice(4));
    const def = v?.args.default;
    if (def?.kind === 'literal' && def.value !== null) return String(def.value);
  }
  return undefined;
}

export function providerSummary(ir: IR): Array<{ provider: Provider; regions: string[]; count: number }> {
  const out = new Map<Provider, { provider: Provider; regions: string[]; count: number }>();
  const entry = (p: Provider) => {
    let e = out.get(p);
    if (!e) out.set(p, (e = { provider: p, regions: [], count: 0 }));
    return e;
  };
  const addRegion = (p: Provider, region: string | undefined) => {
    const e = entry(p);
    if (region && !e.regions.includes(region)) e.regions.push(region);
  };
  for (const r of ir.resources) entry(r.provider).count++;
  for (const block of ir.providers) addRegion(providerOfSourceName(block.name), resolveLiteral(block.args.region, ir));
  for (const r of ir.resources) {
    if (r.provider === 'azure') addRegion('azure', resolveLiteral(r.args.location, ir));
    if (r.provider === 'gcp') addRegion('gcp', resolveLiteral(r.args.region, ir));
  }
  return [...out.values()].filter((e) => e.count > 0);
}

function settingValue(e: Expression): string | undefined {
  switch (e.kind) {
    case 'literal':
      return e.value === null ? undefined : String(e.value);
    case 'ref':
      // references to other resources are listed as connections instead
      return refTargetAddress(e.path) ? undefined : e.path;
    case 'list': {
      const items = e.items.map(settingValue);
      if (items.length === 0 || items.some((i) => i === undefined)) return undefined;
      return items.length > 3 ? `${items.slice(0, 3).join(', ')} +${items.length - 3}` : items.join(', ');
    }
    case 'raw': {
      const flat = e.hcl.replace(/\s+/g, ' ').trim();
      return flat.length > 44 ? `${flat.slice(0, 43)}…` : flat;
    }
    case 'blocks':
      return plural(e.items.length, 'block');
    default:
      return undefined;
  }
}

/** the few arguments worth reading, schema order first, secrets masked */
export function keySettings(r: ResourceNode, max = 6): string[] {
  const order = [...(getDef(r.type)?.fields.map((f) => f.name) ?? []), ...Object.keys(r.args)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of order) {
    if (seen.has(key) || out.length >= max) continue;
    seen.add(key);
    const e = r.args[key];
    if (!e || key === 'tags' || key === 'tags_all') continue;
    const value = settingValue(e);
    if (value === undefined || value === '') continue;
    if (SCRIPT_ARG.test(key)) out.push(`${key}: ${SCRIPT_HIDDEN}`);
    // a true/false switch (manage_master_user_password = true) gives nothing away
    else if (isSecretArg(r.type, key) && !(e.kind === 'literal' && typeof e.value === 'boolean')) out.push(`${key}: ${MASK}`);
    else out.push(`${key}: ${redactSecrets(value)}`);
  }
  return out;
}

function placement(r: ResourceNode, byId: Map<string, ResourceNode>): string {
  const chain: string[] = [];
  let cur = r.parentId ? byId.get(r.parentId) : undefined;
  while (cur && chain.length < 6) {
    chain.unshift(`${cur.name} (${shortName(cur.type)})`);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain.join(' › ');
}

// ------------------------------------------------------------------ layout

interface Run {
  text: string;
  font?: PdfFont;
  size?: number;
  color?: PdfColor;
  /** make this run a link */
  url?: string;
}

interface Column {
  title: string;
  /** share of the text width */
  share: number;
}

interface Row {
  cells: Run[][];
  /** full-width group heading instead of cells */
  group?: { label: string; color: PdfColor; note?: string };
  /** colored mark at the start of the row */
  accent?: PdfColor;
}

const LEAD = 1.38;
const CELL_PAD_X = 6;
const CELL_PAD_Y = 5;
const MAX_CELL_LINES = 14;

class Cursor {
  page!: PdfPage;
  y = 0;
  readonly sectionPages = new Map<string, PdfPage>();

  constructor(
    readonly doc: PdfDocument,
    private readonly size: { width: number; height: number },
  ) {}

  get left() {
    return MARGIN;
  }
  get width() {
    return this.page.width - MARGIN * 2;
  }
  get bottom() {
    return this.page.height - BOTTOM_SPACE;
  }

  newPage(): void {
    this.page = this.doc.addPage(this.size.width, this.size.height);
    this.y = MARGIN;
  }

  /** start a new page unless `h` more points fit */
  ensure(h: number): boolean {
    if (this.y + h <= this.bottom) return false;
    this.newPage();
    return true;
  }

  paragraph(text: string, opts: { font?: PdfFont; size?: number; color?: PdfColor; width?: number; x?: number; gap?: number } = {}) {
    const { font = 'regular', size = 9, color = INK, width = this.width, x = this.left, gap = 6 } = opts;
    const lh = size * LEAD;
    for (const line of wrapText(text, width, font, size)) {
      this.ensure(lh);
      this.page.text(line, x, baseline(this.y, size, lh), { font, size, color });
      this.y += lh;
    }
    this.y += gap;
  }

  section(key: string, title: string, subtitle?: string): void {
    if (this.y > MARGIN) {
      this.y += 14;
      this.ensure(150);
    }
    this.sectionPages.set(key, this.page);
    this.doc.bookmark(title, this.page, this.y - 6);
    this.page.text(title, this.left, baseline(this.y, 16, 22), { font: 'bold', size: 16, color: INK });
    this.y += 22;
    if (subtitle) {
      this.page.text(fitText(subtitle, this.width, 'regular', 9), this.left, baseline(this.y, 9, 13), { size: 9, color: MUTED });
      this.y += 13;
    }
    this.y += 5;
    this.page.line(this.left, this.y, this.left + this.width, this.y, { color: LINE, width: 0.8 });
    this.y += 12;
  }

  heading(text: string, note?: string): void {
    this.ensure(64);
    this.page.text(text, this.left, baseline(this.y, 10.5, 15), { font: 'bold', size: 10.5, color: INK });
    if (note) {
      const w = textWidth(text, 'bold', 10.5);
      this.page.text(note, this.left + w + 6, baseline(this.y, 10.5, 15), { size: 8.5, color: FAINT });
    }
    this.y += 20;
  }

  table(columns: Column[], rows: Row[]): void {
    const widths = columns.map((c) => c.share * this.width);
    const lay = (cells: Run[][]) =>
      cells.map((runs, i) =>
        runs
          .flatMap((run) => {
            const font = run.font ?? 'regular';
            const size = run.size ?? 8.5;
            return wrapText(run.text, widths[i] - CELL_PAD_X * 2, font, size).map((text) => ({ ...run, text, font, size }));
          })
          .slice(0, MAX_CELL_LINES),
      );
    const heightOf = (lines: ReturnType<typeof lay>) =>
      Math.max(...lines.map((ls) => ls.reduce((h, l) => h + l.size * LEAD, 0))) + CELL_PAD_Y * 2;

    const header = () => {
      const h = 18;
      this.page.rect(this.left, this.y, this.width, h, { fill: SOFT, radius: 3 });
      let x = this.left;
      columns.forEach((c, i) => {
        this.page.text(c.title.toUpperCase(), x + CELL_PAD_X, baseline(this.y, 6.8, h), { font: 'bold', size: 6.8, color: MUTED });
        x += widths[i];
      });
      this.y += h;
    };

    this.ensure(18 + 40);
    header();
    rows.forEach((row, index) => {
      if (row.group) {
        const next = rows[index + 1];
        const nextH = next && !next.group ? heightOf(lay(next.cells)) : 0;
        if (this.ensure(22 + nextH)) header();
        this.y += 4;
        this.page.rect(this.left, this.y, this.width, 18, { fill: tint(row.group.color, 0.9), radius: 3 });
        this.page.circle(this.left + 10, this.y + 9, 3, { fill: row.group.color });
        this.page.text(row.group.label, this.left + 19, baseline(this.y, 8.5, 18), { font: 'bold', size: 8.5, color: INK });
        if (row.group.note) {
          const w = textWidth(row.group.label, 'bold', 8.5);
          this.page.text(row.group.note, this.left + 25 + w, baseline(this.y, 8, 18), { size: 8, color: MUTED });
        }
        this.y += 18;
        return;
      }
      const lines = lay(row.cells);
      const h = heightOf(lines);
      if (this.ensure(h)) header();
      if (row.accent) this.page.rect(this.left, this.y + 4, 2.2, h - 8, { fill: row.accent, radius: 1 });
      let x = this.left;
      lines.forEach((cell, i) => {
        let top = this.y + CELL_PAD_Y;
        for (const l of cell) {
          const lh = l.size * LEAD;
          this.page.text(l.text, x + CELL_PAD_X, baseline(top, l.size, lh), { font: l.font, size: l.size, color: l.color ?? INK });
          if (l.url) this.page.link(x + CELL_PAD_X, top, textWidth(l.text, l.font, l.size), lh, l.url);
          top += lh;
        }
        x += widths[i];
      });
      this.y += h;
      this.page.line(this.left, this.y, this.left + this.width, this.y, { color: LINE, width: 0.6 });
    });
    this.y += 10;
  }
}

/** the Cloud Blueprint mark: an isometric cube, drawn as three faces */
function logo(page: PdfPage, x: number, y: number, size: number) {
  const s = size / 32;
  const P = (px: number, py: number): [number, number] => [x + px * s, y + py * s];
  page.polygon([P(16, 3), P(28, 9.5), P(16, 16), P(4, 9.5)], { fill: '#3b82f6' });
  page.polygon([P(4, 9.5), P(16, 16), P(16, 29), P(4, 22.5)], { fill: '#2563eb' });
  page.polygon([P(28, 9.5), P(16, 16), P(16, 29), P(28, 22.5)], { fill: '#1d4ed8' });
}

function arrowHead(page: PdfPage, x: number, y: number, color: PdfColor) {
  page.polygon([[x, y], [x - 5, y - 2.8], [x - 5, y + 2.8]], { fill: color });
}

// ------------------------------------------------------------------ pages

const HEADER_H = 62;
/** legend row + footer below the diagram box */
const LEGEND_SPACE = 55;

function diagramPage(doc: PdfDocument, input: ArchDocInput, meta: string) {
  const paper = PAPER[input.paper];
  const portrait = { width: paper.width, height: paper.height };
  const landscape = { width: paper.height, height: paper.width };
  const boxOf = (s: { width: number; height: number }) => ({
    w: s.width - MARGIN * 2,
    h: s.height - MARGIN - HEADER_H - LEGEND_SPACE,
  });
  const img = input.diagram;
  const fitScale = (s: { width: number; height: number }) => {
    if (!img) return 0;
    const b = boxOf(s);
    return Math.min(b.w / img.width, b.h / img.height);
  };
  const size = img && fitScale(portrait) > fitScale(landscape) ? portrait : landscape;
  const page = doc.addPage(size.width, size.height);
  doc.bookmark('Diagram', page, 0);

  // header: title + facts on the left, the mark on the right
  const brand = 'Cloud Blueprint';
  const brandW = textWidth(brand, 'bold', 9) + 22;
  const top = MARGIN;
  page.text(fitText(input.title, size.width - MARGIN * 2 - brandW - 20, 'bold', 20), MARGIN, top + 18, {
    font: 'bold',
    size: 20,
    color: INK,
  });
  page.text(fitText(meta, size.width - MARGIN * 2 - brandW - 20, 'regular', 9), MARGIN, top + 36, { size: 9, color: MUTED });
  logo(page, size.width - MARGIN - brandW, top + 3, 16);
  page.text(brand, size.width - MARGIN, top + 15, { font: 'bold', size: 9, color: INK, align: 'right' });
  page.line(MARGIN, top + 48, size.width - MARGIN, top + 48, { color: LINE, width: 0.8 });

  const box = boxOf(size);
  const bx = MARGIN;
  const by = MARGIN + HEADER_H;
  page.rect(bx, by, box.w, box.h, { fill: img?.background ?? SOFT, stroke: '#d3e0f0', lineWidth: 0.8, radius: 8 });
  if (img) {
    const pdfImage = doc.addImage(img.width, img.height, img.data);
    // fill the box, but never blow a small diagram up past ~1.15× its on-screen size
    const pad = 10;
    const scale = Math.min((box.w - pad * 2) / img.width, (box.h - pad * 2) / img.height, 1.15 / img.scale);
    const w = img.width * scale;
    const h = img.height * scale;
    page.image(pdfImage, bx + (box.w - w) / 2, by + (box.h - h) / 2, w, h);
  } else {
    page.text('The diagram could not be rendered.', bx + box.w / 2, by + box.h / 2, { size: 10, color: MUTED, align: 'center' });
  }

  // legend
  const ly = by + box.h + 14;
  let lx = MARGIN;
  const item = (label: string, draw: (x: number) => void) => {
    draw(lx);
    page.text(label, lx + 28, ly + 2.6, { size: 7.5, color: MUTED });
    lx += 28 + textWidth(label, 'regular', 7.5) + 18;
  };
  item('Network boundary (VPC, subnet, group)', (x) =>
    page.rect(x, ly - 5, 22, 10, { stroke: '#a855f7', lineWidth: 0.9, dash: [2.5, 1.8], radius: 2.5 }),
  );
  item('Uses / depends on', (x) => {
    page.line(x, ly, x + 19, ly, { color: EDGE_REF, width: 1.2 });
    arrowHead(page, x + 22, ly, EDGE_REF);
  });
  item('Security group / firewall link', (x) => {
    page.line(x, ly, x + 19, ly, { color: EDGE_SECURITY, width: 1.2, dash: [3, 2.2] });
    arrowHead(page, x + 22, ly, EDGE_SECURITY);
  });
  if (img?.lens) {
    item('Allowed traffic (security lens)', (x) => {
      page.line(x, ly, x + 19, ly, { color: TRAFFIC_COLOR.internet, width: 1.6 });
      arrowHead(page, x + 22, ly, TRAFFIC_COLOR.internet);
    });
  }
}

interface TocEntry {
  key: string;
  title: string;
}

function overview(c: Cursor, input: ArchDocInput, toc: TocEntry[]): { page: PdfPage; rows: Array<{ entry: TocEntry; y: number }> } {
  const { ir, edges, audit } = input;
  c.newPage();
  c.section('overview', 'Overview', `Generated ${formatDocDate(input.generatedAt)} with Cloud Blueprint.`);

  const notes = input.notes?.trim();
  if (notes) {
    const size = 9.5;
    const lh = size * LEAD;
    const lines = wrapText(notes, c.width - 28, 'regular', size).slice(0, 40);
    const h = lines.length * lh + 34;
    c.page.rect(c.left, c.y, c.width, h, { fill: '#f8fafc', stroke: LINE, lineWidth: 0.6, radius: 5 });
    c.page.rect(c.left, c.y, 3, h, { fill: PRIMARY, radius: 1.5 });
    c.page.text('NOTES', c.left + 14, c.y + 16, { font: 'bold', size: 7, color: MUTED });
    let y = c.y + 22;
    for (const line of lines) {
      c.page.text(line, c.left + 14, baseline(y, size, lh), { size, color: INK });
      y += lh;
    }
    c.y += h + 16;
  }

  // stat tiles
  const containers = ir.resources.filter((r) => getDef(r.type)?.container).length;
  const tiles: Array<{ value: string; label: string; color?: PdfColor }> = [
    { value: String(ir.resources.length), label: 'Resources' },
    { value: String(edges.length), label: 'Connections' },
    { value: String(containers), label: 'Networks & groups' },
  ];
  if (input.sections.security && audit.grade) {
    tiles.push({ value: audit.grade, label: `Security score ${audit.score}`, color: GRADE_COLOR[audit.grade] });
  } else {
    tiles.push({ value: String(ir.variables.length), label: 'Variables' });
  }
  const gap = 10;
  const tw = (c.width - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = c.left + i * (tw + gap);
    c.page.rect(x, c.y, tw, 54, { stroke: LINE, lineWidth: 0.8, radius: 6 });
    c.page.text(t.value, x + 12, c.y + 27, { font: 'bold', size: 19, color: t.color ?? INK });
    c.page.text(fitText(t.label.toUpperCase(), tw - 24, 'bold', 6.8), x + 12, c.y + 43, { font: 'bold', size: 6.8, color: MUTED });
  });
  c.y += 54 + 22;

  // providers
  c.heading('Cloud providers');
  for (const p of providerSummary(ir)) {
    c.page.circle(c.left + 4, c.y + 6.5, 3.2, { fill: PROVIDER_COLOR[p.provider] });
    c.page.text(PROVIDER_LABEL[p.provider], c.left + 14, baseline(c.y, 9.5, 13), { font: 'bold', size: 9.5, color: INK });
    const detail = `${plural(p.count, 'resource')}${p.regions.length ? ` · ${p.regions.length > 1 ? 'regions' : 'region'} ${p.regions.join(', ')}` : ''}`;
    c.page.text(detail, c.left + 14 + textWidth(PROVIDER_LABEL[p.provider], 'bold', 9.5) + 8, baseline(c.y, 9, 13), {
      size: 9,
      color: MUTED,
    });
    c.y += 17;
  }
  c.y += 14;

  // resources per category, as bars
  c.heading('Resources by category');
  const counts = new Map<CategoryKey, number>();
  for (const r of ir.resources) counts.set(categoryOf(r), (counts.get(categoryOf(r)) ?? 0) + 1);
  const cats = ([...CATEGORY_ORDER, 'other'] as CategoryKey[]).filter((k) => counts.has(k));
  const most = Math.max(1, ...counts.values());
  const labelW = 120;
  const barW = c.width - labelW - 36;
  for (const k of cats) {
    const n = counts.get(k)!;
    c.page.text(categoryLabel(k), c.left, baseline(c.y, 9, 13), { size: 9, color: INK });
    c.page.rect(c.left + labelW, c.y + 3, barW, 7, { fill: SOFT, radius: 3.5 });
    c.page.rect(c.left + labelW, c.y + 3, Math.max(7, (barW * n) / most), 7, { fill: categoryColor(k), radius: 3.5 });
    c.page.text(String(n), c.left + c.width, baseline(c.y, 9, 13), { font: 'bold', size: 9, color: INK, align: 'right' });
    c.y += 17;
  }
  c.y += 14;

  // table of contents — page numbers are filled in once every section is laid out
  c.ensure(40 + toc.length * 17);
  c.heading('In this document');
  const page = c.page;
  const rows = toc.map((entry) => {
    const y = c.y;
    c.y += 17;
    return { entry, y };
  });
  return { page, rows };
}

function inventory(c: Cursor, input: ArchDocInput) {
  const { ir } = input;
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  c.section('inventory', 'Resource inventory', 'Every resource in the design, grouped by category, with the settings that matter most.');
  const groups = new Map<CategoryKey, ResourceNode[]>();
  for (const r of ir.resources) {
    const k = categoryOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows: Row[] = [];
  for (const k of [...CATEGORY_ORDER, 'other'] as CategoryKey[]) {
    const list = groups.get(k);
    if (!list) continue;
    rows.push({ cells: [], group: { label: categoryLabel(k), color: categoryColor(k), note: String(list.length) } });
    for (const r of list) {
      const settings = keySettings(r);
      rows.push({
        cells: [
          [
            { text: r.name, font: 'bold' },
            { text: r.type, font: 'mono', size: 6.6, color: FAINT, url: docsUrl(r.type) },
          ],
          [
            { text: serviceName(r.type) },
            { text: PROVIDER_LABEL[r.provider], size: 7, color: FAINT },
          ],
          settings.length ? settings.map((s) => ({ text: s, size: 7.5, color: INK })) : [{ text: '—', color: FAINT }],
          [{ text: placement(r, byId) || '—', size: 7.5, color: r.parentId ? MUTED : FAINT }],
        ],
      });
    }
  }
  c.table(
    [
      { title: 'Resource', share: 0.27 },
      { title: 'Service', share: 0.19 },
      { title: 'Configuration', share: 0.34 },
      { title: 'Placement', share: 0.2 },
    ],
    rows,
  );

  if (ir.variables.length || ir.outputs.length) {
    c.section('variables', 'Variables & outputs', 'Inputs someone deploying this must provide, and the values it exposes.');
    if (ir.variables.length) {
      c.heading('Variables', String(ir.variables.length));
      c.table(
        [
          { title: 'Name', share: 0.24 },
          { title: 'Type', share: 0.14 },
          { title: 'Default', share: 0.24 },
          { title: 'Description', share: 0.38 },
        ],
        ir.variables.map((v) => {
          const flagged = v.args.sensitive?.kind === 'literal' && v.args.sensitive.value === true;
          const hidden = flagged || isSecretName(v.name);
          const def = v.args.default;
          const description = literalText(v.args.description);
          return {
            cells: [
              [{ text: v.name, font: 'mono', size: 7.5 }],
              [{ text: v.args.type ? exprPreview(v.args.type) : 'any', size: 7.5, color: MUTED }],
              [
                def
                  ? {
                      text: hidden ? '(sensitive)' : redactSecrets(safePreview(def)),
                      size: 7.5,
                      font: hidden ? 'regular' : 'mono',
                      color: hidden ? FAINT : INK,
                    }
                  : { text: 'required', size: 7.5, font: 'bold', color: '#b45309' },
              ],
              [{ text: description ? redactSecrets(description, false) : '—', size: 7.5, color: description ? INK : FAINT }],
            ],
          } satisfies Row;
        }),
      );
    }
    if (ir.outputs.length) {
      c.heading('Outputs', String(ir.outputs.length));
      c.table(
        [
          { title: 'Name', share: 0.24 },
          { title: 'Value', share: 0.38 },
          { title: 'Description', share: 0.38 },
        ],
        ir.outputs.map((o) => {
          const flagged = o.args.sensitive?.kind === 'literal' && o.args.sensitive.value === true;
          const hidden = flagged || isSecretName(o.name);
          const description = literalText(o.args.description);
          return {
            cells: [
              [{ text: o.name, font: 'mono', size: 7.5 }],
              [
                {
                  text: hidden ? '(sensitive)' : redactSecrets(safePreview(o.args.value)),
                  font: hidden ? 'regular' : 'mono',
                  size: 7.5,
                  color: hidden ? FAINT : INK,
                },
              ],
              [{ text: description ? redactSecrets(description, false) : '—', size: 7.5, color: description ? INK : FAINT }],
            ],
          } satisfies Row;
        }),
      );
    }
  }
}

function literalText(e: Expression | undefined): string | undefined {
  return e?.kind === 'literal' && typeof e.value === 'string' && e.value.trim() ? e.value : undefined;
}

function connections(c: Cursor, input: ArchDocInput) {
  const { ir, edges, audit } = input;
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const who = (id: string): Run[] => {
    const r = byId.get(id);
    if (!r) return [{ text: id, font: 'mono', size: 7.5 }];
    return [
      { text: r.name, font: 'bold', size: 8.5 },
      { text: serviceName(r.type), size: 7, color: FAINT },
    ];
  };
  c.section('connections', 'Connections & traffic', 'How the resources relate to each other and which network traffic the rules allow.');

  const flows = [...audit.topology.flows].sort((a, b) => Number(b.from === 'internet') - Number(a.from === 'internet'));
  const risky = new Set(audit.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').map((f) => f.resource));
  if (flows.length) {
    c.heading('Allowed network traffic', plural(flows.length, 'flow'));
    c.table(
      [
        { title: 'From', share: 0.3 },
        { title: 'To', share: 0.3 },
        { title: 'Ports', share: 0.2 },
        { title: 'Reach', share: 0.2 },
      ],
      flows.map((f) => {
        const internet = f.from === 'internet';
        const tone = internet ? (risky.has(f.to) ? TRAFFIC_COLOR.risky : TRAFFIC_COLOR.internet) : TRAFFIC_COLOR.internal;
        return {
          accent: tone,
          cells: [
            internet ? [{ text: 'Internet', font: 'bold', size: 8.5 }, { text: '0.0.0.0/0', font: 'mono', size: 7, color: FAINT }] : who(f.from),
            who(f.to),
            [{ text: f.ports.map((p) => (/^\d/.test(p) ? `:${p}` : p)).join('  '), font: 'mono', size: 8 }],
            [{ text: internet ? (tone === TRAFFIC_COLOR.risky ? 'Public — at risk' : 'Public') : 'Internal', size: 8, font: 'bold', color: tone }],
          ],
        } satisfies Row;
      }),
    );
  }

  if (edges.length) {
    c.heading('Dependencies', plural(edges.length, 'connection'));
    c.paragraph('Each row means the first resource refers to the second in its configuration. Resources nested inside a network are shown by placement instead.', {
      size: 8,
      color: MUTED,
      gap: 8,
    });
    c.table(
      [
        { title: 'Resource', share: 0.32 },
        { title: 'Uses', share: 0.32 },
        { title: 'Through', share: 0.36 },
      ],
      edges.map(
        (e) =>
          ({
            accent: e.kind === 'security' ? EDGE_SECURITY : EDGE_REF,
            cells: [who(e.source), who(e.target), [{ text: e.field, font: 'mono', size: 7.5, color: MUTED }]],
          }) satisfies Row,
      ),
    );
  }

  if (!flows.length && !edges.length) c.paragraph('The resources are not connected to each other yet.', { color: MUTED });
}

function security(c: Cursor, input: ArchDocInput) {
  const { audit, ir } = input;
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const nameOf = (id: string) => {
    const r = byId.get(id);
    return r ? `${r.name} (${shortName(r.type)})` : id;
  };
  c.section('security', 'Security review', 'Automated checks of firewall rules, exposure and common misconfigurations.');

  if (audit.grade) {
    c.ensure(70);
    const color = GRADE_COLOR[audit.grade];
    c.page.circle(c.left + 24, c.y + 24, 24, { fill: color });
    c.page.text(audit.grade, c.left + 24, c.y + 32, { font: 'bold', size: 24, color: '#ffffff', align: 'center' });
    c.page.text(`Security score ${audit.score}/100`, c.left + 62, c.y + 18, { font: 'bold', size: 12, color: INK });
    let x = c.left + 62;
    const any = SEVERITY_ORDER.some((s) => audit.counts[s] > 0);
    for (const s of SEVERITY_ORDER) {
      if (!audit.counts[s]) continue;
      const label = `${audit.counts[s]} ${s}`;
      const w = textWidth(label, 'bold', 7.5) + 14;
      c.page.rect(x, c.y + 26, w, 14, { fill: tint(SEVERITY_COLOR[s], 0.85), radius: 7 });
      c.page.text(label, x + 7, c.y + 36, { font: 'bold', size: 7.5, color: SEVERITY_COLOR[s] });
      x += w + 6;
    }
    if (!any) c.page.text('No issues found.', x, c.y + 36, { size: 8.5, color: MUTED });
    c.y += 64;
  } else if (audit.findings.length === 0) {
    c.paragraph('The design has no security groups, firewalls or exposed services to review yet.', { color: MUTED });
    return;
  }

  const exposed = [...audit.topology.exposure].filter(([, e]) => e.level === 'internet');
  if (exposed.length) {
    c.heading('Reachable from the internet', String(exposed.length));
    for (const [id, e] of exposed) {
      c.ensure(15);
      c.page.circle(c.left + 4, c.y + 6, 2.6, { fill: TRAFFIC_COLOR.internet });
      const name = nameOf(id);
      c.page.text(name, c.left + 13, baseline(c.y, 9, 12), { font: 'bold', size: 9, color: INK });
      c.page.text(`open on ${e.ports.map((p) => (/^\d/.test(p) ? `:${p}` : p)).join(', ')}`, c.left + 19 + textWidth(name, 'bold', 9), baseline(c.y, 9, 12), {
        size: 9,
        color: MUTED,
      });
      c.y += 15;
    }
    c.y += 12;
  }

  if (!audit.findings.length) return;
  c.heading('Findings', String(audit.findings.length));
  const findings = [...audit.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  for (const f of findings) {
    const width = c.width - 24;
    const detail = wrapText(f.detail, width, 'regular', 8.5);
    const meta = [`Resource: ${nameOf(f.resource)}`, f.fix ? `Suggested fix: ${f.fix.label}` : ''].filter(Boolean).join('   ·   ');
    const h = 16 + detail.length * 8.5 * LEAD + 16 + 12;
    c.ensure(h);
    const color = SEVERITY_COLOR[f.severity];
    c.page.rect(c.left, c.y, c.width, h, { stroke: LINE, lineWidth: 0.7, radius: 5 });
    c.page.rect(c.left, c.y, 3, h, { fill: color, radius: 1.5 });
    const pill = f.severity.toUpperCase();
    const pw = textWidth(pill, 'bold', 6.5) + 10;
    c.page.rect(c.left + 12, c.y + 8, pw, 11, { fill: color, radius: 5.5 });
    c.page.text(pill, c.left + 17, c.y + 15.8, { font: 'bold', size: 6.5, color: '#ffffff' });
    c.page.text(fitText(f.title, c.width - pw - 36, 'bold', 9.5), c.left + 18 + pw, c.y + 16.8, { font: 'bold', size: 9.5, color: INK });
    let y = c.y + 24;
    for (const line of detail) {
      c.page.text(line, c.left + 12, baseline(y, 8.5, 8.5 * LEAD), { size: 8.5, color: MUTED });
      y += 8.5 * LEAD;
    }
    c.page.text(fitText(meta, width, 'regular', 7.5), c.left + 12, y + 11, { size: 7.5, color: FAINT });
    c.y += h + 8;
  }
}

/** `# @blueprint:pos=…` lines only matter to the editor */
const LAYOUT_COMMENT = /^\s*(?:#|\/\/)\s*@blueprint:/;

function sourceCode(c: Cursor, input: ArchDocInput) {
  const files = input.files.filter(([, text]) => text.trim());
  if (!files.length) return;
  c.newPage();
  c.section('code', 'Terraform source', `${plural(files.length, 'file')} from the project (canvas layout comments left out).`);
  const size = 7;
  const lh = size * 1.42;
  const gutter = 26;
  const perLine = Math.floor((c.width - gutter) / (size * 0.6));
  for (const [name, text] of files) {
    const lines = text
      .replace(/\r\n?/g, '\n')
      .replace(/\n$/, '')
      .split('\n')
      .filter((line) => !LAYOUT_COMMENT.test(line));
    c.heading(name, plural(lines.length, 'line'));
    lines.forEach((raw, i) => {
      const line = raw.replace(/\t/g, '  ');
      const chunks = line.length ? (line.match(new RegExp(`.{1,${perLine}}`, 'g')) ?? ['']) : [''];
      chunks.forEach((chunk, j) => {
        c.ensure(lh);
        if (j === 0) c.page.text(String(i + 1), c.left + gutter - 8, baseline(c.y, size, lh), { font: 'mono', size, color: FAINT, align: 'right' });
        c.page.text(chunk, c.left + gutter, baseline(c.y, size, lh), { font: 'mono', size, color: chunk.trimStart().startsWith('#') ? '#64748b' : INK });
        c.y += lh;
      });
    });
    c.y += 14;
  }
}

function footers(doc: PdfDocument, title: string) {
  doc.pages.forEach((page, i) => {
    const y = page.height - FOOTER_BASELINE;
    page.text(fitText(title, page.width / 2, 'regular', 7.5), MARGIN, y, { size: 7.5, color: FAINT });
    page.text(`Page ${i + 1} of ${doc.pageCount}`, page.width - MARGIN, y, { size: 7.5, color: FAINT, align: 'right' });
  });
}

// ------------------------------------------------------------------ entry

export function buildArchitecturePdf(input: ArchDocInput): Uint8Array {
  const { ir, edges } = input;
  const doc = new PdfDocument(
    {
      title: input.title,
      subject: 'Cloud architecture document',
      creator: 'Cloud Blueprint',
      created: input.generatedAt,
    },
    input.compress ?? true,
  );
  const providers = providerSummary(ir)
    .map((p) => (p.regions.length ? `${PROVIDER_LABEL[p.provider]} (${p.regions.join(', ')})` : PROVIDER_LABEL[p.provider]))
    .join(' + ');
  const meta = [providers, plural(ir.resources.length, 'resource'), plural(edges.length, 'connection'), formatDocDate(input.generatedAt)]
    .filter(Boolean)
    .join('   ·   ');
  diagramPage(doc, input, meta);

  const hasVars = ir.variables.length > 0 || ir.outputs.length > 0;
  const toc: TocEntry[] = [
    { key: 'diagram', title: 'Diagram' },
    { key: 'overview', title: 'Overview' },
    ...(input.sections.inventory ? [{ key: 'inventory', title: 'Resource inventory' }] : []),
    ...(input.sections.inventory && hasVars ? [{ key: 'variables', title: 'Variables & outputs' }] : []),
    ...(input.sections.connections ? [{ key: 'connections', title: 'Connections & traffic' }] : []),
    ...(input.sections.security ? [{ key: 'security', title: 'Security review' }] : []),
    ...(input.sections.code && input.files.some(([, t]) => t.trim()) ? [{ key: 'code', title: 'Terraform source' }] : []),
  ];

  const paper = PAPER[input.paper];
  const c = new Cursor(doc, paper);
  const contents = overview(c, input, toc);
  if (input.sections.inventory) inventory(c, input);
  if (input.sections.connections) connections(c, input);
  if (input.sections.security) security(c, input);
  if (input.sections.code) sourceCode(c, input);

  // now every section has a page: fill in the table of contents
  for (const { entry, y } of contents.rows) {
    const target = entry.key === 'diagram' ? doc.pages[0] : c.sectionPages.get(entry.key);
    if (!target) continue;
    const label = String(target.index + 1);
    const tw = textWidth(entry.title, 'regular', 9.5);
    const nw = textWidth(label, 'bold', 9.5);
    contents.page.text(entry.title, c.left, baseline(y, 9.5, 13), { size: 9.5, color: PRIMARY });
    contents.page.line(c.left + tw + 6, y + 9.5, c.left + c.width - nw - 6, y + 9.5, { color: LINE, width: 0.8, dash: [1, 2] });
    contents.page.text(label, c.left + c.width, baseline(y, 9.5, 13), { font: 'bold', size: 9.5, color: INK, align: 'right' });
    contents.page.linkTo(c.left, y, c.width, 14, target);
  }

  footers(doc, input.title);
  return doc.save();
}
