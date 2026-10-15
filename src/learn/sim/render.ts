/**
 * The terminal's text, in Terraform's own format and symbols: plan diffs
 * (`+`, `~`, `-/+`, `-`), values as the CLI prints them (maps with quoted
 * keys, lists with trailing commas, `jsonencode(…)` for JSON strings,
 * `(known after apply)`), error boxes and the Outputs section. It stays in
 * English in both UI languages: it's what learners will read in real life.
 */
import { isObject, Opaque, UNKNOWN, type Val } from './eval';

export type Tone = 'add' | 'change' | 'destroy' | 'replace' | 'error' | 'warning' | 'success' | 'strong' | 'muted';

export interface Line {
  text: string;
  /** diff tones color the line's symbol; the others the whole line */
  tone?: Tone;
  /** the terminal waits a beat after it (`Creating...`), so the output feels like it's running */
  pause?: boolean;
}

export const line = (text = '', tone?: Tone, pause?: boolean): Line => (tone ? { text, tone, ...(pause ? { pause } : {}) } : { text });

type Sym = '+' | '-' | '~' | ' ';
const pad = (n: number) => ' '.repeat(Math.max(0, n));
const TONE: Record<Sym, Tone | undefined> = { '+': 'add', '-': 'destroy', '~': 'change', ' ': undefined };

/** a state attribute (always a string) as the value it stood for, when the planned value says what type it is */
export function decode(s: string, like?: Val): Val {
  if (typeof like === 'number' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (typeof like === 'boolean' && (s === 'true' || s === 'false')) return s === 'true';
  if (typeof like === 'string' || like === UNKNOWN || like instanceof Opaque) return s;
  if (/^[[{]/.test(s)) {
    try {
      return JSON.parse(s) as Val;
    } catch {
      return s;
    }
  }
  return s;
}

/** how a value is stored in the state: strings as they are, the rest as JSON */
export function serialize(v: Val): string {
  if (typeof v === 'string') return v;
  if (v instanceof Opaque) return v.text;
  return JSON.stringify(v, (_k, x: unknown) => (x instanceof Opaque ? x.text : x));
}

/** a JSON object or list written as a string (a policy): shown as `jsonencode(…)` */
function jsonValue(v: Val): Val | undefined {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return undefined;
  try {
    return JSON.parse(v) as Val;
  } catch {
    return undefined;
  }
}

export function scalar(v: Val): string {
  if (v === UNKNOWN || v instanceof Opaque) return '(known after apply)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v.includes('\n') ? `<<-EOT\n${v}EOT` : JSON.stringify(v);
  return String(v);
}

const keyText = (k: string, bare: boolean) => (bare && /^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k));

/**
 * `v` as the value of an entry whose symbol sits at column `col`: the text
 * that follows `name = ` on the entry's line, then any further lines.
 * Children sit 4 columns in, closing brackets 2.
 */
function show(v: Val, sym: Sym, col: number, bare = false): string[] {
  const json = jsonValue(v);
  if (json !== undefined && (Array.isArray(json) || isObject(json))) {
    const [first, ...rest] = show(json, sym, col + 4, true);
    return ['jsonencode(', `${pad(col + 6)}${first}`, ...rest, `${pad(col + 2)})`];
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return ['[]'];
    const out = ['['];
    for (const item of v) {
      const [first, ...rest] = show(item, sym, col + 4, bare);
      out.push(`${pad(col + 4)}${sym} ${first}`, ...rest);
      out[out.length - 1] += ',';
    }
    out.push(`${pad(col + 2)}]`);
    return out;
  }
  if (isObject(v)) {
    const keys = Object.keys(v).sort();
    if (keys.length === 0) return ['{}'];
    const width = Math.max(...keys.map((k) => keyText(k, bare).length));
    const out = ['{'];
    for (const k of keys) {
      const [first, ...rest] = show(v[k], sym, col + 4, bare);
      out.push(`${pad(col + 4)}${sym} ${keyText(k, bare).padEnd(width)} = ${first}`, ...rest);
    }
    out.push(`${pad(col + 2)}}`);
    return out;
  }
  return [scalar(v)];
}

/** an entry (`name = value`) with every line marked by `sym`, `-> null` after a removed one */
function entry(sym: Sym, col: number, name: string, width: number, v: Val, bare: boolean, gone = false): Line[] {
  const [first, ...rest] = show(v, sym, col, bare);
  const texts = [`${pad(col)}${sym} ${name.padEnd(width)} = ${first}`, ...rest];
  if (gone) texts[texts.length - 1] += ' -> null';
  return texts.map((text) => line(text, TONE[sym]));
}

/** a nested block (`versioning { … }`), each of its attributes marked by `sym` */
function blockLines(sym: Sym, col: number, name: string, body: Val): Line[] {
  const out = [line(`${pad(col)}${sym} ${name} {`, TONE[sym])];
  out.push(...bodyLines(sym, col + 4, isObject(body) ? body : {}, new Set()));
  out.push(line(`${pad(col + 2)}}`));
  return out;
}

const blockItems = (v: Val | undefined): Val[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** a block's whole body under one symbol: attributes sorted and aligned, then the nested blocks */
function bodyLines(sym: Sym, col: number, body: Record<string, Val>, blocks: Set<string>, gone = false): Line[] {
  const attrs = Object.keys(body)
    .filter((k) => !blocks.has(k) && body[k] !== null)
    .sort();
  const width = Math.max(0, ...attrs.map((k) => keyText(k, true).length));
  const out: Line[] = [];
  for (const k of attrs) out.push(...entry(sym, col, keyText(k, true), width, body[k], false, gone));
  for (const k of [...blocks].filter((b) => b in body).sort()) {
    for (const item of blockItems(body[k])) out.push(...blockLines(sym, col, k, item));
  }
  return out;
}

const unknownish = (v: Val) => v === UNKNOWN || v instanceof Opaque;

const same = (a: Val | undefined, b: Val | undefined) =>
  a !== undefined && b !== undefined && !unknownish(a) && !unknownish(b) && serialize(a) === serialize(b);

function hidden(col: number, n: number, what: 'attribute' | 'element' | 'block'): Line[] {
  return n > 0 ? [line(`${pad(col + 2)}# (${n} unchanged ${what}${n === 1 ? '' : 's'} hidden)`, 'muted')] : [];
}

/** one attribute's change in an update or a replacement */
function diffEntry(col: number, name: string, width: number, before: Val | undefined, after: Val | undefined, bare: boolean, note = ''): Line[] {
  if (before === undefined || before === null) return after === undefined || after === null ? [] : entry('+', col, name, width, after, bare);
  if (after === undefined || after === null) return entry('-', col, name, width, before, bare, true);
  const jb = jsonValue(before);
  const ja = jsonValue(after);
  if (jb !== undefined && ja !== undefined) {
    const inner = diffValue(col + 4, jb, ja, true);
    return [
      line(`${pad(col)}~ ${name.padEnd(width)} = jsonencode(`, 'change'),
      ...inner.map((l, i) => (i === 0 ? { ...l, text: `${pad(col + 6)}${l.text.trimStart()}` } : l)),
      line(`${pad(col + 2)})${note}`),
    ];
  }
  if ((isObject(before) && isObject(after)) || (Array.isArray(before) && Array.isArray(after))) {
    const [first, ...rest] = diffValue(col, before, after, bare);
    return [{ ...first, text: `${pad(col)}~ ${name.padEnd(width)} = ${first.text.trimStart()}` }, ...rest];
  }
  const shown = (v: Val) => (unknownish(v) ? '(known after apply)' : show(v, ' ', col, bare).join(' ').replace(/\s+/g, ' '));
  return [line(`${pad(col)}~ ${name.padEnd(width)} = ${shown(before)} -> ${shown(after)}${note}`, 'change')];
}

/** a map's or list's changes: first line is the opening bracket (at `col`'s entry), then the members */
function diffValue(col: number, before: Val, after: Val, bare: boolean): Line[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const changed = keys.filter((k) => !same(before[k], after[k]));
    const width = Math.max(0, ...changed.map((k) => keyText(k, bare).length));
    const out = [line('{', 'change')];
    for (const k of changed) out.push(...diffEntry(col + 4, keyText(k, bare), width, before[k], after[k], bare));
    out.push(...hidden(col + 2, keys.length - changed.length, 'element'), line(`${pad(col + 2)}}`));
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const key = (v: Val) => serialize(v);
    const kept = new Set(after.map(key));
    const had = new Set(before.map(key));
    const out = [line('[', 'change')];
    for (const v of before) if (!kept.has(key(v))) out.push(...itemLines('-', col + 4, v, bare));
    for (const v of after) if (!had.has(key(v)) || unknownish(v)) out.push(...itemLines('+', col + 4, v, bare));
    out.push(...hidden(col + 2, after.filter((v) => had.has(key(v)) && !unknownish(v)).length, 'element'), line(`${pad(col + 2)}]`));
    return out;
  }
  return [line(`${scalar(before)} -> ${scalar(after)}`, 'change')];
}

function itemLines(sym: Sym, col: number, v: Val, bare: boolean): Line[] {
  const [first, ...rest] = show(v, sym, col, bare);
  const texts = [`${pad(col)}${sym} ${first}`, ...rest];
  texts[texts.length - 1] += ',';
  return texts.map((text) => line(text, TONE[sym]));
}

/* ------------------------------------------------------------------ resource changes */

/** `read`: a data source read during apply (`<=`) */
export type ChangeAction = 'create' | 'update' | 'replace' | 'delete' | 'read' | 'noop';

export interface ResourceChange {
  /** `aws_subnet.public[0]`, `module.net.aws_vpc.this` */
  address: string;
  type: string;
  name: string;
  action: ChangeAction;
  /** the state's attributes (update, replace, delete) */
  before?: Record<string, string>;
  /** the planned values: the arguments, and the computed attributes (`UNKNOWN` until apply) */
  after?: Record<string, Val>;
  /** which attributes are nested blocks */
  blocks: Set<string>;
  /** attributes whose change forces the replacement */
  forced?: Set<string>;
  /** `lifecycle { create_before_destroy = true }` */
  createFirst?: boolean;
  /** why a delete happens, when it isn't obvious; why a read waits for the apply */
  because?: string;
  /** the address a `moved` block took it from */
  movedFrom?: string;
}

/** attributes an update always shows, changed or not (what identifies the object) */
const IDENTIFYING = new Set(['id', 'name', 'tags']);

const HEADS: Record<ChangeAction, string> = {
  create: 'will be created',
  update: 'will be updated in-place',
  replace: 'must be replaced',
  delete: 'will be destroyed',
  read: 'will be read during apply',
  noop: '',
};

export function changeLines(c: ResourceChange): Line[] {
  const moveOnly = c.action === 'noop' && c.movedFrom !== undefined;
  const out: Line[] = [line(moveOnly ? `  # ${c.movedFrom} has moved to ${c.address}` : `  # ${c.address} ${HEADS[c.action]}`, 'strong')];
  if (c.movedFrom !== undefined && !moveOnly) out.push(line(`  # (moved from ${c.movedFrom})`, 'strong'));
  if (c.action === 'read') out.push(line(`  # (${c.because ?? 'config refers to values not yet known'})`, 'strong'));
  else if (c.because) out.push(line(`  # (because ${c.because})`, 'strong'));
  const open = `${c.action === 'read' ? 'data' : 'resource'} "${c.type}" "${c.name}" {`;
  if (c.action === 'create' || c.action === 'read') {
    out.push(c.action === 'read' ? line(` <= ${open}`, 'change') : line(`  + ${open}`, 'add'), ...bodyLines('+', 6, c.after ?? {}, c.blocks));
  } else if (c.action === 'delete') {
    const body: Record<string, Val> = Object.fromEntries(Object.entries(c.before ?? {}).map(([k, v]) => [k, decode(v)]));
    out.push(line(`  - ${open}`, 'destroy'), ...bodyLines('-', 6, body, new Set(), true));
  } else {
    out.push(
      c.action === 'noop' ? line(`    ${open}`) : c.action === 'update' ? line(`  ~ ${open}`, 'change') : line(`${c.createFirst ? '+/-' : '-/+'} ${open}`, 'replace'),
    );
    const before = c.before ?? {};
    const after = c.after ?? {};
    const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const attrs = names.filter((k) => !c.blocks.has(k));
    const val = (k: string) => (before[k] === undefined ? undefined : decode(before[k], after[k]));
    const changed = attrs.filter((k) => !same(val(k), after[k]) && !(val(k) === undefined && (after[k] === null || after[k] === undefined)));
    const shownSame = attrs.filter((k) => !changed.includes(k) && IDENTIFYING.has(k) && val(k) !== undefined);
    const width = Math.max(0, ...[...changed, ...shownSame].map((k) => keyText(k, true).length));
    for (const k of attrs) {
      if (shownSame.includes(k)) out.push(...entry(' ', 6, keyText(k, true), width, val(k)!, false));
      else if (changed.includes(k)) {
        out.push(...diffEntry(6, keyText(k, true), width, val(k), after[k], false, c.forced?.has(k) ? ' # forces replacement' : ''));
      }
    }
    let sameBlocks = 0;
    for (const k of [...c.blocks].sort()) {
      const was = blockItems(before[k] === undefined ? undefined : decode(before[k]));
      const now = blockItems(after[k]);
      for (let i = 0; i < Math.max(was.length, now.length); i++) {
        if (i >= now.length) out.push(...blockLines('-', 6, k, was[i]));
        else if (i >= was.length) out.push(...blockLines('+', 6, k, now[i]));
        else if (same(was[i], now[i])) sameBlocks++;
        else {
          const b = isObject(was[i]) ? (was[i] as Record<string, Val>) : {};
          const a = isObject(now[i]) ? (now[i] as Record<string, Val>) : {};
          const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort().filter((x) => !same(b[x], a[x]));
          const w = Math.max(0, ...keys.map((x) => x.length));
          const forced = c.forced?.has(k) ? ' # forces replacement' : '';
          out.push(line(`      ~ ${k} {${forced}`, 'change'));
          for (const x of keys) out.push(...diffEntry(10, keyText(x, true), w, b[x], a[x], false));
          out.push(...hidden(8, Object.keys(a).length - keys.length, 'attribute'), line('        }'));
        }
      }
    }
    out.push(...hidden(6, attrs.length - changed.length - shownSame.length, 'attribute'), ...hidden(6, sameBlocks, 'block'));
  }
  out.push(line('    }'), line());
  return out;
}

/* ------------------------------------------------------------------ outputs */

export interface OutputChange {
  name: string;
  before?: string;
  after?: Val;
  sensitive?: boolean;
}

/** the "Changes to Outputs:" entries */
export function outputChangeLines(changes: OutputChange[]): Line[] {
  const width = Math.max(0, ...changes.map((c) => c.name.length));
  const out: Line[] = [];
  for (const c of changes) {
    const after = c.sensitive && c.after !== undefined ? '(sensitive value)' : c.after;
    const before = c.sensitive && c.before !== undefined ? '(sensitive value)' : c.before === undefined ? undefined : decode(c.before, c.after);
    if (c.sensitive) {
      const sym: Sym = c.before === undefined ? '+' : c.after === undefined ? '-' : '~';
      out.push(line(`  ${sym} ${c.name.padEnd(width)} = (sensitive value)${sym === '-' ? ' -> null' : ''}`, TONE[sym]));
    } else if (before === undefined) out.push(...entry('+', 2, c.name, width, after!, false));
    else if (after === undefined) out.push(...entry('-', 2, c.name, width, before, false, true));
    else out.push(...diffEntry(2, c.name, width, before, after, false));
  }
  return out;
}

/** `name = value` as the Outputs section after an apply (and `terraform output`) prints it */
export function outputValueLines(name: string, v: Val, sensitive: boolean): Line[] {
  if (sensitive) return [line(`${name} = <sensitive>`)];
  const plain = (x: Val, col: number): string[] => {
    if (Array.isArray(x)) {
      if (x.length === 0) return ['[]'];
      const out = ['['];
      for (const item of x) {
        const [first, ...rest] = plain(item, col + 2);
        out.push(`${pad(col + 2)}${first}`, ...rest);
        out[out.length - 1] += ',';
      }
      return [...out, `${pad(col)}]`];
    }
    if (isObject(x)) {
      const keys = Object.keys(x).sort();
      if (keys.length === 0) return ['{}'];
      const width = Math.max(...keys.map((k) => JSON.stringify(k).length));
      const out = ['{'];
      for (const k of keys) {
        const [first, ...rest] = plain(x[k], col + 2);
        out.push(`${pad(col + 2)}${JSON.stringify(k).padEnd(width)} = ${first}`, ...rest);
      }
      return [...out, `${pad(col)}}`];
    }
    return [scalar(x)];
  };
  const [first, ...rest] = plain(v, 0);
  return [line(`${name} = ${first}`), ...rest.map((t) => line(t))];
}

/* ------------------------------------------------------------------ diagnostics */

export interface Problem {
  severity: 'error' | 'warning';
  summary: string;
  detail?: string;
  file?: string;
  line?: number;
  /** `resource "aws_subnet" "a"`: the block the line is in */
  block?: string;
  /** the source line, for the excerpt */
  source?: string;
}

/** a diagnostic in Terraform's box: `╷ │ Error: … ╵` */
export function problemLines(p: Problem): Line[] {
  const tone: Tone = p.severity === 'error' ? 'error' : 'warning';
  const out: Line[] = [line('╷', tone), line(`│ ${p.severity === 'error' ? 'Error' : 'Warning'}: ${p.summary}`, tone), line('│', tone)];
  if (p.file && p.line) {
    out.push(line(`│   on ${p.file} line ${p.line}${p.block ? `, in ${p.block}` : ''}:`, tone));
    if (p.source !== undefined) out.push(line(`│ ${String(p.line).padStart(4)}: ${p.source}`, tone));
    if (p.detail) out.push(line('│', tone));
  }
  if (p.detail) for (const t of p.detail.split('\n')) out.push(line(`│ ${t}`, tone));
  out.push(line('╵', tone));
  return out;
}
