import {
  edge as makeEdge,
  emptyIR,
  newId,
  newModule,
  newResource,
  raw,
  toExpr,
  type Expression,
  type IR,
  type IREdge,
  type IRPatch,
  type ModuleNode,
  type OutputDecl,
  type Provider,
  type ProviderConfig,
  type ResourceNode,
  type VariableDecl,
} from '@blueprint/ir';

export interface ParseOptions {
  /** Logical filename, attached to each emitted node's trivia. */
  sourceFile?: string;
}

/**
 * Loose typing of the AST produced by `@cdktf/hcl2json`. The shape varies
 * slightly across versions; we only walk the subset we care about. Each
 * top-level keyword is a map of "label" -> array of bodies (because Terraform
 * blocks like `resource "aws_instance" "web" {}` use multiple labels and HCL
 * also allows multiple unnamed blocks of the same kind).
 */
export interface HclAstFile {
  resource?: Record<string, Record<string, unknown[] | unknown>>;
  data?: Record<string, Record<string, unknown[] | unknown>>;
  module?: Record<string, unknown[] | unknown>;
  variable?: Record<string, unknown[] | unknown>;
  output?: Record<string, unknown[] | unknown>;
  provider?: Record<string, unknown[] | unknown>;
  terraform?: unknown[] | unknown;
  locals?: unknown[] | unknown;
  [key: string]: unknown;
}

export interface Hcl2JsonAdapter {
  /**
   * Parse a single .tf file's source text into a JSON AST. In the browser,
   * this is a thin wrapper around the WASM module loaded from a WebWorker.
   * In Node, the same `@cdktf/hcl2json` package exposes `parse(filename, source)`.
   */
  parse(filename: string, source: string): Promise<HclAstFile>;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const PROVIDER_PREFIX_MAP: Array<[string, Provider]> = [
  ['aws_', 'aws'],
  ['azurerm_', 'azure'],
  ['azuread_', 'azure'],
  ['google_', 'gcp'],
  ['kubernetes_', 'kubernetes'],
  ['helm_', 'kubernetes'],
  ['random_', 'random'],
  ['tls_', 'tls'],
];

function inferProviderFromType(type: string): Provider {
  for (const [prefix, p] of PROVIDER_PREFIX_MAP) {
    if (type.startsWith(prefix)) return p;
  }
  return 'aws';
}

function inferProviderFromName(name: string): Provider {
  if (name === 'aws') return 'aws';
  if (name === 'azurerm' || name === 'azuread') return 'azure';
  if (name === 'google' || name === 'google-beta') return 'gcp';
  if (name === 'kubernetes' || name === 'helm') return 'kubernetes';
  if (name === 'random') return 'random';
  if (name === 'tls') return 'tls';
  return 'aws';
}

/**
 * Convert a value coming out of hcl2json into our `Expression` representation.
 *
 * hcl2json represents:
 *   - bare strings (no interpolation) as JS strings,
 *   - strings WITH interpolation as JS strings containing `${...}`,
 *   - HCL `true/false/null` and numbers as their JS equivalents,
 *   - HCL lists as JS arrays,
 *   - HCL objects as JS objects,
 *   - heredocs and other complex expressions as JS strings.
 *
 * We map interpolated strings to `raw` so the original syntax round-trips
 * verbatim. Object/list shapes recurse.
 */
export function classifyValue(value: unknown): Expression {
  if (value === null || value === undefined) {
    return { kind: 'literal', value: null };
  }
  if (typeof value === 'string') {
    if (value.includes('${') || value.includes('%{')) {
      // Wrap interpolations as a quoted raw expression so we emit verbatim.
      return raw(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    return { kind: 'literal', value };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'literal', value };
  }
  if (Array.isArray(value)) {
    return { kind: 'list', items: value.map(classifyValue) };
  }
  if (typeof value === 'object') {
    const fields: Record<string, Expression> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      fields[k] = classifyValue(v);
    }
    return { kind: 'object', fields };
  }
  return toExpr(value);
}

/**
 * Walk a list-or-singleton body collection, calling `visit` for each entry.
 *
 * hcl2json wraps single block bodies in a 1-element array (because Terraform
 * lets you declare multiple `resource "type" "name" { }` blocks with the same
 * labels and accumulate their attributes). We just want each body once.
 */
function forEachBody(
  collection: unknown[] | unknown,
  visit: (body: Record<string, unknown>) => void,
): void {
  if (Array.isArray(collection)) {
    for (const b of collection) visit((b as Record<string, unknown>) ?? {});
  } else if (collection && typeof collection === 'object') {
    visit(collection as Record<string, unknown>);
  }
}

/* -------------------------------------------------------------------------- */
/* Reference detection (HCL -> edges)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Match Terraform references: either `${aws_vpc.main.id}` or bare
 * `aws_vpc.main.id` inside a string. Captures `<type>.<name>`.
 */
const REF_RE =
  /\$\{?([a-z][a-z0-9_]*_[a-z][a-zA-Z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)(?:\.[A-Za-z_][A-Za-z0-9_-]*)?\}?/g;

function extractRefs(args: Record<string, Expression>): Array<{ type: string; name: string }> {
  const found = new Map<string, { type: string; name: string }>();
  const visit = (e: Expression): void => {
    if (e.kind === 'literal') {
      if (typeof e.value !== 'string') return;
      let m: RegExpExecArray | null;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(e.value)) !== null) {
        const type = m[1];
        const name = m[2];
        if (!type || !name) continue;
        found.set(`${type}.${name}`, { type, name });
      }
    } else if (e.kind === 'raw') {
      let m: RegExpExecArray | null;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(e.hcl)) !== null) {
        const type = m[1];
        const name = m[2];
        if (!type || !name) continue;
        found.set(`${type}.${name}`, { type, name });
      }
    } else if (e.kind === 'ref') {
      const parts = e.path.split('.');
      const type = parts[0];
      const name = parts[1];
      if (type && name) found.set(`${type}.${name}`, { type, name });
    } else if (e.kind === 'list') {
      e.items.forEach(visit);
    } else if (e.kind === 'object') {
      Object.values(e.fields).forEach(visit);
    }
  };
  Object.values(args).forEach(visit);
  return Array.from(found.values());
}

/* -------------------------------------------------------------------------- */
/* Range scanner                                                              */
/*                                                                            */
/* hcl2json discards trivia. We do a second pass over the original source     */
/* with a tiny block matcher so each ResourceNode/ModuleNode etc. gets its    */
/* `trivia.rawTextRange = { start, end }` set. The emitter uses these ranges  */
/* to perform minimal patches (only rewrite the changed block).               */
/* -------------------------------------------------------------------------- */

interface BlockRange {
  keyword: string;
  labels: string[];
  start: number;
  end: number;
  /** Content between the opening `{` and matching `}`. */
  bodyStart: number;
  bodyEnd: number;
}

const BLOCK_HEADER_RE =
  /(^|\n)([ \t]*)(resource|data|module|variable|output|provider|terraform|locals)\b([^\n{]*?)\{/g;

/**
 * Scan a .tf source and return one `BlockRange` per top-level block.
 * Skips strings, line comments and block comments so braces inside them
 * don't throw off the brace counter.
 */
export function scanBlockRanges(source: string): BlockRange[] {
  const out: BlockRange[] = [];
  BLOCK_HEADER_RE.lastIndex = 0;
  let header: RegExpExecArray | null;
  while ((header = BLOCK_HEADER_RE.exec(source)) !== null) {
    const keyword = header[3];
    const headerTail = header[4] ?? '';
    if (!keyword) continue;
    const headerStart =
      header.index + (header[1] ? header[1].length : 0) + (header[2]?.length ?? 0);
    const openBrace = header.index + header[0].length - 1;
    const labels = parseLabels(headerTail);
    const close = findMatchingBrace(source, openBrace);
    if (close < 0) continue;
    out.push({
      keyword,
      labels,
      start: headerStart,
      end: close + 1,
      bodyStart: openBrace + 1,
      bodyEnd: close,
    });
  }
  return out;
}

function parseLabels(text: string): string[] {
  const labels: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    labels.push(m[1] ?? '');
  }
  return labels;
}

function findMatchingBrace(src: string, openAt: number): number {
  let depth = 1;
  let i = openAt + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      i = skipString(src, i);
      continue;
    }
    if (ch === '#') {
      i = skipLineComment(src, i);
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i = skipLineComment(src, i);
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i = skipBlockComment(src, i);
      continue;
    }
    if (ch === '<' && src[i + 1] === '<') {
      i = skipHeredoc(src, i);
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function skipString(src: string, i: number): number {
  i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i++;
  }
  return i;
}

function skipLineComment(src: string, i: number): number {
  while (i < src.length && src[i] !== '\n') i++;
  return i;
}

function skipBlockComment(src: string, i: number): number {
  i += 2;
  while (i < src.length - 1) {
    if (src[i] === '*' && src[i + 1] === '/') return i + 2;
    i++;
  }
  return src.length;
}

function skipHeredoc(src: string, i: number): number {
  // <<TAG ... TAG  or  <<-TAG ... TAG
  let j = i + 2;
  if (src[j] === '-') j++;
  let tag = '';
  while (j < src.length && /[A-Za-z0-9_]/.test(src[j] ?? '')) {
    tag += src[j];
    j++;
  }
  if (!tag) return i + 2;
  const eolIdx = src.indexOf('\n', j);
  if (eolIdx < 0) return src.length;
  let k = eolIdx + 1;
  while (k < src.length) {
    const lineEnd = src.indexOf('\n', k);
    const line = src.slice(k, lineEnd < 0 ? src.length : lineEnd);
    if (line.trim() === tag) return lineEnd < 0 ? src.length : lineEnd + 1;
    if (lineEnd < 0) return src.length;
    k = lineEnd + 1;
  }
  return src.length;
}

/* -------------------------------------------------------------------------- */
/* Walkers                                                                    */
/* -------------------------------------------------------------------------- */

interface WalkResult {
  resources: ResourceNode[];
  modules: ModuleNode[];
  edges: IREdge[];
  variables: Record<string, VariableDecl>;
  outputs: Record<string, OutputDecl>;
  providers: Partial<Record<Provider, ProviderConfig>>;
}

/**
 * Convert one parsed AST file into a `WalkResult`. Pure: no I/O.
 */
export function astToPatch(ast: HclAstFile, opts: ParseOptions = {}): IRPatch {
  const w = walkAst(ast, opts);
  return {
    addResources: w.resources,
    addModules: w.modules,
    addEdges: w.edges,
    setVariables: w.variables,
    setOutputs: w.outputs,
    setProviders: w.providers,
  };
}

export function walkAst(ast: HclAstFile, opts: ParseOptions = {}): WalkResult {
  const sourceFile = opts.sourceFile ?? 'main.tf';
  const resources: ResourceNode[] = [];
  const modules: ModuleNode[] = [];
  const edges: IREdge[] = [];
  const variables: Record<string, VariableDecl> = {};
  const outputs: Record<string, OutputDecl> = {};
  const providers: Partial<Record<Provider, ProviderConfig>> = {};
  const refIndex = new Map<string, ResourceNode>();

  // ---- resources ----
  for (const [type, byName] of Object.entries(ast.resource ?? {})) {
    for (const [name, body] of Object.entries(byName)) {
      forEachBody(body, (b) => {
        const args: Record<string, Expression> = {};
        for (const [k, v] of Object.entries(b)) args[k] = classifyValue(v);
        const node = newResource(type, name, args);
        node.trivia.sourceFile = sourceFile;
        resources.push(node);
        refIndex.set(`${type}.${name}`, node);
      });
    }
  }

  // ---- modules ----
  for (const [name, body] of Object.entries(ast.module ?? {})) {
    forEachBody(body, (b) => {
      const inputs: Record<string, Expression> = {};
      let source = '';
      let version: string | undefined;
      for (const [k, v] of Object.entries(b)) {
        if (k === 'source' && typeof v === 'string') source = v;
        else if (k === 'version' && typeof v === 'string') version = v;
        else inputs[k] = classifyValue(v);
      }
      const m = newModule(name, source, {}, version ? { version } : {});
      m.inputs = inputs;
      m.trivia.sourceFile = sourceFile;
      modules.push(m);
    });
  }

  // ---- variables ----
  for (const [name, body] of Object.entries(ast.variable ?? {})) {
    forEachBody(body, (b) => {
      const decl: VariableDecl = {};
      if ('type' in b && b.type !== undefined) decl.type = classifyValue(b.type);
      if (typeof b.description === 'string') decl.description = b.description;
      if (typeof b.sensitive === 'boolean') decl.sensitive = b.sensitive;
      if ('default' in b) decl.default = classifyValue(b.default);
      variables[name] = decl;
    });
  }

  // ---- outputs ----
  for (const [name, body] of Object.entries(ast.output ?? {})) {
    forEachBody(body, (b) => {
      const decl: OutputDecl = { value: classifyValue(b.value) };
      if (typeof b.description === 'string') decl.description = b.description;
      if (typeof b.sensitive === 'boolean') decl.sensitive = b.sensitive;
      outputs[name] = decl;
    });
  }

  // ---- providers ----
  for (const [name, body] of Object.entries(ast.provider ?? {})) {
    forEachBody(body, (b) => {
      const provider = inferProviderFromName(name);
      const cfg: ProviderConfig = { ...(providers[provider] ?? {}) };
      if (typeof b.region === 'string') cfg.region = b.region;
      if (typeof b.alias === 'string') cfg.alias = b.alias;
      const extras: Record<string, Expression> = {};
      for (const [k, v] of Object.entries(b)) {
        if (k === 'region' || k === 'alias') continue;
        extras[k] = classifyValue(v);
      }
      if (Object.keys(extras).length) cfg.extras = extras;
      providers[provider] = cfg;
    });
  }

  // ---- edges from resource arg references ----
  for (const node of resources) {
    const refs = extractRefs(node.args);
    for (const r of refs) {
      const target = refIndex.get(`${r.type}.${r.name}`);
      if (target && target.id !== node.id) {
        edges.push(makeEdge(target, node, 'reference'));
      }
    }
  }

  return { resources, modules, edges, variables, outputs, providers };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse multiple .tf files into one IR. Each file's AST is walked, resources
 * are accumulated, and trivia ranges are attached based on a second pass over
 * the source text.
 */
export async function parse(
  files: Record<string, string>,
  adapter: Hcl2JsonAdapter,
  opts: ParseOptions = {},
): Promise<IR> {
  let ir = emptyIR();

  for (const [filename, source] of Object.entries(files)) {
    const ast = await adapter.parse(filename, source);
    const w = walkAst(ast, { sourceFile: filename, ...opts });

    // Attach rawTextRange by matching block headers in the source.
    const ranges = scanBlockRanges(source);
    indexRanges(w.resources, w.modules, ranges, filename);

    ir = {
      ...ir,
      resources: [...ir.resources, ...w.resources],
      modules: [...ir.modules, ...w.modules],
      edges: [...ir.edges, ...w.edges],
      variables: { ...ir.variables, ...w.variables },
      outputs: { ...ir.outputs, ...w.outputs },
      providers: { ...ir.providers, ...w.providers },
    };
  }
  return ir;
}

function indexRanges(
  resources: ResourceNode[],
  modules: ModuleNode[],
  ranges: BlockRange[],
  sourceFile: string,
): void {
  for (const r of resources) {
    const found = ranges.find(
      (br) =>
        br.keyword === 'resource' &&
        br.labels.length >= 2 &&
        br.labels[0] === r.type &&
        br.labels[1] === r.name,
    );
    if (found) {
      r.trivia.rawTextRange = { start: found.start, end: found.end };
      r.trivia.sourceFile = sourceFile;
    }
  }
  for (const m of modules) {
    const found = ranges.find((br) => br.keyword === 'module' && br.labels[0] === m.name);
    if (found) {
      m.trivia.rawTextRange = { start: found.start, end: found.end };
      m.trivia.sourceFile = sourceFile;
    }
  }
}

export { newId, inferProviderFromType };
