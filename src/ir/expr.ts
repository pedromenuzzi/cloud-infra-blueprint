import type { Expression } from './types';

export const lit = (value: string | number | boolean | null): Expression => ({
  kind: 'literal',
  value,
});

export const ref = (path: string): Expression => ({ kind: 'ref', path });

export const list = (items: Expression[]): Expression => ({ kind: 'list', items });

export const obj = (fields: Record<string, Expression>): Expression => ({
  kind: 'object',
  fields,
});

export const block = (body: Record<string, Expression>): Expression => ({ kind: 'block', body });

export const blocks = (items: Array<Record<string, Expression>>): Expression => ({
  kind: 'blocks',
  items,
});

export const raw = (hcl: string): Expression => ({ kind: 'raw', hcl });

/** String value of a literal expression, if it is one. */
export function literalString(e: Expression | undefined): string | undefined {
  if (e && e.kind === 'literal' && typeof e.value === 'string') return e.value;
  return undefined;
}

/**
 * Resource address a ref points at, or null when it points at something that
 * is not a resource (var.*, local.*, module.*, data.* …).
 * `aws_vpc.main.id` → `aws_vpc.main`, `aws_subnet.private[0].id` → `aws_subnet.private`
 */
export function refTargetAddress(path: string): string | null {
  const segs = path.split('.');
  if (segs.length < 2) return null;
  const head = segs[0];
  if (
    ['var', 'local', 'module', 'data', 'each', 'count', 'self', 'terraform', 'path'].includes(head)
  ) {
    return null;
  }
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return null;
  const bracket = segs[1].indexOf('[');
  const name = bracket === -1 ? segs[1] : segs[1].slice(0, bracket);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return null;
  return `${head}.${name}`;
}

/** True when `path` is the address itself or a traversal into it (`.attr`, `[index]`). */
export function pathTargets(path: string, address: string): boolean {
  if (!path.startsWith(address)) return false;
  const next = path[address.length];
  return next === undefined || next === '.' || next === '[';
}

export interface TraversalToken {
  start: number;
  end: number;
  path: string;
}

const isIdentStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isIdentChar = (c: number) => isIdentStart(c) || isDigit(c) || c === 45;
const HEREDOC_RE = /<<-?([A-Za-z_][A-Za-z0-9_-]*)/y;
/** index keys that belong to a traversal path: digits, `*`, or a plain quoted string */
const SIMPLE_INDEX_RE = /\[(?:\d+|\*|"[^"\\$%\n]*")\]/y;

/** End of a traversal starting at identifier offset `i`: `a.b`, `.0`, `.*`, `[0]`, `["k"]`, `[*]`. */
function traversalEnd(hcl: string, i: number): number {
  let j = i + 1;
  while (j < hcl.length && isIdentChar(hcl.charCodeAt(j))) j++;
  for (;;) {
    const c = hcl.charCodeAt(j);
    const next = hcl.charCodeAt(j + 1);
    if (c === 46 /* . */ && isIdentStart(next)) {
      j += 2;
      while (j < hcl.length && isIdentChar(hcl.charCodeAt(j))) j++;
    } else if (c === 46 && isDigit(next)) {
      j += 2;
      while (isDigit(hcl.charCodeAt(j))) j++;
    } else if (c === 46 && next === 42 /* * */) {
      j += 2;
    } else if (c === 91 /* [ */) {
      SIMPLE_INDEX_RE.lastIndex = j;
      if (!SIMPLE_INDEX_RE.exec(hcl)) break;
      j = SIMPLE_INDEX_RE.lastIndex;
    } else {
      break;
    }
  }
  return j;
}

function heredocTag(hcl: string, i: number): string | null {
  HEREDOC_RE.lastIndex = i;
  return HEREDOC_RE.exec(hcl)?.[1] ?? null;
}

type Frame = { mode: 'code'; depth: number } | { mode: 'str' } | { mode: 'heredoc'; tag: string };

/**
 * Bare traversals (`aws_vpc.main.id`, `aws_subnet.x[0].id`) in the code parts
 * of an HCL snippet. String text, heredoc text and comments are skipped; the
 * `${…}` interpolations inside them are scanned. Identifiers are matched whole,
 * so `aws_vpc.main` is never found inside `aws_vpc.main2` or `data.aws_vpc.main`.
 */
export function scanTraversals(hcl: string): TraversalToken[] {
  const out: TraversalToken[] = [];
  const stack: Frame[] = [{ mode: 'code', depth: 0 }];
  const n = hcl.length;
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = hcl.charCodeAt(i);
    const next = hcl.charCodeAt(i + 1);
    if (top.mode !== 'code') {
      if (top.mode === 'str') {
        if (c === 92 /* \ */) {
          i += 2;
          continue;
        }
        if (c === 34 /* " */ || c === 10) {
          stack.pop();
          i++;
          continue;
        }
      } else if (i === 0 || hcl.charCodeAt(i - 1) === 10) {
        let lineEnd = hcl.indexOf('\n', i);
        if (lineEnd === -1) lineEnd = n;
        if (hcl.slice(i, lineEnd).trim() === top.tag) {
          stack.pop();
          i = lineEnd;
          continue;
        }
      }
      if ((c === 36 || c === 37) /* $ % */ && next === c && hcl.charCodeAt(i + 2) === 123) {
        i += 3; // `$${` / `%%{` are escapes, not interpolations
        continue;
      }
      if ((c === 36 || c === 37) && next === 123 /* { */) {
        stack.push({ mode: 'code', depth: 0 });
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === 34) {
      stack.push({ mode: 'str' });
      i++;
    } else if (c === 35 /* # */ || (c === 47 /* / */ && next === 47)) {
      const nl = hcl.indexOf('\n', i);
      i = nl === -1 ? n : nl;
    } else if (c === 47 && next === 42 /* * */) {
      const close = hcl.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
    } else if (c === 60 /* < */ && next === 60 && heredocTag(hcl, i) !== null) {
      const nl = hcl.indexOf('\n', i);
      stack.push({ mode: 'heredoc', tag: heredocTag(hcl, i)! });
      i = nl === -1 ? n : nl + 1;
    } else if (c === 123) {
      top.depth++;
      i++;
    } else if (c === 125 /* } */) {
      if (top.depth === 0 && stack.length > 1) stack.pop();
      else top.depth--;
      i++;
    } else if (isIdentStart(c)) {
      const prev = i > 0 ? hcl.charCodeAt(i - 1) : 0;
      const end = traversalEnd(hcl, i);
      if (!isIdentChar(prev) && prev !== 46) {
        const path = hcl.slice(i, end);
        if (path.includes('.')) out.push({ start: i, end, path });
      }
      i = end;
    } else {
      i++;
    }
  }
  return out;
}

/** Rewrite every traversal of `from` (incl. `.attr` / `[index]` suffixes) to `to` inside raw HCL. */
export function renameInHcl(hcl: string, from: string, to: string): string {
  let out = '';
  let last = 0;
  for (const t of scanTraversals(hcl)) {
    if (!pathTargets(t.path, from)) continue;
    out += hcl.slice(last, t.start) + to;
    last = t.start + from.length;
  }
  return last === 0 ? hcl : out + hcl.slice(last);
}

/** True when the expression references `address` (bare refs and traversals inside raw HCL). */
export function exprMentions(e: Expression, address: string): boolean {
  switch (e.kind) {
    case 'ref':
      return pathTargets(e.path, address);
    case 'raw':
      return scanTraversals(e.hcl).some((t) => pathTargets(t.path, address));
    case 'list':
      return e.items.some((i) => exprMentions(i, address));
    case 'object':
      return Object.values(e.fields).some((v) => exprMentions(v, address));
    case 'block':
      return Object.values(e.body).some((v) => exprMentions(v, address));
    case 'blocks':
      return e.items.some((b) => Object.values(b).some((v) => exprMentions(v, address)));
    default:
      return false;
  }
}

/** Retarget refs to `from` so they point at `to`; unchanged subtrees keep their identity. */
export function renameInExpression(e: Expression, from: string, to: string): Expression {
  switch (e.kind) {
    case 'ref':
      return pathTargets(e.path, from) ? { kind: 'ref', path: to + e.path.slice(from.length) } : e;
    case 'raw': {
      const hcl = renameInHcl(e.hcl, from, to);
      return hcl === e.hcl ? e : { kind: 'raw', hcl };
    }
    case 'list': {
      const items = e.items.map((item) => renameInExpression(item, from, to));
      return items.every((item, i) => item === e.items[i]) ? e : { kind: 'list', items };
    }
    case 'object': {
      const fields = renameInRecord(e.fields, from, to);
      return fields === e.fields ? e : { kind: 'object', fields };
    }
    case 'block': {
      const body = renameInRecord(e.body, from, to);
      return body === e.body ? e : { kind: 'block', body };
    }
    case 'blocks': {
      const items = e.items.map((body) => renameInRecord(body, from, to));
      return items.every((body, i) => body === e.items[i]) ? e : { kind: 'blocks', items };
    }
    default:
      return e;
  }
}

/** `renameInExpression` over a record; returns the same object when nothing changed. */
export function renameInRecord(
  record: Record<string, Expression>,
  from: string,
  to: string,
): Record<string, Expression> {
  let changed = false;
  const out: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = renameInExpression(v, from, to);
    if (out[k] !== v) changed = true;
  }
  return changed ? out : record;
}

/** Collect every ref inside an expression tree (with the arg path that holds it). */
export function collectRefs(
  e: Expression,
  field: string,
  out: Array<{ field: string; path: string }>,
): void {
  switch (e.kind) {
    case 'ref':
      out.push({ field, path: e.path });
      break;
    case 'list':
      e.items.forEach((item) => collectRefs(item, field, out));
      break;
    case 'object':
      for (const [k, v] of Object.entries(e.fields)) collectRefs(v, `${field}.${k}`, out);
      break;
    case 'block':
      for (const [k, v] of Object.entries(e.body)) collectRefs(v, `${field}.${k}`, out);
      break;
    case 'blocks':
      e.items.forEach((body) => {
        for (const [k, v] of Object.entries(body)) collectRefs(v, `${field}.${k}`, out);
      });
      break;
    case 'raw':
      // bare traversals inside the raw HCL, so edges still render
      for (const t of scanTraversals(e.hcl)) out.push({ field, path: t.path });
      break;
    default:
      break;
  }
}

/** Compact single-line preview used by the inspector and node subtitles. */
export function exprPreview(e: Expression | undefined): string {
  if (!e) return '';
  switch (e.kind) {
    case 'literal':
      return e.value === null ? 'null' : String(e.value);
    case 'ref':
      return e.path;
    case 'raw':
      return e.hcl.replace(/\s+/g, ' ').slice(0, 48);
    case 'list':
      return `[${e.items.map((i) => exprPreview(i)).join(', ')}]`;
    case 'object': {
      const inner = Object.entries(e.fields)
        .map(([k, v]) => `${k} = ${exprPreview(v)}`)
        .join(', ');
      return `{ ${inner} }`;
    }
    case 'block':
    case 'blocks':
      return '{ … }';
  }
}

/** Deep structural equality of expressions (used by tests and diffing). */
export function exprEquals(a: Expression, b: Expression): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'literal':
      return a.value === (b as typeof a).value;
    case 'ref':
      return a.path === (b as typeof a).path;
    case 'raw':
      return a.hcl.trim() === (b as typeof a).hcl.trim();
    case 'list': {
      const bb = b as typeof a;
      return (
        a.items.length === bb.items.length && a.items.every((x, i) => exprEquals(x, bb.items[i]))
      );
    }
    case 'object': {
      const bb = b as typeof a;
      return recordEquals(a.fields, bb.fields);
    }
    case 'block': {
      const bb = b as typeof a;
      return recordEquals(a.body, bb.body);
    }
    case 'blocks': {
      const bb = b as typeof a;
      return (
        a.items.length === bb.items.length && a.items.every((x, i) => recordEquals(x, bb.items[i]))
      );
    }
  }
}

function recordEquals(a: Record<string, Expression>, b: Record<string, Expression>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => b[k] !== undefined && exprEquals(a[k], b[k]));
}
