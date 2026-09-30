/**
 * Comments written inside a list or object value (`cidr_blocks = [ # office`,
 * `tags = { Team = "x" # who to page }`) are not in the IR: re-emitting the
 * value from the IR would drop them. When the patcher (./patch.ts) must
 * rewrite such a value, it edits the value's own text instead — items and
 * fields are replaced, removed or added in place, recursively, and every
 * comment stays where it was, except those on the lines of what was removed.
 * The result is re-parsed and used only if it means exactly the new value and
 * still holds those comments; otherwise the edit is refused with an "edit it
 * in the code" reason (`CommentsWouldBeLost`), never applied lossily.
 */
import { exprEquals } from '@/ir/expr';
import type { Expression } from '@/ir/types';
import { emitExpression, emitValueLike, POS_COMMENT_RE, quoteKey } from './emitter';
import { decodeString, parseExpressionText } from './parser';

/** Thrown by the patcher for a change it can't make without losing comments: the argument, or null for the block. */
export class CommentsWouldBeLost extends Error {
  constructor(readonly key: string | null) {
    super(`comments inside ${key ?? 'the block'} would be lost`);
  }
}

interface Comment {
  start: number;
  text: string;
}

// ------------------------------------------------------------ lexing

const HEREDOC_RE = /<<-?([A-Za-z_][A-Za-z0-9_-]*)[ \t]*\r?\n/y;

/** Index just past the quoted string at `from` (templates and nested strings followed), or -1. */
function stringEnd(text: string, from: number): number {
  const braces: number[] = [];
  let inString = true;
  for (let i = from + 1; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\n') return -1;
      if (c === '\\') i++;
      else if ((c === '$' || c === '%') && text[i + 1] === c && text[i + 2] === '{') i += 2;
      else if ((c === '$' || c === '%') && text[i + 1] === '{') {
        braces.push(0);
        inString = false;
        i++;
      } else if (c === '"') {
        if (braces.length === 0) return i + 1;
        inString = false;
      }
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') braces[braces.length - 1]++;
    else if (c === '}') {
      if (braces[braces.length - 1] === 0) {
        braces.pop();
        inString = true;
      } else braces[braces.length - 1]--;
    }
  }
  return -1;
}

/** Index of the end of the heredoc's terminator line (before its newline), or -1. */
function heredocEnd(text: string, from: number): number {
  HEREDOC_RE.lastIndex = from;
  const m = HEREDOC_RE.exec(text);
  if (!m) return -1;
  let line = from + m[0].length;
  while (line <= text.length) {
    let end = text.indexOf('\n', line);
    if (end === -1) end = text.length;
    if (text.slice(line, end).trim() === m[1]) return end;
    if (end === text.length) return -1;
    line = end + 1;
  }
  return -1;
}

const lineEnd = (text: string, from: number) => {
  const nl = text.indexOf('\n', from);
  return nl === -1 ? text.length : nl;
};

/**
 * Walk `text`: `onComment` for each comment, `onCode(i)` for each code
 * character outside strings and heredocs (which are reported as one span,
 * `onCode(start, end)`). False when a string, heredoc or comment never ends.
 */
function lex(text: string, onCode: (start: number, end: number) => void, onComment?: (c: Comment) => void): boolean {
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      if (end === -1) return false;
      onCode(i, end);
      i = end;
    } else if (c === '<' && text[i + 1] === '<' && heredocEnd(text, i) !== -1) {
      const end = heredocEnd(text, i);
      onCode(i, end);
      i = end;
    } else if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      const end = lineEnd(text, i);
      onComment?.({ start: i, text: text.slice(i, end).trimEnd() });
      i = end;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) return false;
      onComment?.({ start: i, text: text.slice(i, close + 2) });
      i = close + 2;
    } else {
      onCode(i, i + 1);
      i++;
    }
  }
  return true;
}

function commentsOf(text: string): Comment[] | null {
  const out: Comment[] = [];
  return lex(text, () => {}, (c) => out.push(c)) ? out : null;
}

/** Does this value text hold a comment (outside its strings and heredocs)? */
export function hasComments(text: string): boolean {
  const found = commentsOf(text);
  return found === null || found.length > 0;
}

/**
 * The comments of `before` that `after` no longer has (compared as text, the
 * managed position comment aside) — for the patcher's whole-block fallbacks.
 */
export function lostComments(before: string, after: string, ignore: (start: number) => boolean = () => false): string[] {
  const left = (commentsOf(after) ?? []).map((c) => c.text.trim());
  const lost: string[] = [];
  for (const c of commentsOf(before) ?? []) {
    const text = c.text.trim();
    if (POS_COMMENT_RE.test(text) || ignore(c.start)) continue;
    const i = left.indexOf(text);
    if (i === -1) lost.push(text);
    else left.splice(i, 1);
  }
  return lost;
}

// ------------------------------------------------------------ structure

interface Segment {
  /** the item's (or field's) code, without the whitespace and comments around it */
  start: number;
  end: number;
  /** the `,` after it, if any */
  comma: number | null;
}

interface Container {
  open: number;
  close: number;
  items: Segment[];
}

/**
 * The items of the list or object whose bracket opens at `open`: separated by
 * commas (and, in an object, by newlines) at its own depth. Null when the text
 * isn't one.
 */
function scanContainer(text: string, open: number): Container | null {
  const closer = text[open] === '[' ? ']' : '}';
  const isObject = closer === '}';
  const items: Segment[] = [];
  let depth = 0;
  let start = -1;
  let end = -1;
  let close = -1;
  let bad = false;
  const flush = (comma: number | null) => {
    if (start >= 0) items.push({ start, end, comma });
    else if (comma !== null) bad = true; // `[a, , b]`
    start = end = -1;
  };
  const mark = (s: number, e: number) => {
    if (start < 0) start = s;
    end = e;
  };
  const inner = text.slice(open + 1);
  let done = false;
  const ok = lex(inner, (s, e) => {
    if (done) return;
    const at = open + 1 + s;
    const c = inner[s];
    if (e - s > 1) return mark(at, open + 1 + e); // a string or heredoc
    if (c === ' ' || c === '\t' || c === '\r') return;
    if (c === '\n') {
      if (depth === 0 && isObject) flush(null);
      return;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      return mark(at, at + 1);
    }
    if (c === ')' || c === ']' || c === '}') {
      if (depth > 0) {
        depth--;
        return mark(at, at + 1);
      }
      if (c !== closer) bad = true;
      flush(null);
      close = at;
      done = true;
      return;
    }
    if (c === ',' && depth === 0) return flush(at);
    mark(at, at + 1);
  });
  if (!ok || bad || close === -1 || !/^\s*$/.test(text.slice(close + 1))) return null;
  return { open, close, items };
}

interface Field extends Segment {
  key: string;
  keyEnd: number;
  /** where `=` or `:` is */
  eq: number;
  valueStart: number;
}

function fieldOf(text: string, seg: Segment): Field | null {
  let i = seg.start;
  let key: string | null;
  if (text[i] === '"') {
    const end = stringEnd(text, i);
    if (end === -1) return null;
    key = decodeString(text.slice(i + 1, end - 1));
    i = end;
  } else {
    const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i, seg.end));
    key = m ? m[0] : null;
    i += m ? m[0].length : 0;
  }
  const keyEnd = i;
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (key === null || (text[i] !== '=' && text[i] !== ':') || text[i + 1] === '=') return null;
  const eq = i;
  i++;
  while (text[i] === ' ' || text[i] === '\t') i++;
  return i < seg.end ? { ...seg, key, keyEnd, eq, valueStart: i } : null;
}

// ------------------------------------------------------------ rewriting

interface Edit {
  start: number;
  end: number;
  text: string;
}

const lineStartOf = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const onlySpace = (s: string) => /^[ \t\r]*$/.test(s);

/** the indentation of the line holding `at`, when that line starts inside `text`; else `fallback` */
function indentAt(text: string, at: number, fallback: string): string {
  const ls = lineStartOf(text, at);
  if (ls === 0) return fallback;
  return /^[ \t]*/.exec(text.slice(ls))![0];
}

class Rewrite {
  edits: Edit[] = [];
  /** comments on the removed lines: they go with what they annotated */
  removed: Array<[number, number]> = [];
  constructor(readonly text: string) {}

  /**
   * Cut an item and its comma. Alone on its line(s), the whole lines go,
   * with the comment after it; otherwise just the item (and a comma).
   */
  remove(c: Container, k: number) {
    const { text } = this;
    const seg = c.items[k];
    const tail = seg.comma ?? seg.end - 1;
    const ls = lineStartOf(text, seg.start);
    const le = lineEnd(text, tail + 1);
    const rest = text.slice(tail + 1, le);
    const ownLines = ls > c.open && onlySpace(text.slice(ls, seg.start)) && le < c.close && (onlySpace(rest) || /^\s*(#|\/\/)/.test(rest));
    if (ownLines) {
      this.cut(ls, le + 1);
    } else if (seg.comma !== null) {
      let e = seg.comma + 1;
      while (text[e] === ' ' || text[e] === '\t') e++;
      this.cut(seg.start, e);
    } else {
      // the last item: take the comma before it instead
      const prev = c.items[k - 1];
      this.cut(prev?.comma ?? seg.start, seg.end);
    }
  }

  private cut(start: number, end: number) {
    this.edits.push({ start, end, text: '' });
    this.removed.push([start, end]);
  }

  replace(start: number, end: number, text: string) {
    this.edits.push({ start, end, text });
  }

  apply(): string | null {
    const sorted = [...this.edits].sort((a, b) => a.start - b.start || a.end - b.end);
    let out = '';
    let cursor = 0;
    for (const e of sorted) {
      if (e.start < cursor) return null;
      out += this.text.slice(cursor, e.start) + e.text;
      cursor = e.end;
    }
    return out + this.text.slice(cursor);
  }
}

/** Where new items go: after `anchor` (or first, with -1), each on its own line when the value spans lines. */
function insertAfter(rw: Rewrite, c: Container, anchor: number, entries: string[], indent: string, list: boolean): boolean {
  const { text } = rw;
  const multiline = text.slice(c.open, c.close).includes('\n');
  if (!multiline) {
    const joined = entries.join(', ');
    if (anchor >= 0) rw.replace(c.items[anchor].end, c.items[anchor].end, `, ${joined}`);
    else rw.replace(c.open + 1, c.open + 1, c.items.length > 0 ? `${joined}, ` : joined);
    return true;
  }
  const first = c.items[0];
  const itemIndent = first && lineStartOf(text, first.start) > c.open ? indentAt(text, first.start, `${indent}  `) : `${indent}  `;
  const after = anchor >= 0 ? (c.items[anchor].comma ?? c.items[anchor].end - 1) + 1 : c.open + 1;
  const at = lineEnd(text, after);
  // the closing bracket (or the next item) must not share the anchor's line
  if (at > c.close || (anchor + 1 < c.items.length && c.items[anchor + 1].start < at)) return false;
  if (list && anchor >= 0 && c.items[anchor].comma === null) rw.replace(c.items[anchor].end, c.items[anchor].end, ',');
  const lines = entries.map((e) => `\n${itemIndent}${e}${list ? ',' : ''}`).join('');
  rw.replace(at, at, lines);
  return true;
}

/** Index pairs of a longest common subsequence of `a` and `b` (the items a list edit keeps). */
function commonItems(a: Expression[], b: Expression[]): Array<[number, number]> {
  const len = a.map(() => new Array<number>(b.length + 1).fill(0));
  len.push(new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      len[i][j] = exprEquals(a[i], b[j]) ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (exprEquals(a[i], b[j]) && len[i][j] === len[i + 1][j + 1] + 1) pairs.push([i++, j++]);
    else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Items kept stay with their comments (a longest common subsequence); between
 * them, old items are rewritten into new ones in turn, the extra old ones
 * removed and the extra new ones added after what precedes them.
 */
function rewriteList(o: Extract<Expression, { kind: 'list' }>, n: Extract<Expression, { kind: 'list' }>, rw: Rewrite, c: Container, indent: string): boolean {
  if (c.items.length !== o.items.length) return false;
  const itemIndent = (k: number) => (k >= 0 ? indentAt(rw.text, c.items[k].start, `${indent}  `) : `${indent}  `);
  let lastKept = -1;
  let pi = -1;
  let pj = -1;
  for (const [i, j] of [...commonItems(o.items, n.items), [o.items.length, n.items.length] as [number, number]]) {
    const oldGap = i - pi - 1;
    const newGap = j - pj - 1;
    const paired = Math.min(oldGap, newGap);
    for (let k = 0; k < paired; k++) {
      const seg = c.items[pi + 1 + k];
      const value = rewriteValue(o.items[pi + 1 + k], n.items[pj + 1 + k], rw.text.slice(seg.start, seg.end), itemIndent(pi + 1 + k));
      if (value === null) return false;
      rw.replace(seg.start, seg.end, value);
      lastKept = pi + 1 + k;
    }
    for (let k = paired; k < oldGap; k++) rw.remove(c, pi + 1 + k);
    if (newGap > paired) {
      const added = n.items.slice(pj + 1 + paired, j).map((item) => emitExpression(item, itemIndent(lastKept)));
      if (!insertAfter(rw, c, lastKept, added, indent, true)) return false;
    }
    if (i < o.items.length) lastKept = i;
    pi = i;
    pj = j;
  }
  return true;
}

function rewriteObject(
  o: Extract<Expression, { kind: 'object' }>,
  n: Extract<Expression, { kind: 'object' }>,
  rw: Rewrite,
  c: Container,
  indent: string,
): boolean {
  const fields = c.items.map((seg) => fieldOf(rw.text, seg));
  if (fields.some((f) => f === null)) return false;
  const byKey = new Map((fields as Field[]).map((f) => [f.key, f] as const));
  if (byKey.size !== Object.keys(o.fields).length || Object.keys(o.fields).some((k) => !byKey.has(k))) return false;
  for (const [key, value] of Object.entries(o.fields)) {
    const f = byKey.get(key)!;
    const next = n.fields[key];
    if (next === undefined) {
      rw.remove(c, c.items.findIndex((s) => s.start === f.start));
    } else if (!exprEquals(value, next)) {
      const rewritten = rewriteValue(value, next, rw.text.slice(f.valueStart, f.end), indentAt(rw.text, f.start, indent));
      if (rewritten === null) return false;
      rw.replace(f.valueStart, f.end, rewritten);
    }
  }
  const added = Object.entries(n.fields).filter(([key]) => !byKey.has(key));
  if (added.length === 0) return true;
  const kept = (fields as Field[]).filter((f) => n.fields[f.key] !== undefined);
  const at = kept.length > 0 ? indentAt(rw.text, kept[kept.length - 1].start, `${indent}  `) : `${indent}  `;
  const rendered = added.map(([key, value]) => ({ key: quoteKey(key), value: emitExpression(value, at) }));
  // `=` aligned across the fields (terraform fmt): the new keys join the column, widening it if they must
  const aligned = kept.length > 0 && kept.every((f) => rw.text[f.eq] === '=' && f.eq - f.start === kept[0].eq - kept[0].start);
  const width = aligned ? Math.max(kept[0].eq - kept[0].start - 1, ...rendered.map((r) => r.key.length)) : 0;
  if (aligned && width + 1 > kept[0].eq - kept[0].start) {
    for (const f of kept) rw.replace(f.keyEnd, f.eq, ' '.repeat(width + 1 - (f.keyEnd - f.start)));
  }
  const entries = rendered.map(({ key, value }) => `${key}${' '.repeat(Math.max(1, width + 1 - key.length))}= ${value}`);
  const anchor = kept.length > 0 ? c.items.findIndex((s) => s.start === kept[kept.length - 1].start) : -1;
  return insertAfter(rw, c, anchor, entries, indent, false);
}

/** `previous` rewritten to mean `n`; null when that can't be done without losing a comment. */
function rewriteValue(o: Expression, n: Expression, previous: string, indent: string): string | null {
  if (o.kind === n.kind && (o.kind === 'list' || o.kind === 'object')) {
    const c = scanContainer(previous, 0);
    if (!c || previous[0] !== (o.kind === 'list' ? '[' : '{')) return null;
    const rw = new Rewrite(previous);
    const ok =
      o.kind === 'list'
        ? rewriteList(o, n as typeof o, rw, c, indent)
        : rewriteObject(o, n as Extract<Expression, { kind: 'object' }>, rw, c, indent);
    return ok ? checked(rw, n) : null;
  }
  // a whole new value: fine without comments to lose — or when it is code written over code that
  // had them (a raw expression keeps its comments in the IR, so the new text is the user's)
  if (!hasComments(previous) || (o.kind === 'raw' && n.kind === 'raw')) return emitValueLike(n, indent, previous);
  return null;
}

/** The rewrite, if it means exactly `n` and every comment outside what was removed is still there. */
function checked(rw: Rewrite, n: Expression): string | null {
  const out = rw.apply();
  if (out === null) return null;
  const parsed = parseExpressionText(out);
  if (!parsed || !exprEquals(parsed, n)) return null;
  const inRemoved = (at: number) => rw.removed.some(([s, e]) => at >= s && at < e);
  return lostComments(rw.text, out, inRemoved).length === 0 ? out : null;
}

/**
 * The new text for a changed value that has comments inside: `undefined` when
 * it has none (or is code rewritten as code: the IR holds a raw expression's
 * comments), the rewritten text, or null when the change can't keep them.
 */
export function keepComments(o: Expression, n: Expression, previous: string, indent: string): string | null | undefined {
  if (!hasComments(previous) || (o.kind === 'raw' && n.kind === 'raw')) return undefined;
  return rewriteValue(o, n, previous, indent);
}
