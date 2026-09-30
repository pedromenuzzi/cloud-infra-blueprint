/**
 * Minimal-patch engine: canvas ops → smallest possible text edits.
 *
 * The parser records source spans for every block (header, labels, the
 * position comment, each argument and nested block). A touched block is
 * diffed against its previous IR and only the changed pieces are spliced: a
 * move rewrites the `# @blueprint:pos` line, set/unset rewrites one argument,
 * a rename one label. Whole blocks are emitted only when they are new (or too
 * irregular to splice). Every other byte of the user's files stays untouched.
 *
 * Spans are trusted only while each block's recorded text still sits at its
 * range: when the IR is stale (the code changed and no longer parses) the
 * patch is refused instead of splicing into the wrong bytes. A patch that
 * would lose a block or add parse errors is refused too.
 */
import { messagesFor } from '@/i18n/messages';
import { exprEquals, renameInExpression, renameInHcl } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import { applyOps } from '@/ir/ops';
import type {
  BlockSpans,
  BodySpans,
  CanvasPosition,
  Diagnostic,
  EntrySpan,
  Expression,
  IR,
  OutputDecl,
  ProviderBlock,
  RawBlock,
  ResourceNode,
  VariableDecl,
} from '@/ir/types';
import {
  DEFAULT_FILES,
  emitExpression,
  emitLabel,
  emitNestedBlock,
  emitOutput,
  emitProvider,
  emitRawBlock,
  emitResource,
  emitValueLike,
  emitVariable,
  posComment,
  quoteKey,
} from './emitter';
import type { ParsedBlock, ParsedFile, ParseFileResult } from './parser';
import {
  buildIR,
  parseBlocksAt,
  parseExpressionText,
  parseFile,
  parseProject,
  posFromComment,
  shiftParsedBlock,
} from './parser';
import { CommentsWouldBeLost, keepComments, lostComments } from './keepComments';
import { hclMessages, type StaleReason } from './messages';

interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface PatchRefusal {
  file: string;
  /** why nothing was written, ready to show to the user */
  message: string;
}

export interface PatchOutcome {
  files: Record<string, string>;
  ir: IR;
  diagnostics: Diagnostic[];
  renamed: Map<string, string>;
  /** set when the ops were NOT applied: `files` and `ir` are the inputs, unchanged */
  refused?: PatchRefusal;
}

type Block =
  | { kind: 'resource'; node: ResourceNode }
  | { kind: 'variable'; node: VariableDecl }
  | { kind: 'output'; node: OutputDecl }
  | { kind: 'provider'; node: ProviderBlock }
  | { kind: 'extra'; node: RawBlock };

function blocksOf(ir: IR): Block[] {
  return [
    ...ir.resources.map((node) => ({ kind: 'resource' as const, node })),
    ...ir.variables.map((node) => ({ kind: 'variable' as const, node })),
    ...ir.outputs.map((node) => ({ kind: 'output' as const, node })),
    ...ir.providers.map((node) => ({ kind: 'provider' as const, node })),
    ...ir.extras.map((node) => ({ kind: 'extra' as const, node })),
  ];
}

function emitBlock(b: Block): string {
  switch (b.kind) {
    case 'resource':
      return emitResource(b.node);
    case 'variable':
      return emitVariable(b.node);
    case 'output':
      return emitOutput(b.node);
    case 'provider':
      return emitProvider(b.node);
    case 'extra':
      return emitRawBlock(b.node);
  }
}

function defaultFile(b: Block): string {
  if (b.kind !== 'extra') return DEFAULT_FILES[b.kind];
  return /^\s*terraform\b/.test(b.node.text) ? DEFAULT_FILES.terraform : DEFAULT_FILES.resource;
}

/** Blocks are identified by where they were parsed from — ids can repeat or change. */
function keyOf(b: Block): string | undefined {
  const { rawTextRange, sourceFile } = b.node.trivia;
  return rawTextRange && sourceFile !== undefined ? `${sourceFile}\u0000${rawTextRange.start}` : undefined;
}

// ------------------------------------------------------------ text helpers

interface FileCtx {
  text: string;
  eol: string;
  /** renames done by this batch of ops (old address → new) */
  renamed: Map<string, string>;
}

function eolOf(text: string): string {
  const nl = text.indexOf('\n');
  return nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
}

/** emitted snippets use `\n`; CRLF files get CRLF back */
function withEol(s: string, eol: string): string {
  return eol === '\n' ? s : s.replace(/\r?\n/g, eol);
}

/** start of the line holding `offset` (a leading BOM stays in front of everything) */
function lineStart(text: string, offset: number): number {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return start === 0 && offset > 0 && text.charCodeAt(0) === 0xfeff ? 1 : start;
}

function nextLine(text: string, offset: number): number {
  const nl = text.indexOf('\n', offset);
  return nl === -1 ? text.length : nl + 1;
}

const BLANK_LINE_RE = /^[ \t\r]*\n?$/;
const BLANK_LINES_RE = /^(?:[ \t\r]*\n)*$/;

function isBlankLine(text: string, from: number, to: number): boolean {
  return BLANK_LINE_RE.test(text.slice(from, to));
}

function indentAt(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, offset), offset))![0];
}

/** true when [from, to) holds only whitespace and comments */
function onlyTrivia(text: string, from: number, to: number): boolean {
  let i = from;
  while (i < to) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff) {
      i++;
    } else if (c === 35 || (c === 47 && text.charCodeAt(i + 1) === 47)) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 || nl > to ? to : nl;
    } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1 || end + 2 > to) return false;
      i = end + 2;
    } else {
      return false;
    }
  }
  return true;
}

/** Apply non-overlapping edits in one ascending pass; null when two overlap. */
function applyEdits(source: string, edits: Edit[]): string | null {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: string[] = [];
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) return null;
    parts.push(source.slice(cursor, e.start), e.text);
    cursor = e.end;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

function disjoint(edits: Edit[]): boolean {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.every((e, i) => i === 0 || e.start >= sorted[i - 1].end);
}

/**
 * Widen a removed line range over the blank lines around it — the only
 * normalization, and only at the seam: one blank line survives between
 * neighbours, none at the start or end of the region.
 */
function widenOverBlankLines(text: string, start: number, end: number, lo: number, hi: number): Edit {
  let top = start;
  let before = 0;
  while (top > lo) {
    const prev = lineStart(text, top - 1);
    if (!isBlankLine(text, prev, top)) break;
    top = prev;
    before++;
  }
  let bottom = end;
  let after = 0;
  while (bottom < hi) {
    const next = nextLine(text, bottom);
    if (next === bottom || !isBlankLine(text, bottom, next)) break;
    bottom = next;
    after++;
  }
  const keep = top <= lo || bottom >= hi ? 0 : Math.max(before, after);
  let surplus = before + after - keep;
  let newEnd = end;
  for (; surplus > 0 && newEnd < bottom; surplus--) newEnd = nextLine(text, newEnd);
  let newStart = start;
  for (; surplus > 0 && newStart > top; surplus--) newStart = lineStart(text, newStart - 1);
  return { start: newStart, end: newEnd, text: '' };
}

/** Remove whole-line ranges inside [lo, hi), merging neighbours separated only by blank lines. */
function removeLines(text: string, ranges: Array<[number, number]>, lo: number, hi: number): Edit[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && (start <= last[1] || BLANK_LINES_RE.test(text.slice(last[1], start)))) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged.map(([start, end]) => widenOverBlankLines(text, start, end, lo, hi));
}

/** The lines strictly inside a body, or null when `{` / `}` share a line with other tokens. */
function bodyInner(text: string, body: BodySpans): { lo: number; hi: number } | null {
  if (body.close < 0) return null;
  const lo = nextLine(text, body.open);
  const hi = lineStart(text, body.close);
  if (lo > hi || !onlyTrivia(text, body.open + 1, lo)) return null;
  if (!/^[ \t]*$/.test(text.slice(hi, body.close))) return null;
  return { lo, hi };
}

type LineKind = 'blank' | 'close' | 'other';

function lineKindAt(text: string, offset: number): LineKind {
  const line = text.slice(offset, nextLine(text, offset)).trim();
  if (line === '') return 'blank';
  return line.startsWith('}') ? 'close' : 'other';
}

// ------------------------------------------------------------ alignment

const keyWidth = (e: EntrySpan) => e.keyEnd - e.keyStart;
const eqColumn = (text: string, e: EntrySpan) => e.eq! - lineStart(text, e.eq!);

function alignable(text: string, e: EntrySpan): boolean {
  if (e.kind !== 'attr' || e.inline || e.eq === undefined) return false;
  const nl = text.indexOf('\n', e.keyStart);
  return nl === -1 || nl >= e.contentEnd;
}

/** Runs of consecutive single-line attributes (no blank or comment line between): what `=` aligns across. */
function alignmentRuns(text: string, entries: EntrySpan[]): EntrySpan[][] {
  const runs: EntrySpan[][] = [];
  let run: EntrySpan[] = [];
  for (const e of entries) {
    const ok = alignable(text, e);
    const prev = run[run.length - 1];
    const chained = ok && prev !== undefined && e.start === prev.end && e.start === lineStart(text, e.keyStart);
    if (!chained && run.length > 0) {
      runs.push(run);
      run = [];
    }
    if (ok) run.push(e);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

const isAligned = (text: string, run: EntrySpan[]) =>
  run.every((e) => eqColumn(text, e) === eqColumn(text, run[0]));

// ------------------------------------------------------------ body diff

const isBlockish = (e: Expression) => e.kind === 'block' || e.kind === 'blocks';
/** keys of verbatim sub-blocks (`provisioner "x" #0`), see the parser */
const RAW_ENTRY_KEY_RE = /[\s"]/;
const itemsOf = (e: Expression) => (e.kind === 'block' ? [e.body] : e.kind === 'blocks' ? e.items : []);
const bodiesEqual = (a: Record<string, Expression>, b: Record<string, Expression>) =>
  a === b || exprEquals({ kind: 'block', body: a }, { kind: 'block', body: b });

/**
 * When a value changed only because a resource it references was renamed,
 * rewrite those tokens in its original text (keeping layout and comments).
 */
function renamedInPlace(ctx: FileCtx, o: Expression, n: Expression, previous: string): string | null {
  if (ctx.renamed.size === 0) return null;
  let expected = o;
  let text = previous;
  for (const [from, to] of ctx.renamed) {
    expected = renameInExpression(expected, from, to);
    text = renameInHcl(text, from, to);
  }
  return exprEquals(expected, n) ? text : null;
}

/** a line without its trailing `#` / `//` comment (quote-aware) */
function codeOf(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '#' || line.startsWith('//', i))) return line.slice(0, i);
  }
  return line;
}

/**
 * Connect / disconnect on a list written one item per line: add or drop item
 * lines instead of re-emitting the list, so comments on the other items
 * survive. The candidate is re-parsed and used only if it means exactly `n`.
 */
function editListLines(o: Expression, n: Expression, previous: string, indent: string): string | null {
  if (o.kind !== 'list' || n.kind !== 'list' || !previous.includes('\n')) return null;
  const lines = previous.split('\n');
  if (!/^[ \t]*\][ \t]*$/.test(lines[lines.length - 1])) return null;
  const inner = lines.slice(1, -1);
  let candidate: string[];
  if (n.items.length > o.items.length && o.items.every((item, i) => exprEquals(item, n.items[i]))) {
    const lastCode = codeOf([lines[0], ...inner].filter((l) => l.trim() !== '').pop()!).trim();
    if (!lastCode.endsWith(',') && !lastCode.endsWith('[')) return null;
    const itemIndent = inner.length > 0 ? /^[ \t]*/.exec(inner[0])![0] : `${indent}  `;
    const added = n.items.slice(o.items.length).map((item) => `${itemIndent}${emitExpression(item, itemIndent)},`);
    candidate = [...lines.slice(0, -1), ...added, lines[lines.length - 1]];
  } else if (n.items.length < o.items.length) {
    const gone = o.items.filter((item) => !n.items.some((kept) => exprEquals(kept, item)));
    const texts = gone.map((item) => emitExpression(item, indent));
    const keep = inner.filter((line) => {
      const i = texts.indexOf(codeOf(line).trim().replace(/,$/, '').trim());
      if (i === -1) return true;
      texts.splice(i, 1);
      return false;
    });
    candidate = [lines[0], ...keep, lines[lines.length - 1]];
  } else {
    return null;
  }
  const text = candidate.join('\n');
  const parsed = parseExpressionText(text);
  return parsed && exprEquals(parsed, n) ? text : null;
}

function renderBlocks(key: string, e: Expression, indent: string): string {
  return itemsOf(e)
    .map((body) => emitNestedBlock(key, body, indent).join('\n'))
    .join('\n\n');
}

/**
 * Splice the differences between two argument records into a body: changed
 * values are replaced in place, removed entries lose their lines, new
 * attributes go after the last attribute and new blocks at the end. Returns
 * false when the layout doesn't allow line-level edits (single-line bodies…).
 */
function patchBody(
  ctx: FileCtx,
  oldArgs: Record<string, Expression>,
  newArgs: Record<string, Expression>,
  body: BodySpans,
  parentIndent: string,
  edits: Edit[],
): boolean {
  const { text, eol } = ctx;
  const byKey = new Map<string, EntrySpan[]>();
  for (const e of body.entries) {
    const list = byKey.get(e.key);
    if (list) list.push(e);
    else byKey.set(e.key, [e]);
  }
  const firstLine = body.entries.find((e) => !e.inline);
  const indent = firstLine ? indentAt(text, firstLine.keyStart) : parentIndent + '  ';

  const deleted = new Set<EntrySpan>();
  const newAttrs: Array<[string, Expression]> = [];
  const newBlocks: string[] = [];

  for (const key of new Set([...Object.keys(oldArgs), ...Object.keys(newArgs)])) {
    const o = oldArgs[key];
    const n = newArgs[key];
    if (o !== undefined && n !== undefined && (o === n || exprEquals(o, n))) continue;
    const spans = byKey.get(key) ?? [];
    if (o !== undefined && spans.length === 0) return false;
    if (n === undefined) {
      for (const s of spans) deleted.add(s);
      continue;
    }
    if (o === undefined || isBlockish(o) !== isBlockish(n)) {
      // new entry (or an attribute that became a block, or back)
      for (const s of spans) deleted.add(s);
      if (isBlockish(n)) newBlocks.push(renderBlocks(key, n, indent));
      else if (RAW_ENTRY_KEY_RE.test(key) && n.kind === 'raw') newBlocks.push(indent + n.hcl);
      else newAttrs.push([key, n]);
      continue;
    }
    if (isBlockish(o)) {
      const blockSpans = spans.filter((s) => s.kind === 'block');
      if (!patchBlockItems(ctx, key, itemsOf(o), itemsOf(n), blockSpans, edits, deleted)) return false;
      continue;
    }
    // an attribute (or a verbatim sub-block) changed; with duplicates the last one is in the IR
    const span = spans.filter((s) => s.kind !== 'block').pop();
    if (!span) return false;
    if (span.kind === 'raw') {
      if (o.kind !== 'raw' || n.kind !== 'raw') return false;
      edits.push({ start: span.keyStart, end: span.keyStart + o.hcl.length, text: withEol(n.hcl, eol) });
      continue;
    }
    const previous = text.slice(span.valueStart!, span.valueEnd!);
    const at = indentAt(text, span.keyStart);
    let value = renamedInPlace(ctx, o, n, previous) ?? editListLines(o, n, previous, at);
    if (value === null) {
      // comments inside the value aren't in the IR: edit its text around them, or refuse
      const kept = keepComments(o, n, previous, at);
      if (kept === null) throw new CommentsWouldBeLost(key);
      value = kept ?? emitValueLike(n, at, previous);
    }
    edits.push({ start: span.valueStart!, end: span.valueEnd!, text: withEol(value, eol) });
  }

  if (deleted.size === 0 && newAttrs.length === 0 && newBlocks.length === 0) return true;
  if ([...deleted].some((e) => e.inline)) return false;
  const inner = bodyInner(text, body);

  if (deleted.size > 0) {
    if (!inner) return false;
    const ranges = [...deleted].map((e): [number, number] => [e.start, e.end]);
    edits.push(...removeLines(text, ranges, inner.lo, inner.hi));
  }

  // `=` alignment: re-align only the runs that lose or gain an attribute, and only if they were aligned
  const attrs = body.entries.filter((e) => e.kind === 'attr' && !deleted.has(e));
  const anchor = attrs[attrs.length - 1];
  const rendered = newAttrs.map(([key, value]) => ({ key: quoteKey(key), value: emitExpression(value, indent) }));
  const singleLine = rendered.filter((r) => !r.value.includes('\n'));
  const runs = alignmentRuns(text, body.entries);
  const anchorRun = anchor ? runs.find((r) => r.includes(anchor)) : undefined;
  let newWidth = anchorRun ? 0 : Math.max(0, ...singleLine.map((r) => r.key.length));
  for (const run of runs) {
    const joins = run === anchorRun && singleLine.length > 0;
    const survivors = run.filter((e) => !deleted.has(e));
    if ((survivors.length === run.length && !joins) || !isAligned(text, run)) continue;
    const width = Math.max(0, ...survivors.map(keyWidth), ...(joins ? singleLine.map((r) => r.key.length) : []));
    for (const e of survivors) {
      const gap = width - keyWidth(e) + 1;
      if (e.eq! - e.keyEnd !== gap) edits.push({ start: e.keyEnd, end: e.eq!, text: ' '.repeat(gap) });
    }
    if (joins) newWidth = width;
  }

  if (rendered.length > 0) {
    let at: number;
    if (anchor) {
      if (anchor.inline || text[anchor.end - 1] !== '\n') return false;
      at = anchor.end;
    } else {
      if (!inner) return false;
      at = inner.lo;
    }
    const lines = rendered.map(({ key, value }) => {
      const gap = value.includes('\n') || newWidth === 0 ? 1 : Math.max(1, newWidth - key.length + 1);
      return `${indent}${key}${' '.repeat(gap)}= ${value}\n`;
    });
    // attributes put at the top of a body that only has blocks get a blank line after them
    const spacer = !anchor && body.entries.some((e) => !deleted.has(e)) ? '\n' : '';
    edits.push({ start: at, end: at, text: withEol(lines.join('') + spacer, eol) });
  }

  if (newBlocks.length > 0) {
    if (!inner) return false;
    const at = inner.hi;
    const hasContent = rendered.length > 0 || body.entries.some((e) => !deleted.has(e));
    const prevBlank = at > inner.lo && isBlankLine(text, lineStart(text, at - 1), at);
    const lead = hasContent && !prevBlank ? '\n' : '';
    edits.push({ start: at, end: at, text: withEol(`${lead}${newBlocks.join('\n\n')}\n`, eol) });
  }
  return true;
}

/** Diff repeated nested blocks item by item, so interleaved `ingress`/`egress` keep their order. */
function patchBlockItems(
  ctx: FileCtx,
  key: string,
  oldItems: Array<Record<string, Expression>>,
  newItems: Array<Record<string, Expression>>,
  spans: EntrySpan[],
  edits: Edit[],
  deleted: Set<EntrySpan>,
): boolean {
  const { text, eol } = ctx;
  if (spans.length !== oldItems.length) return false;
  for (let i = 0; i < Math.min(oldItems.length, newItems.length); i++) {
    if (bodiesEqual(oldItems[i], newItems[i])) continue;
    const span = spans[i];
    const indent = indentAt(text, span.keyStart);
    const itemEdits: Edit[] = [];
    if (
      span.body &&
      !span.inline &&
      patchBody(ctx, oldItems[i], newItems[i], span.body, indent, itemEdits) &&
      disjoint(itemEdits)
    ) {
      edits.push(...itemEdits);
      continue;
    }
    // irregular layout: re-emit just this nested block (its first line starts at the key)
    const block = emitNestedBlock(key, newItems[i], indent).join('\n').slice(indent.length);
    const end = span.body ? span.body.close + 1 : span.contentEnd;
    if (lostComments(text.slice(span.keyStart, end), block).length > 0) throw new CommentsWouldBeLost(key);
    edits.push({ start: span.keyStart, end, text: withEol(block, eol) });
  }
  for (let i = newItems.length; i < oldItems.length; i++) deleted.add(spans[i]);
  if (newItems.length > oldItems.length) {
    const last = spans[spans.length - 1];
    if (last.inline || text[last.end - 1] !== '\n') return false;
    const indent = indentAt(text, last.keyStart);
    const added = newItems
      .slice(oldItems.length)
      .map((body) => emitNestedBlock(key, body, indent).join('\n'))
      .join('\n\n');
    const after = lineKindAt(text, last.end) === 'other' ? '\n' : '';
    edits.push({ start: last.end, end: last.end, text: withEol(`\n${added}\n${after}`, eol) });
  }
  return true;
}

// ------------------------------------------------------------ blocks

function writePosition(ctx: FileCtx, spans: BlockSpans, position: CanvasPosition, edits: Edit[]): boolean {
  const comment = posComment(position);
  if (spans.pos) {
    if (ctx.text.slice(spans.pos.start, spans.pos.end) !== comment) {
      edits.push({ start: spans.pos.start, end: spans.pos.end, text: comment });
    }
    return true;
  }
  // no position yet: its own line right above the header (below the block's comments)
  const at = lineStart(ctx.text, spans.header);
  const indent = ctx.text.slice(at, spans.header);
  if (!/^[ \t]*$/.test(indent)) return false;
  edits.push({ start: at, end: at, text: indent + comment + ctx.eol });
  return true;
}

function spliceBlock(ctx: FileCtx, old: Block, next: Block, edits: Edit[]): boolean {
  const spans = old.node.trivia.spans;
  if (!spans || old.kind !== next.kind) return false;
  if (old.node.trivia.leadingComments.join('\n') !== next.node.trivia.leadingComments.join('\n')) {
    return false;
  }
  if (old.kind === 'extra') {
    const { text } = next.node as RawBlock;
    if (text !== old.node.text) {
      edits.push({ start: spans.header, end: spans.header + old.node.text.length, text: withEol(text, ctx.eol) });
    }
    return true;
  }
  if (old.kind === 'resource') {
    const o = old.node;
    const n = next.node as ResourceNode;
    if (o.type !== n.type) return false;
    if (o.name !== n.name) {
      const label = spans.labels[1];
      if (!label) return false;
      edits.push({ start: label.start, end: label.end, text: emitLabel(n.name, !label.quoted) });
    }
    // a new position object means the node was moved (set_arg & co. keep the old one)
    if (n.position && n.position !== o.position && !writePosition(ctx, spans, n.position, edits)) {
      return false;
    }
  } else if (old.node.name !== (next.node as typeof old.node).name) {
    return false;
  }
  const indent = indentAt(ctx.text, spans.header);
  return patchBody(ctx, old.node.args, (next.node as typeof old.node).args, spans.body, indent, edits);
}

function patchBlock(ctx: FileCtx, old: Block, next: Block): Edit[] {
  const edits: Edit[] = [];
  if (spliceBlock(ctx, old, next, edits) && disjoint(edits)) return edits;
  // too irregular to splice (e.g. a single-line body): re-emit the whole block — unless comments
  // it holds (inside values or nested blocks: not in the IR) would go, other than a removed entry's
  const range = old.node.trivia.rawTextRange!;
  const text = withEol(emitBlock(next), ctx.eol);
  const nextArgs = 'args' in next.node ? next.node.args : {};
  const gone = (old.node.trivia.spans?.body.entries ?? []).filter((e) => !Object.hasOwn(nextArgs, e.key));
  const inGone = (at: number) => gone.some((e) => range.start + at >= e.start && range.start + at < e.end);
  if (lostComments(ctx.text.slice(range.start, range.end), text, inGone).length > 0) throw new CommentsWouldBeLost(null);
  return [{ start: range.start, end: range.end, text }];
}

/**
 * What to cut when a block goes away. Comments above a block that is followed
 * by an uncommented one read as a section banner ("# Networking") for what
 * follows, so they stay; otherwise they belong to the block.
 */
function removalRange(text: string, b: Block, next: Block | undefined): [number, number] {
  const { rawTextRange: range, spans, leadingComments } = b.node.trivia;
  if (spans && leadingComments.length > 0 && next && next.node.trivia.leadingComments.length === 0) {
    const header = lineStart(text, spans.header);
    const pos = spans.pos && spans.pos.start < spans.header ? lineStart(text, spans.pos.start) : header;
    return [Math.max(range!.start, Math.min(pos, header)), range!.end];
  }
  return [range!.start, range!.end];
}

/** Why `text` no longer holds the blocks parsed from it, or null when it still does. */
function staleness(text: string | undefined, blocks: Block[]): StaleReason | null {
  if (blocks.some((b) => b.node.trivia.sourceText === undefined)) return null; // not from the parser
  if (text === undefined) return blocks.length > 0 ? 'gone' : null;
  const sorted = [...blocks].sort((a, b) => a.node.trivia.rawTextRange!.start - b.node.trivia.rawTextRange!.start);
  let cursor = 0;
  for (const b of sorted) {
    const { rawTextRange: range, sourceText } = b.node.trivia;
    if (range!.start < cursor || range!.end > text.length) return 'moved';
    if (!onlyTrivia(text, cursor, range!.start)) return 'between';
    if (text.slice(range!.start, range!.end) !== sourceText) return 'changed';
    cursor = range!.end;
  }
  return onlyTrivia(text, cursor, text.length) ? null : 'after';
}

function appendBlocks(text: string, blocks: string[], eol: string): string {
  const body = blocks.map((b) => withEol(b, eol)).join(eol);
  let last = text.length - 1;
  while (last >= 0 && ' \t\r\n﻿'.includes(text[last])) last--;
  if (last === -1) return body;
  // keep the last line's bytes, replace the trailing blank lines with one separator
  const nl = text.indexOf('\n', last);
  const head = nl === -1 ? text + eol : text.slice(0, nl + 1);
  return head + eol + body;
}

// ------------------------------------------------------------ entry point

interface Plan {
  nextIR: IR;
  renamed: Map<string, string>;
  edits: Map<string, Edit[]>;
  appends: Map<string, string[]>;
  /** the previous parse, per file */
  oldByFile: Map<string, Block[]>;
  /** files that lose a block */
  shrunk: Set<string>;
}

function push<T>(map: Map<string, T[]>, key: string, ...values: T[]) {
  const list = map.get(key);
  if (list) list.push(...values);
  else map.set(key, [...values]);
}

function plan(files: Record<string, string>, ir: IR, ops: Op[]): Plan | { stale: PatchRefusal } {
  const { ir: nextIR, renamed } = applyOps(ir, ops);

  const oldBlocks = blocksOf(ir);
  const oldNodes = new Set(oldBlocks.map((b) => b.node));
  const oldByKey = new Map<string, Block>();
  const oldByFile = new Map<string, Block[]>();
  for (const b of oldBlocks) {
    const key = keyOf(b);
    if (key === undefined) continue;
    oldByKey.set(key, b);
    push(oldByFile, b.node.trivia.sourceFile!, b);
  }

  const appends = new Map<string, string[]>();
  const changed: Array<[Block, Block]> = [];
  const claimed = new Set<string>();
  for (const b of blocksOf(nextIR)) {
    const key = keyOf(b);
    const old = key !== undefined && !claimed.has(key) ? oldByKey.get(key) : undefined;
    if (!old) {
      if (!oldNodes.has(b.node)) push(appends, b.node.trivia.sourceFile ?? defaultFile(b), emitBlock(b));
      continue;
    }
    claimed.add(key!);
    if (old.node !== b.node) changed.push([old, b]);
  }
  const removed = new Set([...oldByKey].filter(([key]) => !claimed.has(key)).map(([, b]) => b));

  const touched = new Set([
    ...changed.map(([old]) => old.node.trivia.sourceFile!),
    ...[...removed].map((b) => b.node.trivia.sourceFile!),
    ...appends.keys(),
  ]);
  for (const file of touched) {
    const reason = staleness(files[file], oldByFile.get(file) ?? []);
    if (reason) {
      return { stale: { file, message: messagesFor(hclMessages).stale(file, reason) } };
    }
  }

  const ctxs = new Map<string, FileCtx>();
  const ctxOf = (file: string) => {
    let ctx = ctxs.get(file);
    if (!ctx) {
      const text = files[file] ?? '';
      ctx = { text, eol: eolOf(text), renamed };
      ctxs.set(file, ctx);
    }
    return ctx;
  };

  const edits = new Map<string, Edit[]>();
  for (const [old, next] of changed) {
    const file = old.node.trivia.sourceFile!;
    try {
      push(edits, file, ...patchBlock(ctxOf(file), old, next));
    } catch (err) {
      if (!(err instanceof CommentsWouldBeLost)) throw err;
      const where = old.kind === 'resource' ? old.node.id : old.kind === 'extra' ? file : `${old.kind} "${old.node.name}"`;
      return { stale: { file, message: messagesFor(hclMessages).commentsWouldBeLost(where, err.key) } };
    }
  }
  const shrunk = new Set<string>();
  for (const [file, blocks] of oldByFile) {
    if (!blocks.some((b) => removed.has(b))) continue;
    shrunk.add(file);
    const { text } = ctxOf(file);
    const sorted = [...blocks].sort((a, b) => a.node.trivia.rawTextRange!.start - b.node.trivia.rawTextRange!.start);
    const ranges: Array<[number, number]> = [];
    let nextSurvivor: Block | undefined;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (removed.has(sorted[i])) ranges.push(removalRange(text, sorted[i], nextSurvivor));
      else nextSurvivor = sorted[i];
    }
    push(edits, file, ...removeLines(text, ranges, 0, text.length));
  }
  return { nextIR, renamed, edits, appends, oldByFile, shrunk };
}

// ------------------------------------------------------------ re-parse

const byStart = (a: Block, b: Block) => a.node.trivia.rawTextRange!.start - b.node.trivia.rawTextRange!.start;

const atLineStart = (text: string, offset: number) =>
  offset === 0 || text[offset - 1] === '\n' || (offset === 1 && text.charCodeAt(0) === 0xfeff);

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** The previous parse of a block, rebuilt from its IR entry (`text` is the text it came from). */
function toParsed(b: Block, text: string): ParsedBlock | null {
  const t = b.node.trivia;
  if (!t.spans || !t.rawTextRange || t.sourceText === undefined) return null;
  const base = {
    leading: t.leadingComments,
    // the IR's own position may have been laid out or moved since: read it from the text
    pos: t.spans.pos ? posFromComment(text.slice(t.spans.pos.start, t.spans.pos.end)) : undefined,
    range: t.rawTextRange,
    argComments: t.argComments ?? {},
    argTrailing: t.argTrailing ?? {},
    spans: t.spans,
    sourceText: t.sourceText,
    errors: t.diagnostics ?? [],
  };
  switch (b.kind) {
    case 'resource':
      return { kind: 'resource', type: b.node.type, name: b.node.name, args: b.node.args, ...base };
    case 'variable':
    case 'output':
    case 'provider':
      return { kind: 'labeled', keyword: b.kind, name: b.node.name, args: b.node.args, ...base };
    case 'extra':
      return { kind: 'raw', text: b.node.text, ...base };
  }
}

/**
 * Re-read one patched file cheaply: blocks the edits didn't touch are the
 * previous parse shifted into place, edited blocks are parsed on their own.
 * Null whenever that might differ from a full parse (the caller then does one).
 */
function reparseFile(file: string, before: string, after: string, blocks: Block[], edits: Edit[]): ParseFileResult | null {
  const pending = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const parsed: Array<ParsedBlock | null> = [];
  const redo: Array<{ slot: number; start: number; end: number }> = [];
  let next = 0;
  let delta = 0;
  let lineDelta = 0;
  for (const b of [...blocks].sort(byStart)) {
    const range = b.node.trivia.rawTextRange!;
    if (!atLineStart(before, range.start)) return null;
    let grow = 0;
    let touched = false;
    for (; next < pending.length; next++) {
      const e = pending[next];
      const inside =
        e.start === e.end ? range.start <= e.start && e.start < range.end : range.start <= e.start && e.end <= range.end;
      if (!inside) {
        if (e.start < range.end) return null; // an edit between blocks
        break;
      }
      grow += e.text.length - (e.end - e.start);
      touched = true;
    }
    if (!touched) {
      const old = toParsed(b, before);
      if (!old) return null;
      parsed.push(shiftParsedBlock(old, delta, lineDelta));
      continue;
    }
    const start = range.start + delta;
    const end = range.end + delta + grow;
    redo.push({ slot: parsed.length, start, end });
    parsed.push(null);
    lineDelta += countNewlines(after, start, end) - countNewlines(before, range.start, range.end);
    delta += grow;
  }
  if (next < pending.length) return null;
  const fresh = parseBlocksAt(file, after, redo.map((r) => r.start));
  for (let i = 0; i < redo.length; i++) {
    const b = fresh[i];
    if (!b || b.range.start !== redo[i].start || b.range.end !== redo[i].end) return null;
    parsed[redo[i].slot] = b;
  }
  const blocksOut = parsed as ParsedBlock[];
  // errors are rare here; let a full parse report them in its exact order
  return blocksOut.some((b) => b.errors.length > 0) ? null : { blocks: blocksOut, errors: [] };
}

/** Parse the patched project, reusing the previous parse wherever the text is unchanged. */
function reparseProject(files: Record<string, string>, nextFiles: Record<string, string>, planned: Plan) {
  const parsed: ParsedFile[] = [];
  for (const [file, after] of Object.entries(nextFiles)) {
    const blocks = planned.oldByFile.get(file) ?? [];
    const edits = planned.edits.get(file) ?? [];
    const reusable =
      blocks.length > 0 &&
      files[file] !== undefined &&
      !planned.appends.has(file) &&
      !planned.shrunk.has(file) &&
      // touched files were checked by plan(); untouched ones must still match their parse
      (edits.length > 0 || staleness(files[file], blocks) === null);
    const result = (reusable && reparseFile(file, files[file], after, blocks, edits)) || parseFile(file, after);
    parsed.push({ file, ...result });
  }
  return buildIR(parsed);
}

const isError = (d: Diagnostic) => d.severity === 'error';

function refuse(files: Record<string, string>, ir: IR, refusal: PatchRefusal): PatchOutcome {
  return { files, ir, diagnostics: parseProject(files).diagnostics, renamed: new Map(), refused: refusal };
}

/** A patch must keep every block the ops kept and must not add parse errors. */
function verify(
  files: Record<string, string>,
  expected: IR,
  fresh: { ir: IR; diagnostics: Diagnostic[] },
  touched: string[],
): PatchRefusal | null {
  const ids = (ir: IR) => ir.resources.map((r) => r.id).sort().join('\n');
  const counts = (ir: IR) =>
    [ir.variables.length, ir.outputs.length, ir.providers.length, ir.extras.length].join();
  if (ids(expected) !== ids(fresh.ir) || counts(expected) !== counts(fresh.ir)) {
    return {
      file: touched[0] ?? '',
      message: messagesFor(hclMessages).wrongBlocks,
    };
  }
  const errorsIn = (diags: Diagnostic[], file: string) => diags.filter((d) => isError(d) && d.file === file);
  if (!touched.some((file) => errorsIn(fresh.diagnostics, file).length > 0)) return null;
  const before = parseProject(files).diagnostics;
  for (const file of touched) {
    const after = errorsIn(fresh.diagnostics, file);
    if (after.length > errorsIn(before, file).length) {
      return { file, message: messagesFor(hclMessages).wouldBreak(file, after[0].message) };
    }
  }
  return null;
}

/**
 * Apply canvas ops to the project: returns new file texts (minimally patched)
 * and the fresh IR parsed back from them. When the IR no longer matches the
 * files, nothing is written and `refused` says why.
 */
export function applyOpsWithPatches(
  files: Record<string, string>,
  ir: IR,
  ops: Op[],
): PatchOutcome {
  const planned = plan(files, ir, ops);
  if ('stale' in planned) return refuse(files, ir, planned.stale);

  const nextFiles: Record<string, string> = { ...files };
  for (const [file, edits] of planned.edits) {
    const patched = applyEdits(nextFiles[file] ?? '', edits);
    if (patched === null) {
      return refuse(files, ir, { file, message: messagesFor(hclMessages).conflicting });
    }
    nextFiles[file] = patched;
  }
  for (const [file, texts] of planned.appends) {
    const existing = nextFiles[file] ?? '';
    nextFiles[file] = appendBlocks(existing, texts, eolOf(existing));
  }

  // Re-parse so ranges are fresh and canvas/code stay perfectly consistent.
  const fresh = reparseProject(files, nextFiles, planned);
  const touched = [...new Set([...planned.edits.keys(), ...planned.appends.keys()])];
  const broken = verify(files, planned.nextIR, fresh, touched);
  if (broken) return refuse(files, ir, broken);
  return { files: nextFiles, ir: fresh.ir, diagnostics: fresh.diagnostics, renamed: planned.renamed };
}
