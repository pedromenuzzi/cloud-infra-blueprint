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
 * `aws_vpc.main.id` → `aws_vpc.main`
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
  return `${segs[0]}.${segs[1]}`;
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
    case 'raw': {
      // Best-effort: find bare traversals inside raw HCL so edges still render.
      const re = /\b([a-z][a-z0-9_]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_*[\]"]+)*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(e.hcl))) out.push({ field, path: m[1] });
      break;
    }
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
