/**
 * Canvas ops on a child module's own blocks, with the same patcher as the
 * root module's: the module's folder is taken as a project of its own
 * (`modules/net/main.tf` → `main.tf`), parsed, patched minimally and put
 * back. Nothing outside the folder is touched; a patch the patcher refuses
 * (stale text, a block it would lose) changes nothing.
 */
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { dirOfPath } from '@/ir/modules';
import type { Op } from '@/ir/ops';
import type { IR } from '@/ir/types';

export type ScopedPatch = { ok: true; files: Record<string, string>; ir: IR } | { ok: false; message?: string };

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
