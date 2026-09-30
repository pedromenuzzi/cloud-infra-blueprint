/**
 * Child modules that live in the project (`modules/net/main.tf`): parsed on
 * their own, never into the root module's IR. What a module call needs from
 * its folder — the variables it takes (required or not), the outputs it
 * gives, the resources inside — is read here, cached per folder while its
 * files' texts stay the same.
 */
import { buildIR, parseFile } from '@/hcl/parser';
import { exprPreview, literalString } from './expr';
import { dirOfPath, moduleSourceInfo, resolveModuleDir, type ModuleSourceInfo } from './modules';
import type { Diagnostic, Expression, IR, ModuleNode } from './types';

export interface ModuleVariable {
  name: string;
  /** no `default`: every call must pass it */
  required: boolean;
  /** the `type` constraint as written (`list(string)`) */
  type?: string;
  description?: string;
  default?: Expression;
}

export interface ModuleOutput {
  name: string;
  description?: string;
}

export interface LocalModule {
  /** project folder, `modules/net` */
  dir: string;
  /** its files' project paths, sorted */
  files: string[];
  /** the module's own blocks (resources, variables, outputs, nested module calls) */
  ir: IR;
  diagnostics: Diagnostic[];
  /** parse errors: its interface can't be trusted */
  broken: boolean;
  variables: ModuleVariable[];
  outputs: ModuleOutput[];
}

const cache = new Map<string, { texts: Array<[string, string]>; value: LocalModule }>();
const MAX_CACHED = 64;

function sameTexts(a: Array<[string, string]>, b: Array<[string, string]>): boolean {
  return a.length === b.length && a.every(([path, text], i) => path === b[i][0] && text === b[i][1]);
}

/** The child module in project folder `dir`, or null when the project has no files there. */
export function readLocalModule(files: Record<string, string>, dir: string): LocalModule | null {
  if (dir === '') return null;
  const texts = Object.entries(files)
    .filter(([path]) => dirOfPath(path) === dir)
    .sort(([a], [b]) => a.localeCompare(b));
  if (texts.length === 0) return null;
  const hit = cache.get(dir);
  if (hit && sameTexts(hit.texts, texts)) return hit.value;

  const { ir, diagnostics } = buildIR(texts.map(([file, text]) => ({ file, ...parseFile(file, text) })));
  const value: LocalModule = {
    dir,
    files: texts.map(([path]) => path),
    ir,
    diagnostics,
    broken: diagnostics.some((d) => d.severity === 'error'),
    variables: ir.variables.map((v) => ({
      name: v.name,
      required: v.args.default === undefined,
      type: v.args.type ? exprPreview(v.args.type) : undefined,
      description: literalString(v.args.description),
      default: v.args.default,
    })),
    outputs: ir.outputs.map((o) => ({ name: o.name, description: literalString(o.args.description) })),
  };
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(dir, { texts, value });
  return value;
}

export type ModuleTarget =
  /** a folder of this project; `module` null when the project doesn't hold it */
  | { kind: 'local'; dir: string; info: ModuleSourceInfo; module: LocalModule | null }
  /** Registry, git, archives…: contents unknown to the app */
  | { kind: 'remote'; info: ModuleSourceInfo }
  /** no (literal) `source` */
  | { kind: 'none' };

/** What a module call's `source` points at, seen from the file the call is in. */
export function moduleTarget(files: Record<string, string>, m: ModuleNode): ModuleTarget {
  const info = moduleSourceInfo(m);
  if (!info) return { kind: 'none' };
  if (info.kind !== 'local') return { kind: 'remote', info };
  const dir = resolveModuleDir(dirOfPath(m.trivia.sourceFile ?? ''), info.source);
  return { kind: 'local', dir, info, module: readLocalModule(files, dir) };
}
