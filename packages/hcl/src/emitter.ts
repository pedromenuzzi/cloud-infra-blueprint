import type { Expression, IR, ModuleNode, ResourceNode } from '@blueprint/ir';

const INDENT = '  ';

/** Escape a string for safe inclusion inside HCL double quotes. */
function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function isSafeIdentifier(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key);
}

/**
 * Render a single Expression as HCL source.
 *
 * `level` controls indentation for nested objects/lists. The output of `expr`
 * NEVER contains a trailing newline; callers add line breaks as appropriate.
 */
export function expr(value: Expression, level = 1): string {
  switch (value.kind) {
    case 'literal': {
      const v = value.value;
      if (v === null) return 'null';
      if (typeof v === 'string') return `"${escapeString(v)}"`;
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v);
    }
    case 'list': {
      if (value.items.length === 0) return '[]';
      const inline = value.items.every((i) => i.kind === 'literal');
      if (inline && value.items.length <= 6) {
        return `[${value.items.map((i) => expr(i, level)).join(', ')}]`;
      }
      const inner = value.items.map((i) => `${INDENT.repeat(level + 1)}${expr(i, level + 1)}`);
      return `[\n${inner.join(',\n')},\n${INDENT.repeat(level)}]`;
    }
    case 'object': {
      const entries = Object.entries(value.fields).sort(([a], [b]) => a.localeCompare(b));
      if (entries.length === 0) return '{}';
      const lines = entries.map(([k, v]) => {
        const key = isSafeIdentifier(k) ? k : `"${escapeString(k)}"`;
        return `${INDENT.repeat(level + 1)}${key} = ${expr(v, level + 1)}`;
      });
      return `{\n${lines.join('\n')}\n${INDENT.repeat(level)}}`;
    }
    case 'ref':
      return value.path;
    case 'raw':
      return value.hcl;
  }
}

/**
 * Render the body of a block (the part inside `{ ... }`). `body` is a flat map
 * of Terraform argument names to Expressions. Keys with `undefined` values are
 * skipped (lets `defineResource.emit` pass optional fields directly).
 *
 * Keys are emitted in alphabetical order — this gives us a canonical form so
 * round-trips are idempotent regardless of how hcl2json decides to order them.
 * The user's original key order is NOT preserved on the second emit, but the
 * patch-minimal flow (`patchResource`) keeps unedited blocks byte-identical.
 */
export function emitBody(body: Record<string, Expression | undefined>, level = 1): string {
  const lines: string[] = [];
  const keys = Object.keys(body).sort();
  for (const k of keys) {
    const v = body[k];
    if (v === undefined) continue;
    const key = isSafeIdentifier(k) ? k : `"${k}"`;
    lines.push(`${INDENT.repeat(level)}${key} = ${expr(v, level)}`);
  }
  return lines.join('\n');
}

export function emitBlock(
  keyword: string,
  labels: string[],
  body: Record<string, Expression | undefined>,
  level = 0,
): string {
  const labelStr = labels.map((l) => ` "${escapeString(l)}"`).join('');
  const inner = emitBody(body, level + 1);
  if (!inner.trim()) {
    return `${INDENT.repeat(level)}${keyword}${labelStr} {}`;
  }
  return `${INDENT.repeat(level)}${keyword}${labelStr} {\n${inner}\n${INDENT.repeat(level)}}`;
}

function commentBlock(comments: string[]): string {
  if (!comments.length) return '';
  return `${comments.map((c) => (c.startsWith('#') || c.startsWith('//') ? c : `# ${c}`)).join('\n')}\n`;
}

export function emitResource(node: ResourceNode): string {
  const leading = commentBlock(node.trivia.leadingComments);
  const block = emitBlock('resource', [node.type, node.name], node.args);
  const trailing = node.trivia.trailingComments.length
    ? `\n${commentBlock(node.trivia.trailingComments).trimEnd()}`
    : '';
  return `${leading}${block}${trailing}`;
}

export function emitModule(node: ModuleNode): string {
  const body: Record<string, Expression | undefined> = {
    source: { kind: 'literal', value: node.source },
    ...(node.version ? { version: { kind: 'literal', value: node.version } } : {}),
    ...node.inputs,
  };
  const leading = commentBlock(node.trivia.leadingComments);
  return `${leading}${emitBlock('module', [node.name], body)}`;
}

/**
 * Emit a complete IR as a `Record<filename, contents>`. Files generated:
 *
 * - `providers.tf` - provider blocks
 * - `variables.tf` - input variables
 * - `outputs.tf`   - outputs
 * - `main.tf`      - resources + modules
 *
 * Resources/modules can override their target file via `trivia.sourceFile`;
 * unknown source files are passed through unchanged so multi-file projects
 * round-trip correctly.
 */
export function emitIR(ir: IR): Record<string, string> {
  const files: Record<string, string[]> = {};
  const push = (name: string, chunk: string) => {
    if (!files[name]) files[name] = [];
    files[name].push(chunk);
  };

  // Providers.
  const providerBlocks: string[] = [];
  for (const [provider, cfg] of Object.entries(ir.providers)) {
    if (!cfg) continue;
    const body: Record<string, Expression | undefined> = {};
    if (cfg.region) body.region = { kind: 'literal', value: cfg.region };
    if (cfg.alias) body.alias = { kind: 'literal', value: cfg.alias };
    Object.assign(body, cfg.extras ?? {});
    providerBlocks.push(emitBlock('provider', [provider], body));
  }
  if (providerBlocks.length) push('providers.tf', providerBlocks.join('\n\n'));

  // Variables.
  const varBlocks: string[] = [];
  for (const [name, decl] of Object.entries(ir.variables)) {
    const body: Record<string, Expression | undefined> = {};
    if (decl.type !== undefined) body.type = decl.type;
    if (decl.description) body.description = { kind: 'literal', value: decl.description };
    if (decl.default !== undefined) body.default = decl.default;
    if (decl.sensitive) body.sensitive = { kind: 'literal', value: true };
    varBlocks.push(emitBlock('variable', [name], body));
  }
  if (varBlocks.length) push('variables.tf', varBlocks.join('\n\n'));

  // Outputs.
  const outBlocks: string[] = [];
  for (const [name, decl] of Object.entries(ir.outputs)) {
    const body: Record<string, Expression | undefined> = { value: decl.value };
    if (decl.description) body.description = { kind: 'literal', value: decl.description };
    if (decl.sensitive) body.sensitive = { kind: 'literal', value: true };
    outBlocks.push(emitBlock('output', [name], body));
  }
  if (outBlocks.length) push('outputs.tf', outBlocks.join('\n\n'));

  // Resources + modules — emit in deterministic alphabetical order so the
  // serialised file is canonical (avoid spurious diffs after parse-emit cycle).
  const resourcesSorted = [...ir.resources].sort((a, b) => {
    const ka = `${a.type}.${a.name}`;
    const kb = `${b.type}.${b.name}`;
    return ka.localeCompare(kb);
  });
  for (const r of resourcesSorted) {
    const target = r.trivia.sourceFile ?? 'main.tf';
    push(target, emitResource(r));
  }
  const modulesSorted = [...ir.modules].sort((a, b) => a.name.localeCompare(b.name));
  for (const m of modulesSorted) {
    const target = m.trivia.sourceFile ?? 'main.tf';
    push(target, emitModule(m));
  }

  const out: Record<string, string> = {};
  for (const [filename, chunks] of Object.entries(files)) {
    out[filename] = chunks.join('\n\n') + '\n';
  }
  return out;
}
