/**
 * Repetition — resources that stand for many instances (`count`, `for_each`).
 *
 * Derived from the text like everything else: a resource's `count` or
 * `for_each` argument is read into a `Repeat` (how many instances, which keys,
 * when that is known without running Terraform). There is no extra syntax.
 *
 * The rest of the app asks here:
 *   - `repeatOf` / `instanceCount` — draw a stack, multiply a price, word a finding;
 *   - `instanceRef` / `appendReference` — the reference to write when something
 *     connects to a repeated resource (`aws_subnet.private[0].id`, `[*]` for lists);
 *   - `instanceAddress` — `aws_instance.web[0]`, `aws_instance.web["a"]` (moved blocks);
 *   - `rekeyInExpression` / `rekeyInHcl` — retarget references when repetition is
 *     added or removed (`aws_instance.web.id` ↔ `aws_instance.web[0].id`).
 *
 * `dynamic` blocks repeat nested blocks, not resources: they stay verbatim.
 */
import { parseFile } from '@/hcl/parser';
import { pathTargets, scanTraversals } from './expr';
import type { Expression, IR, ResourceNode } from './types';

export type RepeatKind = 'count' | 'for_each';

export interface Repeat {
  kind: RepeatKind;
  /** the argument as written */
  expr: Expression;
  /** instances, when known without running Terraform (a literal, a variable default…) */
  size?: number;
  /** `for_each` keys when known, in the order written (Terraform orders them itself) */
  keys?: string[];
  /** `count = cond ? 1 : 0`: the resource exists or not */
  optional?: boolean;
  /** where a known size came from when it isn't written in place (`var.azs`, `local.sites`) */
  via?: string;
}

const LOCAL_REF = /^local\.([A-Za-z_][\w-]*)$/;
const VAR_REF = /^var\.([A-Za-z_][\w-]*)$/;
const LENGTH_RE = /^length\(\s*([\s\S]*?)\s*\)$/;
const TOSET_RE = /^toset\(\s*([\s\S]*?)\s*\)$/;
const STRING_ITEM_RE = /^"((?:[^"\\$%]|\\.)*)"$/;

/** the source text of an expression, for comparisons and labels */
export function exprText(e: Expression): string {
  switch (e.kind) {
    case 'literal':
      return e.text ?? (typeof e.value === 'string' ? JSON.stringify(e.value) : String(e.value));
    case 'ref':
      return e.path;
    case 'raw':
      return e.hcl.trim();
    case 'list':
      return `[${e.items.map(exprText).join(', ')}]`;
    case 'object':
      return `{ ${Object.entries(e.fields).map(([k, v]) => `${k} = ${exprText(v)}`).join(', ')} }`;
    default:
      return '{ … }';
  }
}

// ------------------------------------------------------------------ locals

/** `locals { … }` values, parsed on demand from the verbatim blocks that hold them */
const localsCache = new WeakMap<IR, Map<string, Expression>>();

/** the attributes of a verbatim `locals { … }` block (read as an output's body) */
function parseLocals(text: string): Record<string, Expression> {
  const [block] = parseFile('', text.replace(/^\s*locals(\s*)\{/, 'output "locals"$1{')).blocks;
  return block?.kind === 'labeled' ? block.args : {};
}

function localValue(ir: IR | undefined, name: string): Expression | undefined {
  if (!ir) return undefined;
  let map = localsCache.get(ir);
  if (!map) {
    map = new Map();
    for (const b of ir.extras) {
      if (!/^\s*locals\s*\{/.test(b.text)) continue;
      for (const [k, v] of Object.entries(parseLocals(b.text))) if (!map.has(k)) map.set(k, v);
    }
    localsCache.set(ir, map);
  }
  return map.get(name);
}

/** a variable's default or a local's value behind `var.x` / `local.x` */
function follow(e: Expression, ir: IR | undefined): { value: Expression; via: string } | undefined {
  if (e.kind !== 'ref' || !ir) return undefined;
  const v = VAR_REF.exec(e.path)?.[1];
  if (v !== undefined) {
    const d = ir.variables.find((x) => x.name === v)?.args.default;
    return d ? { value: d, via: e.path } : undefined;
  }
  const l = LOCAL_REF.exec(e.path)?.[1];
  if (l !== undefined) {
    const value = localValue(ir, l);
    return value ? { value, via: e.path } : undefined;
  }
  return undefined;
}

// ------------------------------------------------------------------ values

/** split `a ? b : c` at the top level (outside brackets and strings); null when it isn't one */
export function splitConditional(hcl: string): [string, string, string] | null {
  let depth = 0;
  let quoted = false;
  let q = -1;
  let nested = 0;
  for (let i = 0; i < hcl.length; i++) {
    const c = hcl[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '?') {
      if (q === -1) q = i;
      else nested++;
    } else if (depth === 0 && c === ':' && q !== -1) {
      if (nested > 0) nested--;
      else return [hcl.slice(0, q).trim(), hcl.slice(q + 1, i).trim(), hcl.slice(i + 1).trim()];
    }
  }
  return null;
}

/** a whole number written in place (`3`, `"3"`) */
function literalCount(e: Expression): number | undefined {
  if (e.kind === 'literal') {
    const n = typeof e.value === 'number' ? e.value : typeof e.value === 'string' && /^\s*\d+\s*$/.test(e.value) ? Number(e.value) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }
  if (e.kind === 'raw' && /^\d+$/.test(e.hcl.trim())) return Number(e.hcl.trim());
  return undefined;
}

/** the items of a list of plain strings: `["a", "b"]` (also inside raw text) */
function stringItems(e: Expression): string[] | undefined {
  if (e.kind === 'list') {
    const out: string[] = [];
    for (const item of e.items) {
      if (item.kind !== 'literal' || item.value === null || typeof item.value === 'boolean') return undefined;
      out.push(String(item.value));
    }
    return out;
  }
  if (e.kind === 'raw') {
    const text = e.hcl.trim();
    if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    const out: string[] = [];
    for (const part of inner.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = STRING_ITEM_RE.exec(part);
      if (m) out.push(m[1].replace(/\\(.)/g, '$1'));
      else if (/^\d+$/.test(part)) out.push(part);
      else return undefined;
    }
    return out;
  }
  return undefined;
}

/** the value of a raw snippet that is itself a plain literal (`toset(["a"])`'s argument) */
function rawInner(text: string): Expression {
  const t = text.trim();
  if (VAR_REF.test(t) || LOCAL_REF.test(t)) return { kind: 'ref', path: t };
  return { kind: 'raw', hcl: t };
}

/** how many items a collection has, when it's written in place or behind a variable / local */
function collectionSize(e: Expression, ir: IR | undefined, depth = 0): { size: number; keys?: string[]; via?: string } | undefined {
  if (depth > 4) return undefined;
  const keys = collectionKeys(e, ir, depth);
  if (keys) return { size: keys.keys.length, keys: keys.keys, via: keys.via };
  if (e.kind === 'list') return { size: e.items.length };
  const followed = follow(e, ir);
  if (followed) {
    const inner = collectionSize(followed.value, ir, depth + 1);
    return inner && { ...inner, via: inner.via ?? followed.via };
  }
  return undefined;
}

/** the keys `for_each` iterates, when known: a literal map / set of strings, maybe behind a variable or local */
function collectionKeys(e: Expression, ir: IR | undefined, depth = 0): { keys: string[]; via?: string } | undefined {
  if (depth > 4) return undefined;
  if (e.kind === 'object') return { keys: Object.keys(e.fields) };
  const items = stringItems(e);
  if (items) return { keys: [...new Set(items)] };
  if (e.kind === 'raw') {
    const set = TOSET_RE.exec(e.hcl.trim())?.[1];
    if (set !== undefined) return collectionKeys(rawInner(set), ir, depth + 1);
    return undefined;
  }
  const followed = follow(e, ir);
  if (followed) {
    const inner = collectionKeys(followed.value, ir, depth + 1);
    return inner && { keys: inner.keys, via: inner.via ?? followed.via };
  }
  return undefined;
}

function countSize(e: Expression, ir: IR | undefined): { size?: number; optional?: boolean; via?: string } {
  const n = literalCount(e);
  if (n !== undefined) return { size: n };
  const followed = follow(e, ir);
  if (followed) {
    const inner = literalCount(followed.value);
    return inner !== undefined ? { size: inner, via: followed.via } : {};
  }
  if (e.kind !== 'raw') return {};
  const text = e.hcl.trim();
  const length = LENGTH_RE.exec(text)?.[1];
  if (length !== undefined) {
    const inner = collectionSize(rawInner(length), ir);
    return inner ? { size: inner.size, ...(inner.via ? { via: inner.via } : {}) } : {};
  }
  const cond = splitConditional(text);
  if (cond) {
    const [, a, b] = cond;
    const pair = [a, b].sort().join();
    if (pair === '0,1') return { optional: true };
  }
  return {};
}

/**
 * The repetition of a resource: its `count` or `for_each`, with the size
 * when it can be known here. Null for a plain (single) resource.
 */
export function repeatOf(node: Pick<ResourceNode, 'args'>, ir?: IR): Repeat | null {
  const count = node.args.count;
  if (count) {
    const known = countSize(count, ir);
    return { kind: 'count', expr: count, ...known };
  }
  const each = node.args.for_each;
  if (each) {
    const keys = collectionKeys(each, ir);
    if (keys) return { kind: 'for_each', expr: each, keys: keys.keys, size: keys.keys.length, ...(keys.via ? { via: keys.via } : {}) };
    // `for_each = aws_s3_bucket.data` — one instance per instance of another resource
    if (each.kind === 'ref' && ir) {
      const target = ir.resources.find((r) => r.id === each.path);
      const other = target && target !== node ? repeatOf(target, ir) : null;
      if (other?.kind === 'for_each' && other.keys) return { kind: 'for_each', expr: each, keys: other.keys, size: other.size, via: each.path };
    }
    return { kind: 'for_each', expr: each };
  }
  return null;
}

export const isRepeatedNode = (node: Pick<ResourceNode, 'args'>) => node.args.count !== undefined || node.args.for_each !== undefined;

/** instances a resource stands for: 1 when plain, the size when known, undefined when decided at plan time */
export function instanceCount(node: Pick<ResourceNode, 'args'>, ir?: IR): number | undefined {
  const r = repeatOf(node, ir);
  return r ? r.size : 1;
}

/** HCL for an instance key: `0`, `"a"` */
export const instanceKey = (kind: RepeatKind, key: string | number): string =>
  kind === 'count' ? String(key) : JSON.stringify(String(key));

/** `aws_instance.web[0]`, `aws_instance.web["a"]`, or the bare address */
export function instanceAddress(address: string, kind?: RepeatKind, key?: string | number): string {
  return kind === undefined || key === undefined ? address : `${address}[${instanceKey(kind, key)}]`;
}

// ------------------------------------------------------------------ writing references

/** a ref / raw value that already evaluates to a list (`x[*].id`, `values(x)[*].id`, `concat(…)`) */
export function isListValued(e: Expression | undefined): boolean {
  if (!e) return false;
  if (e.kind === 'list') return true;
  const text = e.kind === 'ref' ? e.path : e.kind === 'raw' ? e.hcl.trim() : '';
  return /\[\*\]|\.\*\./.test(text) || /^(concat|values|keys|flatten|distinct|compact|tolist|toset|sort)\(/.test(text);
}

function sameRepetition(a: Repeat, b: Repeat): boolean {
  if (a.kind !== b.kind) return false;
  if (a.size !== undefined && b.size !== undefined) {
    if (a.size !== b.size) return false;
    return a.kind === 'count' || (a.keys ?? []).slice().sort().join('\u0000') === (b.keys ?? []).slice().sort().join('\u0000');
  }
  return exprText(a.expr) === exprText(b.expr);
}

/**
 * The reference that makes `from` point at `target`'s `attr`.
 *
 * Plain target: `aws_subnet.a.id`. Repeated target:
 *   - `all` (a list argument): every instance — `aws_subnet.a[*].id`, `values(aws_subnet.a)[*].id` (for_each);
 *   - `from` repeated the same way: the matching instance — `aws_subnet.a[count.index].id`, `[each.key]`;
 *   - otherwise the first instance — `aws_subnet.a[0].id`, `aws_subnet.a["x"].id`,
 *     `values(aws_subnet.a)[0].id` when the keys are only known at plan time.
 */
export function instanceRef(
  target: Pick<ResourceNode, 'id' | 'args'>,
  attr: string,
  options: { ir?: IR; from?: Pick<ResourceNode, 'args'>; all?: boolean } = {},
): Expression {
  const rep = repeatOf(target, options.ir);
  const tail = attr ? `.${attr}` : '';
  if (!rep) return { kind: 'ref', path: `${target.id}${tail}` };
  if (options.all) {
    return rep.kind === 'count'
      ? { kind: 'ref', path: `${target.id}[*]${tail}` }
      : { kind: 'raw', hcl: `values(${target.id})[*]${tail}` };
  }
  const own = options.from ? repeatOf(options.from, options.ir) : null;
  if (own && sameRepetition(own, rep)) {
    return { kind: 'ref', path: `${target.id}[${rep.kind === 'count' ? 'count.index' : 'each.key'}]${tail}` };
  }
  if (rep.kind === 'count') return { kind: 'ref', path: `${target.id}[0]${tail}` };
  if (rep.keys?.length) return { kind: 'ref', path: `${target.id}[${instanceKey('for_each', rep.keys[0])}]${tail}` };
  return { kind: 'raw', hcl: `values(${target.id})[0]${tail}` };
}

/**
 * A list argument after adding `value` to it. Values that are lists
 * themselves (a splat) can't be list items — they are concatenated instead.
 * Null when `existing` already holds exactly that value.
 */
export function appendReference(existing: Expression | undefined, value: Expression): Expression | null {
  const text = exprText(value);
  const many = isListValued(value);
  if (!existing || (existing.kind === 'list' && existing.items.length === 0)) {
    return many ? value : { kind: 'list', items: [value] };
  }
  if (existing.kind === 'list') {
    if (existing.items.some((i) => exprText(i) === text)) return null;
    if (!many) return { kind: 'list', items: [...existing.items, value] };
    return { kind: 'raw', hcl: `concat(${exprText(existing)}, ${text})` };
  }
  if (exprText(existing) === text) return null;
  if (isListValued(existing)) return { kind: 'raw', hcl: `concat(${exprText(existing)}, ${many ? text : `[${text}]`})` };
  return many ? { kind: 'raw', hcl: `concat([${exprText(existing)}], ${text})` } : { kind: 'list', items: [existing, value] };
}

// ------------------------------------------------------------------ re-keying references

/**
 * How references to one resource change when its repetition does:
 *   - `add`: plain attribute access gains an instance key (`web.id` → `web[0].id`);
 *   - `drop`: an instance key goes away (`web[0].id`, `web[count.index].id` → `web.id`; splats stay);
 *   - `map`: instance keys are swapped (`web[0]` → `web["a"]`).
 */
export type Rekey = { add: string } | { drop: true } | { map: Record<string, string> };

/** the new path of one traversal, or null when it doesn't change */
function rekeyPath(path: string, address: string, rekey: Rekey): string | null {
  if (!pathTargets(path, address)) return null;
  const rest = path.slice(address.length);
  if ('add' in rekey) {
    // attribute access only: the bare address (depends_on, for_each chaining) names the whole resource
    return rest.startsWith('.') && !rest.startsWith('.*') ? `${address}[${rekey.add}]${rest}` : null;
  }
  if (!rest.startsWith('[')) return null;
  const close = matchingBracket(rest, 0);
  if (close === -1) return null;
  const key = rest.slice(1, close).trim();
  const after = rest.slice(close + 1);
  if ('drop' in rekey) return key === '*' ? null : `${address}${after}`;
  const to = rekey.map[key];
  return to === undefined ? null : `${address}[${to}]${after}`;
}

function matchingBracket(text: string, open: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/**
 * `rekeyPath` over raw HCL. The traversal scanner stops at an index it
 * doesn't model (`[count.index]`), so the key is read from the text after it.
 */
export function rekeyInHcl(hcl: string, address: string, rekey: Rekey): string {
  let out = '';
  let last = 0;
  for (const t of scanTraversals(hcl)) {
    if (!pathTargets(t.path, address) || t.start < last) continue;
    let end = t.end;
    let path = t.path;
    if (path === address && hcl[end] === '[') {
      // `web[count.index].id`: take the bracket and what follows it
      const close = matchingBracket(hcl, end);
      if (close === -1) continue;
      end = close + 1;
      for (;;) {
        if (hcl[end] === '[') {
          const c = matchingBracket(hcl, end);
          if (c === -1) break;
          end = c + 1;
          continue;
        }
        const step = /^\.(?:[A-Za-z_][\w-]*|\d+|\*)/.exec(hcl.slice(end, end + 256));
        if (!step) break;
        end += step[0].length;
      }
      path = hcl.slice(t.start, end);
    }
    const next = rekeyPath(path, address, rekey);
    if (next === null) continue;
    out += hcl.slice(last, t.start) + next;
    last = end;
  }
  return last === 0 ? hcl : out + hcl.slice(last);
}

/** `rekeyPath` over an expression; unchanged subtrees keep their identity */
export function rekeyInExpression(e: Expression, address: string, rekey: Rekey): Expression {
  switch (e.kind) {
    case 'ref': {
      const path = rekeyPath(e.path, address, rekey);
      return path === null ? e : { kind: 'ref', path };
    }
    case 'raw': {
      const hcl = rekeyInHcl(e.hcl, address, rekey);
      return hcl === e.hcl ? e : { kind: 'raw', hcl };
    }
    case 'list': {
      const items = e.items.map((item) => rekeyInExpression(item, address, rekey));
      return items.every((item, i) => item === e.items[i]) ? e : { kind: 'list', items };
    }
    case 'object': {
      const fields = rekeyInRecord(e.fields, address, rekey);
      return fields === e.fields ? e : { kind: 'object', fields };
    }
    case 'block': {
      const body = rekeyInRecord(e.body, address, rekey);
      return body === e.body ? e : { kind: 'block', body };
    }
    case 'blocks': {
      const items = e.items.map((body) => rekeyInRecord(body, address, rekey));
      return items.every((body, i) => body === e.items[i]) ? e : { kind: 'blocks', items };
    }
    default:
      return e;
  }
}

export function rekeyInRecord(record: Record<string, Expression>, address: string, rekey: Rekey): Record<string, Expression> {
  let changed = false;
  const out: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = rekeyInExpression(v, address, rekey);
    if (out[k] !== v) changed = true;
  }
  return changed ? out : record;
}
