/**
 * Architecture document: a shareable PDF of the design — the diagram, then a
 * readable summary for people who will never open the editor (inventory,
 * connections, allowed traffic, security review, optionally the source).
 *
 * Pure: IR + audit + the diagram geometry in, PDF bytes out. The geometry is
 * read from the live canvas by captureDiagram.ts and drawn as vectors by
 * diagramVector.ts; a diagram too big for one readable page is also split
 * into page-sized tiles.
 */
import { estimateProject, providerName } from '@/cost/estimate';
import { approx, describeLine, priceDate, usd } from '@/cost/format';
import { PRICE_BOOK } from '@/cost/prices/prices';
import type { CloudProvider, ProjectCost, ResourceCost } from '@/cost/types';
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { exprPreview, refTargetAddress } from '@/ir/expr';
import type { Expression, IR, IREdge, Provider, ResourceNode } from '@/ir/types';
import { providerOfSourceName } from '@/ir/types';
import { fitText, splitToWidth, textWidth, wrapText, type PdfFont } from '@/lib/pdf/metrics';
import { PAPER, PdfDocument, tint, type PdfColor, type PdfPage } from '@/lib/pdf/writer';
import { categoryLabel as catalogCategory, resourceName, resourceShortName } from '@/resources/i18n';
import { CATEGORY_COLORS } from '@/resources/icons';
import { docsUrl, getDef } from '@/resources/registry';
import { CATEGORY_ORDER, type Category } from '@/resources/types';
import { SEVERITY_ORDER, type AuditResult, type Severity } from '@/security/audit';
import { controlLabel, controlsIn, FRAMEWORKS, frameworkOf } from '@/security/compliance';
import { portText } from '@/security/model';
import { docMessages, type DocMessages } from './archDoc.messages';
import { drawDiagram, type DiagramVector, type Region } from './diagramVector';
import { modulesSection, pdfModuleMessages } from '@/features/modules/pdfModules';

export type Paper = keyof typeof PAPER;

export interface DocSections {
  inventory: boolean;
  connections: boolean;
  security: boolean;
  code: boolean;
  /** monthly cost estimate (a section and an overview tile); off when absent */
  cost?: boolean;
}

export interface ArchDocInput {
  title: string;
  notes?: string;
  ir: IR;
  edges: IREdge[];
  /** .tf files in display order */
  files: Array<[name: string, text: string]>;
  audit: AuditResult;
  diagram: DiagramVector | null;
  sections: DocSections;
  paper: Paper;
  generatedAt: Date;
  /** deflate page content (tests turn it off to read the text back) */
  compress?: boolean;
  /** the document's language — the UI language by default; `audit` should be worded in it too */
  locale?: Locale;
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
export const BOTTOM_SPACE = 52;
/** footer baseline, from the bottom edge */
export const FOOTER_BASELINE = 24;

const PROVIDER_COLOR: Record<Provider, PdfColor> = { aws: '#ff9900', azure: '#0078d4', gcp: '#4285f4', other: '#64748b' };
const SEVERITY_COLOR: Record<Severity, PdfColor> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' };
const GRADE_COLOR: Record<string, PdfColor> = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#f97316', F: '#ef4444' };
const TRAFFIC_COLOR = { internet: '#0ea5e9', internal: '#10b981', risky: '#ef4444' };

/** "29 Sep 2026, 09:00" / "29 de set. de 2026, 09:00" */
export function formatDocDate(d: Date, locale: Locale = currentLocale()): string {
  return messagesFor(docMessages, locale).date(d);
}

/** baseline for text of `size` vertically centered in a line box starting at `top` */
const baseline = (top: number, size: number, lineHeight: number) => top + (lineHeight - size * 0.925) / 2 + size * 0.718;

// ------------------------------------------------------------------ secrets
//
// The document is meant to be forwarded, so no secret value may reach it —
// whatever the expression looks like (literal, interpolation, list, object).

const MASK = '••••••';

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
function safePreview(e: Expression | undefined, t: DocMessages): string {
  if (!e) return '';
  switch (e.kind) {
    case 'list':
      return `[${e.items.map((i) => safePreview(i, t)).join(', ')}]`;
    case 'object': {
      const inner = Object.entries(e.fields)
        .map(([k, v]) => `${k} = ${SCRIPT_ARG.test(k) ? t.scriptHidden : SECRET_NAME.test(k) ? MASK : safePreview(v, t)}`)
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

function categoryLabel(c: CategoryKey, locale: Locale): string {
  return c === 'other' ? messagesFor(docMessages, locale).other : catalogCategory(c, locale);
}

function categoryColor(c: CategoryKey): PdfColor {
  return c === 'other' ? '#64748b' : CATEGORY_COLORS[c].solid;
}

function serviceName(type: string, locale: Locale): string {
  return getDef(type) ? resourceName(type, locale) : type.replace(/^(aws|azurerm|google)_/, '').replace(/_/g, ' ');
}

function shortName(type: string, locale: Locale): string {
  return getDef(type) ? resourceShortName(type, locale) : serviceName(type, locale);
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

function settingValue(e: Expression, t: DocMessages): string | undefined {
  switch (e.kind) {
    case 'literal':
      return e.value === null ? undefined : String(e.value);
    case 'ref':
      // references to other resources are listed as connections instead
      return refTargetAddress(e.path) ? undefined : e.path;
    case 'list': {
      const items = e.items.map((i) => settingValue(i, t));
      if (items.length === 0 || items.some((i) => i === undefined)) return undefined;
      return items.length > 3 ? `${items.slice(0, 3).join(', ')} +${items.length - 3}` : items.join(', ');
    }
    case 'raw': {
      const flat = e.hcl.replace(/\s+/g, ' ').trim();
      return flat.length > 44 ? `${flat.slice(0, 43)}…` : flat;
    }
    case 'blocks':
      return t.blocks(e.items.length);
    default:
      return undefined;
  }
}

/** the few arguments worth reading, schema order first, secrets masked */
export function keySettings(r: ResourceNode, max = 6, locale: Locale = currentLocale()): string[] {
  const t = messagesFor(docMessages, locale);
  const order = [...(getDef(r.type)?.fields.map((f) => f.name) ?? []), ...Object.keys(r.args)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of order) {
    if (seen.has(key) || out.length >= max) continue;
    seen.add(key);
    const e = r.args[key];
    if (!e || key === 'tags' || key === 'tags_all') continue;
    const value = settingValue(e, t);
    if (value === undefined || value === '') continue;
    if (SCRIPT_ARG.test(key)) out.push(`${key}: ${t.scriptHidden}`);
    // a true/false switch (manage_master_user_password = true) gives nothing away
    else if (isSecretArg(r.type, key) && !(e.kind === 'literal' && typeof e.value === 'boolean')) out.push(`${key}: ${MASK}`);
    else out.push(`${key}: ${redactSecrets(value)}`);
  }
  return out;
}

function placement(r: ResourceNode, byId: Map<string, ResourceNode>, locale: Locale): string {
  const chain: string[] = [];
  let cur = r.parentId ? byId.get(r.parentId) : undefined;
  while (cur && chain.length < 6) {
    chain.unshift(`${cur.name} (${shortName(cur.type, locale)})`);
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
  /** wrap to at most this many lines, the last one cut with "…" */
  maxLines?: number;
}

export interface Column {
  title: string;
  /** share of the text width */
  share: number;
}

export interface Row {
  cells: Run[][];
  /** full-width group heading instead of cells */
  group?: { label: string; color: PdfColor; note?: string };
  /** colored mark at the start of the row */
  accent?: PdfColor;
}

type Line = Run & { font: PdfFont; size: number };

const LEAD = 1.38;
const CELL_PAD_X = 6;
const CELL_PAD_Y = 5;
const MAX_CELL_LINES = 18;
const TABLE_HEADER_H = 18;
const GROUP_ROW_H = 22;
const HEADING_H = 20;
const SECTION_H = 14 + 22 + 13 + 5 + 12;
/** long sections hand the main thread back this often (table rows, findings) */
const YIELD_EVERY = 40;

/** `lines` cut to `max`, the last one ending in "…" */
function clampLines(lines: Line[], max: number, width: number): Line[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1];
  kept[max - 1] = { ...last, text: fitText(`${last.text.trimEnd()}…`, width, last.font, last.size) };
  return kept;
}

interface Pending {
  height: number;
  /** room the next block needs below this one, at least */
  minAfter: number;
  draw(): void;
}

export class Cursor {
  page!: PdfPage;
  y = 0;
  /** where each section starts, for the table of contents */
  readonly sections = new Map<string, { page: PdfPage; y: number }>();
  /** titles waiting to be drawn together with the block that follows them */
  private pending: Pending[] = [];

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

  /**
   * Make room for a block `h` points tall: start a new page unless it fits —
   * together with any heading still waiting for it, so a heading is never
   * left alone at the bottom of a page. Returns whether a page was started.
   */
  ensure(h: number): boolean {
    const lead = this.pending.reduce((sum, p) => sum + p.height, 0);
    const minAfter = Math.max(0, ...this.pending.map((p) => p.minAfter));
    let broke = false;
    if (this.y > MARGIN && this.y + lead + Math.max(h, minAfter) > this.bottom) {
      this.newPage();
      broke = true;
    }
    const queued = this.pending;
    this.pending = [];
    for (const p of queued) p.draw();
    return broke;
  }

  /** draw whatever heading is still waiting (end of the document) */
  flush(): void {
    if (this.pending.length) this.ensure(0);
  }

  paragraph(text: string, opts: { font?: PdfFont; size?: number; color?: PdfColor; width?: number; x?: number; gap?: number } = {}) {
    const { font = 'regular', size = 9, color = INK, width = this.width, x = this.left, gap = 6 } = opts;
    const lh = size * LEAD;
    wrapText(text, width, font, size).forEach((line, i) => {
      // keep the first two lines together (and with a heading above them)
      this.ensure(i === 0 ? lh * 2 : lh);
      this.page.text(line, x, baseline(this.y, size, lh), { font, size, color });
      this.y += lh;
    });
    this.y += gap;
  }

  section(key: string, title: string, subtitle?: string): void {
    this.pending.push({
      height: SECTION_H,
      minAfter: 100,
      draw: () => {
        if (this.y > MARGIN) this.y += 14;
        this.sections.set(key, { page: this.page, y: this.y });
        this.doc.bookmark(title, this.page, this.y - 6);
        this.page.text(fitText(title, this.width, 'bold', 16), this.left, baseline(this.y, 16, 22), { font: 'bold', size: 16, color: INK });
        this.y += 22;
        if (subtitle) {
          this.page.text(fitText(subtitle, this.width, 'regular', 9), this.left, baseline(this.y, 9, 13), { size: 9, color: MUTED });
          this.y += 13;
        }
        this.y += 5;
        this.page.line(this.left, this.y, this.left + this.width, this.y, { color: LINE, width: 0.8 });
        this.y += 12;
      },
    });
  }

  /** a sub-heading, drawn with the first block that follows it */
  heading(text: string, note?: string): void {
    this.pending.push({
      height: HEADING_H,
      minAfter: 0,
      draw: () => {
        const noteW = note ? textWidth(note, 'regular', 8.5) + 6 : 0;
        const label = fitText(text, this.width - noteW, 'bold', 10.5);
        this.page.text(label, this.left, baseline(this.y, 10.5, 15), { font: 'bold', size: 10.5, color: INK });
        if (note) {
          const w = textWidth(label, 'bold', 10.5);
          this.page.text(note, this.left + w + 6, baseline(this.y, 10.5, 15), { size: 8.5, color: FAINT });
        }
        this.y += HEADING_H;
      },
    });
  }

  /** a table; a generator that pauses every few dozen rows (see buildArchitecturePdfAsync) */
  *table(columns: Column[], rows: Row[]): Generator<void, void> {
    const widths = columns.map((c) => c.share * this.width);
    const layouts = new Map<number, Line[][]>();
    const lay = (index: number): Line[][] => {
      let cells = layouts.get(index);
      if (cells) return cells;
      cells = rows[index].cells.map((runs, i) => {
        const inner = widths[i] - CELL_PAD_X * 2;
        const lines = runs.flatMap((run) => {
          const font = run.font ?? 'regular';
          const size = run.size ?? 8.5;
          const wrapped = wrapText(run.text, inner, font, size).map((text) => ({ ...run, text, font, size }));
          return run.maxLines ? clampLines(wrapped, run.maxLines, inner) : wrapped;
        });
        return clampLines(lines, MAX_CELL_LINES, inner);
      });
      layouts.set(index, cells);
      return cells;
    };
    const heightOf = (index: number) =>
      Math.max(0, ...lay(index).map((ls) => ls.reduce((h, l) => h + l.size * LEAD, 0))) + CELL_PAD_Y * 2;
    /** a group row and the row after it stay together */
    const blockHeight = (index: number) => {
      if (!rows[index].group) return heightOf(index);
      const next = rows[index + 1];
      return GROUP_ROW_H + (next && !next.group ? heightOf(index + 1) : 0);
    };

    const header = () => {
      const h = TABLE_HEADER_H;
      this.page.rect(this.left, this.y, this.width, h, { fill: SOFT, radius: 3 });
      let x = this.left;
      columns.forEach((c, i) => {
        const title = fitText(c.title.toUpperCase(), widths[i] - CELL_PAD_X * 2, 'bold', 6.8);
        this.page.text(title, x + CELL_PAD_X, baseline(this.y, 6.8, h), { font: 'bold', size: 6.8, color: MUTED });
        x += widths[i];
      });
      this.y += h;
    };

    // the header never sits alone: it goes with the first real row
    this.ensure(TABLE_HEADER_H + (rows.length ? blockHeight(0) : 0));
    header();
    for (const [index, row] of rows.entries()) {
      if (index % YIELD_EVERY === YIELD_EVERY - 1) yield;
      if (row.group) {
        if (index > 0 && this.ensure(blockHeight(index))) header();
        this.y += 4;
        this.page.rect(this.left, this.y, this.width, 18, { fill: tint(row.group.color, 0.9), radius: 3 });
        this.page.circle(this.left + 10, this.y + 9, 3, { fill: row.group.color });
        const label = fitText(row.group.label, this.width - 40, 'bold', 8.5);
        this.page.text(label, this.left + 19, baseline(this.y, 8.5, 18), { font: 'bold', size: 8.5, color: INK });
        if (row.group.note) {
          const w = textWidth(label, 'bold', 8.5);
          this.page.text(fitText(row.group.note, this.width - 31 - w, 'regular', 8), this.left + 25 + w, baseline(this.y, 8, 18), { size: 8, color: MUTED });
        }
        this.y += 18;
        continue;
      }
      const lines = lay(index);
      const h = heightOf(index);
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
    }
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

// ------------------------------------------------------------------ diagram

const HEADER_H = 62;
/** legend rows start this far below the diagram box */
const LEGEND_GAP = 14;
const LEGEND_ROW_H = 14;
/** room between the last legend row and the bottom edge (the footer lives there) */
const LEGEND_BOTTOM = 41;
/** empty canvas kept around the nodes (chips and badges stick out of them) */
const DIAGRAM_PAD = 28;
const BOX_PAD = 10;
/** never blow a small diagram up past ~1.15× its on-screen size */
const MAX_SCALE = 1.15;
/**
 * A diagram that only fits one page below this scale (node names under ~5.5
 * pt, labels under 4) is also printed in page-sized tiles…
 */
export const TILE_BELOW = 0.42;
/** …at this scale or more: every label ≥ ~5 pt */
export const MIN_TILE_SCALE = 0.53;
/** canvas units shared by neighbouring tiles */
const TILE_OVERLAP = 64;

interface Size {
  width: number;
  height: number;
}

interface LegendItem {
  label: string;
  draw?: (page: PdfPage, x: number, y: number) => void;
}

function legendItems(lens: boolean, t: DocMessages): LegendItem[] {
  const items: LegendItem[] = [
    {
      label: t.legendBoundary,
      draw: (page, x, y) => page.rect(x, y - 5, 22, 10, { stroke: '#a855f7', lineWidth: 0.9, dash: [2.5, 1.8], radius: 2.5 }),
    },
    {
      label: t.legendUses,
      draw: (page, x, y) => {
        page.line(x, y, x + 19, y, { color: EDGE_REF, width: 1.2 });
        arrowHead(page, x + 22, y, EDGE_REF);
      },
    },
    {
      label: t.legendSecurity,
      draw: (page, x, y) => {
        page.line(x, y, x + 19, y, { color: EDGE_SECURITY, width: 1.2, dash: [3, 2.2] });
        arrowHead(page, x + 22, y, EDGE_SECURITY);
      },
    },
  ];
  if (lens) {
    items.push({
      label: t.legendTraffic,
      draw: (page, x, y) => {
        page.line(x, y, x + 19, y, { color: TRAFFIC_COLOR.internet, width: 1.6 });
        arrowHead(page, x + 22, y, TRAFFIC_COLOR.internet);
      },
    });
  }
  return items;
}

const itemWidth = (item: LegendItem) => (item.draw ? 28 : 0) + textWidth(item.label, 'regular', 7.5);

/** legend items in rows that fit `width` */
function legendRows(items: LegendItem[], width: number): LegendItem[][] {
  const rows: LegendItem[][] = [[]];
  let used = 0;
  for (const item of items) {
    const w = itemWidth(item);
    const row = rows[rows.length - 1];
    if (row.length && used + 18 + w > width) {
      rows.push([item]);
      used = w;
    } else {
      used += (row.length ? 18 : 0) + w;
      row.push(item);
    }
  }
  return rows;
}

function drawLegend(page: PdfPage, rows: LegendItem[][], top: number) {
  rows.forEach((row, r) => {
    const y = top + r * LEGEND_ROW_H;
    let x = MARGIN;
    for (const item of row) {
      item.draw?.(page, x, y);
      const tx = x + (item.draw ? 28 : 0);
      page.text(fitText(item.label, page.width - MARGIN - tx, 'regular', 7.5), tx, y + 2.6, { size: 7.5, color: MUTED });
      x += itemWidth(item) + 18;
    }
  });
}

function diagramBox(size: Size, legendRowCount: number) {
  return {
    x: MARGIN,
    y: MARGIN + HEADER_H,
    w: size.width - MARGIN * 2,
    h: size.height - MARGIN - HEADER_H - LEGEND_GAP - (legendRowCount - 1) * LEGEND_ROW_H - LEGEND_BOTTOM,
  };
}

/** the diagram's extent plus a margin, in canvas units */
function diagramRegion(d: DiagramVector): Region | undefined {
  const { x, y, width, height } = d.bounds;
  if (![x, y, width, height].every(Number.isFinite) || d.nodes.length === 0) return undefined;
  return { x: x - DIAGRAM_PAD, y: y - DIAGRAM_PAD, w: Math.max(1, width + DIAGRAM_PAD * 2), h: Math.max(1, height + DIAGRAM_PAD * 2) };
}

function fitScale(region: Region, box: { w: number; h: number }) {
  return Math.min((box.w - BOX_PAD * 2) / region.w, (box.h - BOX_PAD * 2) / region.h);
}

/**
 * Tiles covering `region` at a readable scale: the fewest that keep the
 * scale at MIN_TILE_SCALE or above, then zoomed in as far as that grid allows.
 */
function tileGrid(region: Region, box: { w: number; h: number }): { scale: number; cols: number; rows: number; tiles: Region[] } {
  const bw = box.w - BOX_PAD * 2;
  const bh = box.h - BOX_PAD * 2;
  const span = (length: number, tile: number) => Math.max(1, Math.ceil((length - TILE_OVERLAP) / (tile - TILE_OVERLAP)));
  const cols = span(region.w, bw / MIN_TILE_SCALE);
  const rows = span(region.h, bh / MIN_TILE_SCALE);
  const needW = (region.w + (cols - 1) * TILE_OVERLAP) / cols;
  const needH = (region.h + (rows - 1) * TILE_OVERLAP) / rows;
  const scale = Math.min(bw / needW, bh / needH, MAX_SCALE);
  const tw = bw / scale;
  const th = bh / scale;
  const start = (from: number, length: number, tile: number, i: number, n: number) =>
    n === 1 ? from + (length - tile) / 2 : from + ((length - tile) * i) / (n - 1);
  const tiles: Region[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({ x: start(region.x, region.w, tw, c, cols), y: start(region.y, region.h, th, r, rows), w: tw, h: th });
    }
  }
  return { scale, cols, rows, tiles };
}

/** title + facts on the left; on the right the mark, or `reserve` points left free */
function pageHeader(page: PdfPage, title: string, meta: string, reserve?: number) {
  const brand = 'Cloud Blueprint';
  const brandW = reserve ?? textWidth(brand, 'bold', 9) + 22;
  const top = MARGIN;
  const room = page.width - MARGIN * 2 - brandW - 20;
  page.text(fitText(title, room, 'bold', 20), MARGIN, top + 18, { font: 'bold', size: 20, color: INK });
  page.text(fitText(meta, room, 'regular', 9), MARGIN, top + 36, { size: 9, color: MUTED });
  if (reserve === undefined) {
    logo(page, page.width - MARGIN - brandW, top + 3, 16);
    page.text(brand, page.width - MARGIN, top + 15, { font: 'bold', size: 9, color: INK, align: 'right' });
  }
  page.line(MARGIN, top + 48, page.width - MARGIN, top + 48, { color: LINE, width: 0.8 });
}

/** draw `region` of the diagram into `box`, clipped, centered */
function diagramInBox(
  page: PdfPage,
  d: DiagramVector,
  box: { x: number; y: number; w: number; h: number },
  region: Region,
  scale: number,
  locale: Locale,
) {
  page.rect(box.x, box.y, box.w, box.h, { fill: d.palette.canvas, stroke: '#d3e0f0', lineWidth: 0.8, radius: 8 });
  const w = region.w * scale;
  const h = region.h * scale;
  page.save();
  page.clipRect(box.x + 0.4, box.y + 0.4, box.w - 0.8, box.h - 0.8, 7.6);
  drawDiagram(page, d, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, scale, region, locale });
  page.restore();
}

/**
 * The diagram page — and, for a diagram too big to read on one page, an
 * overview with numbered areas followed by one page per area.
 */
function* diagramPages(doc: PdfDocument, input: ArchDocInput, meta: string, locale: Locale): Generator<string, void> {
  const t = messagesFor(docMessages, locale);
  const paper = PAPER[input.paper];
  const portrait = { width: paper.width, height: paper.height };
  const landscape = { width: paper.height, height: paper.width };
  const d = input.diagram;
  const legend = legendItems(!!d?.lens, t);
  const rowsFor = (s: Size) => legendRows(legend, s.width - MARGIN * 2);
  const boxFor = (s: Size) => diagramBox(s, rowsFor(s).length);

  const region = d ? diagramRegion(d) : undefined;
  const size = region && fitScale(region, boxFor(portrait)) > fitScale(region, boxFor(landscape)) ? portrait : landscape;
  const page = doc.addPage(size.width, size.height);
  doc.bookmark(t.diagram, page, 0);
  pageHeader(page, input.title, meta);
  const box = boxFor(size);

  if (!d || !region) {
    page.rect(box.x, box.y, box.w, box.h, { fill: SOFT, stroke: '#d3e0f0', lineWidth: 0.8, radius: 8 });
    page.text(t.noDiagram, box.x + box.w / 2, box.y + box.h / 2, { size: 10, color: MUTED, align: 'center' });
    drawLegend(page, rowsFor(size), box.y + box.h + LEGEND_GAP);
    return;
  }

  const scale = Math.min(fitScale(region, box), MAX_SCALE);
  if (scale >= TILE_BELOW) {
    diagramInBox(page, d, box, region, scale, locale);
    drawLegend(page, rowsFor(size), box.y + box.h + LEGEND_GAP);
    return;
  }

  // too small to read: tiles at a readable scale, on whichever orientation needs fewer
  // (an area page has a single line under its box: the way back to page 1)
  const gridOf = (s: Size) => tileGrid(region, diagramBox(s, 1));
  const tileSize = gridOf(portrait).tiles.length < gridOf(landscape).tiles.length ? portrait : landscape;
  const grid = gridOf(tileSize);
  const tilePages = grid.tiles.map(() => doc.addPage(tileSize.width, tileSize.height));
  const first = tilePages[0].index + 1;
  const last = tilePages[tilePages.length - 1].index + 1;
  const note: LegendItem = { label: t.numberedAreas(first, last) };
  const rows = legendRows([...legend, note], size.width - MARGIN * 2);
  const overviewBox = diagramBox(size, rows.length);
  const overviewScale = Math.min(fitScale(region, overviewBox), MAX_SCALE);
  diagramInBox(page, d, overviewBox, region, overviewScale, locale);
  drawLegend(page, rows, overviewBox.y + overviewBox.h + LEGEND_GAP);

  // the areas, numbered and linked to their pages
  const ox = overviewBox.x + (overviewBox.w - region.w * overviewScale) / 2;
  const oy = overviewBox.y + (overviewBox.h - region.h * overviewScale) / 2;
  const onOverview = (t: Region) => {
    const x0 = Math.max(overviewBox.x + 2, ox + (t.x - region.x) * overviewScale);
    const y0 = Math.max(overviewBox.y + 2, oy + (t.y - region.y) * overviewScale);
    const x1 = Math.min(overviewBox.x + overviewBox.w - 2, ox + (t.x + t.w - region.x) * overviewScale);
    const y1 = Math.min(overviewBox.y + overviewBox.h - 2, oy + (t.y + t.h - region.y) * overviewScale);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  grid.tiles.forEach((t, i) => {
    const r = onOverview(t);
    page.rect(r.x, r.y, r.w, r.h, { stroke: PRIMARY, lineWidth: 0.7, dash: [3, 2.5], opacity: 0.55, radius: 3 });
    const label = String(i + 1);
    const bw = Math.max(14, textWidth(label, 'bold', 8) + 8);
    page.rect(r.x + 4, r.y + 4, bw, 13, { fill: PRIMARY, radius: 6.5 });
    page.text(label, r.x + 4 + bw / 2, r.y + 13.3, { font: 'bold', size: 8, color: '#ffffff', align: 'center' });
    page.linkTo(r.x, r.y, r.w, r.h, tilePages[i], 0);
  });

  // one page per area, with a locator map in the header: every area, this one
  // filled, each linking to its page
  const tileBox = diagramBox(tileSize, 1);
  const k = Math.min(150 / region.w, 42 / region.h);
  const mw = region.w * k;
  const mh = region.h * k;
  for (const [i, tile] of grid.tiles.entries()) {
    yield t.drawingArea(i + 1, grid.tiles.length);
    const p = tilePages[i];
    const row = Math.floor(i / grid.cols) + 1;
    const col = (i % grid.cols) + 1;
    pageHeader(p, t.areaTitle(i + 1, grid.tiles.length), t.areaMeta(input.title, row, grid.rows, col, grid.cols), mw + 12);
    diagramInBox(p, d, tileBox, tile, grid.scale, locale);
    const mx = p.width - MARGIN - mw;
    const my = MARGIN + 2 + (42 - mh) / 2;
    p.rect(mx, my, mw, mh, { fill: SOFT, stroke: LINE, lineWidth: 0.5 });
    grid.tiles.forEach((o, j) => {
      const rx = mx + Math.max(0, (o.x - region.x) * k);
      const ry = my + Math.max(0, (o.y - region.y) * k);
      const rw = Math.min(mx + mw, mx + (o.x + o.w - region.x) * k) - rx;
      const rh = Math.min(my + mh, my + (o.y + o.h - region.y) * k) - ry;
      if (rw <= 0 || rh <= 0) return;
      if (j === i) p.rect(rx, ry, rw, rh, { fill: PRIMARY, opacity: 0.3 });
      p.rect(rx, ry, rw, rh, { stroke: PRIMARY, lineWidth: 0.4, opacity: 0.6 });
      if (j !== i) p.linkTo(rx, ry, rw, rh, tilePages[j], 0);
    });
    const back = t.backToOverview;
    const by = tileBox.y + tileBox.h + LEGEND_GAP;
    p.text(back, MARGIN, by + 2.6, { size: 7.5, color: PRIMARY });
    p.linkTo(MARGIN, by - 6, textWidth(back, 'regular', 7.5), 12, page, 0);
  }
}

// ------------------------------------------------------------------ pages

interface TocEntry {
  key: string;
  title: string;
}

function overview(
  c: Cursor,
  input: ArchDocInput,
  toc: TocEntry[],
  cost: ProjectCost | null,
  locale: Locale,
): { page: PdfPage; rows: Array<{ entry: TocEntry; y: number }> } {
  const t = messagesFor(docMessages, locale);
  const { ir, edges, audit } = input;
  c.newPage();
  c.section('overview', t.overview, t.generated(formatDocDate(input.generatedAt, locale)));

  const notes = input.notes?.trim();
  if (notes) {
    // the notes flow across pages: one box per page they touch
    const size = 9.5;
    const lh = size * LEAD;
    const lines = wrapText(notes, c.width - 28, 'regular', size);
    let at = 0;
    while (at < lines.length) {
      c.ensure(34 + Math.min(3, lines.length - at) * lh);
      const room = Math.floor((c.bottom - c.y - 34) / lh);
      const part = lines.slice(at, at + Math.max(1, room));
      const h = part.length * lh + 34;
      c.page.rect(c.left, c.y, c.width, h, { fill: '#f8fafc', stroke: LINE, lineWidth: 0.6, radius: 5 });
      c.page.rect(c.left, c.y, 3, h, { fill: PRIMARY, radius: 1.5 });
      c.page.text(at === 0 ? t.notes : t.notesContinued, c.left + 14, c.y + 16, { font: 'bold', size: 7, color: MUTED });
      let y = c.y + 22;
      for (const line of part) {
        c.page.text(line, c.left + 14, baseline(y, size, lh), { size, color: INK });
        y += lh;
      }
      at += part.length;
      c.y += h + (at < lines.length ? 0 : 16);
    }
  }

  // stat tiles
  const containers = ir.resources.filter((r) => getDef(r.type)?.container).length;
  const tiles: Array<{ value: string; label: string; color?: PdfColor }> = [
    { value: String(ir.resources.length), label: t.tileResources },
    { value: String(edges.length), label: t.tileConnections },
    // five tiles (with the cost one) leave no room for the long label
    { value: String(containers), label: t.tileNetworks(!!cost) },
  ];
  if (input.sections.security && audit.grade) {
    tiles.push({ value: audit.grade, label: t.tileScore(audit.score), color: GRADE_COLOR[audit.grade] });
  } else {
    tiles.push({ value: String(ir.variables.length), label: t.tileVariables });
  }
  if (cost) tiles.push({ value: approx(cost.counts.fixed ? cost.total : 0, locale), label: t.tileCost });
  const gap = 10;
  const tw = (c.width - gap * (tiles.length - 1)) / tiles.length;
  c.ensure(54);
  tiles.forEach((t, i) => {
    const x = c.left + i * (tw + gap);
    c.page.rect(x, c.y, tw, 54, { stroke: LINE, lineWidth: 0.8, radius: 6 });
    // a longer value ("~US$ 1.234" in Portuguese) shrinks to fit before it would be cut
    let size = 19;
    while (size > 13 && textWidth(t.value, 'bold', size) > tw - 24) size -= 0.5;
    c.page.text(fitText(t.value, tw - 24, 'bold', size), x + 12, c.y + 27, { font: 'bold', size, color: t.color ?? INK });
    c.page.text(fitText(t.label.toUpperCase(), tw - 24, 'bold', 6.8), x + 12, c.y + 43, { font: 'bold', size: 6.8, color: MUTED });
  });
  c.y += 54 + 22;

  // providers, one row each (regions wrap under themselves)
  c.heading(t.cloudProviders);
  for (const p of providerSummary(ir)) {
    const label = providerName(p.provider, locale);
    const dx = c.left + 14 + textWidth(label, 'bold', 9.5) + 8;
    const detail = t.providerDetail(p.count, p.regions);
    const lines = wrapText(detail, c.left + c.width - dx, 'regular', 9);
    c.ensure(17 + (lines.length - 1) * 13);
    c.page.circle(c.left + 4, c.y + 6.5, 3.2, { fill: PROVIDER_COLOR[p.provider] });
    c.page.text(label, c.left + 14, baseline(c.y, 9.5, 13), { font: 'bold', size: 9.5, color: INK });
    lines.forEach((line, i) => c.page.text(line, dx, baseline(c.y + i * 13, 9, 13), { size: 9, color: MUTED }));
    c.y += 17 + (lines.length - 1) * 13;
  }
  c.y += 14;

  // resources per category, as bars
  c.heading(t.byCategoryTitle);
  const counts = new Map<CategoryKey, number>();
  for (const r of ir.resources) counts.set(categoryOf(r), (counts.get(categoryOf(r)) ?? 0) + 1);
  const cats = ([...CATEGORY_ORDER, 'other'] as CategoryKey[]).filter((k) => counts.has(k));
  const most = Math.max(1, ...counts.values());
  const labelW = 120;
  const barW = c.width - labelW - 36;
  for (const k of cats) {
    const n = counts.get(k)!;
    c.ensure(17);
    c.page.text(fitText(categoryLabel(k, locale), labelW - 8, 'regular', 9), c.left, baseline(c.y, 9, 13), { size: 9, color: INK });
    c.page.rect(c.left + labelW, c.y + 3, barW, 7, { fill: SOFT, radius: 3.5 });
    c.page.rect(c.left + labelW, c.y + 3, Math.max(7, (barW * n) / most), 7, { fill: categoryColor(k), radius: 3.5 });
    c.page.text(String(n), c.left + c.width, baseline(c.y, 9, 13), { font: 'bold', size: 9, color: INK, align: 'right' });
    c.y += 17;
  }
  c.y += 14;

  // table of contents — page numbers are filled in once every section is laid out
  c.heading(t.inThisDocument);
  c.ensure(toc.length * 17);
  const page = c.page;
  const rows = toc.map((entry) => {
    const y = c.y;
    c.y += 17;
    return { entry, y };
  });
  return { page, rows };
}

function* inventory(c: Cursor, input: ArchDocInput, locale: Locale): Generator<void, void> {
  const t = messagesFor(docMessages, locale);
  const { ir } = input;
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  c.section('inventory', t.inventory, t.inventoryHint);
  const groups = new Map<CategoryKey, ResourceNode[]>();
  for (const r of ir.resources) {
    const k = categoryOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows: Row[] = [];
  for (const k of [...CATEGORY_ORDER, 'other'] as CategoryKey[]) {
    const list = groups.get(k);
    if (!list) continue;
    rows.push({ cells: [], group: { label: categoryLabel(k, locale), color: categoryColor(k), note: String(list.length) } });
    for (const r of list) {
      const settings = keySettings(r, 6, locale);
      rows.push({
        cells: [
          [
            { text: r.name, font: 'bold' },
            { text: r.type, font: 'mono', size: 6.6, color: FAINT, url: docsUrl(r.type) },
          ],
          [
            { text: serviceName(r.type, locale) },
            { text: providerName(r.provider, locale), size: 7, color: FAINT },
          ],
          // each setting gets a few lines at most, so a huge value can't hide the ones after it
          settings.length ? settings.map((s) => ({ text: s, size: 7.5, color: INK, maxLines: 3 })) : [{ text: '—', color: FAINT }],
          [{ text: placement(r, byId, locale) || '—', size: 7.5, color: r.parentId ? MUTED : FAINT }],
        ],
      });
    }
  }
  yield* c.table(
    [
      { title: t.colResource, share: 0.27 },
      { title: t.colService, share: 0.19 },
      { title: t.colConfiguration, share: 0.34 },
      { title: t.colPlacement, share: 0.2 },
    ],
    rows,
  );

  if (ir.variables.length || ir.outputs.length) {
    c.section('variables', t.variablesOutputs, t.variablesHint);
    if (ir.variables.length) {
      c.heading(t.variables, String(ir.variables.length));
      yield* c.table(
        [
          { title: t.colName, share: 0.24 },
          { title: t.colType, share: 0.14 },
          { title: t.colDefault, share: 0.24 },
          { title: t.colDescription, share: 0.38 },
        ],
        ir.variables.map((v) => {
          const flagged = v.args.sensitive?.kind === 'literal' && v.args.sensitive.value === true;
          const hidden = flagged || isSecretName(v.name);
          const def = v.args.default;
          const description = literalText(v.args.description);
          return {
            cells: [
              [{ text: v.name, font: 'mono', size: 7.5 }],
              [{ text: v.args.type ? exprPreview(v.args.type) : 'any', size: 7.5, color: MUTED, maxLines: 4 }],
              [
                def
                  ? {
                      text: hidden ? t.sensitive : redactSecrets(safePreview(def, t)),
                      size: 7.5,
                      font: hidden ? 'regular' : 'mono',
                      color: hidden ? FAINT : INK,
                      maxLines: 6,
                    }
                  : { text: t.required, size: 7.5, font: 'bold', color: '#b45309' },
              ],
              [{ text: description ? redactSecrets(description, false) : '—', size: 7.5, color: description ? INK : FAINT }],
            ],
          } satisfies Row;
        }),
      );
    }
    if (ir.outputs.length) {
      c.heading(t.outputs, String(ir.outputs.length));
      yield* c.table(
        [
          { title: t.colName, share: 0.24 },
          { title: t.colValue, share: 0.38 },
          { title: t.colDescription, share: 0.38 },
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
                  text: hidden ? t.sensitive : redactSecrets(safePreview(o.args.value, t)),
                  font: hidden ? 'regular' : 'mono',
                  size: 7.5,
                  color: hidden ? FAINT : INK,
                  maxLines: 6,
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

function* connections(c: Cursor, input: ArchDocInput, locale: Locale): Generator<void, void> {
  const t = messagesFor(docMessages, locale);
  const { ir, edges, audit } = input;
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const who = (id: string): Run[] => {
    const r = byId.get(id);
    if (!r) return [{ text: id, font: 'mono', size: 7.5 }];
    return [
      { text: r.name, font: 'bold', size: 8.5 },
      { text: serviceName(r.type, locale), size: 7, color: FAINT },
    ];
  };
  c.section('connections', t.connectionsTitle, t.connectionsHint);

  const flows = [...audit.topology.flows].sort((a, b) => Number(b.from === 'internet') - Number(a.from === 'internet'));
  const risky = new Set(audit.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').map((f) => f.resource));
  if (flows.length) {
    c.heading(t.allowedTraffic, t.flows(flows.length));
    yield* c.table(
      [
        { title: t.colFrom, share: 0.3 },
        { title: t.colTo, share: 0.3 },
        { title: t.colPorts, share: 0.2 },
        { title: t.colReach, share: 0.2 },
      ],
      flows.map((f) => {
        const internet = f.from === 'internet';
        const tone = internet ? (risky.has(f.to) ? TRAFFIC_COLOR.risky : TRAFFIC_COLOR.internet) : TRAFFIC_COLOR.internal;
        return {
          accent: tone,
          cells: [
            internet ? [{ text: 'Internet', font: 'bold', size: 8.5 }, { text: '0.0.0.0/0', font: 'mono', size: 7, color: FAINT }] : who(f.from),
            who(f.to),
            [{ text: f.ports.map((p) => (/^\d/.test(p) ? `:${p}` : portText(p, locale))).join('  '), font: 'mono', size: 8 }],
            [{ text: internet ? (tone === TRAFFIC_COLOR.risky ? t.publicAtRisk : t.public) : t.internal, size: 8, font: 'bold', color: tone }],
          ],
        } satisfies Row;
      }),
    );
  }

  if (edges.length) {
    c.heading(t.dependencies, t.connections(edges.length));
    c.paragraph(t.dependenciesHint, { size: 8, color: MUTED, gap: 8 });
    yield* c.table(
      [
        { title: t.colResource, share: 0.32 },
        { title: t.colUses, share: 0.32 },
        { title: t.colThrough, share: 0.36 },
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

  if (!flows.length && !edges.length) c.paragraph(t.notConnected, { color: MUTED });
}

function* security(c: Cursor, input: ArchDocInput, locale: Locale): Generator<void, void> {
  const t = messagesFor(docMessages, locale);
  const { audit, ir } = input;
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const nameOf = (id: string) => {
    const r = byId.get(id);
    return r ? `${r.name} (${shortName(r.type, locale)})` : id;
  };
  c.section('security', t.securityTitle, t.securityHint);

  if (audit.grade) {
    c.ensure(70);
    const color = GRADE_COLOR[audit.grade];
    c.page.circle(c.left + 24, c.y + 24, 24, { fill: color });
    c.page.text(audit.grade, c.left + 24, c.y + 32, { font: 'bold', size: 24, color: '#ffffff', align: 'center' });
    c.page.text(t.score(audit.score), c.left + 62, c.y + 18, { font: 'bold', size: 12, color: INK });
    let x = c.left + 62;
    const any = SEVERITY_ORDER.some((s) => audit.counts[s] > 0);
    for (const s of SEVERITY_ORDER) {
      if (!audit.counts[s]) continue;
      const label = t.severityCount(audit.counts[s], s);
      const w = textWidth(label, 'bold', 7.5) + 14;
      c.page.rect(x, c.y + 26, w, 14, { fill: tint(SEVERITY_COLOR[s], 0.85), radius: 7 });
      c.page.text(label, x + 7, c.y + 36, { font: 'bold', size: 7.5, color: SEVERITY_COLOR[s] });
      x += w + 6;
    }
    if (!any) c.page.text(t.noIssues, x, c.y + 36, { size: 8.5, color: MUTED });
    c.y += 64;
  } else if (audit.findings.length === 0) {
    c.paragraph(t.nothingToReview, { color: MUTED });
    return;
  }

  const exposed = [...audit.topology.exposure].filter(([, e]) => e.level === 'internet');
  const port = (p: string) => (/^\d/.test(p) ? `:${p}` : portText(p, locale));
  if (exposed.length) {
    c.heading(t.reachable, String(exposed.length));
    for (const [id, e] of exposed) {
      const name = fitText(nameOf(id), c.width * 0.6, 'bold', 9);
      const dx = c.left + 19 + textWidth(name, 'bold', 9);
      const detail = wrapText(t.openOn(e.ports.map(port).join(', ')), c.left + c.width - dx, 'regular', 9);
      const h = 15 + (detail.length - 1) * 12;
      c.ensure(h);
      c.page.circle(c.left + 4, c.y + 6, 2.6, { fill: TRAFFIC_COLOR.internet });
      c.page.text(name, c.left + 13, baseline(c.y, 9, 12), { font: 'bold', size: 9, color: INK });
      detail.forEach((line, i) => c.page.text(line, dx, baseline(c.y + i * 12, 9, 12), { size: 9, color: MUTED }));
      c.y += h;
      // why: the chain of controls per port, Internet and the resource itself left implicit
      for (const access of (audit.topology.access.get(id)?.open ?? []).slice(0, 8)) {
        const chain = access.paths[0].steps
          .filter((s) => s.kind !== 'internet' && s.kind !== 'resource')
          .map((s) => (s.kind === 'sg' && s.ref ? `${s.title} ${s.ref}` : s.title));
        const label = port(access.ports);
        const lx = c.left + 13;
        const px = lx + Math.max(34, textWidth(label, 'mono', 7.5) + 8);
        const lines = wrapText(t.via(chain.join('  ›  ')), c.left + c.width - px, 'regular', 7.5);
        const lh = 7.5 * LEAD;
        c.ensure(lines.length * lh + 2);
        c.page.text(label, lx, baseline(c.y, 7.5, lh), { font: 'mono', size: 7.5, color: INK });
        lines.forEach((line, i) => c.page.text(line, px, baseline(c.y + i * lh, 7.5, lh), { size: 7.5, color: MUTED }));
        c.y += lines.length * lh + 2;
      }
      c.y += 3;
    }
    c.y += 12;
  }

  if (!audit.findings.length) return;
  c.heading(t.findings, String(audit.findings.length));
  const findings = [...audit.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  for (const [i, f] of findings.entries()) {
    if (i % YIELD_EVERY === YIELD_EVERY - 1) yield;
    const width = c.width - 24;
    const detail = wrapText(f.detail, width, 'regular', 8.5);
    const meta = [t.resource(nameOf(f.resource)), f.fix ? t.suggestedFix(f.fix.label) : ''].filter(Boolean).join('   ·   ');
    const controls = f.controls?.length ? wrapText(t.controls(f.controls.map(controlLabel).join(', ')), width, 'regular', 7.5) : [];
    const h = 16 + detail.length * 8.5 * LEAD + 16 + 12 + controls.length * 10;
    c.ensure(h);
    const color = SEVERITY_COLOR[f.severity];
    c.page.rect(c.left, c.y, c.width, h, { stroke: LINE, lineWidth: 0.7, radius: 5 });
    c.page.rect(c.left, c.y, 3, h, { fill: color, radius: 1.5 });
    const pill = t.severityPill(f.severity);
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
    controls.forEach((line, j) => c.page.text(line, c.left + 12, y + 21 + j * 10, { size: 7.5, color: MUTED }));
    c.y += h + 8;
  }

  // the benchmark controls the findings fail, framework by framework
  const failed = controlsIn(locale).map((control) => ({
    control,
    findings: audit.findings.filter((f) => f.controls?.some((x) => x.framework === control.framework && x.id === control.id)),
  })).filter((x) => x.findings.length);
  if (!failed.length) return;
  c.y += 4;
  c.heading(t.complianceControls, t.failedControls(failed.length));
  c.paragraph(
    t.complianceHint(
      FRAMEWORKS.filter((f) => failed.some((x) => x.control.framework === f.id))
        .map((f) => `${f.name} (${f.version})`)
        .join(', '),
    ),
    { size: 8, color: MUTED, gap: 8 },
  );
  yield* c.table(
    [
      { title: t.colControl, share: 0.2 },
      { title: t.colRequirement, share: 0.56 },
      { title: t.colFindings, share: 0.24 },
    ],
    failed.map(({ control, findings }) => {
      const worst = findings.map((f) => f.severity).sort((a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b))[0];
      return {
        accent: SEVERITY_COLOR[worst],
        cells: [
          [
            { text: control.id, font: 'bold', size: 8.5 },
            { text: frameworkOf(control.framework).short, size: 7, color: FAINT },
          ],
          [{ text: control.title, size: 8 }],
          [{ text: [...new Set(findings.map((f) => nameOf(f.resource)))].join(', '), size: 8, color: MUTED, maxLines: 3 }],
        ],
      } satisfies Row;
    }),
  );
}

// ------------------------------------------------------------------ cost

const COST_KIND_ORDER = { fixed: 0, usage: 1, unknown: 2, free: 3 } as const;
const AMBER = '#b45309';

/** amounts as bars: a label, a bar sized against the largest, the amount */
function costBars(c: Cursor, groups: Array<{ label: string; color: PdfColor; monthly: number; note?: string; text?: string }>, locale: Locale) {
  const most = Math.max(0.01, ...groups.map((g) => g.monthly));
  const labelW = 150;
  const amountW = 64;
  const barW = c.width - labelW - amountW - 12;
  for (const g of groups) {
    c.ensure(17);
    const label = fitText(g.label, labelW - 8, 'regular', 9);
    c.page.text(label, c.left, baseline(c.y, 9, 13), { size: 9, color: INK });
    if (g.note) {
      c.page.text(fitText(g.note, labelW - 14 - textWidth(label, 'regular', 9), 'regular', 7.5), c.left + textWidth(label, 'regular', 9) + 6, baseline(c.y, 9, 13), { size: 7.5, color: FAINT });
    }
    c.page.rect(c.left + labelW, c.y + 3, barW, 7, { fill: SOFT, radius: 3.5 });
    if (g.monthly > 0) c.page.rect(c.left + labelW, c.y + 3, Math.max(7, (barW * g.monthly) / most), 7, { fill: g.color, radius: 3.5 });
    c.page.text(g.text ?? usd(g.monthly, locale), c.left + c.width, baseline(c.y, 9, 13), g.text ? { size: 8, color: MUTED, align: 'right' } : { font: 'bold', size: 9, color: INK, align: 'right' });
    c.y += 17;
  }
  c.y += 10;
}

function costRow(item: ResourceCost, locale: Locale): Row {
  const t = messagesFor(docMessages, locale);
  const how: Run[] =
    item.kind === 'fixed'
      ? [
          ...item.breakdown.map((l) => ({ text: describeLine(l, locale), size: 7.5, color: INK, maxLines: 2 })),
          ...item.assumptions.slice(0, 3).map((a) => ({ text: a, size: 7, color: FAINT, maxLines: 2 })),
        ]
      : [{ text: item.note ?? '', size: 7.5, color: MUTED, maxLines: 4 }];
  const one = item.breakdown.reduce((sum, l) => sum + l.monthly, 0);
  const amount: Run[] =
    item.kind === 'fixed'
      ? [
          { text: usd(item.monthly ?? 0, locale), font: 'bold', size: 8.5 },
          ...(item.count !== 1 ? [{ text: `${item.count} × ${usd(one, locale)}`, size: 7, color: FAINT }] : []),
        ]
      : [{ text: item.kind === 'usage' ? t.kindUsage : t.kindUnknown, font: 'bold', size: 7.5, color: item.kind === 'usage' ? PRIMARY : AMBER }];
  return {
    cells: [
      [
        { text: item.name, font: 'bold' },
        { text: item.type, font: 'mono', size: 6.6, color: FAINT, url: docsUrl(item.type) },
      ],
      [{ text: serviceName(item.type, locale) }, ...(item.region ? [{ text: item.region, size: 7, color: FAINT }] : [])],
      how,
      amount,
    ],
  };
}

/** the estimate: headline, totals by category (and cloud), a row per resource, then every assumption */
function* costEstimate(c: Cursor, cost: ProjectCost, locale: Locale): Generator<void, void> {
  const t = messagesFor(docMessages, locale);
  c.section('cost', t.costTitle, t.costHint);
  const { counts, total } = cost;
  const clouds = cost.byProvider.filter((g): g is typeof g & { key: CloudProvider } => g.key !== 'other');

  // headline
  const extras = [counts.usage ? t.usageBased(counts.usage) : '', counts.unknown ? t.notEstimated(counts.unknown) : ''].filter(Boolean);
  const summary = `${counts.fixed ? t.pricedFor(usd(total, locale), counts.fixed) : t.nothingFixed}${t.plus(extras)}.`;
  const dates = clouds.map((g) => t.pricesOn(providerName(g.key, locale), g.region, priceDate(g.retrieved ?? '', locale)));
  const lines = wrapText(summary, c.width - 190, 'regular', 8.5);
  const h = Math.max(58, 40 + lines.length * 12, 20 + dates.length * 11);
  c.ensure(h);
  c.page.rect(c.left, c.y, c.width, h, { stroke: LINE, lineWidth: 0.8, radius: 6 });
  c.page.rect(c.left, c.y, 3, h, { fill: '#10b981', radius: 1.5 });
  const big = approx(counts.fixed ? total : 0, locale);
  c.page.text(big, c.left + 16, c.y + 27, { font: 'bold', size: 20, color: INK });
  c.page.text(t.perMonth, c.left + 22 + textWidth(big, 'bold', 20), c.y + 27, { size: 9.5, color: MUTED });
  lines.forEach((line, i) => c.page.text(line, c.left + 16, c.y + 43 + i * 12, { size: 8.5, color: MUTED }));
  dates.forEach((d, i) =>
    c.page.text(fitText(d, 170, 'regular', 7.5), c.left + c.width - 12, c.y + 18 + i * 11, { size: 7.5, color: FAINT, align: 'right' }),
  );
  c.y += h + 18;

  const categories = cost.byCategory.filter((g) => g.monthly > 0);
  if (categories.length) {
    c.heading(t.byCategory);
    costBars(
      c,
      categories.map((g) => ({ label: categoryLabel(g.key, locale), color: categoryColor(g.key), monthly: g.monthly })),
      locale,
    );
  }
  if (clouds.length > 1) {
    c.heading(t.byCloud);
    costBars(
      c,
      clouds.map((g) => ({
        label: providerName(g.key, locale),
        note: g.region,
        color: PROVIDER_COLOR[g.key],
        monthly: g.monthly,
        text: g.priced ? undefined : t.noFixedPrice,
      })),
      locale,
    );
  }

  // one row per resource that costs (or may cost) something, grouped by category
  const charged = cost.items.filter((i) => i.kind !== 'free');
  if (charged.length) {
    c.heading(t.byResource, t.resources(charged.length));
    const rows: Row[] = [];
    for (const k of [...CATEGORY_ORDER, 'other'] as CategoryKey[]) {
      const list = charged
        .filter((i) => i.category === k)
        .sort((a, b) => COST_KIND_ORDER[a.kind] - COST_KIND_ORDER[b.kind] || (b.monthly ?? 0) - (a.monthly ?? 0));
      if (!list.length) continue;
      const subtotal = cost.byCategory.find((g) => g.key === k)?.monthly ?? 0;
      rows.push({ cells: [], group: { label: categoryLabel(k, locale), color: categoryColor(k), note: subtotal > 0 ? usd(subtotal, locale) : undefined } });
      for (const item of list) rows.push(costRow(item, locale));
    }
    yield* c.table(
      [
        { title: t.colResource, share: 0.24 },
        { title: t.colService, share: 0.18 },
        { title: t.colHow, share: 0.43 },
        { title: t.colPerMonth, share: 0.15 },
      ],
      rows,
    );
    if (counts.fixed) {
      c.ensure(20);
      const label = t.total;
      const amount = t.totalAmount(usd(total, locale));
      c.page.text(amount, c.left + c.width, baseline(c.y, 10, 14), { font: 'bold', size: 10, color: INK, align: 'right' });
      c.page.text(label, c.left + c.width - textWidth(amount, 'bold', 10) - 12, baseline(c.y, 9, 14), { size: 9, color: MUTED, align: 'right' });
      c.y += 26;
    }
  }

  const freeItems = cost.items.filter((i) => i.kind === 'free');
  if (freeItems.length) {
    const names = new Map<string, number>();
    for (const i of freeItems) names.set(shortName(i.type, locale), (names.get(shortName(i.type, locale)) ?? 0) + 1);
    const list = [...names].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ');
    c.paragraph(t.noCharge(freeItems.length, list), { size: 8, color: MUTED, gap: 12 });
  }

  c.heading(t.assumptions);
  for (const a of cost.assumptions) c.paragraph(`•  ${a}`, { size: 8, color: MUTED, gap: 2 });
  c.y += 6;
  c.paragraph(t.notAQuote, { size: 8, color: INK, gap: 6 });
  const hosts = clouds.map((g) => {
    const names = [...new Set(PRICE_BOOK[g.key].meta.sources.map((s) => s.replace(/^https?:\/\/([^/]+).*$/, '$1')))];
    return `${providerName(g.key, locale)}: ${names.join(', ')}`;
  });
  if (hosts.length) c.paragraph(t.sources(hosts.join('; ')), { size: 7, color: FAINT });
}

/** `# @blueprint:pos=…` lines only matter to the editor */
const LAYOUT_COMMENT = /^\s*(?:#|\/\/)\s*@blueprint:/;

/** the lines of a file worth printing, with their line numbers in the file */
export function sourceLines(text: string): Array<{ no: number; text: string }> {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((line, i) => ({ no: i + 1, text: line.replace(/\t/g, '  ') }))
    .filter((l) => !LAYOUT_COMMENT.test(l.text));
}

function* sourceCode(c: Cursor, input: ArchDocInput, locale: Locale): Generator<void, void> {
  const t = messagesFor(docMessages, locale);
  const files = input.files.filter(([, text]) => text.trim());
  if (!files.length) return;
  c.newPage();
  c.section('code', t.sourceTitle, t.sourceHint(files.length));
  const size = 7;
  const lh = size * 1.42;
  for (const [name, text] of files) {
    const lines = sourceLines(text);
    // wide enough for the longest line number, right-aligned 8 pt before the code
    const digits = String(lines[lines.length - 1]?.no ?? 1).length;
    const gutter = Math.max(26, digits * size * 0.6 + 10);
    c.heading(name, t.lines(lines.length));
    for (const [i, line] of lines.entries()) {
      if (i % (YIELD_EVERY * 10) === YIELD_EVERY * 10 - 1) yield;
      const comment = /^\s*(?:#|\/\/)/.test(line.text);
      splitToWidth(line.text, c.width - gutter, 'mono', size).forEach((chunk, j) => {
        // a file heading keeps its first few lines
        c.ensure(i === 0 && j === 0 ? lh * 3 : lh);
        if (j === 0) c.page.text(String(line.no), c.left + gutter - 8, baseline(c.y, size, lh), { font: 'mono', size, color: FAINT, align: 'right' });
        c.page.text(chunk, c.left + gutter, baseline(c.y, size, lh), { font: 'mono', size, color: comment ? '#64748b' : INK });
        c.y += lh;
      });
    }
    c.y += 14;
  }
}

/** run a section, announcing `label` every time it pauses */
function* step(label: string, work: Generator<void, void>): Generator<string, void> {
  yield label;
  for (let s = work.next(); !s.done; s = work.next()) yield label;
}

function footers(doc: PdfDocument, title: string, t: DocMessages) {
  doc.pages.forEach((page, i) => {
    const y = page.height - FOOTER_BASELINE;
    const number = t.page(i + 1, doc.pageCount);
    page.text(fitText(title, page.width - MARGIN * 2 - textWidth(number, 'regular', 7.5) - 24, 'regular', 7.5), MARGIN, y, { size: 7.5, color: FAINT });
    page.text(number, page.width - MARGIN, y, { size: 7.5, color: FAINT, align: 'right' });
  });
}

// ------------------------------------------------------------------ entry

/** the document, built in steps; each `yield` names the next step */
function* build(input: ArchDocInput): Generator<string, Uint8Array> {
  const locale = input.locale ?? currentLocale();
  const t = messagesFor(docMessages, locale);
  const { ir, edges } = input;
  const doc = new PdfDocument(
    {
      title: input.title,
      subject: t.subject,
      creator: 'Cloud Blueprint',
      created: input.generatedAt,
    },
    input.compress ?? true,
  );
  const providers = providerSummary(ir)
    .map((p) => (p.regions.length ? `${providerName(p.provider, locale)} (${p.regions.join(', ')})` : providerName(p.provider, locale)))
    .join(' + ');
  const meta = [providers, t.resources(ir.resources.length), t.connections(edges.length), formatDocDate(input.generatedAt, locale)]
    .filter(Boolean)
    .join('   ·   ');
  yield t.drawing;
  yield* diagramPages(doc, input, meta, locale);

  const hasVars = ir.variables.length > 0 || ir.outputs.length > 0;
  const toc: TocEntry[] = [
    { key: 'diagram', title: t.diagram },
    { key: 'overview', title: t.overview },
    ...(input.sections.inventory ? [{ key: 'inventory', title: t.inventory }] : []),
    ...(input.sections.inventory && hasVars ? [{ key: 'variables', title: t.variablesOutputs }] : []),
    ...(input.sections.inventory && ir.modules.length > 0 ? [{ key: 'modules', title: messagesFor(pdfModuleMessages, locale).title }] : []),
    ...(input.sections.connections ? [{ key: 'connections', title: t.connectionsTitle }] : []),
    ...(input.sections.security ? [{ key: 'security', title: t.securityTitle }] : []),
    ...(input.sections.cost ? [{ key: 'cost', title: t.costTitle }] : []),
    ...(input.sections.code && input.files.some(([, text]) => text.trim()) ? [{ key: 'code', title: t.sourceTitle }] : []),
  ];

  const paper = PAPER[input.paper];
  const c = new Cursor(doc, paper);
  const cost = input.sections.cost ? estimateProject(ir, PRICE_BOOK, locale) : null;
  yield t.writingOverview;
  const contents = overview(c, input, toc, cost, locale);
  if (input.sections.inventory) yield* step(t.writingInventory, inventory(c, input, locale));
  if (input.sections.inventory && ir.modules.length > 0) {
    yield* step(messagesFor(pdfModuleMessages, locale).writing, modulesSection(c, ir, locale));
  }
  if (input.sections.connections) yield* step(t.writingConnections, connections(c, input, locale));
  if (input.sections.security) yield* step(t.writingSecurity, security(c, input, locale));
  if (cost) yield* step(t.estimating, costEstimate(c, cost, locale));
  if (input.sections.code) yield* step(t.addingSource, sourceCode(c, input, locale));
  c.flush();

  // now every section has a page: fill in the table of contents
  for (const { entry, y } of contents.rows) {
    const target = entry.key === 'diagram' ? { page: doc.pages[0], y: 0 } : c.sections.get(entry.key);
    if (!target) continue;
    const label = String(target.page.index + 1);
    const nw = textWidth(label, 'bold', 9.5);
    const title = fitText(entry.title, c.width - nw - 20, 'regular', 9.5);
    const tw = textWidth(title, 'regular', 9.5);
    contents.page.text(title, c.left, baseline(y, 9.5, 13), { size: 9.5, color: PRIMARY });
    contents.page.line(c.left + tw + 6, y + 9.5, c.left + c.width - nw - 6, y + 9.5, { color: LINE, width: 0.8, dash: [1, 2] });
    contents.page.text(label, c.left + c.width, baseline(y, 9.5, 13), { font: 'bold', size: 9.5, color: INK, align: 'right' });
    // land on the section title, like its bookmark
    contents.page.linkTo(c.left, y, c.width, 14, target.page, Math.max(0, target.y - 6));
  }

  footers(doc, input.title, t);
  // compressing is the heaviest step: a page at a time
  const saving = doc.saveSteps();
  for (let step = saving.next(); ; step = saving.next()) {
    if (step.done) return step.value;
    yield t.saving;
  }

}

export function buildArchitecturePdf(input: ArchDocInput): Uint8Array {
  const steps = build(input);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The same document, built a step at a time: the browser gets the main
 * thread back between steps, `onStage` names each one and `signal` cancels.
 */
export async function buildArchitecturePdfAsync(
  input: ArchDocInput,
  { signal, onStage }: { signal?: AbortSignal; onStage?: (label: string) => void } = {},
): Promise<Uint8Array> {
  const steps = build(input);
  let step = steps.next();
  while (!step.done) {
    onStage?.(step.value);
    await new Promise((r) => setTimeout(r, 0));
    if (signal?.aborted) throw new DOMException('The export was cancelled', 'AbortError');
    step = steps.next();
  }
  return step.value;
}
