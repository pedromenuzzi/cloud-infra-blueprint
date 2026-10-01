/**
 * What each instance of a repeated resource (`count`, `for_each`) is given,
 * when that is certain without running Terraform: the subnets of
 * `count = length(var.azs)` with `cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)`
 * and `availability_zone = var.azs[count.index]`, or the subnets of a literal
 * `for_each` map with `cidr_block = each.value` (or `each.value.cidr`).
 *
 * A small evaluator over the subset of HCL such plans are written in:
 * literals, lists and maps, `var.x` defaults, `local.x`, `count.index`,
 * `each.key` / `each.value`, other resources' literal arguments
 * (`aws_vpc.main.cidr_block`), `+ - *`, and `cidrsubnet`, `element`,
 * `length`, `lookup`, `tostring`, `tonumber`, `toset`, `tolist`. Anything
 * else is unknown, and callers fall back to treating the value as an
 * expression. Sizes and keys come from ../repeat.ts.
 */
import { formatCidrBlock, parseCidrBlock } from '@/resources/cidr';
import { exprText, instanceAddress, localValue, repeatOf, type RepeatKind } from '../repeat';
import type { Expression, IR, ResourceNode } from '../types';

/** a value the evaluator knows: strings, numbers, booleans, lists and maps of those */
export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

/** what `count.index` / `each.key` / `each.value` are for one instance */
export interface InstanceScope {
  /** `count.index`, or the `for_each` key */
  key: number | string;
  /** `each.value` */
  value?: Value;
}

export interface Instance {
  kind: RepeatKind;
  /** `aws_subnet.public[0]`, `aws_subnet.public["a"]` */
  address: string;
  scope: InstanceScope;
}

interface Ctx {
  ir: IR;
  scope?: InstanceScope & { kind: RepeatKind };
  depth: number;
}

const UNKNOWN = Symbol('unknown');
type Result = Value | typeof UNKNOWN;

/* ------------------------------------------------------------- instances */

/**
 * The instances of a repeated resource, when how many (and their keys and
 * values) is known; undefined for a plain resource or one decided at plan time.
 */
export function instancesOf(node: ResourceNode, ir: IR): Instance[] | undefined {
  const rep = repeatOf(node, ir);
  if (!rep || rep.size === undefined) return undefined;
  if (rep.kind === 'count') {
    return Array.from({ length: rep.size }, (_, i) => ({
      kind: 'count' as const,
      address: instanceAddress(node.id, 'count', i),
      scope: { key: i },
    }));
  }
  const keys = rep.keys;
  if (!keys) return undefined;
  const collection = evaluate(node.args.for_each, ir);
  const valueOf = (key: string): Value | undefined => {
    if (collection === UNKNOWN || collection === null) return undefined;
    if (Array.isArray(collection)) return key; // a set of strings: each.value is the key
    if (typeof collection === 'object') return collection[key];
    return undefined;
  };
  return keys.map((key) => ({
    kind: 'for_each' as const,
    address: instanceAddress(node.id, 'for_each', key),
    scope: { key, value: valueOf(key) },
  }));
}

/* ------------------------------------------------------------- evaluation */

/** The value of `e` for one instance (or outside any), or undefined when it isn't certain. */
export function evaluateFor(e: Expression | undefined, ir: IR, instance?: Instance): Value | undefined {
  const r = evaluate(e, ir, instance ? { ...instance.scope, kind: instance.kind } : undefined);
  return r === UNKNOWN ? undefined : r;
}

/** A string value for one instance (a CIDR, a zone), or undefined. */
export function stringFor(e: Expression | undefined, ir: IR, instance?: Instance): string | undefined {
  const v = evaluateFor(e, ir, instance);
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function evaluate(e: Expression | undefined, ir: IR, scope?: Ctx['scope'], depth = 0): Result {
  if (!e) return UNKNOWN;
  return fromExpression(e, { ir, scope, depth });
}

function fromExpression(e: Expression, ctx: Ctx): Result {
  if (ctx.depth > 8) return UNKNOWN;
  switch (e.kind) {
    case 'literal':
      return e.value;
    case 'list': {
      const out: Value[] = [];
      for (const item of e.items) {
        const v = fromExpression(item, ctx);
        if (v === UNKNOWN) return UNKNOWN;
        out.push(v);
      }
      return out;
    }
    case 'object': {
      const out: Record<string, Value> = {};
      for (const [k, item] of Object.entries(e.fields)) {
        const v = fromExpression(item, ctx);
        if (v === UNKNOWN) return UNKNOWN;
        out[k] = v;
      }
      return out;
    }
    case 'ref':
    case 'raw':
      return evalText(exprText(e), ctx);
    default:
      return UNKNOWN;
  }
}

/* ------------------------------------------------------------- the text */

/** a quoted string: text, and `${…}` interpolations to evaluate */
type StringPart = string | { expr: string };
type Token = { t: 'num'; v: number } | { t: 'str'; v: StringPart[] } | { t: 'id'; v: string } | { t: 'op'; v: string };

/** the index just past the `}` closing an interpolation that starts at `from` (after `${`), or -1 */
function interpolationEnd(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

function tokenize(text: string): Token[] | undefined {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/\d/.test(c)) {
      const m = /^\d+(?:\.\d+)?/.exec(text.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w-]*/.exec(text.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      const parts: StringPart[] = [];
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          s += text[j + 1] ?? '';
          j += 2;
          continue;
        }
        // `${…}` is evaluated; `$${` is a literal `${`; template directives (`%{`) aren't modeled
        if (text[j] === '$' && text[j + 1] === '$' && text[j + 2] === '{') {
          s += '${';
          j += 3;
          continue;
        }
        if (text[j] === '$' && text[j + 1] === '{') {
          const end = interpolationEnd(text, j + 2);
          if (end === -1) return undefined;
          if (s) parts.push(s);
          s = '';
          parts.push({ expr: text.slice(j + 2, end - 1) });
          j = end;
          continue;
        }
        if (text[j] === '%' && text[j + 1] === '{') return undefined;
        s += text[j++];
      }
      if (j >= text.length) return undefined;
      if (s || parts.length === 0) parts.push(s);
      out.push({ t: 'str', v: parts });
      i = j + 1;
    } else if ('()[]{},.+-*/%=:'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else {
      return undefined;
    }
  }
  return out;
}

function evalText(text: string, ctx: Ctx): Result {
  const tokens = tokenize(text);
  if (!tokens) return UNKNOWN;
  const p = new Parser(tokens, ctx);
  const v = p.expr();
  return p.done() ? v : UNKNOWN;
}

const isNum = (v: Result): v is number => typeof v === 'number' && Number.isFinite(v);

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly ctx: Ctx,
  ) {}

  done() {
    return this.i === this.tokens.length;
  }

  private peek(v?: string): Token | undefined {
    const t = this.tokens[this.i];
    if (v === undefined) return t;
    return t && t.t === 'op' && t.v === v ? t : undefined;
  }

  private eat(v: string): boolean {
    if (!this.peek(v)) return false;
    this.i++;
    return true;
  }

  expr(): Result {
    let left = this.term();
    for (;;) {
      if (this.eat('+')) {
        const right = this.term();
        left = isNum(left) && isNum(right) ? left + right : UNKNOWN;
      } else if (this.eat('-')) {
        const right = this.term();
        left = isNum(left) && isNum(right) ? left - right : UNKNOWN;
      } else return left;
    }
  }

  private term(): Result {
    let left = this.unary();
    for (;;) {
      if (this.eat('*')) {
        const right = this.unary();
        left = isNum(left) && isNum(right) ? left * right : UNKNOWN;
      } else if (this.eat('/')) {
        const right = this.unary();
        left = isNum(left) && isNum(right) && right !== 0 ? left / right : UNKNOWN;
      } else if (this.eat('%')) {
        const right = this.unary();
        left = isNum(left) && isNum(right) && right !== 0 ? left % right : UNKNOWN;
      } else return left;
    }
  }

  private unary(): Result {
    if (this.eat('-')) {
      const v = this.unary();
      return isNum(v) ? -v : UNKNOWN;
    }
    return this.postfix(this.primary());
  }

  private postfix(start: Result | Path): Result {
    let cur = start;
    for (;;) {
      if (this.peek('.')) {
        this.i++;
        const t = this.tokens[this.i++];
        if (!t || (t.t !== 'id' && t.t !== 'num')) return UNKNOWN;
        cur = step(cur, String(t.v), this.ctx);
      } else if (this.peek('[')) {
        this.i++;
        const key = this.expr();
        if (!this.eat(']')) return UNKNOWN;
        if (key === UNKNOWN || (typeof key !== 'string' && typeof key !== 'number')) return UNKNOWN;
        cur = step(cur, key, this.ctx);
      } else {
        return settle(cur, this.ctx);
      }
    }
  }

  private primary(): Result | Path {
    const t = this.tokens[this.i++];
    if (!t) return UNKNOWN;
    if (t.t === 'num') return t.v;
    if (t.t === 'str') {
      let s = '';
      for (const part of t.v) {
        if (typeof part === 'string') {
          s += part;
          continue;
        }
        const v = evalText(part.expr, this.ctx);
        if (typeof v !== 'string' && !isNum(v) && typeof v !== 'boolean') return UNKNOWN;
        s += String(v);
      }
      return s;
    }
    if (t.t === 'op') {
      if (t.v === '(') {
        const v = this.expr();
        return this.eat(')') ? v : UNKNOWN;
      }
      if (t.v === '[') {
        const items: Value[] = [];
        let unknown = false;
        while (!this.peek(']')) {
          const v = this.expr();
          if (v === UNKNOWN) unknown = true;
          else items.push(v);
          if (!this.eat(',')) break;
        }
        if (!this.eat(']')) return UNKNOWN;
        return unknown ? UNKNOWN : items;
      }
      return UNKNOWN;
    }
    if (t.v === 'true' || t.v === 'false') return t.v === 'true';
    if (t.v === 'null') return null;
    if (this.peek('(')) {
      this.i++;
      const args: Result[] = [];
      while (!this.peek(')')) {
        args.push(this.expr());
        if (!this.eat(',')) break;
      }
      if (!this.eat(')')) return UNKNOWN;
      return call(t.v, args);
    }
    return { path: [t.v] };
  }
}

/* ------------------------------------------------------------- names */

/** a traversal still being read: `var` → `var.azs` → (resolved) */
interface Path {
  path: Array<string | number>;
}

const isPath = (v: unknown): v is Path => typeof v === 'object' && v !== null && !Array.isArray(v) && 'path' in v && Array.isArray((v as Path).path);

/** one `.attr` / `[key]` step: on a value, or growing a traversal until it names one */
function step(cur: Result | Path, key: string | number, ctx: Ctx): Result | Path {
  if (cur === UNKNOWN) return UNKNOWN;
  if (isPath(cur)) {
    const next = { path: [...cur.path, key] };
    const resolved = resolvePath(next.path, ctx);
    return resolved === 'more' ? next : resolved;
  }
  return index(cur, key);
}

/** a traversal at its end: what it names, if that is a value */
function settle(cur: Result | Path, ctx: Ctx): Result {
  if (!isPath(cur)) return cur;
  const resolved = resolvePath(cur.path, ctx);
  return resolved === 'more' ? UNKNOWN : resolved;
}

function index(v: Value, key: string | number): Result {
  if (Array.isArray(v)) return typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < v.length ? v[key] : UNKNOWN;
  if (v && typeof v === 'object') return Object.hasOwn(v, String(key)) ? v[String(key)] : UNKNOWN;
  return UNKNOWN;
}

/** `var.x`, `local.x`, `count.index`, `each.key|value`, `<type>.<name>.<attr>`; 'more' while incomplete */
function resolvePath(path: Array<string | number>, ctx: Ctx): Result | 'more' {
  const [root, second, third] = path;
  const nested = { ...ctx, depth: ctx.depth + 1, scope: undefined };
  if (path.length === 1) return 'more';
  if (root === 'var' && path.length === 2) {
    const d = ctx.ir.variables.find((v) => v.name === second)?.args.default;
    return d ? fromExpression(d, nested) : UNKNOWN;
  }
  if (root === 'local' && path.length === 2) {
    const l = typeof second === 'string' ? localValue(ctx.ir, second) : undefined;
    return l ? fromExpression(l, nested) : UNKNOWN;
  }
  if (root === 'count') {
    return second === 'index' && ctx.scope?.kind === 'count' ? ctx.scope.key : UNKNOWN;
  }
  if (root === 'each') {
    if (ctx.scope?.kind !== 'for_each') return UNKNOWN;
    if (second === 'key') return ctx.scope.key;
    if (second === 'value') return ctx.scope.value === undefined ? UNKNOWN : ctx.scope.value;
    return UNKNOWN;
  }
  if (root === 'data' || root === 'module' || root === 'path' || root === 'terraform' || root === 'self') return UNKNOWN;
  // another resource's argument, written as a value: `aws_vpc.main.cidr_block`
  if (path.length === 2) return 'more';
  if (typeof third !== 'string') return UNKNOWN; // an instance of a repeated resource
  const target = ctx.ir.resources.find((r) => r.id === `${root}.${second}`);
  if (!target || target.args.count || target.args.for_each) return UNKNOWN;
  const arg = target.args[third];
  return arg ? fromExpression(arg, nested) : UNKNOWN;
}

/* ------------------------------------------------------------- functions */

function call(name: string, args: Result[]): Result {
  if (args.some((a) => a === UNKNOWN)) return UNKNOWN;
  const a = args as Value[];
  switch (name) {
    case 'cidrsubnet':
      return a.length === 3 && typeof a[0] === 'string' && isNum(a[1]) && isNum(a[2]) ? cidrsubnet(a[0], a[1], a[2]) : UNKNOWN;
    case 'element': {
      const [list, i] = a;
      if (!Array.isArray(list) || list.length === 0 || !isNum(i) || !Number.isInteger(i) || i < 0) return UNKNOWN;
      return list[i % list.length];
    }
    case 'length': {
      const [v] = a;
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'string') return [...v].length;
      if (v && typeof v === 'object') return Object.keys(v).length;
      return UNKNOWN;
    }
    case 'lookup': {
      const [map, key, fallback] = a;
      if (!map || typeof map !== 'object' || Array.isArray(map) || (typeof key !== 'string' && typeof key !== 'number')) return UNKNOWN;
      if (Object.hasOwn(map, String(key))) return map[String(key)];
      return a.length === 3 ? fallback : UNKNOWN;
    }
    case 'tostring':
      return typeof a[0] === 'string' || isNum(a[0]) ? String(a[0]) : UNKNOWN;
    case 'tonumber':
      return isNum(a[0]) ? a[0] : typeof a[0] === 'string' && /^-?\d+(\.\d+)?$/.test(a[0]) ? Number(a[0]) : UNKNOWN;
    case 'toset':
    case 'tolist':
      return Array.isArray(a[0]) ? (name === 'toset' ? [...new Set(a[0].map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as Value) : a[0]) : UNKNOWN;
    default:
      return UNKNOWN;
  }
}

/** Terraform's `cidrsubnet(prefix, newbits, netnum)`; unknown when Terraform would refuse it */
export function cidrsubnet(prefix: string, newbits: number, netnum: number): string | typeof UNKNOWN {
  const parsed = parseCidrBlock(prefix);
  if (!parsed.ok || !Number.isInteger(newbits) || !Number.isInteger(netnum) || newbits < 0 || netnum < 0) return UNKNOWN;
  const bits = parsed.block.family === 'ipv4' ? 32 : 128;
  const length = parsed.block.prefix + newbits;
  if (length > bits || BigInt(netnum) >= 1n << BigInt(newbits)) return UNKNOWN;
  const start = parsed.block.start + (BigInt(netnum) << BigInt(bits - length));
  return formatCidrBlock({ family: parsed.block.family, start, end: start, prefix: length });
}
