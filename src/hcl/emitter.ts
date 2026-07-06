/**
 * IR → HCL emitter.
 *
 * Deterministic, terraform-fmt-flavoured output: aligned `=` within runs of
 * scalar attributes, blank lines around nested blocks, user comments and the
 * managed `# @blueprint:pos` comment re-emitted above each block.
 */
import type {
  Expression,
  IR,
  OutputDecl,
  ProviderBlock,
  RawBlock,
  ResourceNode,
  Trivia,
  VariableDecl,
  CanvasPosition,
} from '@/ir/types';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export const POS_COMMENT_RE =
  /^\s*(?:#|\/\/)\s*@blueprint:pos=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?),(\d+(?:\.\d+)?))?\s*$/;

export function posComment(p: CanvasPosition): string {
  const base = `# @blueprint:pos=${Math.round(p.x)},${Math.round(p.y)}`;
  if (p.w !== undefined && p.h !== undefined) {
    return `${base},${Math.round(p.w)},${Math.round(p.h)}`;
  }
  return base;
}

function quoteKey(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Render an expression. Multiline renders assume they start after `key = `
 * on a line indented with `indent`.
 */
export function emitExpression(e: Expression, indent: string): string {
  switch (e.kind) {
    case 'literal':
      if (e.value === null) return 'null';
      if (typeof e.value === 'string') return `"${escapeString(e.value)}"`;
      return String(e.value);
    case 'ref':
      return e.path;
    case 'raw':
      return e.hcl;
    case 'list': {
      const rendered = e.items.map((item) => emitExpression(item, indent + '  '));
      const inline = `[${rendered.join(', ')}]`;
      const isSimple = e.items.every((i) => i.kind === 'literal' || i.kind === 'ref');
      if ((isSimple && inline.length <= 64 && !inline.includes('\n')) || e.items.length === 0) {
        return inline;
      }
      const inner = rendered.map((r) => `${indent}  ${r},`).join('\n');
      return `[\n${inner}\n${indent}]`;
    }
    case 'object': {
      const keys = Object.keys(e.fields);
      if (keys.length === 0) return '{}';
      return `{\n${emitEntries(e.fields, indent + '  ')}\n${indent}}`;
    }
    case 'block':
    case 'blocks':
      // Handled by emitEntries — should not be emitted as a value.
      return '{}';
  }
}

interface Entry {
  key: string;
  expr: Expression;
  comments?: string[];
  trailing?: string;
}

function isBlockish(e: Expression): boolean {
  return e.kind === 'block' || e.kind === 'blocks';
}

/** True for captured labeled sub-blocks stored verbatim (key like `provisioner "x"`). */
function isRawEntryKey(key: string): boolean {
  return /[\s"]/.test(key);
}

/**
 * Emit a record of entries (resource body, object fields, block body) at the
 * given indent. Aligns `=` within contiguous runs of assignment entries.
 */
function emitEntriesList(entries: Entry[], indent: string): string {
  const lines: string[] = [];
  let run: Entry[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const width = Math.max(...run.map((en) => quoteKey(en.key).length));
    for (const en of run) {
      if (en.comments) for (const c of en.comments) lines.push(`${indent}${c}`);
      const key = quoteKey(en.key);
      const value = emitExpression(en.expr, indent);
      const pad = ' '.repeat(width - key.length);
      const trailing = en.trailing ? `  ${en.trailing}` : '';
      lines.push(`${indent}${key}${pad} = ${value}${trailing}`);
    }
    run = [];
  };

  for (const en of entries) {
    if (isBlockish(en.expr) || isRawEntryKey(en.key)) {
      flushRun();
      if (lines.length > 0) lines.push('');
      if (en.comments) for (const c of en.comments) lines.push(`${indent}${c}`);
      if (en.expr.kind === 'block') {
        lines.push(...emitNestedBlock(en.key, en.expr.body, indent));
      } else if (en.expr.kind === 'blocks') {
        en.expr.items.forEach((body, i) => {
          if (i > 0) lines.push('');
          lines.push(...emitNestedBlock(en.key, body, indent));
        });
      } else {
        // raw labeled sub-block captured verbatim
        const text = en.expr.kind === 'raw' ? en.expr.hcl : emitExpression(en.expr, indent);
        lines.push(...text.split('\n').map((l, i) => (i === 0 ? `${indent}${l}` : l)));
      }
      lines.push('');
      continue;
    }
    run.push(en);
  }
  flushRun();

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function emitNestedBlock(name: string, body: Record<string, Expression>, indent: string): string[] {
  const inner = emitEntries(body, indent + '  ');
  if (!inner) return [`${indent}${name} {}`];
  return [`${indent}${name} {`, inner, `${indent}}`];
}

export function emitEntries(
  record: Record<string, Expression>,
  indent: string,
  trivia?: Trivia,
): string {
  const entries: Entry[] = Object.entries(record).map(([key, expr]) => ({
    key,
    expr,
    comments: trivia?.argComments?.[key],
    trailing: trivia?.argTrailing?.[key],
  }));
  return emitEntriesList(entries, indent);
}

function emitTopBlock(
  header: string,
  args: Record<string, Expression>,
  trivia: Trivia,
  position?: CanvasPosition,
): string {
  const lines: string[] = [];
  for (const c of trivia.leadingComments) lines.push(c);
  if (position) lines.push(posComment(position));
  const body = emitEntries(args, '  ', trivia);
  if (body) {
    lines.push(`${header} {`);
    lines.push(body);
    lines.push('}');
  } else {
    lines.push(`${header} {}`);
  }
  return lines.join('\n') + '\n';
}

export function emitResource(node: ResourceNode): string {
  return emitTopBlock(
    `resource "${node.type}" "${node.name}"`,
    node.args,
    node.trivia,
    node.position,
  );
}

export function emitVariable(v: VariableDecl): string {
  return emitTopBlock(`variable "${v.name}"`, v.args, v.trivia);
}

export function emitOutput(o: OutputDecl): string {
  return emitTopBlock(`output "${o.name}"`, o.args, o.trivia);
}

export function emitProvider(p: ProviderBlock): string {
  return emitTopBlock(`provider "${p.name}"`, p.args, p.trivia);
}

export function emitRawBlock(b: RawBlock): string {
  const lines: string[] = [];
  for (const c of b.trivia.leadingComments) lines.push(c);
  lines.push(b.text.replace(/\n+$/, ''));
  return lines.join('\n') + '\n';
}

export const DEFAULT_FILES = {
  resource: 'main.tf',
  variable: 'variables.tf',
  output: 'outputs.tf',
  provider: 'providers.tf',
  terraform: 'versions.tf',
} as const;

interface FileChunk {
  file: string;
  order: number;
  seq: number;
  text: string;
}

/** Emit the whole IR into a set of .tf files (fresh projects, exports, tests). */
export function emitProject(ir: IR): Record<string, string> {
  const chunks: FileChunk[] = [];
  let seq = 0;
  const push = (file: string, range: { start: number } | undefined, text: string) => {
    chunks.push({ file, order: range ? range.start : Number.MAX_SAFE_INTEGER, seq: seq++, text });
  };

  for (const b of ir.extras) {
    const isTerraform = /^\s*terraform\b/.test(b.text);
    const file =
      b.trivia.sourceFile ?? (isTerraform ? DEFAULT_FILES.terraform : DEFAULT_FILES.resource);
    push(file, b.trivia.rawTextRange, emitRawBlock(b));
  }
  for (const p of ir.providers) {
    push(p.trivia.sourceFile ?? DEFAULT_FILES.provider, p.trivia.rawTextRange, emitProvider(p));
  }
  for (const r of ir.resources) {
    push(r.trivia.sourceFile ?? DEFAULT_FILES.resource, r.trivia.rawTextRange, emitResource(r));
  }
  for (const v of ir.variables) {
    push(v.trivia.sourceFile ?? DEFAULT_FILES.variable, v.trivia.rawTextRange, emitVariable(v));
  }
  for (const o of ir.outputs) {
    push(o.trivia.sourceFile ?? DEFAULT_FILES.output, o.trivia.rawTextRange, emitOutput(o));
  }

  const byFile = new Map<string, FileChunk[]>();
  for (const c of chunks) {
    const arr = byFile.get(c.file) ?? [];
    arr.push(c);
    byFile.set(c.file, arr);
  }

  const files: Record<string, string> = {};
  for (const [file, arr] of byFile) {
    arr.sort((a, b) => a.order - b.order || a.seq - b.seq);
    files[file] = arr.map((c) => c.text).join('\n');
  }
  return files;
}
