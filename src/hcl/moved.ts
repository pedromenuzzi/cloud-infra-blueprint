/**
 * `moved {}` blocks — how Terraform keeps an object's state when its address
 * changes (a rename, adding or removing `count` / `for_each`):
 *
 *   moved {
 *     from = aws_instance.web
 *     to   = aws_instance.app
 *   }
 *
 * They stay verbatim blocks in the IR (`ir.extras`), so an untouched file
 * round-trips byte for byte. This module reads them and plans the ops that
 * record a move (`moveOps`), used by renames and repetition changes — and,
 * later, by module renames (`module.a` → `module.b` is the same statement).
 *
 * Collapsing. A block this editing session wrote hasn't been applied yet, so
 * a second move of the same object rewrites it (a→b then b→c is one a→c
 * block; renaming back removes it). A block that was already in the files
 * may have been applied: it is history and is never rewritten — a new move
 * chains after it (a→b stays, b→c is added; Terraform follows chains). The
 * caller says which blocks are history (the editor: the ones present when
 * the project was opened).
 */
import type { Op } from '@/ir/ops';
import type { IR, RawBlock } from '@/ir/types';

export interface MovedStatement {
  from: string;
  to: string;
}

export interface MovedBlock extends MovedStatement {
  /** the extra's id in the IR */
  id: string;
  text: string;
  /** where `to`'s value sits in `text` */
  toSpan: [number, number];
}

const MOVED_RE = /^\s*moved\s*\{/;
/** blocks whose addresses name state, not configuration: a rename must not rewrite them */
const STATE_BLOCK_RE = /^\s*(?:moved|removed)\s*\{/;

export const isMovedText = (text: string) => MOVED_RE.test(text);
export const isStateBlockText = (text: string) => STATE_BLOCK_RE.test(text);

/** a line's code without a trailing `#` / `//` comment (quote-aware) */
function codeEnd(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '#' || (c === '/' && line[i + 1] === '/')) return i;
  }
  return line.length;
}

/** `from` / `to` of a verbatim `moved {}` block, or null when the text isn't one we can read */
export function readMoved(text: string): (MovedStatement & { toSpan: [number, number] }) | null {
  if (!MOVED_RE.test(text)) return null;
  let from: string | undefined;
  let to: string | undefined;
  let toSpan: [number, number] | undefined;
  let offset = 0;
  for (const line of text.split('\n')) {
    const m = /^([ \t]*(?:moved[ \t]*\{[ \t]*)?)(from|to)([ \t]*=[ \t]*)/.exec(line);
    if (m) {
      const start = m[0].length;
      const end = start + line.slice(start, codeEnd(line)).trimEnd().length;
      const value = line.slice(start, end);
      if (value && m[2] === 'from') from = value;
      if (value && m[2] === 'to') {
        to = value;
        toSpan = [offset + start, offset + end];
      }
    }
    offset += line.length + 1;
  }
  return from && to && toSpan ? { from, to, toSpan } : null;
}

/** every `moved {}` block of the project */
export function movedBlocks(ir: IR): MovedBlock[] {
  const out: MovedBlock[] = [];
  for (const b of ir.extras) {
    const m = readMoved(b.text);
    if (m) out.push({ id: b.id, text: b.text, ...m });
  }
  return out;
}

export function emitMoved(from: string, to: string): string {
  return `moved {\n  from = ${from}\n  to   = ${to}\n}`;
}

/** identifies a statement across re-parses */
export const movedKey = (m: MovedStatement) => `${m.from}\u0000${m.to}`;

/** the resource part of an address: `aws_instance.web["a"]` → `aws_instance.web` (module paths kept) */
const baseOf = (address: string) => {
  const bracket = address.indexOf('[');
  return bracket === -1 ? address : address.slice(0, bracket);
};
const isWhole = (address: string) => !address.includes('[');

/** `to` points at `from` in a way a new move of `from` continues */
function continues(to: string, move: MovedStatement): boolean {
  if (to === move.from) return true;
  // renaming a whole resource carries its instances along: web[0] → app[0]
  return isWhole(move.from) && isWhole(move.to) && baseOf(to) === move.from;
}

export interface MoveOptions {
  /** blocks that may already be applied — never rewritten (default: none) */
  isHistory?: (m: MovedStatement) => boolean;
  /** the resource the new blocks follow in its file (its id after the ops that come before) */
  after?: string;
  /** the file for new blocks when `after` isn't found */
  file?: string;
}

interface Working extends MovedStatement {
  id: string;
  text: string;
  toSpan?: [number, number];
  history: boolean;
  fresh: boolean;
  removed: boolean;
  changed: boolean;
}

let seq = 0;

/**
 * Ops that record `moves` (in order) as `moved {}` blocks: collapsing into
 * blocks this session wrote, chaining after history, dropping a block a move
 * undoes. Apply them after the ops that change the addresses.
 */
export function moveOps(ir: IR, moves: MovedStatement[], options: MoveOptions = {}): Op[] {
  const isHistory = options.isHistory ?? (() => false);
  const work: Working[] = movedBlocks(ir).map((b) => ({
    ...b,
    history: isHistory(b),
    fresh: false,
    removed: false,
    changed: false,
  }));
  // `after` may already be the new address (a rename): the file is the one the moved resource is in now
  const owner =
    ir.resources.find((r) => r.id === options.after) ?? ir.resources.find((r) => moves.some((m) => baseOf(m.from) === r.id));
  const file = owner?.trivia.sourceFile ?? options.file ?? 'main.tf';

  for (const move of moves) {
    if (move.from === move.to) continue;
    const live = work.filter((w) => !w.removed);
    // a move back over applied history: that block would now name a declared address
    for (const h of live) if (h.history && h.from === move.to && h.to === move.from) h.removed = true;
    const chainedOnHistory = live.some((w) => w.history && !w.removed && continues(w.to, move));
    let collapsed = false;
    if (!chainedOnHistory) {
      for (const p of live) {
        if (p.history || p.removed || !continues(p.to, move)) continue;
        collapsed = true;
        const to = move.to + p.to.slice(move.from.length);
        if (to === p.from) {
          p.removed = true;
          continue;
        }
        p.to = to;
        p.changed = true;
      }
    }
    if (!collapsed) {
      work.push({
        id: `moved:new#${seq++}`,
        from: move.from,
        to: move.to,
        text: '',
        history: false,
        fresh: true,
        removed: false,
        changed: true,
      });
    }
  }

  const ops: Op[] = [];
  for (const w of work) {
    if (w.fresh) {
      if (w.removed) continue;
      const block: RawBlock = { id: w.id, text: emitMoved(w.from, w.to), trivia: { leadingComments: [], sourceFile: file } };
      ops.push({ kind: 'add_extra', block, ...(options.after ? { after: options.after } : {}) });
    } else if (w.removed) {
      ops.push({ kind: 'remove_extra', blockId: w.id });
    } else if (w.changed && w.toSpan) {
      ops.push({ kind: 'set_extra', blockId: w.id, text: w.text.slice(0, w.toSpan[0]) + w.to + w.text.slice(w.toSpan[1]) });
    }
  }
  return ops;
}

/**
 * Ops that drop the moved blocks this session wrote towards resources that
 * are being deleted: Terraform destroys the object either way, so they
 * would only be clutter. History is left as it is.
 */
export function dropMovesTo(ir: IR, addresses: string[], isHistory: (m: MovedStatement) => boolean = () => false): Op[] {
  const gone = new Set(addresses);
  return movedBlocks(ir)
    .filter((b) => !isHistory(b) && gone.has(baseOf(b.to)))
    .map((b): Op => ({ kind: 'remove_extra', blockId: b.id }));
}

/**
 * Does the project look deployed (so renames should keep the state by
 * default)? A remote backend or Terraform Cloud, or state-aware blocks
 * (`moved`, `import`, `removed`) say someone runs `terraform apply` on it.
 */
export function looksDeployed(ir: IR): boolean {
  return ir.extras.some(
    (b) =>
      /^\s*(?:moved|import|removed)\s*\{/.test(b.text) ||
      (/^\s*terraform\s*\{/.test(b.text) && /^\s*(?:backend\s+"[^"]+"|backend\s+\w+|cloud)\s*\{/m.test(b.text)),
  );
}
