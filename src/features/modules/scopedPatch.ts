/**
 * Canvas ops on a child module's own blocks, with the same patcher as the
 * root module's: the module's folder is taken as a project of its own
 * (`modules/net/main.tf` → `main.tf`), parsed, patched minimally and put
 * back. Nothing outside the folder is touched; a patch the patcher refuses
 * (stale text, a block it would lose) changes nothing.
 *
 * An opened module (the editor's scope) keeps its IR with project paths in
 * `sourceFile` (`modules/net/main.tf`), so the code pane, `revealInCode` and
 * nested module sources read it like the root's; `applyOpsInScope` maps the
 * paths to the folder's own names for the patcher and back.
 */
import { applyOpsWithPatches } from '@/hcl/patch';
import { buildIR, parseFile, parseProject } from '@/hcl/parser';
import { dirOfPath } from '@/ir/modules';
import type { Op } from '@/ir/ops';
import type { Diagnostic, IR, Trivia } from '@/ir/types';

export type ScopedPatch = { ok: true; files: Record<string, string>; ir: IR } | { ok: false; message?: string };

/** A local module opened on the canvas: its folder, and the module calls that lead to it from the root. */
export interface ModuleScope {
  /** project folder, `modules/net` */
  dir: string;
  /** call names from the root module, outermost first (`['service', 'ecr']`) */
  path: string[];
}

/** The files of folder `dir`, keyed by their names in it. */
export function folderAsProject(files: Record<string, string>, dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) if (dirOfPath(path) === dir) out[path.slice(dir.length + 1)] = text;
  return out;
}

export function applyOpsInModule(files: Record<string, string>, dir: string, ops: Op[]): ScopedPatch {
  const scoped = folderAsProject(files, dir);
  if (Object.keys(scoped).length === 0) return { ok: false };
  const { ir, diagnostics } = parseProject(scoped);
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false };
  const outcome = applyOpsWithPatches(scoped, ir, ops);
  if (outcome.refused) return { ok: false, message: outcome.refused.message };
  if (outcome.diagnostics.some((d) => d.severity === 'error')) return { ok: false };
  const next = { ...files };
  for (const [name, text] of Object.entries(outcome.files)) next[`${dir}/${name}`] = text;
  return { ok: true, files: next, ir: outcome.ir };
}

/* ------------------------------------------------------- opened module */

type WithTrivia = { trivia: Trivia };

const hasTrivia = (v: unknown): v is WithTrivia =>
  typeof v === 'object' && v !== null && 'trivia' in v && typeof (v as WithTrivia).trivia === 'object';

function retrivia<T>(block: T, map: (file: string) => string): T {
  if (!hasTrivia(block) || block.trivia.sourceFile === undefined) return block;
  const file = map(block.trivia.sourceFile);
  return file === block.trivia.sourceFile ? block : { ...block, trivia: { ...block.trivia, sourceFile: file } };
}

/**
 * The IR with every block's `sourceFile` passed through `map`; blocks keep
 * everything else (positions, containment). Every list of blocks the IR has
 * is mapped, whatever its kind.
 */
export function mapSourceFiles(ir: IR, map: (file: string) => string): IR {
  const out: Record<string, unknown> = { ...ir };
  for (const [key, value] of Object.entries(ir)) if (Array.isArray(value)) out[key] = value.map((b) => retrivia(b, map));
  return out as unknown as IR;
}

/** An op whose new block (resource, module call, `moved {}`…) names a file, with that file mapped. */
function mapOpFiles(op: Op, map: (file: string) => string): Op {
  const o = op as Op & { node?: unknown; block?: unknown };
  if (hasTrivia(o.node)) return { ...op, node: retrivia(o.node, map) } as Op;
  if (hasTrivia(o.block)) return { ...op, block: retrivia(o.block, map) } as Op;
  return op;
}

export type ScopeOutcome =
  | { ok: true; files: Record<string, string>; ir: IR; renamed: Map<string, string> }
  | { ok: false; message?: string };

/**
 * Ops on the opened module in folder `dir`, whose blocks are `ir` (project
 * paths in `sourceFile`, as parseFolder gives them): patched into that
 * folder's files alone. The fresh IR comes back with project paths too.
 */
export function applyOpsInScope(files: Record<string, string>, dir: string, ir: IR, ops: Op[]): ScopeOutcome {
  const scoped = folderAsProject(files, dir);
  if (Object.keys(scoped).length === 0) return { ok: false };
  const prefix = `${dir}/`;
  const inFolder = (file: string) => (file.startsWith(prefix) ? file.slice(prefix.length) : file);
  const inProject = (file: string) => `${prefix}${file}`;
  const outcome = applyOpsWithPatches(
    scoped,
    mapSourceFiles(ir, inFolder),
    ops.map((op) => mapOpFiles(op, inFolder)),
  );
  if (outcome.refused) return { ok: false, message: outcome.refused.message };
  if (outcome.diagnostics.some((d) => d.severity === 'error')) return { ok: false };
  const next = { ...files };
  for (const [name, text] of Object.entries(outcome.files)) next[inProject(name)] = text;
  return { ok: true, files: next, ir: mapSourceFiles(outcome.ir, inProject), renamed: outcome.renamed };
}

/** The blocks of folder `dir` (project paths in `sourceFile`), freshly parsed; null when the project has no files there. */
export function parseFolder(files: Record<string, string>, dir: string): { ir: IR; diagnostics: Diagnostic[] } | null {
  const texts = Object.entries(files)
    .filter(([path]) => dirOfPath(path) === dir)
    .sort(([a], [b]) => a.localeCompare(b));
  if (dir === '' || texts.length === 0) return null;
  return buildIR(texts.map(([file, text]) => ({ file, ...parseFile(file, text) })));
}
