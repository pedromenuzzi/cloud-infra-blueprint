/**
 * HCL → IR parser.
 *
 * Hand-rolled, error-tolerant scanner tuned for the Terraform subset the app
 * emits, plus a `raw` escape hatch for everything else (functions, heredocs,
 * interpolations, conditionals, labeled sub-blocks, terraform/locals/data/
 * module blocks). Design rule: the parser must NEVER lose user text — anything
 * it cannot model is captured verbatim and re-emitted untouched.
 *
 * It also understands the managed position comment:
 *   # @blueprint:pos=x,y[,w,h]
 */
import type {
  CanvasPosition,
  Diagnostic,
  Expression,
  IR,
  TextRange,
} from '@/ir/types';
import { emptyIR, providerOfType, resourceAddress } from '@/ir/types';
import { POS_COMMENT_RE } from './emitter';

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_-]/;
const OPERATOR_CONTINUATION = /[+\-*/%<>=!&|?:.]/;

interface ParsedBlockBase {
  leading: string[];
  pos?: CanvasPosition;
  range: TextRange;
  argComments: Record<string, string[]>;
  argTrailing: Record<string, string>;
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
      keyword: 'variable' | 'output' | 'provider';
      name: string;
      args: Record<string, Expression>;
    } & ParsedBlockBase)
  | ({ kind: 'raw'; text: string } & ParsedBlockBase);

export interface ParseFileResult {
  blocks: ParsedBlock[];
  errors: Diagnostic[];
}

export function lineColOf(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}

class Scanner {
  src: string;
  pos = 0;
  file: string;
  errors: Diagnostic[] = [];

  constructor(file: string, src: string) {
    this.file = file;
    this.src = src;
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }
  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }
  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  error(message: string, at = this.pos) {
    const start = lineColOf(this.src, at);
    this.errors.push({ file: this.file, message, severity: 'error', start });
  }

  /** spaces / tabs / CR — not newlines */
  skipInlineWs() {
    while (!this.eof()) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else break;
    }
  }

  atComment(): boolean {
    const c = this.peek();
    return c === '#' || this.startsWith('//') || this.startsWith('/*');
  }

  /** Read a comment starting at pos; returns its text (verbatim, no newline). */
  readComment(): string {
    const start = this.pos;
    if (this.startsWith('/*')) {
      const end = this.src.indexOf('*/', this.pos + 2);
      this.pos = end === -1 ? this.src.length : end + 2;
      return this.src.slice(start, this.pos);
    }
    while (!this.eof() && this.peek() !== '\n') this.pos++;
    return this.src.slice(start, this.pos).replace(/\s+$/, '');
  }

  consumeNewline() {
    if (this.peek() === '\n') this.pos++;
  }

  /**
   * Consume whitespace + comments before a block or body entry. Comment lines
   * directly above the next token (no blank line in between) are returned as
   * the attached leading group along with the offset where the group starts.
   */
  collectLeading(): { comments: string[]; start: number } {
    let group: string[] = [];
    let groupStart = -1;
    let blankRun = 0;
    for (;;) {
      this.skipInlineWs();
      if (this.eof()) break;
      const c = this.peek();
      if (c === '\n') {
        this.pos++;
        blankRun++;
        if (blankRun >= 2 && group.length > 0) {
          group = [];
          groupStart = -1;
        }
        continue;
      }
      if (this.atComment()) {
        const lineStart = this.pos;
        const text = this.readComment();
        if (group.length === 0) groupStart = lineStart;
        group.push(text);
        blankRun = 0;
        this.skipInlineWs();
        this.consumeNewline();
        blankRun = 1;
        continue;
      }
      break;
    }
    return { comments: group, start: groupStart === -1 ? this.pos : groupStart };
  }

  readIdent(): string | null {
    if (!IDENT_START.test(this.peek())) return null;
    const start = this.pos;
    this.pos++;
    while (!this.eof() && IDENT_CHAR.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  /** Skip a double-quoted string (assumes current char is `"`), template-aware. */
  skipString() {
    this.pos++; // opening quote
    let templateDepth = 0;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '\\') {
        this.pos += 2;
        continue;
      }
      if (templateDepth === 0 && (this.startsWith('${') || this.startsWith('%{'))) {
        templateDepth++;
        this.pos += 2;
        continue;
      }
      if (templateDepth > 0) {
        if (c === '{') templateDepth++;
        if (c === '}') templateDepth--;
        this.pos++;
        continue;
      }
      this.pos++;
      if (c === '"') return;
    }
  }

  /** Skip a heredoc (assumes at `<<`). */
  skipHeredoc() {
    const m = /^<<-?([A-Za-z_][A-Za-z0-9_]*)/.exec(this.src.slice(this.pos));
    if (!m) {
      this.pos += 2;
      return;
    }
    const tag = m[1];
    this.pos += m[0].length;
    // advance to end of current line
    while (!this.eof() && this.peek() !== '\n') this.pos++;
    this.pos++;
    for (;;) {
      if (this.eof()) return;
      const lineStart = this.pos;
      let lineEnd = this.src.indexOf('\n', lineStart);
      if (lineEnd === -1) lineEnd = this.src.length;
      const line = this.src.slice(lineStart, lineEnd);
      this.pos = lineEnd < this.src.length ? lineEnd + 1 : lineEnd;
      if (line.trim() === tag) return;
    }
  }

  /**
   * Scan from `from` to the end of an arbitrary expression: bracket-depth
   * aware, string/heredoc/comment aware. Stops (without consuming) at a
   * newline, `,`, `}`, `]`, `)` or a trailing comment at depth 0.
   */
  scanRawExpression(from: number): string {
    this.pos = from;
    let depth = 0;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '"') {
        this.skipString();
        continue;
      }
      if (this.startsWith('<<')) {
        this.skipHeredoc();
        // a heredoc at depth 0 terminates the expression (nothing may follow it)
        if (depth === 0) break;
        continue;
      }
      if (depth === 0 && (c === '#' || this.startsWith('//'))) break;
      if (this.startsWith('/*')) {
        const end = this.src.indexOf('*/', this.pos + 2);
        this.pos = end === -1 ? this.src.length : end + 2;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') {
        depth++;
        this.pos++;
        continue;
      }
      if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
        this.pos++;
        continue;
      }
      if (depth === 0 && (c === '\n' || c === ',')) break;
      this.pos++;
    }
    return this.src.slice(from, this.pos).replace(/\s+$/, '');
  }

  /** Offset of the `]` matching the `[` at `open` on the same line, or -1. */
  findMatchingBracket(open: number): number {
    let depth = 0;
    for (let i = open; i < this.src.length; i++) {
      const c = this.src[i];
      if (c === '"') {
        const saved = this.pos;
        this.pos = i;
        this.skipString();
        i = this.pos - 1;
        this.pos = saved;
        continue;
      }
      if (c === '[') depth++;
      if (c === ']') {
        depth--;
        if (depth === 0) return i;
      }
      if (c === '\n') return -1;
    }
    return -1;
  }

  /** Find the offset just past the `}` matching the `{` at `openBrace`. */
  findMatchingBrace(openBrace: number): number {
    const saved = this.pos;
    this.pos = openBrace + 1;
    let depth = 1;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '"') {
        this.skipString();
        continue;
      }
      if (this.startsWith('<<')) {
        this.skipHeredoc();
        continue;
      }
      if (c === '#' || this.startsWith('//')) {
        this.readComment();
        continue;
      }
      if (this.startsWith('/*')) {
        const end = this.src.indexOf('*/', this.pos + 2);
        this.pos = end === -1 ? this.src.length : end + 2;
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
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

function unescapeString(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, esc: string) => {
    if (esc.startsWith('u')) return String.fromCharCode(parseInt(esc.slice(1), 16));
    switch (esc) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return `\\${esc}`;
    }
  });
}

interface BodyResult {
  args: Record<string, Expression>;
  argComments: Record<string, string[]>;
  argTrailing: Record<string, string>;
  ok: boolean;
}

function parseExpression(s: Scanner): Expression {
  s.skipInlineWs();
  const start = s.pos;
  const primary = parsePrimary(s, start);
  if (primary === null) {
    return { kind: 'raw', hcl: s.scanRawExpression(start) };
  }
  // Operator continuation on the same line → the whole thing becomes raw.
  const save = s.pos;
  s.skipInlineWs();
  const next = s.peek();
  if (next && next !== '\n' && OPERATOR_CONTINUATION.test(next) && !s.startsWith('//')) {
    return { kind: 'raw', hcl: s.scanRawExpression(start) };
  }
  if (next === '(') {
    return { kind: 'raw', hcl: s.scanRawExpression(start) };
  }
  s.pos = save;
  return primary;
}

function parsePrimary(s: Scanner, start: number): Expression | null {
  const c = s.peek();

  if (c === '"') {
    const strStart = s.pos;
    s.skipString();
    const rawText = s.src.slice(strStart, s.pos);
    if (rawText.includes('${') || rawText.includes('%{')) {
      return { kind: 'raw', hcl: rawText };
    }
    return { kind: 'literal', value: unescapeString(rawText.slice(1, -1)) };
  }

  if (s.startsWith('<<')) {
    return { kind: 'raw', hcl: s.scanRawExpression(start) };
  }

  if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(s.peek(1)))) {
    const m = /^-?\d+(\.\d+)?/.exec(s.src.slice(s.pos));
    if (m) {
      const after = s.src[s.pos + m[0].length] ?? '';
      if (IDENT_CHAR.test(after) || after === '.') {
        return { kind: 'raw', hcl: s.scanRawExpression(start) };
      }
      s.pos += m[0].length;
      return { kind: 'literal', value: Number(m[0]) };
    }
  }

  if (c === '[') {
    s.pos++;
    const items: Expression[] = [];
    for (;;) {
      skipWsCommentsNewlines(s);
      if (s.eof()) break;
      if (s.peek() === ']') {
        s.pos++;
        break;
      }
      items.push(parseExpression(s));
      skipWsCommentsNewlines(s);
      if (s.peek() === ',') s.pos++;
    }
    return { kind: 'list', items };
  }

  if (c === '{') {
    s.pos++;
    const fields: Record<string, Expression> = {};
    for (;;) {
      skipWsCommentsNewlines(s);
      if (s.eof()) break;
      if (s.peek() === '}') {
        s.pos++;
        break;
      }
      let key: string | null = null;
      if (s.peek() === '"') {
        const kStart = s.pos;
        s.skipString();
        key = unescapeString(s.src.slice(kStart + 1, s.pos - 1));
      } else {
        key = s.readIdent();
      }
      if (key === null) {
        // Unparseable object — degrade the whole object to raw.
        return { kind: 'raw', hcl: s.scanRawExpression(start) };
      }
      s.skipInlineWs();
      if (s.peek() === '=' || s.peek() === ':') s.pos++;
      else return { kind: 'raw', hcl: s.scanRawExpression(start) };
      fields[key] = parseExpression(s);
      s.skipInlineWs();
      if (s.peek() === ',') s.pos++;
    }
    return { kind: 'object', fields };
  }

  if (IDENT_START.test(c)) {
    const traversal = readTraversal(s);
    if (traversal === 'true') return { kind: 'literal', value: true };
    if (traversal === 'false') return { kind: 'literal', value: false };
    if (traversal === 'null') return { kind: 'literal', value: null };
    return { kind: 'ref', path: traversal };
  }

  return null;
}

function readTraversal(s: Scanner): string {
  const start = s.pos;
  s.readIdent();
  for (;;) {
    if (s.peek() === '.') {
      const after = s.peek(1);
      if (IDENT_START.test(after) || /[0-9*]/.test(after)) {
        s.pos++;
        if (after === '*') s.pos++;
        else if (/[0-9]/.test(after)) {
          while (/[0-9]/.test(s.peek())) s.pos++;
        } else s.readIdent();
        continue;
      }
    }
    if (s.peek() === '[') {
      const close = s.findMatchingBracket(s.pos);
      if (close === -1) break;
      s.pos = close + 1;
      continue;
    }
    break;
  }
  return s.src.slice(start, s.pos);
}

function skipWsCommentsNewlines(s: Scanner) {
  for (;;) {
    s.skipInlineWs();
    if (s.peek() === '\n') {
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

function parseBody(s: Scanner): BodyResult {
  const args: Record<string, Expression> = {};
  const argComments: Record<string, string[]> = {};
  const argTrailing: Record<string, string> = {};
  let rawKeySeq = 0;

  for (;;) {
    const { comments } = s.collectLeading();
    if (s.eof()) return { args, argComments, argTrailing, ok: false };
    if (s.peek() === '}') {
      s.pos++;
      return { args, argComments, argTrailing, ok: true };
    }

    const keyStart = s.pos;
    let key: string | null = null;
    if (s.peek() === '"') {
      const kStart = s.pos;
      s.skipString();
      key = unescapeString(s.src.slice(kStart + 1, s.pos - 1));
    } else {
      key = s.readIdent();
    }
    if (key === null) {
      s.error('Expected attribute name or block', s.pos);
      return { args, argComments, argTrailing, ok: false };
    }

    s.skipInlineWs();
    const c = s.peek();

    if (c === '=') {
      s.pos++;
      const value = parseExpression(s);
      args[key] = value;
      if (comments.length > 0) argComments[key] = comments;
      s.skipInlineWs();
      if (s.peek() === '#' || s.startsWith('//')) {
        argTrailing[key] = s.readComment();
      }
      s.skipInlineWs();
      if (s.peek() === ',') s.pos++;
      continue;
    }

    if (c === '{') {
      // unlabeled nested block: `ingress { ... }`
      const open = s.pos;
      s.pos++;
      const inner = parseBody(s);
      if (!inner.ok) {
        // capture verbatim and continue after the block
        const end = s.findMatchingBrace(open);
        const text = s.src.slice(keyStart, end);
        args[`${key} #${rawKeySeq++} raw`] = { kind: 'raw', hcl: text };
        s.pos = end;
        continue;
      }
      const bodyRecord = inner.args;
      const existing = args[key];
      if (existing && existing.kind === 'block') {
        args[key] = { kind: 'blocks', items: [existing.body, bodyRecord] };
      } else if (existing && existing.kind === 'blocks') {
        existing.items.push(bodyRecord);
      } else {
        args[key] = { kind: 'block', body: bodyRecord };
      }
      if (comments.length > 0) argComments[key] = comments;
      continue;
    }

    if (c === '"') {
      // labeled nested block: `provisioner "local-exec" { ... }` — verbatim
      while (s.peek() === '"') {
        s.skipString();
        s.skipInlineWs();
      }
      if (s.peek() === '{') {
        const end = s.findMatchingBrace(s.pos);
        const text = s.src.slice(keyStart, end);
        const label = /"([^"]*)"/.exec(text)?.[1] ?? String(rawKeySeq);
        args[`${key} "${label}" #${rawKeySeq++}`] = { kind: 'raw', hcl: text };
        if (comments.length > 0) argComments[`${key} "${label}" #${rawKeySeq - 1}`] = comments;
        s.pos = end;
        continue;
      }
      s.error(`Unexpected string after "${key}"`, s.pos);
      return { args, argComments, argTrailing, ok: false };
    }

    s.error(`Expected "=" or "{" after "${key}"`, s.pos);
    return { args, argComments, argTrailing, ok: false };
  }
}

function extractPos(comments: string[]): { comments: string[]; pos?: CanvasPosition } {
  const kept: string[] = [];
  let pos: CanvasPosition | undefined;
  for (const c of comments) {
    const m = POS_COMMENT_RE.exec(c);
    if (m) {
      pos = { x: Number(m[1]), y: Number(m[2]) };
      if (m[3] !== undefined && m[4] !== undefined) {
        pos.w = Number(m[3]);
        pos.h = Number(m[4]);
      }
    } else {
      kept.push(c);
    }
  }
  return { comments: kept, pos };
}

export function parseFile(file: string, source: string): ParseFileResult {
  const s = new Scanner(file, source);
  const blocks: ParsedBlock[] = [];

  for (;;) {
    const { comments, start: groupStart } = s.collectLeading();
    if (s.eof()) break;

    const keywordStart = s.pos;
    const keyword = s.readIdent();
    if (keyword === null) {
      s.error(`Unexpected character "${s.peek()}"`, s.pos);
      // recover: skip to next line
      while (!s.eof() && s.peek() !== '\n') s.pos++;
      continue;
    }

    // labels
    const labels: string[] = [];
    for (;;) {
      s.skipInlineWs();
      if (s.peek() === '"') {
        const lStart = s.pos;
        s.skipString();
        labels.push(unescapeString(s.src.slice(lStart + 1, s.pos - 1)));
        continue;
      }
      break;
    }

    s.skipInlineWs();
    if (s.peek() !== '{') {
      s.error(`Expected "{" after "${keyword}" block header`, s.pos);
      while (!s.eof() && s.peek() !== '\n') s.pos++;
      continue;
    }

    const openBrace = s.pos;
    const blockStart = comments.length > 0 ? groupStart : keywordStart;
    s.pos++;

    const errCountBefore = s.errors.length;
    const body = parseBody(s);

    let endOffset: number;
    let degraded = false;
    if (body.ok) {
      endOffset = s.pos;
    } else {
      // capture whole block verbatim
      endOffset = s.findMatchingBrace(openBrace);
      s.pos = endOffset;
      degraded = true;
      // keep only the first error of this block
      s.errors.length = Math.min(s.errors.length, errCountBefore + 1);
    }

    // include trailing spaces + newline in range
    s.skipInlineWs();
    if (s.peek() === '\n') s.pos++;
    const range: TextRange = { start: blockStart, end: s.pos };

    const { comments: userComments, pos: headerPos } = extractPos(comments);
    let pos = headerPos;
    // Be lenient: also accept the managed comment inside the block body.
    for (const [key, list] of Object.entries(body.argComments)) {
      const kept: string[] = [];
      for (const c of list) {
        const m = POS_COMMENT_RE.exec(c);
        if (m) {
          if (!pos) {
            pos = { x: Number(m[1]), y: Number(m[2]) };
            if (m[3] !== undefined && m[4] !== undefined) {
              pos.w = Number(m[3]);
              pos.h = Number(m[4]);
            }
          }
        } else {
          kept.push(c);
        }
      }
      if (kept.length > 0) body.argComments[key] = kept;
      else delete body.argComments[key];
    }
    const base: ParsedBlockBase = {
      leading: userComments,
      pos,
      range,
      argComments: body.argComments,
      argTrailing: body.argTrailing,
    };

    if (!degraded && keyword === 'resource' && labels.length === 2) {
      blocks.push({ kind: 'resource', type: labels[0], name: labels[1], args: body.args, ...base });
    } else if (
      !degraded &&
      (keyword === 'variable' || keyword === 'output' || keyword === 'provider') &&
      labels.length === 1
    ) {
      blocks.push({ kind: 'labeled', keyword, name: labels[0], args: body.args, ...base });
    } else {
      const text = s.src.slice(keywordStart, endOffset).replace(/\s+$/, '');
      blocks.push({ kind: 'raw', text, ...base });
    }
  }

  return { blocks, errors: s.errors };
}

/** Parse every file of a project into a fresh IR. */
export function parseProject(files: Record<string, string>): {
  ir: IR;
  diagnostics: Diagnostic[];
} {
  const ir = emptyIR();
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  let rawSeq = 0;
  let providerSeq = 0;

  for (const [file, source] of Object.entries(files)) {
    const { blocks, errors } = parseFile(file, source);
    diagnostics.push(...errors);

    for (const b of blocks) {
      const trivia = {
        leadingComments: b.leading,
        argComments: Object.keys(b.argComments).length ? b.argComments : undefined,
        argTrailing: Object.keys(b.argTrailing).length ? b.argTrailing : undefined,
        rawTextRange: b.range,
        sourceFile: file,
      };
      if (b.kind === 'resource') {
        const id = resourceAddress(b.type, b.name);
        if (seen.has(id)) {
          diagnostics.push({
            file,
            message: `Duplicate resource "${id}"`,
            severity: 'error',
            start: lineColOf(source, b.range.start),
          });
        }
        seen.add(id);
        ir.resources.push({
          id,
          provider: providerOfType(b.type),
          type: b.type,
          name: b.name,
          args: b.args,
          position: b.pos,
          trivia,
        });
      } else if (b.kind === 'labeled') {
        if (b.keyword === 'variable') {
          ir.variables.push({ id: `var.${b.name}`, name: b.name, args: b.args, trivia });
        } else if (b.keyword === 'output') {
          ir.outputs.push({ id: `output.${b.name}`, name: b.name, args: b.args, trivia });
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
