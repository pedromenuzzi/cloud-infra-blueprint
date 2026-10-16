/**
 * The simulated terminal's expression evaluator: what an argument evaluates
 * to when Terraform plans it, or `UNKNOWN` ("known after apply") when it
 * depends on something only an apply creates (an id, an ARN).
 *
 * The subset of HCL lessons are written in: literals, templates and
 * heredocs, `var` / `local` / resource / `data` / `module` references with
 * attributes, indexes and splats, `count.index`, `each.key` / `each.value`,
 * arithmetic, comparisons, `&&` `||` `!`, conditionals, `for` expressions
 * and the common functions; `dynamic` blocks expanded into the blocks they
 * stand for. Anything else throws `Unsupported`, and the caller keeps the
 * argument as an opaque value (see `Opaque`).
 *
 * ponytail: src/ir/checks/repeatValues.ts has a smaller evaluator of the
 * same subset (no unknowns, no references to other blocks' results); fold it
 * into this one if the checks ever need conditionals or functions.
 */
import { parseFile } from '@/hcl/parser';
import { parseCidrBlock, formatAddress, formatCidrBlock } from '@/resources/cidr';
import { exprText } from '@/ir/repeat';
import type { Expression } from '@/ir/types';

export const UNKNOWN: unique symbol = Symbol('known after apply');

/** an argument written in syntax the evaluator doesn't model: compared and stored by its text */
export class Opaque {
  constructor(readonly text: string) {}
}

export type Val = string | number | boolean | null | Val[] | { [key: string]: Val } | typeof UNKNOWN | Opaque;

/** syntax or a function the evaluator doesn't model */
export class Unsupported extends Error {}

export interface Scope {
  /**
   * `var.x`, `local.x`, `aws_vpc.main`, `data` (`aws_ami.ubuntu`), `module.net`,
   * `count.index`, `each.key`… as a value; undefined when it isn't declared.
   */
  ref(root: string, name: string): Val | undefined;
  /** a file of the project, for `file()` */
  file?(path: string): string | undefined;
}

export const isObject = (v: Val): v is { [key: string]: Val } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Opaque);

/** the value holds something only an apply can tell */
export function hasUnknown(v: Val): boolean {
  if (v === UNKNOWN) return true;
  if (Array.isArray(v)) return v.some(hasUnknown);
  if (isObject(v)) return Object.values(v).some(hasUnknown);
  return false;
}

/* ------------------------------------------------------------------ the expression tree */

type Node =
  | { k: 'lit'; v: Val }
  | { k: 'tpl'; parts: Array<string | Node> }
  | { k: 'name'; name: string }
  | { k: 'attr'; of: Node; name: string }
  | { k: 'index'; of: Node; key: Node }
  /** `of[*]<each>`: `each` is applied to every item (bound as the name `*`) */
  | { k: 'splat'; of: Node; each: Node }
  | { k: 'call'; name: string; args: Node[]; expand: boolean }
  | { k: 'tuple'; items: Node[] }
  | { k: 'object'; items: Array<[Node, Node]> }
  | { k: 'unary'; op: string; x: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'cond'; c: Node; a: Node; b: Node }
  | { k: 'for'; key?: string; val: string; coll: Node; keyExpr?: Node; valExpr: Node; cond?: Node };

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; parts: Array<string | Node> }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '=>', '...', '(', ')', '[', ']', '{', '}', ',', '.', '+', '-', '*', '/', '%', '=', ':', '?', '!', '<', '>'];

/** `"text ${expr} text"` (from past the opening quote) or a heredoc body (`quoted` false): parts and where it ends */
function template(text: string, from: number, quoted: boolean): { parts: Array<string | Node>; next: number } {
  const parts: Array<string | Node> = [];
  let s = '';
  let i = from;
  while (i < text.length && !(quoted && (text[i] === '"' || text[i] === '\n'))) {
    const c = text[i];
    if (c === '\\' && quoted) {
      // only quoted strings have escapes
      const n = text[i + 1];
      s += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : (n ?? '');
      i += 2;
      continue;
    }
    if ((c === '$' || c === '%') && text[i + 1] === c && text[i + 2] === '{') {
      s += `${c}{`;
      i += 3;
      continue;
    }
    if (c === '%' && text[i + 1] === '{') throw new Unsupported('template directive');
    if (c === '$' && text[i + 1] === '{') {
      const close = closing(text, i + 2);
      if (close === -1) throw new Unsupported('unclosed interpolation');
      if (s) parts.push(s);
      s = '';
      parts.push(parse(text.slice(i + 2, close).replace(/^~|~$/g, '')));
      i = close + 1;
      continue;
    }
    s += c;
    i++;
  }
  if (s || parts.length === 0) parts.push(s);
  return { parts, next: i };
}

/** the index of the `}` closing an interpolation whose body starts at `from` */
function closing(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
    } else if (/\d/.test(c)) {
      const m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w-]*/.exec(text.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if (c === '"') {
      const { parts, next } = template(text, i + 1, true);
      if (text[next] !== '"') throw new Unsupported('unterminated string');
      out.push({ t: 'str', parts });
      i = next + 1;
    } else if (c === '<' && text[i + 1] === '<') {
      const m = /^<<(-?)([A-Za-z_][\w-]*)[ \t]*\n/.exec(text.slice(i));
      if (!m) throw new Unsupported('heredoc');
      const bodyStart = i + m[0].length;
      const endRe = new RegExp(`^[ \\t]*${m[2]}[ \\t]*$`, 'm');
      const rest = text.slice(bodyStart);
      const found = endRe.exec(rest);
      if (!found) throw new Unsupported('heredoc terminator');
      let body = rest.slice(0, found.index);
      if (m[1]) {
        // `<<-`: the common leading whitespace goes
        const lines = body.split('\n');
        const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
        body = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
      }
      out.push({ t: 'str', parts: template(body, 0, false).parts });
      i = bodyStart + found.index + found[0].length;
    } else {
      const op = OPS.find((o) => text.startsWith(o, i));
      if (!op) throw new Unsupported(`character ${c}`);
      out.push({ t: 'op', v: op });
      i += op.length;
    }
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  done() {
    return this.i === this.tokens.length;
  }

  private peek(v: string, ahead = 0): boolean {
    const t = this.tokens[this.i + ahead];
    return t !== undefined && (t.t === 'op' || t.t === 'id') && t.v === v;
  }

  private eat(v: string): boolean {
    if (!this.peek(v)) return false;
    this.i++;
    return true;
  }

  private expect(v: string) {
    if (!this.eat(v)) throw new Unsupported(`expected ${v}`);
  }

  private ident(): string {
    const t = this.tokens[this.i++];
    if (t?.t !== 'id') throw new Unsupported('expected a name');
    return t.v;
  }

  expr(): Node {
    const c = this.binary(0);
    if (!this.eat('?')) return c;
    const a = this.expr();
    this.expect(':');
    return { k: 'cond', c, a, b: this.expr() };
  }

  private static LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

  private binary(level: number): Node {
    if (level === Parser.LEVELS.length) return this.unary();
    let a = this.binary(level + 1);
    for (;;) {
      const op = Parser.LEVELS[level].find((o) => this.peek(o));
      if (!op) return a;
      this.i++;
      a = { k: 'bin', op, a, b: this.binary(level + 1) };
    }
  }

  private unary(): Node {
    if (this.eat('!')) return { k: 'unary', op: '!', x: this.unary() };
    if (this.eat('-')) return { k: 'unary', op: '-', x: this.unary() };
    return this.postfix(this.primary());
  }

  private postfix(start: Node): Node {
    let cur = start;
    for (;;) {
      if (this.peek('.') && this.peek('*', 1)) {
        this.i += 2;
        return { k: 'splat', of: cur, each: this.postfix({ k: 'name', name: '*' }) };
      }
      if (this.peek('[') && this.peek('*', 1) && this.peek(']', 2)) {
        this.i += 3;
        return { k: 'splat', of: cur, each: this.postfix({ k: 'name', name: '*' }) };
      }
      if (this.eat('.')) {
        const t = this.tokens[this.i++];
        if (t?.t === 'id') cur = { k: 'attr', of: cur, name: t.v };
        else if (t?.t === 'num') cur = { k: 'index', of: cur, key: { k: 'lit', v: t.v } };
        else throw new Unsupported('expected an attribute');
      } else if (this.eat('[')) {
        const key = this.expr();
        this.expect(']');
        cur = { k: 'index', of: cur, key };
      } else return cur;
    }
  }

  private primary(): Node {
    const t = this.tokens[this.i++];
    if (!t) throw new Unsupported('expected a value');
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return t.parts.length === 1 && typeof t.parts[0] === 'string' ? { k: 'lit', v: t.parts[0] } : { k: 'tpl', parts: t.parts };
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (this.eat('(')) {
        const args: Node[] = [];
        let expand = false;
        while (!this.peek(')')) {
          args.push(this.expr());
          if (this.eat('...')) expand = true;
          if (!this.eat(',')) break;
        }
        this.expect(')');
        return { k: 'call', name: t.v, args, expand };
      }
      return { k: 'name', name: t.v };
    }
    if (t.v === '(') {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.v === '[') {
      if (this.peek('for')) return this.forExpr(']');
      const items: Node[] = [];
      while (!this.peek(']')) {
        items.push(this.expr());
        if (!this.eat(',')) break;
      }
      this.expect(']');
      return { k: 'tuple', items };
    }
    if (t.v === '{') {
      if (this.peek('for')) return this.forExpr('}');
      const items: Array<[Node, Node]> = [];
      while (!this.peek('}')) {
        const key = this.tokens[this.i];
        // `name = …` is the key "name"; `(expr) = …` or `"text" = …` evaluate
        const k: Node = key?.t === 'id' && (this.peek('=', 1) || this.peek(':', 1)) ? (this.i++, { k: 'lit', v: key.v }) : this.expr();
        if (!this.eat('=')) this.expect(':');
        items.push([k, this.expr()]);
        this.eat(',');
      }
      this.expect('}');
      return { k: 'object', items };
    }
    throw new Unsupported(`unexpected ${t.v}`);
  }

  private forExpr(close: string): Node {
    this.expect('for');
    const first = this.ident();
    const second = this.eat(',') ? this.ident() : undefined;
    this.expect('in');
    const coll = this.expr();
    this.expect(':');
    let keyExpr: Node | undefined;
    let valExpr = this.expr();
    if (close === '}') {
      this.expect('=>');
      keyExpr = valExpr;
      valExpr = this.expr();
      if (this.eat('...')) throw new Unsupported('grouping');
    }
    const cond = this.eat('if') ? this.expr() : undefined;
    this.expect(close);
    return {
      k: 'for',
      key: second === undefined ? undefined : first,
      val: second ?? first,
      coll,
      keyExpr,
      valExpr,
      cond,
    };
  }
}

const parsed = new Map<string, Node>();

function parse(text: string): Node {
  let node = parsed.get(text);
  if (!node) {
    const p = new Parser(tokenize(text));
    node = p.expr();
    if (!p.done()) throw new Unsupported('trailing text');
    if (parsed.size > 2000) parsed.clear();
    parsed.set(text, node);
  }
  return node;
}

/* ------------------------------------------------------------------ evaluation */

type Env = Map<string, Val>;

/** Terraform converts between strings, numbers and bools where an operation needs one */
function toNumber(v: Val): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  throw new Unsupported('not a number');
}

function toBool(v: Val): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'false') return v === 'true';
  throw new Unsupported('not a bool');
}

export function toStr(v: Val): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new Unsupported('not a string');
}

const same = (a: Val, b: Val) => JSON.stringify(a) === JSON.stringify(b);

function getAttr(v: Val, name: string): Val {
  if (v === UNKNOWN) return UNKNOWN;
  if (isObject(v)) {
    if (Object.hasOwn(v, name)) return v[name];
    throw new Unsupported(`no attribute ${name}`);
  }
  throw new Unsupported('attribute of a non object');
}

function getIndex(v: Val, key: Val): Val {
  if (v === UNKNOWN || key === UNKNOWN) return UNKNOWN;
  if (Array.isArray(v)) {
    const i = toNumber(key);
    if (Number.isInteger(i) && i >= 0 && i < v.length) return v[i];
    throw new Unsupported('index out of range');
  }
  if (isObject(v)) {
    const k = toStr(key);
    if (Object.hasOwn(v, k)) return v[k];
    throw new Unsupported(`no key ${k}`);
  }
  throw new Unsupported('index of a non collection');
}

/** the root of a traversal (`var.x`, `aws_vpc.main`, `data.aws_ami.ubuntu`) when `node` is one */
function rootRef(node: Node, scope: Scope, env: Env): Val | 'none' {
  if (node.k !== 'attr') return 'none';
  let path: [string, string] | undefined;
  if (node.of.k === 'name' && !env.has(node.of.name) && node.of.name !== 'data') path = [node.of.name, node.name];
  else if (node.of.k === 'attr' && node.of.of.k === 'name' && node.of.of.name === 'data' && !env.has('data')) {
    path = ['data', `${node.of.name}.${node.name}`];
  }
  if (!path) return 'none';
  const v = scope.ref(...path);
  // undeclared: validation reports it with its line; here it's just not a value
  if (v === undefined) throw new Unsupported(`undeclared ${path.join('.')}`);
  return v;
}

function run(node: Node, scope: Scope, env: Env): Val {
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'tpl': {
      let s = '';
      for (const part of node.parts) {
        if (typeof part === 'string') {
          s += part;
          continue;
        }
        const v = run(part, scope, env);
        if (v === UNKNOWN) return UNKNOWN;
        s += toStr(v);
      }
      return s;
    }
    case 'name': {
      if (env.has(node.name)) return env.get(node.name)!;
      throw new Unsupported(`bare name ${node.name}`);
    }
    case 'attr': {
      const root = rootRef(node, scope, env);
      if (root !== 'none') return root;
      return getAttr(run(node.of, scope, env), node.name);
    }
    case 'index':
      return getIndex(run(node.of, scope, env), run(node.key, scope, env));
    case 'splat': {
      const of = run(node.of, scope, env);
      if (of === UNKNOWN) return UNKNOWN;
      // a single value splats as a one item list, null as an empty one
      const items = Array.isArray(of) ? of : of === null ? [] : [of];
      return items.map((item) => run(node.each, scope, new Map(env).set('*', item)));
    }
    case 'tuple':
      return node.items.map((item) => run(item, scope, env));
    case 'object': {
      const out: Record<string, Val> = {};
      for (const [k, v] of node.items) {
        const key = run(k, scope, env);
        if (key === UNKNOWN) return UNKNOWN;
        out[toStr(key)] = run(v, scope, env);
      }
      return out;
    }
    case 'unary': {
      const x = run(node.x, scope, env);
      if (x === UNKNOWN) return UNKNOWN;
      return node.op === '!' ? !toBool(x) : -toNumber(x);
    }
    case 'bin': {
      const { op } = node;
      const a = run(node.a, scope, env);
      // `false && …` / `true || …` don't need the other side
      if (op === '&&' && a !== UNKNOWN && toBool(a) === false) return false;
      if (op === '||' && a !== UNKNOWN && toBool(a) === true) return true;
      const b = run(node.b, scope, env);
      if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
      switch (op) {
        case '==':
          return same(a, b);
        case '!=':
          return !same(a, b);
        case '&&':
        case '||':
          return toBool(b);
        case '<':
          return toNumber(a) < toNumber(b);
        case '>':
          return toNumber(a) > toNumber(b);
        case '<=':
          return toNumber(a) <= toNumber(b);
        case '>=':
          return toNumber(a) >= toNumber(b);
        case '+':
          return toNumber(a) + toNumber(b);
        case '-':
          return toNumber(a) - toNumber(b);
        case '*':
          return toNumber(a) * toNumber(b);
        case '/':
          return toNumber(a) / toNumber(b);
        default:
          return toNumber(a) % toNumber(b);
      }
    }
    case 'cond': {
      const c = run(node.c, scope, env);
      if (c === UNKNOWN) return UNKNOWN;
      return toBool(c) ? run(node.a, scope, env) : run(node.b, scope, env);
    }
    case 'for': {
      const coll = run(node.coll, scope, env);
      if (coll === UNKNOWN) return UNKNOWN;
      const pairs: Array<[Val, Val]> = Array.isArray(coll)
        ? coll.map((v, i) => [i, v])
        : isObject(coll)
          ? Object.keys(coll)
              .sort()
              .map((k) => [k, coll[k]])
          : [];
      const list: Val[] = [];
      const map: Record<string, Val> = {};
      for (const [k, v] of pairs) {
        const inner = new Map(env).set(node.val, v);
        if (node.key !== undefined) inner.set(node.key, k);
        if (node.cond) {
          const ok = run(node.cond, scope, inner);
          if (ok === UNKNOWN) return UNKNOWN;
          if (!toBool(ok)) continue;
        }
        if (node.keyExpr) {
          const key = run(node.keyExpr, scope, inner);
          if (key === UNKNOWN) return UNKNOWN;
          map[toStr(key)] = run(node.valExpr, scope, inner);
        } else list.push(run(node.valExpr, scope, inner));
      }
      return node.keyExpr ? map : list;
    }
    case 'call':
      return call(node, scope, env);
  }
}

/* ------------------------------------------------------------------ functions */

/** functions that only need their arguments' shape: unknown items pass through */
const STRUCTURAL = new Set(['concat', 'merge', 'tolist', 'toset', 'tomap', 'element', 'lookup', 'values', 'keys', 'length', 'flatten', 'slice', 'reverse', 'one', 'coalesce']);

function call(node: Extract<Node, { k: 'call' }>, scope: Scope, env: Env): Val {
  const { name } = node;
  if (name === 'try' || name === 'can') {
    for (const arg of node.args) {
      try {
        const v = run(arg, scope, env);
        return name === 'can' ? (v === UNKNOWN ? UNKNOWN : true) : v;
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
      }
    }
    if (name === 'can') return false;
    throw new Unsupported('try: no argument worked');
  }
  let args = node.args.map((a) => run(a, scope, env));
  if (node.expand) {
    const last = args.at(-1)!;
    if (last === UNKNOWN) return UNKNOWN;
    if (!Array.isArray(last)) throw new Unsupported('... of a non list');
    args = [...args.slice(0, -1), ...last];
  }
  if (STRUCTURAL.has(name) ? args.some((a) => a === UNKNOWN) : args.some(hasUnknown)) return UNKNOWN;
  const fn = FUNCTIONS[name];
  if (!fn) throw new Unsupported(`function ${name}`);
  return name === 'file' ? fileOf(args, scope) : fn(args);
}

function fileOf(args: Val[], scope: Scope): Val {
  const path = toStr(args[0]).replace(/^(\$\{path\.module\}|\.)\//, '');
  const text = scope.file?.(path);
  if (text === undefined) throw new Unsupported('file not found');
  return text;
}

const list = (v: Val): Val[] => {
  if (Array.isArray(v)) return v;
  throw new Unsupported('not a list');
};

const obj = (v: Val): { [key: string]: Val } => {
  if (isObject(v)) return v;
  throw new Unsupported('not a map');
};

/** Terraform's `format` verbs: %s %d %v %q %%, with an optional width */
function format(spec: string, args: Val[]): string {
  let n = 0;
  return spec.replace(/%(-?\d*)([sdvq%f])/g, (_, width: string, verb: string) => {
    if (verb === '%') return '%';
    const v = args[n++];
    if (v === undefined) throw new Unsupported('format: too few arguments');
    let s = verb === 'q' ? JSON.stringify(toStr(v)) : verb === 'd' ? String(Math.trunc(toNumber(v))) : verb === 'f' ? toNumber(v).toFixed(6) : toStr(v);
    const w = Number(width);
    if (w) s = w < 0 ? s.padEnd(-w) : s.padStart(w, width.startsWith('0') ? '0' : ' ');
    return s;
  });
}

/** `jsonencode`: keys sorted, like Terraform's */
function json(v: Val): string {
  if (v instanceof Opaque || v === UNKNOWN) throw new Unsupported('jsonencode of an opaque value');
  if (Array.isArray(v)) return `[${v.map(json).join(',')}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${json(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function cidr(prefix: Val) {
  const parsed = parseCidrBlock(toStr(prefix));
  if (!parsed.ok) throw new Unsupported('not a CIDR');
  return { ...parsed.block, bits: parsed.block.family === 'ipv4' ? 32 : 128 };
}

const FUNCTIONS: Record<string, (a: Val[]) => Val> = {
  abs: ([x]) => Math.abs(toNumber(x)),
  ceil: ([x]) => Math.ceil(toNumber(x)),
  floor: ([x]) => Math.floor(toNumber(x)),
  max: (a) => Math.max(...a.map(toNumber)),
  min: (a) => Math.min(...a.map(toNumber)),
  pow: ([x, y]) => toNumber(x) ** toNumber(y),
  signum: ([x]) => Math.sign(toNumber(x)),
  parseint: ([s, base]) => parseInt(toStr(s), toNumber(base)),
  chomp: ([s]) => toStr(s).replace(/(\r?\n)+$/, ''),
  format: ([spec, ...rest]) => format(toStr(spec), rest),
  formatlist: ([spec, ...rest]) => {
    const n = Math.max(...rest.map((r) => (Array.isArray(r) ? r.length : 1)));
    return Array.from({ length: n }, (_, i) => format(toStr(spec), rest.map((r) => (Array.isArray(r) ? r[i] : r))));
  },
  join: ([sep, ...lists]) => lists.flatMap(list).map(toStr).join(toStr(sep)),
  split: ([sep, s]) => toStr(s).split(toStr(sep)),
  lower: ([s]) => toStr(s).toLowerCase(),
  upper: ([s]) => toStr(s).toUpperCase(),
  title: ([s]) => toStr(s).replace(/\b\w/g, (c) => c.toUpperCase()),
  replace: ([s, from, to]) => {
    const f = toStr(from);
    const m = /^\/(.*)\/$/.exec(f);
    return m ? toStr(s).replace(new RegExp(m[1], 'g'), toStr(to)) : toStr(s).split(f).join(toStr(to));
  },
  substr: ([s, offset, length]) => {
    const chars = [...toStr(s)];
    const o = toNumber(offset);
    const start = o < 0 ? chars.length + o : o;
    const l = toNumber(length);
    return chars.slice(start, l < 0 ? undefined : start + l).join('');
  },
  trim: ([s, cut]) => {
    const set = new Set(toStr(cut));
    const chars = [...toStr(s)];
    while (chars.length && set.has(chars[0])) chars.shift();
    while (chars.length && set.has(chars.at(-1)!)) chars.pop();
    return chars.join('');
  },
  trimspace: ([s]) => toStr(s).trim(),
  trimprefix: ([s, p]) => (toStr(s).startsWith(toStr(p)) ? toStr(s).slice(toStr(p).length) : toStr(s)),
  trimsuffix: ([s, p]) => (toStr(s).endsWith(toStr(p)) ? toStr(s).slice(0, -toStr(p).length || undefined) : toStr(s)),
  startswith: ([s, p]) => toStr(s).startsWith(toStr(p)),
  endswith: ([s, p]) => toStr(s).endsWith(toStr(p)),
  strrev: ([s]) => [...toStr(s)].reverse().join(''),
  concat: (a) => a.flatMap(list),
  contains: ([l, v]) => list(l).some((x) => same(x, v)),
  distinct: ([l]) => list(l).filter((x, i, all) => all.findIndex((y) => same(x, y)) === i),
  element: ([l, i]) => {
    const items = list(l);
    if (items.length === 0) throw new Unsupported('element of an empty list');
    return items[toNumber(i) % items.length];
  },
  flatten: ([l]) => {
    const flat = (v: Val[]): Val[] => v.flatMap((x) => (Array.isArray(x) ? flat(x) : [x]));
    return flat(list(l));
  },
  index: ([l, v]) => {
    const i = list(l).findIndex((x) => same(x, v));
    if (i === -1) throw new Unsupported('index: not found');
    return i;
  },
  keys: ([m]) => Object.keys(obj(m)).sort(),
  values: ([m]) => {
    const o = obj(m);
    return Object.keys(o)
      .sort()
      .map((k) => o[k]);
  },
  length: ([v]) => (Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : [...toStr(v)].length),
  lookup: ([m, k, fallback]) => {
    const o = obj(m);
    const key = toStr(k);
    if (Object.hasOwn(o, key)) return o[key];
    if (fallback === undefined) throw new Unsupported('lookup: no key');
    return fallback;
  },
  merge: (a) => Object.assign({}, ...a.filter((x) => x !== null).map(obj)) as Val,
  one: ([l]) => {
    const items = list(l);
    if (items.length > 1) throw new Unsupported('one: more than one');
    return items[0] ?? null;
  },
  range: (a) => {
    const [start, end, step] = a.length === 1 ? [0, toNumber(a[0]), 1] : [toNumber(a[0]), toNumber(a[1]), a[2] === undefined ? 1 : toNumber(a[2])];
    const out: number[] = [];
    for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i);
    return out;
  },
  reverse: ([l]) => [...list(l)].reverse(),
  slice: ([l, from, to]) => list(l).slice(toNumber(from), toNumber(to)),
  sort: ([l]) => list(l).map(toStr).sort(),
  toset: ([l]) => (hasUnknown(l) ? UNKNOWN : FUNCTIONS.sort([FUNCTIONS.distinct([l])])),
  tolist: ([l]) => list(l),
  tomap: ([m]) => obj(m),
  tostring: ([v]) => (v === null ? null : toStr(v)),
  tonumber: ([v]) => (v === null ? null : toNumber(v)),
  tobool: ([v]) => (v === null ? null : toBool(v)),
  zipmap: ([k, v]) => Object.fromEntries(list(k).map((key, i) => [toStr(key), list(v)[i]])),
  coalesce: (a) => {
    const v = a.find((x) => x !== null && x !== '');
    if (v === undefined) throw new Unsupported('coalesce: no value');
    return v;
  },
  coalescelist: (a) => a.map(list).find((l) => l.length > 0) ?? [],
  compact: ([l]) => list(l).filter((x) => x !== null && x !== ''),
  jsonencode: ([v]) => json(v),
  jsondecode: ([s]) => JSON.parse(toStr(s)) as Val,
  base64encode: ([s]) => btoa(String.fromCharCode(...new TextEncoder().encode(toStr(s)))),
  cidrsubnet: ([prefix, newbits, netnum]) => {
    const c = cidr(prefix);
    const length = c.prefix + toNumber(newbits);
    if (length > c.bits || BigInt(toNumber(netnum)) >= 1n << BigInt(toNumber(newbits))) throw new Unsupported('cidrsubnet: out of range');
    const start = c.start + (BigInt(toNumber(netnum)) << BigInt(c.bits - length));
    return formatCidrBlock({ family: c.family, start, end: start, prefix: length });
  },
  cidrhost: ([prefix, hostnum]) => {
    const c = cidr(prefix);
    return formatAddress(c.start + BigInt(toNumber(hostnum)), c.family);
  },
  cidrnetmask: ([prefix]) => {
    const c = cidr(prefix);
    return formatAddress(((1n << 32n) - 1n) ^ ((1n << BigInt(32 - c.prefix)) - 1n), 'ipv4');
  },
  file: () => null, // read through the scope (fileOf)
  // the value as it is: what's sensitive is told from the references (simulate.ts `isSensitive`)
  sensitive: ([v]) => v,
  nonsensitive: ([v]) => v,
};

/* ------------------------------------------------------------------ entry points */

/**
 * The value of an argument. Nested blocks come out as objects (`blocks` as
 * lists of them). Syntax the evaluator doesn't model gives an `Opaque` of
 * its text (a reference to something undeclared too: validation reports those).
 */
export function evaluate(e: Expression, scope: Scope, env: Env = new Map()): Val {
  switch (e.kind) {
    case 'literal':
      return e.value;
    case 'list':
      return e.items.map((item) => evaluate(item, scope, env));
    case 'object':
      return evaluateRecord(e.fields, scope, env);
    case 'block':
      return evaluateRecord(e.body, scope, env);
    case 'blocks':
      return e.items.map((body) => evaluateRecord(body, scope, env));
    default: {
      const text = exprText(e);
      try {
        return run(parse(text), scope, env);
      } catch (err) {
        if (err instanceof Unsupported) return new Opaque(text);
        throw err;
      }
    }
  }
}

export function evaluateRecord(record: Record<string, Expression>, scope: Scope, env: Env = new Map()): { [key: string]: Val } {
  const out: { [key: string]: Val } = {};
  const dynamics: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(record)) {
    const label = dynamicLabel(k);
    if (label !== undefined && v.kind === 'raw') dynamics.push([label, v.hcl]);
    else out[k] = evaluate(v, scope, env);
  }
  // ponytail: dynamic blocks go after the static ones of the same name, not in source order
  for (const [label, hcl] of dynamics) {
    const items = dynamicBlocks(hcl, scope, env);
    const had = out[label];
    const before: Val[] = had === undefined ? [] : Array.isArray(had) ? had : [had];
    out[label] = Array.isArray(items) ? [...before, ...items] : items;
  }
  return out;
}

/** the block name a `dynamic "ingress" { … }` entry stands for (the parser keeps it verbatim, keyed `dynamic "ingress" #0`) */
export const dynamicLabel = (key: string): string | undefined => /^dynamic "([^"]+)" #\d+$/.exec(key)?.[1];

/**
 * A `dynamic` block's expansion: one `content` body per item of `for_each`,
 * with the iterator (the label, or `iterator = name`) as `{ key, value }`
 * (the index for a list, the key for a map).
 */
function dynamicBlocks(hcl: string, scope: Scope, env: Env): Val {
  const body = hcl.slice(hcl.indexOf('{') + 1, hcl.lastIndexOf('}'));
  // parsed as an `output` body: a block kind the parser reads argument by argument
  const [block] = parseFile('dynamic.tf', `output "dynamic" {\n${body}\n}\n`).blocks;
  const args = block?.kind === 'labeled' ? block.args : {};
  const content = args.content;
  if (!args.for_each || content?.kind !== 'block') return new Opaque(hcl);
  const iterator = args.iterator ? exprText(args.iterator).trim() : /^dynamic\s+"([^"]+)"/.exec(hcl)?.[1];
  const coll = evaluate(args.for_each, scope, env);
  if (coll === UNKNOWN) return UNKNOWN;
  if (!iterator || coll instanceof Opaque) return new Opaque(hcl);
  const pairs: Array<[Val, Val]> = Array.isArray(coll) ? coll.map((v, i) => [i, v]) : isObject(coll) ? Object.keys(coll).sort().map((k) => [k, coll[k]]) : [];
  return pairs.map(([key, value]) => evaluateRecord(content.body, scope, new Map(env).set(iterator, { key, value })));
}

/** `count.index` / `each.key` / `each.value` for one instance */
export const instanceEnv = (count?: number, each?: { key: string; value: Val }): Env => {
  const env: Env = new Map();
  if (count !== undefined) env.set('count', { index: count });
  if (each) env.set('each', { key: each.key, value: each.value });
  return env;
};
