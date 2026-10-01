/**
 * Where is the caret, structurally? A small HCL scanner that tracks nested
 * blocks (skipping strings, interpolations, heredocs, comments and
 * expression brackets) so completion and hover know the resource type and
 * the nested block path at any offset — `resource "aws_instance" … {
 * root_block_device { | }` → aws_instance, ['root_block_device'] — or the
 * data source type in a `data "aws_ami" … { filter { | } }` block.
 */

export interface CursorContext {
  /** type of the enclosing `resource` block */
  resourceType?: string;
  /** type of the enclosing `data` block (`aws_ami`); `resourceType` is then unset */
  dataType?: string;
  /** schema path from the resource body to the caret's block (dynamic blocks resolve to their label) */
  path: string[];
  /**
   * `body`: a block body at a statement start (attribute / block names go here) ·
   * `value`: after `=` or inside brackets · `string`: in a string, heredoc or comment ·
   * `meta`: inside lifecycle / provisioner / connection, or a `dynamic` block's own body
   */
  where: 'body' | 'value' | 'string' | 'meta';
  /** keys already written in the caret's block (attributes and blocks) */
  keys: Set<string>;
}

interface BlockFrame {
  kind: 'block';
  /** header tokens: identifiers and string label contents (`resource`, `aws_instance`, `web`) */
  header: string[];
  keys: Set<string>;
}
interface ExprFrame {
  kind: 'expr';
}
type Frame = BlockFrame | ExprFrame;

const IDENT_START = /[A-Za-z_]/;
const IDENT = /[\w-]/;
const META_BLOCKS = new Set(['lifecycle', 'provisioner', 'connection']);

export function cursorContext(text: string, offset: number): CursorContext {
  const end = Math.min(offset, text.length);
  const root: BlockFrame = { kind: 'block', header: [], keys: new Set() };
  const stack: Frame[] = [root];
  /** tokens of the statement being read in the innermost block */
  let stmt: string[] = [];
  let stmtHasEquals = false;
  let i = 0;

  const top = () => stack[stack.length - 1];
  const endStatement = () => {
    const frame = top();
    if (frame.kind === 'block' && stmtHasEquals && stmt.length > 0) frame.keys.add(stmt[0]);
    stmt = [];
    stmtHasEquals = false;
  };

  /** skip a quoted string starting at `i` (on the quote); false when it runs past `end` */
  const skipString = (): boolean => {
    i++;
    while (i < end) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return true;
      }
      if ((c === '$' || c === '%') && text[i + 1] === '{') {
        i += 2;
        if (!skipTemplate()) return false;
        continue;
      }
      if (c === '\n') return true; // unterminated: let the line end it
      i++;
    }
    return false;
  };
  /** skip an interpolation body up to its closing brace */
  const skipTemplate = (): boolean => {
    let depth = 1;
    while (i < end) {
      const c = text[i];
      if (c === '"') {
        if (!skipString()) return false;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          i++;
          return true;
        }
      }
      i++;
    }
    return false;
  };

  while (i < end) {
    const c = text[i];
    if (c === '\n') {
      if (top().kind === 'block') endStatement();
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      const nl = text.indexOf('\n', i);
      if (nl === -1 || nl >= end) return { ...resolve(stack), where: 'string' };
      i = nl;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1 || close + 2 > end) return { ...resolve(stack), where: 'string' };
      i = close + 2;
      continue;
    }
    if (c === '"') {
      const start = i;
      if (!skipString()) return { ...resolve(stack), where: 'string' };
      if (top().kind === 'block' && !stmtHasEquals) stmt.push(text.slice(start + 1, i - 1));
      continue;
    }
    if (c === '<' && text[i + 1] === '<') {
      const m = /^<<-?([A-Za-z_][\w-]*)[ \t]*\r?\n/.exec(text.slice(i, i + 200));
      if (m) {
        const lines = text.slice(i + m[0].length);
        const close = new RegExp(`^[ \\t]*${m[1]}[ \\t]*$`, 'm').exec(lines);
        const stop = close ? i + m[0].length + close.index + close[0].length : text.length;
        if (stop > end) return { ...resolve(stack), where: 'string' };
        i = stop;
        continue;
      }
    }
    if (c === '{') {
      const frame = top();
      if (frame.kind === 'block' && !stmtHasEquals) {
        if (stmt.length > 0) frame.keys.add(stmt[0]);
        stack.push({ kind: 'block', header: stmt, keys: new Set() });
        stmt = [];
        stmtHasEquals = false;
      } else {
        stack.push({ kind: 'expr' });
      }
      i++;
      continue;
    }
    if (c === '[' || c === '(') {
      stack.push({ kind: 'expr' });
      i++;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      if (stack.length > 1) {
        const popped = stack.pop()!;
        if (popped.kind === 'block') {
          stmt = [];
          stmtHasEquals = false;
        }
      }
      i++;
      continue;
    }
    if (c === '=' && text[i + 1] !== '=' && text[i + 1] !== '>' && !/[!<>=]/.test(text[i - 1] ?? '')) {
      if (top().kind === 'block') stmtHasEquals = true;
      i++;
      continue;
    }
    if (IDENT_START.test(c)) {
      const start = i;
      while (i < end && IDENT.test(text[i])) i++;
      if (top().kind === 'block' && !stmtHasEquals) stmt.push(text.slice(start, i));
      continue;
    }
    i++;
  }

  const ctx = resolve(stack);
  if (top().kind === 'expr' || stmtHasEquals) return { ...ctx, where: ctx.where === 'meta' ? 'meta' : 'value' };
  // a statement start: nothing, or a single identifier being typed
  if (stmt.length > 1) return { ...ctx, where: 'value' };
  return ctx;
}

/** map the block stack to a resource (or data source) type + schema path */
function resolve(stack: Frame[]): CursorContext {
  const blocks = stack.filter((f): f is BlockFrame => f.kind === 'block');
  const innermost = blocks[blocks.length - 1];
  const top = blocks[1];
  const keyword = top?.header[0];
  if (!top || (keyword !== 'resource' && keyword !== 'data') || !top.header[1]) {
    return { path: [], keys: innermost.keys, where: 'meta' };
  }
  const base = { ...(keyword === 'data' ? { dataType: top.header[1] } : { resourceType: top.header[1] }), keys: innermost.keys };
  const path: string[] = [];
  const where: CursorContext['where'] = 'body';
  for (let d = 2; d < blocks.length; d++) {
    const [name, label] = blocks[d].header;
    if (!name) return { ...base, path, where: 'meta' };
    if (d === 2 && META_BLOCKS.has(name)) return { ...base, path, where: 'meta' };
    if (name === 'dynamic') {
      // `dynamic "x" { for_each … content { <x's body> } }`
      const content = blocks[d + 1];
      if (!label || !content || content.header[0] !== 'content') return { ...base, path, where: 'meta' };
      path.push(label);
      d++;
      continue;
    }
    path.push(name);
  }
  return { ...base, path, where };
}

/**
 * A resource attribute reference being typed right before the caret:
 * `aws_instance.web.pri` → { type: 'aws_instance', name: 'web', partial: 'pri' }.
 * Not for `data.`/`module.`/`var.` traversals.
 */
export function referenceBefore(textBefore: string): { type: string; name: string; partial: string } | undefined {
  const m = /(^|[^\w.-])([A-Za-z][\w-]*)\.([A-Za-z_][\w-]*)\.([\w-]*)$/.exec(textBefore);
  if (!m) return undefined;
  const [, , type, name, partial] = m;
  if (!/^(aws|azurerm|google)_/.test(type)) return undefined;
  return { type, name, partial };
}

/**
 * A data source attribute reference being typed right before the caret:
 * `data.aws_ami.ubuntu.ar` → { type: 'aws_ami', name: 'ubuntu', partial: 'ar' }
 * (instance keys allowed: `data.aws_vpc.x[0].`).
 */
export function dataReferenceBefore(textBefore: string): { type: string; name: string; partial: string } | undefined {
  const m = /(^|[^\w.-])data\.([A-Za-z][\w-]*)\.([A-Za-z_][\w-]*)(?:\[[^\]\n]*\])?\.([\w-]*)$/.exec(textBefore);
  if (!m) return undefined;
  const [, , type, name, partial] = m;
  return { type, name, partial };
}

/** `data "aws_am` → the data source type label being typed (`aws_am`) */
export function dataTypeLabelBefore(textBefore: string): string | undefined {
  return /^\s*data\s+"([\w-]*)$/.exec(textBefore)?.[1];
}
