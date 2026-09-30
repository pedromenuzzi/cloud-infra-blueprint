/**
 * HCL → IR parser.
 *
 * Hand-rolled, error-tolerant scanner tuned for the Terraform subset the app
 * emits, plus a `raw` escape hatch for everything else (functions, heredocs,
 * interpolations, conditionals, comprehensions, labeled sub-blocks,
 * terraform/locals/data/module blocks). Design rule: the parser must NEVER
 * lose user text — anything it cannot model is captured verbatim and
 * re-emitted untouched.
 *
 * Alongside the IR it records source spans (header, labels, the position
 * comment, every argument and nested block) so canvas edits can be patched
 * into the text one line at a time.
 *
 * It also understands the managed position comment:
 *   # @blueprint:pos=x,y[,w,h]
 */
import type {
  BlockSpans,
  BodySpans,
  CanvasPosition,
  Diagnostic,
  EntrySpan,
  Expression,
  IR,
  TextRange,
  Trivia,
} from '@/ir/types';
import { emptyIR, providerOfType, resourceAddress } from '@/ir/types';
import { isRootModuleFile, moduleAddress } from '@/ir/modules';
import { messagesFor } from '@/i18n/messages';
import { POS_COMMENT_RE } from './emitter';
import { hclMessages } from './messages';

/** error messages in the UI language in effect */
const t = () => messagesFor(hclMessages);

/** Deeper nesting is kept verbatim instead of recursing (guards the call stack). */
const MAX_DEPTH = 64;
/** Per file: a pasted non-HCL document must not flood Monaco or the parse time. */
const MAX_DIAGNOSTICS = 100;

const TAB = 9;
const NL = 10;
const CR = 13;
const SPACE = 32;
const QUOTE = 34;
const HASH = 35;
const DOLLAR = 36;
const PERCENT = 37;
const LPAREN = 40;
const RPAREN = 41;
const STAR = 42;
const COMMA = 44;
const DOT = 46;
const SLASH = 47;
const LT = 60;
const EQUALS = 61;
const LBRACKET = 91;
const BACKSLASH = 92;
const RBRACKET = 93;
const LBRACE = 123;
const RBRACE = 125;
const BOM = 0xfeff;

const isDigit = (c: number) => c >= 48 && c <= 57;
const isIdentStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;
const isIdentChar = (c: number) => isIdentStart(c) || isDigit(c) || c === 45;
const isInlineWs = (c: number) => c === SPACE || c === TAB || c === CR || c === BOM;
const OPERATOR_CODES = new Set([...'+-*/%<>=!&|?:.'].map((ch) => ch.charCodeAt(0)));
/** a binary/ternary operator or attribute access right after a value makes it a compound expression */
const isOperatorStart = (c: number) => OPERATOR_CODES.has(c);

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const NUMBER_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEREDOC_RE = /<<-?([A-Za-z_][A-Za-z0-9_-]*)/y;
const HEX_RE = /^[0-9a-fA-F]+$/;

/** Label arity of the top-level Terraform blocks (unknown keywords aren't checked). */
const BLOCK_LABELS: Record<string, string[]> = {
  resource: ['TYPE', 'NAME'],
  data: ['TYPE', 'NAME'],
  variable: ['NAME'],
  output: ['NAME'],
  provider: ['NAME'],
  module: ['NAME'],
  terraform: [],
  locals: [],
};

interface ParsedBlockBase {
  leading: string[];
  pos?: CanvasPosition;
  range: TextRange;
  argComments: Record<string, string[]>;
  argTrailing: Record<string, string>;
  spans: BlockSpans;
  sourceText: string;
  /** parse errors inside this block */
  errors: Diagnostic[];
}

export type ParsedBlock =
  | ({
      kind: 'resource';
      type: string;
      name: string;
      args: Record<string, Expression>;
    } & ParsedBlockBase)
  | ({
      kind: 'labeled';
      keyword: 'variable' | 'output' | 'provider' | 'module';
      name: string;
      args: Record<string, Expression>;
    } & ParsedBlockBase)
  | ({ kind: 'raw'; text: string } & ParsedBlockBase);

export interface ParseFileResult {
  blocks: ParsedBlock[];
  errors: Diagnostic[];
}

/** Offsets where each line starts (index = line - 1). */
export function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function lineColIn(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 };
}

let cachedSource: string | undefined;
let cachedStarts: number[] = [];

/** 1-based line/column of an offset (the line table of the last source is cached). */
export function lineColOf(source: string, offset: number): { line: number; col: number } {
  if (source !== cachedSource) {
    cachedSource = source;
    cachedStarts = lineStartsOf(source);
  }
  return lineColIn(cachedStarts, Math.max(0, Math.min(offset, source.length)));
}

interface CommentRec {
  text: string;
  start: number;
}

const NO_COMMENTS: readonly CommentRec[] = Object.freeze([]);
/** strings that need decoding (escapes, template markers) */
const NEEDS_DECODE_RE = /[\\$%]/;

class Scanner {
  readonly src: string;
  readonly file: string;
  pos = 0;
  errors: Diagnostic[] = [];
  private starts: number[] | undefined;
  private lineHint = 0;
  /** unterminated strings already reported (rescans must not repeat them) */
  private reported = new Set<number>();

  constructor(file: string, src: string) {
    this.file = file;
    this.src = src;
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }
  code(offset = 0): number {
    return this.src.charCodeAt(this.pos + offset);
  }
  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }
  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  lineCol(offset: number): { line: number; col: number } {
    const starts = (this.starts ??= lineStartsOf(this.src));
    // offsets mostly arrive in increasing order: walk forward from the last line found
    let i = this.lineHint;
    if (starts[i] > offset) return lineColIn(starts, offset);
    while (i + 1 < starts.length && starts[i + 1] <= offset) i++;
    this.lineHint = i;
    return { line: i + 1, col: offset - starts[i] + 1 };
  }

  error(message: string, at = this.pos) {
    if (this.errors.length >= MAX_DIAGNOSTICS) return;
    this.errors.push({ file: this.file, message, severity: 'error', start: this.lineCol(at) });
  }

  /** start of the line holding `offset` (a leading BOM belongs to no block) */
  lineStartOf(offset: number): number {
    const start = this.src.lastIndexOf('\n', offset - 1) + 1;
    return start === 0 && offset > 0 && this.src.charCodeAt(0) === BOM ? 1 : start;
  }

  /** true when only whitespace precedes `offset` on its line */
  onlyWsBefore(offset: number): boolean {
    for (let i = this.lineStartOf(offset); i < offset; i++) {
      if (!isInlineWs(this.src.charCodeAt(i))) return false;
    }
    return true;
  }

  /** spaces / tabs / CR / BOM — not newlines */
  skipInlineWs() {
    while (this.pos < this.src.length && isInlineWs(this.src.charCodeAt(this.pos))) this.pos++;
  }

  skipLine() {
    const nl = this.src.indexOf('\n', this.pos);
    this.pos = nl === -1 ? this.src.length : nl;
  }

  atComment(): boolean {
    const c = this.code();
    return c === HASH || (c === SLASH && (this.code(1) === SLASH || this.code(1) === STAR));
  }

  /** Read a comment starting at pos; returns its text (verbatim, no newline). */
  readComment(): string {
    const start = this.pos;
    if (this.startsWith('/*')) {
      const end = this.src.indexOf('*/', this.pos + 2);
      if (end === -1) this.error(t().unterminatedComment, start);
      this.pos = end === -1 ? this.src.length : end + 2;
      return this.src.slice(start, this.pos);
    }
    this.skipLine();
    return this.src.slice(start, this.pos).trimEnd();
  }

  /**
   * Consume whitespace + comments before a block or body entry. Comment lines
   * directly above the next token (no blank line in between) are returned as
   * the attached group, with their offsets.
   */
  collectLeading(): readonly CommentRec[] {
    let group: CommentRec[] | undefined;
    let blankRun = 0;
    for (;;) {
      this.skipInlineWs();
      if (this.eof()) break;
      if (this.code() === NL) {
        this.pos++;
        blankRun++;
        if (blankRun >= 2) group = undefined;
        continue;
      }
      if (this.atComment()) {
        const start = this.pos;
        (group ??= []).push({ text: this.readComment(), start });
        this.skipInlineWs();
        if (this.code() === NL) this.pos++;
        blankRun = 1;
        continue;
      }
      break;
    }
    return group ?? NO_COMMENTS;
  }

  readIdent(): string | null {
    if (!isIdentStart(this.code())) return null;
    const start = this.pos;
    this.pos++;
    while (this.pos < this.src.length && isIdentChar(this.src.charCodeAt(this.pos))) this.pos++;
    return this.src.slice(start, this.pos);
  }

  /**
   * Offset just past the quoted string opening at `from`, or -1 when it never
   * closes. Strings nested inside `${…}` / `%{…}` are followed recursively
   * (iteratively, really: strings and interpolations strictly alternate). A
   * quoted string can't span lines, so a newline outside `${…}` ends the scan.
   */
  scanString(from: number): number {
    const src = this.src;
    const braces: number[] = []; // brace depth of each open interpolation
    let inString = true;
    let i = from + 1;
    while (i < src.length) {
      const c = src.charCodeAt(i);
      if (inString) {
        if (c === NL) return -1;
        if (c === BACKSLASH) {
          if (src.charCodeAt(i + 1) === NL) return -1;
          i += 2;
        } else if ((c === DOLLAR || c === PERCENT) && src.charCodeAt(i + 1) === c && src.charCodeAt(i + 2) === LBRACE) {
          i += 3; // `$${` / `%%{` escapes
        } else if ((c === DOLLAR || c === PERCENT) && src.charCodeAt(i + 1) === LBRACE) {
          braces.push(0);
          inString = false;
          i += 2;
        } else if (c === QUOTE) {
          if (braces.length === 0) return i + 1;
          inString = false; // a nested string closed: back inside its interpolation
          i++;
        } else {
          i++;
        }
        continue;
      }
      if (c === QUOTE) {
        inString = true;
      } else if (c === LBRACE) {
        braces[braces.length - 1]++;
      } else if (c === RBRACE) {
        const top = braces.length - 1;
        if (braces[top] === 0) {
          braces.pop();
          inString = true;
        } else {
          braces[top]--;
        }
      }
      i++;
    }
    return -1;
  }

  /**
   * Skip a double-quoted string (current char is `"`). An unterminated one is
   * reported at its opening quote and skipping stops at the end of its line,
   * so the rest of the file still parses.
   */
  skipString(): boolean {
    const from = this.pos;
    const end = this.scanString(from);
    if (end !== -1) {
      this.pos = end;
      return true;
    }
    if (!this.reported.has(from)) {
      this.reported.add(from);
      this.error(t().unterminatedString, from);
    }
    const nl = this.src.indexOf('\n', from);
    this.pos = nl === -1 ? this.src.length : nl;
    return false;
  }

  /** Skip a heredoc (assumes at `<<`), stopping at the end of its terminator line. */
  skipHeredoc() {
    HEREDOC_RE.lastIndex = this.pos;
    const m = HEREDOC_RE.exec(this.src);
    if (!m) {
      this.pos += 2;
      return;
    }
    const start = this.pos;
    const tag = m[1];
    let lineStart = this.src.indexOf('\n', this.pos + m[0].length) + 1;
    while (lineStart > 0 && lineStart < this.src.length) {
      let lineEnd = this.src.indexOf('\n', lineStart);
      if (lineEnd === -1) lineEnd = this.src.length;
      if (this.src.slice(lineStart, lineEnd).trim() === tag) {
        // stop before the newline: a comment on the next line is not the value's
        this.pos = lineEnd;
        return;
      }
      lineStart = lineEnd + 1;
    }
    this.error(t().missingHeredocTerminator(tag), start);
    this.pos = this.src.length;
  }

  skipBlockComment() {
    const end = this.src.indexOf('*/', this.pos + 2);
    this.pos = end === -1 ? this.src.length : end + 2;
  }

  /**
   * Scan from `from` to the end of an arbitrary expression: bracket-matching,
   * string/heredoc/comment aware. Stops (without consuming) at a newline, `,`,
   * or closing bracket at depth 0, or at a trailing comment. A closing bracket
   * that doesn't match is reported at the bracket it fails to close.
   */
  scanRawExpression(from: number): string {
    this.pos = from;
    const open: number[] = [];
    while (!this.eof()) {
      const c = this.code();
      if (c === QUOTE) {
        this.skipString();
        continue;
      }
      if (c === LT && this.code(1) === LT) {
        this.skipHeredoc();
        // a heredoc at depth 0 terminates the expression (nothing may follow it)
        if (open.length === 0) break;
        continue;
      }
      if (c === SLASH && this.code(1) === STAR) {
        this.skipBlockComment();
        continue;
      }
      if (c === HASH || (c === SLASH && this.code(1) === SLASH)) {
        if (open.length === 0) break;
        this.skipLine();
        continue;
      }
      if (c === LPAREN || c === LBRACKET || c === LBRACE) {
        open.push(this.pos);
        this.pos++;
        continue;
      }
      if (c === RPAREN || c === RBRACKET || c === RBRACE) {
        if (open.length === 0) break;
        const opener = this.src[open[open.length - 1]];
        if (OPENERS[opener] !== this.src[this.pos]) {
          this.error(t().expectedClose(OPENERS[opener], opener), open[open.length - 1]);
          open.length = 0;
          break;
        }
        open.pop();
        this.pos++;
        continue;
      }
      if (open.length === 0 && (c === NL || c === COMMA)) break;
      this.pos++;
    }
    if (open.length > 0) {
      const opener = this.src[open[0]];
      this.error(t().expectedClose(OPENERS[opener], opener), open[0]);
    }
    return this.src.slice(from, this.pos).trimEnd();
  }

  /** Offset of the `]` matching the `[` at `open` on the same line, or -1. */
  findMatchingBracket(open: number): number {
    let depth = 0;
    for (let i = open; i < this.src.length; i++) {
      const c = this.src.charCodeAt(i);
      if (c === QUOTE) {
        const end = this.scanString(i);
        if (end === -1) return -1;
        i = end - 1;
        continue;
      }
      if (c === LBRACKET) depth++;
      if (c === RBRACKET) {
        depth--;
        if (depth === 0) return i;
      }
      if (c === NL) return -1;
    }
    return -1;
  }

  /** Find the offset just past the `}` matching the `{` at `openBrace`. */
  findMatchingBrace(openBrace: number): number {
    const saved = this.pos;
    this.pos = openBrace + 1;
    let depth = 1;
    while (!this.eof()) {
      const c = this.code();
      if (c === QUOTE) {
        this.skipString();
        continue;
      }
      if (c === LT && this.code(1) === LT) {
        this.skipHeredoc();
        continue;
      }
      if (c === HASH || (c === SLASH && this.code(1) === SLASH)) {
        this.skipLine();
        continue;
      }
      if (c === SLASH && this.code(1) === STAR) {
        this.skipBlockComment();
        continue;
      }
      if (c === LBRACE) depth++;
      if (c === RBRACE) {
        depth--;
        if (depth === 0) {
          const result = this.pos + 1;
          this.pos = saved;
          return result;
        }
      }
      this.pos++;
    }
    const result = this.src.length;
    this.pos = saved;
    return result;
  }
}

/**
 * Value of a quoted string's body (between the quotes), or null when it is a
 * template (`${…}` / `%{…}`) or holds an escape HCL doesn't define.
 */
export function decodeString(body: string): string | null {
  if (!NEEDS_DECODE_RE.test(body)) return body;
  let out = '';
  let chunk = 0;
  let i = 0;
  while (i < body.length) {
    const c = body.charCodeAt(i);
    if (c === BACKSLASH) {
      out += body.slice(chunk, i);
      const esc = body[i + 1];
      if (esc === 'n') out += '\n';
      else if (esc === 't') out += '\t';
      else if (esc === 'r') out += '\r';
      else if (esc === '"') out += '"';
      else if (esc === '\\') out += '\\';
      else if (esc === 'u' || esc === 'U') {
        const digits = esc === 'u' ? 4 : 8;
        const hex = body.slice(i + 2, i + 2 + digits);
        if (hex.length !== digits || !HEX_RE.test(hex)) return null;
        const cp = parseInt(hex, 16);
        if (cp > 0x10ffff) return null;
        out += String.fromCodePoint(cp);
        i += digits;
      } else return null;
      i += 2;
      chunk = i;
      continue;
    }
    if ((c === DOLLAR || c === PERCENT) && body.charCodeAt(i + 1) === LBRACE) return null;
    if ((c === DOLLAR || c === PERCENT) && body.charCodeAt(i + 1) === c && body.charCodeAt(i + 2) === LBRACE) {
      out += body.slice(chunk, i + 1); // `$${` → `${`
      i += 2;
      chunk = i;
      continue;
    }
    i++;
  }
  return out + body.slice(chunk);
}

/** true when the scanner sits on the keyword `word` (not a longer identifier) */
function atKeyword(s: Scanner, word: string): boolean {
  return s.startsWith(word) && !isIdentChar(s.src.charCodeAt(s.pos + word.length));
}

function skipWsCommentsNewlines(s: Scanner) {
  for (;;) {
    s.skipInlineWs();
    if (s.code() === NL) {
      s.pos++;
      continue;
    }
    if (s.atComment()) {
      s.readComment();
      continue;
    }
    break;
  }
}

function parseExpression(s: Scanner, depth: number): Expression {
  s.skipInlineWs();
  const start = s.pos;
  if (depth > MAX_DEPTH) return { kind: 'raw', hcl: s.scanRawExpression(start) };
  const primary = parsePrimary(s, start, depth);
  if (primary === null) {
    return { kind: 'raw', hcl: s.scanRawExpression(start) };
  }
  // Operator, call or index on the same line → the whole thing becomes raw.
  const save = s.pos;
  s.skipInlineWs();
  const next = s.code();
  const comment = next === SLASH && (s.code(1) === SLASH || s.code(1) === STAR);
  if ((isOperatorStart(next) && !comment) || next === LPAREN || next === LBRACKET) {
    return { kind: 'raw', hcl: s.scanRawExpression(start) };
  }
  s.pos = save;
  return primary;
}

function parseString(s: Scanner): Expression {
  const strStart = s.pos;
  const ok = s.skipString();
  const rawText = s.src.slice(strStart, s.pos);
  if (!ok) return { kind: 'raw', hcl: rawText.trimEnd() };
  const value = decodeString(rawText.slice(1, -1));
  return value === null ? { kind: 'raw', hcl: rawText } : { kind: 'literal', value };
}

function parsePrimary(s: Scanner, start: number, depth: number): Expression | null {
  const c = s.code();

  if (c === QUOTE) return parseString(s);

  if (c === LT && s.code(1) === LT) {
    return { kind: 'raw', hcl: s.scanRawExpression(start) };
  }

  if (isDigit(c) || (c === 45 && isDigit(s.code(1)))) {
    NUMBER_RE.lastIndex = s.pos;
    const m = NUMBER_RE.exec(s.src);
    if (m) {
      const after = s.src.charCodeAt(s.pos + m[0].length);
      if (isIdentChar(after) || after === DOT) {
        return { kind: 'raw', hcl: s.scanRawExpression(start) };
      }
      s.pos += m[0].length;
      const value = Number(m[0]);
      return String(value) === m[0]
        ? { kind: 'literal', value }
        : { kind: 'literal', value, text: m[0] };
    }
  }

  if (c === LBRACKET) return parseList(s, start, depth);
  if (c === LBRACE) return parseObject(s, start, depth);

  if (isIdentStart(c)) {
    const traversal = readTraversal(s);
    if (traversal === 'true') return { kind: 'literal', value: true };
    if (traversal === 'false') return { kind: 'literal', value: false };
    if (traversal === 'null') return { kind: 'literal', value: null };
    return { kind: 'ref', path: traversal };
  }

  return null;
}

function parseList(s: Scanner, start: number, depth: number): Expression {
  s.pos++;
  skipWsCommentsNewlines(s);
  // `[for x in xs : x.id]` is a comprehension, not a list
  if (atKeyword(s, 'for')) return { kind: 'raw', hcl: s.scanRawExpression(start) };
  const items: Expression[] = [];
  for (;;) {
    skipWsCommentsNewlines(s);
    if (s.eof()) {
      s.error(t().expectedListClose, start);
      return { kind: 'raw', hcl: s.src.slice(start, s.pos).trimEnd() };
    }
    if (s.code() === RBRACKET) {
      s.pos++;
      return { kind: 'list', items };
    }
    const itemStart = s.pos;
    items.push(parseExpression(s, depth + 1));
    if (s.pos === itemStart) {
      // stray `}` / `)` / `,` — no progress possible (e.g. `x = [` then the block's `}`)
      s.error(t().expectedListClose, start);
      return { kind: 'raw', hcl: s.src.slice(start, s.pos).trimEnd() };
    }
    skipWsCommentsNewlines(s);
    if (s.code() === COMMA) s.pos++;
    else if (s.code() !== RBRACKET) {
      // items not separated by commas: not a list we can model — keep it verbatim
      return { kind: 'raw', hcl: s.scanRawExpression(start) };
    }
  }
}

function parseObject(s: Scanner, start: number, depth: number): Expression {
  s.pos++;
  skipWsCommentsNewlines(s);
  // `{for k, v in m : k => v}` is a comprehension, not an object
  if (atKeyword(s, 'for')) return { kind: 'raw', hcl: s.scanRawExpression(start) };
  const fields: Record<string, Expression> = {};
  for (;;) {
    skipWsCommentsNewlines(s);
    if (s.eof()) {
      s.error(t().expectedObjectClose, start);
      return { kind: 'raw', hcl: s.src.slice(start, s.pos).trimEnd() };
    }
    if (s.code() === RBRACE) {
      s.pos++;
      return { kind: 'object', fields };
    }
    let key: string | null = null;
    if (s.code() === QUOTE) {
      const kStart = s.pos;
      if (s.skipString()) key = decodeString(s.src.slice(kStart + 1, s.pos - 1));
    } else {
      key = s.readIdent();
    }
    s.skipInlineWs();
    if (key === null || !(s.code() === EQUALS || s.code() === 58 /* : */) || s.code(1) === EQUALS) {
      // computed keys, `a.b = …`, `==` … — keep the whole object verbatim
      return { kind: 'raw', hcl: s.scanRawExpression(start) };
    }
    s.pos++;
    fields[key] = parseExpression(s, depth + 1);
    s.skipInlineWs();
    const sep = s.code();
    if (sep === COMMA) s.pos++;
    else if (!(sep === NL || sep === RBRACE || s.atComment())) {
      return { kind: 'raw', hcl: s.scanRawExpression(start) };
    }
  }
}

function readTraversal(s: Scanner): string {
  const start = s.pos;
  s.readIdent();
  for (;;) {
    if (s.code() === DOT) {
      const after = s.code(1);
      if (isIdentStart(after) || isDigit(after) || after === STAR) {
        s.pos++;
        if (after === STAR) s.pos++;
        else if (isDigit(after)) {
          while (isDigit(s.code())) s.pos++;
        } else s.readIdent();
        continue;
      }
    }
    if (s.code() === LBRACKET) {
      const close = s.findMatchingBracket(s.pos);
      if (close === -1) break;
      s.pos = close + 1;
      continue;
    }
    break;
  }
  return s.src.slice(start, s.pos);
}

interface BodyResult {
  args: Record<string, Expression>;
  argComments: Record<string, string[]>;
  argTrailing: Record<string, string>;
  spans: BodySpans;
  /** a managed position comment found inside a top-level body (tolerated) */
  pos?: { value: CanvasPosition; range: TextRange };
  ok: boolean;
}

export function posFromComment(text: string): CanvasPosition | undefined {
  const m = POS_COMMENT_RE.exec(text);
  if (!m) return undefined;
  const pos: CanvasPosition = { x: Number(m[1]), y: Number(m[2]) };
  if (m[3] !== undefined && m[4] !== undefined) {
    pos.w = Number(m[3]);
    pos.h = Number(m[4]);
  }
  return pos;
}

/** What every body entry records before its value / block is parsed. */
interface EntryHead {
  key: string;
  start: number;
  keyStart: number;
  keyEnd: number;
  /** user comments attached above the entry */
  texts: string[];
  inline: boolean;
  line: number;
  col: number;
}

/**
 * After a value or closing brace: an optional same-line comment, then the
 * line must end (HCL separates arguments by newlines).
 */
function finishEntry(
  s: Scanner,
  key: string,
  contentEnd: number,
): { contentEnd: number; end: number; inline: boolean; comment?: string } {
  s.skipInlineWs();
  let comment: string | undefined;
  if (s.atComment()) {
    const at = s.pos;
    comment = s.readComment();
    contentEnd = at + comment.length;
    s.skipInlineWs();
  }
  if (s.eof()) return { contentEnd, end: s.pos, inline: false, comment };
  const c = s.code();
  if (c === NL) {
    s.pos++;
    return { contentEnd, end: s.pos, inline: false, comment };
  }
  if (c === RBRACE) return { contentEnd, end: contentEnd, inline: true, comment };
  if (c === COMMA) {
    s.error(t().commaAfter(key), s.pos);
    s.pos++;
  } else {
    s.error(t().newlineAfter(key), s.pos);
  }
  return { contentEnd, end: contentEnd, inline: true, comment };
}

/** Terraform rejects a repeated argument, and a name used both as argument and block. */
function noteKind(s: Scanner, kinds: Map<string, EntrySpan['kind']>, head: EntryHead, kind: EntrySpan['kind']) {
  const prev = kinds.get(head.key);
  if (prev === 'attr' && kind === 'attr') {
    s.error(t().duplicateArgument(head.key), head.keyStart);
  } else if (prev !== undefined && prev !== kind && prev !== 'raw' && kind !== 'raw') {
    s.error(t().argumentAndBlock(head.key), head.keyStart);
  }
  kinds.set(head.key, kind);
}

/** Keep an entry verbatim (labeled sub-blocks, broken or too-deep blocks) ending at `end`. */
function pushVerbatim(s: Scanner, result: BodyResult, head: EntryHead, argKey: string, end: number) {
  result.args[argKey] = { kind: 'raw', hcl: s.src.slice(head.keyStart, end) };
  if (head.texts.length > 0) result.argComments[argKey] = head.texts;
  s.pos = end;
  const tail = finishEntry(s, head.key, end);
  result.spans.entries.push({
    key: argKey, kind: 'raw', start: head.start, keyStart: head.keyStart, keyEnd: head.keyEnd,
    contentEnd: tail.contentEnd, end: tail.end, inline: head.inline || tail.inline,
    line: head.line, col: head.col,
  });
}

/** Comments above an entry, minus a managed pos comment (tolerated inside top-level bodies). */
function entryComments(
  comments: readonly CommentRec[],
  depth: number,
  result: BodyResult,
): { owned: readonly CommentRec[]; texts: string[] } {
  if (comments.length === 0) return { owned: comments, texts: [] };
  if (depth !== 1 || !comments.some((c) => POS_COMMENT_RE.test(c.text))) {
    return { owned: comments, texts: comments.map((c) => c.text) };
  }
  const managed = comments.filter((c) => POS_COMMENT_RE.test(c.text));
  const first = managed[0];
  result.pos ??= {
    value: posFromComment(first.text)!,
    range: { start: first.start, end: first.start + first.text.length },
  };
  // the entry's span starts below the managed comment: removing the entry keeps the position
  const owned = comments.slice(comments.lastIndexOf(managed[managed.length - 1]) + 1);
  return { owned, texts: comments.filter((c) => !managed.includes(c)).map((c) => c.text) };
}

/** Parse a body whose `{` is at `open`; on success `s.pos` is just past the matching `}`. */
function parseBody(s: Scanner, open: number, depth: number): BodyResult {
  const result: BodyResult = {
    args: {},
    argComments: {},
    argTrailing: {},
    spans: { open, close: -1, entries: [] },
    ok: false,
  };
  const { args, argComments, argTrailing } = result;
  const entries = result.spans.entries;
  const kinds = new Map<string, EntrySpan['kind']>();
  let rawKeySeq = 0;

  s.pos = open + 1;
  // a comment on the `{` line annotates the header, not the first argument
  s.skipInlineWs();
  if (s.atComment()) s.readComment();

  for (;;) {
    const comments = s.collectLeading();
    if (s.eof()) return result;
    if (s.code() === RBRACE) {
      result.spans.close = s.pos;
      s.pos++;
      result.ok = true;
      return result;
    }

    const keyStart = s.pos;
    let key: string | null = null;
    if (s.code() === QUOTE) {
      if (!s.skipString()) return result;
      const text = s.src.slice(keyStart + 1, s.pos - 1);
      key = decodeString(text) ?? text;
    } else {
      key = s.readIdent();
    }
    if (key === null) {
      s.error(t().expectedAttributeOrBlock, s.pos);
      return result;
    }

    const { owned, texts } = entryComments(comments, depth, result);
    const inline = !s.onlyWsBefore(keyStart);
    const at = s.lineCol(keyStart);
    const head: EntryHead = {
      key,
      start:
        owned.length > 0 && s.onlyWsBefore(owned[0].start)
          ? s.lineStartOf(owned[0].start)
          : inline
            ? keyStart
            : s.lineStartOf(keyStart),
      keyStart,
      keyEnd: s.pos,
      texts,
      inline,
      line: at.line,
      col: at.col,
    };

    s.skipInlineWs();
    const c = s.code();

    if (c === EQUALS && s.code(1) !== EQUALS) {
      const eq = s.pos;
      s.pos++;
      s.skipInlineWs();
      const valueStart = s.pos;
      const value = parseExpression(s, depth);
      const valueEnd = value.kind === 'raw' ? valueStart + value.hcl.length : s.pos;
      if (value.kind === 'raw' && value.hcl === '') {
        s.error(t().expectedValue(key), keyStart);
      }
      noteKind(s, kinds, head, 'attr');
      args[key] = value;
      if (texts.length > 0) argComments[key] = texts;
      const tail = finishEntry(s, key, valueEnd);
      if (tail.comment !== undefined) argTrailing[key] = tail.comment;
      entries.push({
        key, kind: 'attr', start: head.start, keyStart, keyEnd: head.keyEnd, eq, valueStart, valueEnd,
        contentEnd: tail.contentEnd, end: tail.end, inline: inline || tail.inline, line: head.line, col: head.col,
      });
      continue;
    }

    if (c === LBRACE) {
      // unlabeled nested block: `ingress { ... }`
      const braceOpen = s.pos;
      const inner = depth < MAX_DEPTH ? parseBody(s, braceOpen, depth + 1) : undefined;
      if (!inner?.ok) {
        // too deep or broken: capture verbatim and continue after the block
        pushVerbatim(s, result, head, `${key} #${rawKeySeq++} raw`, s.findMatchingBrace(braceOpen));
        continue;
      }
      noteKind(s, kinds, head, 'block');
      const existing = args[key];
      if (existing && existing.kind === 'block') {
        args[key] = { kind: 'blocks', items: [existing.body, inner.args] };
      } else if (existing && existing.kind === 'blocks') {
        existing.items.push(inner.args);
      } else {
        args[key] = { kind: 'block', body: inner.args };
      }
      if (texts.length > 0) argComments[key] = texts;
      const tail = finishEntry(s, key, s.pos);
      entries.push({
        key, kind: 'block', start: head.start, keyStart, keyEnd: head.keyEnd, contentEnd: tail.contentEnd,
        end: tail.end, inline: inline || tail.inline, body: inner.spans, line: head.line, col: head.col,
      });
      continue;
    }

    if (c === QUOTE || isIdentStart(c)) {
      // labeled nested block: `provisioner "local-exec" { ... }`, `dynamic "x" {` — verbatim
      const labelsAt = s.pos;
      let label: string | undefined;
      for (;;) {
        s.skipInlineWs();
        const labelStart = s.pos;
        if (s.code() === QUOTE) {
          if (!s.skipString()) break;
          label ??= s.src.slice(labelStart + 1, s.pos - 1);
        } else if (isIdentStart(s.code())) {
          label ??= s.readIdent()!;
        } else break;
      }
      if (label !== undefined && s.code() === LBRACE) {
        const braceOpen = s.pos;
        // parsed only to report errors inside; the text is kept as is
        const inner = depth < MAX_DEPTH ? parseBody(s, braceOpen, depth + 1) : undefined;
        const end = inner?.ok ? s.pos : s.findMatchingBrace(braceOpen);
        noteKind(s, kinds, head, 'raw');
        pushVerbatim(s, result, head, `${key} "${label}" #${rawKeySeq++}`, end);
        continue;
      }
      s.error(
        c === QUOTE ? t().unexpectedString(key) : t().expectedEqualsOrBrace(key),
        labelsAt,
      );
      return result;
    }

    s.error(t().expectedEqualsOrBrace(key), s.pos);
    return result;
  }
}

/** Parse a standalone expression; null unless the text is exactly one clean expression. */
export function parseExpressionText(text: string): Expression | null {
  const s = new Scanner('', text);
  const e = parseExpression(s, 0);
  skipWsCommentsNewlines(s);
  return s.eof() && s.errors.length === 0 ? e : null;
}

function extractPos(comments: readonly CommentRec[]): {
  comments: string[];
  pos?: CanvasPosition;
  range?: TextRange;
} {
  const kept: string[] = [];
  let pos: CanvasPosition | undefined;
  let range: TextRange | undefined;
  for (const c of comments) {
    const p = posFromComment(c.text);
    if (p) {
      pos = p;
      range = { start: c.start, end: c.start + c.text.length };
    } else {
      kept.push(c.text);
    }
  }
  return { comments: kept, pos, range };
}


/**
 * Parse the top-level block at `s.pos` (its leading comments already read).
 * Returns null when the line held no block: the error is reported and the
 * scanner has skipped the line.
 */
function parseTopLevel(s: Scanner, comments: readonly CommentRec[], errStart: number): ParsedBlock | null {
  const keywordStart = s.pos;
  const keyword = s.readIdent();
  if (keyword === null) {
    s.error(t().unexpectedCharacter(s.peek()), s.pos);
    // recover: skip to next line
    s.skipLine();
    return null;
  }

  // labels: quoted strings or bare identifiers (`resource aws_vpc main {` is valid HCL)
  const labels: string[] = [];
  const labelSpans: BlockSpans['labels'] = [];
  for (;;) {
    s.skipInlineWs();
    const at = s.pos;
    if (s.code() === QUOTE) {
      if (!s.skipString()) break;
      const text = s.src.slice(at + 1, s.pos - 1);
      labels.push(decodeString(text) ?? text);
      labelSpans.push({ start: at, end: s.pos, quoted: true });
    } else if (isIdentStart(s.code())) {
      labels.push(s.readIdent()!);
      labelSpans.push({ start: at, end: s.pos, quoted: false });
    } else break;
  }

  s.skipInlineWs();
  if (s.code() !== LBRACE) {
    s.error(t().expectedHeaderBrace(keyword), s.pos);
    s.skipLine();
    return null;
  }

  const expectedLabels = BLOCK_LABELS[keyword];
  if (expectedLabels !== undefined && labels.length !== expectedLabels.length) {
    const usage = [keyword, ...expectedLabels.map((l) => `"${l}"`)].join(' ');
    s.error(t().expectedUsage(usage), keywordStart);
  }

  const openBrace = s.pos;
  const blockStart =
    comments.length > 0 && s.onlyWsBefore(comments[0].start)
      ? s.lineStartOf(comments[0].start)
      : comments.length > 0
        ? comments[0].start
        : s.onlyWsBefore(keywordStart)
          ? s.lineStartOf(keywordStart)
          : keywordStart;

  const errCountBefore = s.errors.length;
  const body = parseBody(s, openBrace, 1);

  let endOffset: number;
  let degraded = false;
  if (body.ok) {
    endOffset = s.pos;
  } else {
    // parseBody reports every failure except running off the end of the file
    if (s.errors.length === errCountBefore) {
      s.error(t().missingBlockClose(keyword), keywordStart);
    }
    // capture whole block verbatim
    endOffset = s.findMatchingBrace(openBrace);
    s.pos = endOffset;
    degraded = true;
    // keep only the first error of this block
    s.errors.length = Math.min(s.errors.length, errCountBefore + 1);
  }

  // a same-line comment after `}` belongs to this block, not to the next one
  s.skipInlineWs();
  if (s.atComment()) s.readComment();
  s.skipInlineWs();
  if (s.code() === NL) s.pos++;
  const range: TextRange = { start: blockStart, end: s.pos };

  const header = extractPos(comments);
  let pos = header.pos;
  let posRange = header.range;
  if (!pos && body.pos) {
    pos = body.pos.value;
    posRange = body.pos.range;
  }
  const at = s.lineCol(keywordStart);
  const base: ParsedBlockBase = {
    leading: header.comments,
    pos,
    range,
    argComments: body.argComments,
    argTrailing: body.argTrailing,
    spans: {
      header: keywordStart,
      line: at.line,
      col: at.col,
      labels: labelSpans,
      pos: posRange,
      textEnd: endOffset,
      body: body.spans,
    },
    sourceText: s.src.slice(range.start, range.end),
    errors: s.errors.slice(errStart),
  };

  if (!degraded && keyword === 'resource' && labels.length === 2) {
    return { kind: 'resource', type: labels[0], name: labels[1], args: body.args, ...base };
  }
  if (
    !degraded &&
    (keyword === 'variable' || keyword === 'output' || keyword === 'provider' || keyword === 'module') &&
    labels.length === 1
  ) {
    return { kind: 'labeled', keyword, name: labels[0], args: body.args, ...base };
  }
  const text = s.src.slice(keywordStart, endOffset).trimEnd();
  base.spans.textEnd = keywordStart + text.length;
  return { kind: 'raw', text, ...base };
}

export function parseFile(file: string, source: string): ParseFileResult {
  const s = new Scanner(file, source);
  const blocks: ParsedBlock[] = [];
  for (;;) {
    const errStart = s.errors.length;
    const comments = s.collectLeading();
    if (s.eof()) break;
    const block = parseTopLevel(s, comments, errStart);
    if (block) blocks.push(block);
  }
  return { blocks, errors: s.errors };
}

/**
 * Parse just the top-level blocks starting at `offsets` (ascending) — how the
 * patcher re-reads the blocks it edited. A slot is null when no block starts there.
 */
export function parseBlocksAt(file: string, source: string, offsets: number[]): Array<ParsedBlock | null> {
  const s = new Scanner(file, source);
  return offsets.map((offset) => {
    s.pos = offset;
    const errStart = s.errors.length;
    const comments = s.collectLeading();
    return s.eof() ? null : parseTopLevel(s, comments, errStart);
  });
}

function shiftRange<T extends TextRange>(r: T, d: number): T {
  return { ...r, start: r.start + d, end: r.end + d };
}

function shiftBody(body: BodySpans, d: number, dl: number): BodySpans {
  return {
    open: body.open + d,
    close: body.close < 0 ? body.close : body.close + d,
    entries: body.entries.map((e) => {
      const shifted: EntrySpan = {
        ...e,
        start: e.start + d,
        keyStart: e.keyStart + d,
        keyEnd: e.keyEnd + d,
        contentEnd: e.contentEnd + d,
        end: e.end + d,
        line: e.line + dl,
      };
      if (e.eq !== undefined) shifted.eq = e.eq + d;
      if (e.valueStart !== undefined) shifted.valueStart = e.valueStart + d;
      if (e.valueEnd !== undefined) shifted.valueEnd = e.valueEnd + d;
      if (e.body) shifted.body = shiftBody(e.body, d, dl);
      return shifted;
    }),
  };
}

/**
 * The same block, `d` bytes and `dl` lines further down the file (its own
 * text unchanged, so columns are too) — exactly what re-parsing it would give.
 */
export function shiftParsedBlock(b: ParsedBlock, d: number, dl: number): ParsedBlock {
  if (d === 0 && dl === 0) return b;
  const spans = b.spans;
  const line = (p: Diagnostic['start']) => p && { line: p.line + dl, col: p.col };
  return {
    ...b,
    range: shiftRange(b.range, d),
    spans: {
      ...spans,
      header: spans.header + d,
      line: spans.line + dl,
      labels: spans.labels.map((l) => shiftRange(l, d)),
      pos: spans.pos && shiftRange(spans.pos, d),
      textEnd: spans.textEnd + d,
      body: shiftBody(spans.body, d, dl),
    },
    errors: b.errors.map((e) => ({ ...e, start: line(e.start), end: line(e.end) })),
  };
}

export interface ParsedFile {
  file: string;
  blocks: ParsedBlock[];
  errors: Diagnostic[];
}

/** Assemble parsed files into an IR: ids, trivia, duplicate-address errors. */
export function buildIR(parsed: ParsedFile[]): { ir: IR; diagnostics: Diagnostic[] } {
  const ir = emptyIR();
  const diagnostics: Diagnostic[] = [];
  const firstSeen = new Map<string, { file: string; line: number }>();
  let rawSeq = 0;
  let providerSeq = 0;

  for (const { file, blocks, errors } of parsed) {
    diagnostics.push(...errors);

    for (const b of blocks) {
      const trivia: Trivia = {
        leadingComments: b.leading,
        argComments: Object.keys(b.argComments).length ? b.argComments : undefined,
        argTrailing: Object.keys(b.argTrailing).length ? b.argTrailing : undefined,
        rawTextRange: b.range,
        sourceFile: file,
        sourceText: b.sourceText,
        spans: b.spans,
        diagnostics: b.errors.length ? b.errors : undefined,
      };
      if (b.kind === 'resource') {
        const id = resourceAddress(b.type, b.name);
        const first = firstSeen.get(id);
        if (first) {
          diagnostics.push({
            file,
            message: t().duplicateResource(id, first.file, first.line),
            severity: 'error',
            start: { line: b.spans.line, col: b.spans.col },
            nodeId: id,
          });
        } else {
          firstSeen.set(id, { file, line: b.spans.line });
        }
        ir.resources.push({
          id,
          provider: providerOfType(b.type),
          type: b.type,
          name: b.name,
          args: b.args,
          position: b.pos && { ...b.pos },
          trivia,
        });
      } else if (b.kind === 'labeled') {
        if (b.keyword === 'variable') {
          ir.variables.push({ id: `var.${b.name}`, name: b.name, args: b.args, trivia });
        } else if (b.keyword === 'output') {
          ir.outputs.push({ id: `output.${b.name}`, name: b.name, args: b.args, trivia });
        } else if (b.keyword === 'module') {
          const id = moduleAddress(b.name);
          const first = firstSeen.get(id);
          if (first) {
            diagnostics.push({
              file,
              message: t().duplicateModule(b.name, first.file, first.line),
              severity: 'error',
              start: { line: b.spans.line, col: b.spans.col },
              nodeId: id,
            });
          } else {
            firstSeen.set(id, { file, line: b.spans.line });
          }
          ir.modules.push({ id, name: b.name, args: b.args, position: b.pos && { ...b.pos }, trivia });
        } else {
          ir.providers.push({ id: `provider.${b.name}.${providerSeq++}`, name: b.name, args: b.args, trivia });
        }
      } else {
        ir.extras.push({ id: `raw.${file}#${rawSeq++}`, text: b.text, trivia });
      }
    }
  }

  return { ir, diagnostics };
}

/**
 * Parse a project into a fresh IR: the root module, i.e. the files without a
 * folder in their path — child modules (`modules/net/main.tf`) are modules'
 * own code, read by src/ir/localModules.ts.
 */
export function parseProject(files: Record<string, string>): {
  ir: IR;
  diagnostics: Diagnostic[];
} {
  return buildIR(
    Object.entries(files)
      .filter(([file]) => isRootModuleFile(file))
      .map(([file, source]) => ({ file, ...parseFile(file, source) })),
  );
}
