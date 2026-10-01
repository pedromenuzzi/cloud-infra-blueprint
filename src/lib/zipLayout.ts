/**
 * Where each file of a project goes in its Terraform zip, so `terraform
 * init` works on what's unzipped.
 *
 * A project keeps its child modules at the path their `source` gives from
 * the root with `..` stopping at the top (`../../modules/vpc` → `modules/vpc`,
 * src/ir/modules.ts). Unzipped flat, those sources would point outside the
 * zip. So when they climb above the root module, the root goes back into
 * folders, at the path it was imported from when known (`envs/prod/`), else
 * at a stand-in one just deep enough (`envs/<project>/`), and each module
 * folder at the path its calls really reach from there. Importing the zip
 * again gives the same project back (src/lib/importTf.ts reads it the same
 * way). Without climbing sources the zip is flat, as it always was.
 */
import { dirOfPath, resolveModuleDir } from '@/ir/modules';
import { localModuleSources, resolveInTree } from './importTf';
import { slugify } from './utils';

export interface ZipLayout {
  /** zip path → text */
  entries: Record<string, string>;
  /** the root module's folder in the zip ('' = the top) */
  root: string;
}

/** As deep as a root module can be put. */
const MAX_DEPTH = 8;
/** stand-in folder names above the root module, nearest first */
const FILLERS = ['envs', 'live', 'infra', 'stacks', 'org', 'repo', 'top', 'base'];

/**
 * Each stored module folder's real folders with the root module at `root`;
 * null when a call would climb out of the zip.
 */
function place(byDir: Map<string, string[]>, root: string): Map<string, Set<string>> | null {
  const real = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const queue: Array<{ stored: string; at: string }> = [{ stored: '', at: root }];
  while (queue.length > 0) {
    const { stored, at } = queue.shift()!;
    for (const text of byDir.get(stored) ?? []) {
      for (const source of localModuleSources(text)) {
        const target = resolveModuleDir(stored, source);
        if (target === '' || !byDir.has(target)) continue;
        const where = resolveInTree(at, source);
        if (where === null) return null;
        if (where === root) continue;
        const key = `${target}\u0000${where}`;
        if (seen.has(key)) continue;
        seen.add(key);
        real.set(target, new Set([...(real.get(target) ?? []), where]));
        queue.push({ stored: target, at: where });
      }
    }
  }
  return real;
}

/** The zip's layout for these project files (`rootPath`: where the root module was imported from). */
export function zipLayout(files: Record<string, string>, options: { rootPath?: string; name?: string } = {}): ZipLayout {
  const byDir = new Map<string, string[]>();
  for (const [path, text] of Object.entries(files)) byDir.set(dirOfPath(path), [...(byDir.get(dirOfPath(path)) ?? []), text]);

  const candidates: string[] = [''];
  const known = options.rootPath ? options.rootPath.split('/') : [];
  if (known.length > 0) candidates.push(known.join('/'));
  const base = known.length > 0 ? known : [slugify(options.name ?? '') || 'root'];
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const segments = [...base];
    while (segments.length < depth) segments.unshift(FILLERS[segments.length - 1] ?? `level${segments.length}`);
    candidates.push(segments.join('/'));
  }

  for (const root of candidates) {
    const placed = place(byDir, root);
    if (!placed) continue;
    if (root === '') return { entries: { ...files }, root };
    const entries: Record<string, string> = {};
    for (const [path, text] of Object.entries(files)) {
      const dir = dirOfPath(path);
      const name = path.slice(dir === '' ? 0 : dir.length + 1);
      if (dir === '') {
        entries[`${root}/${name}`] = text;
        continue;
      }
      const at = placed.get(dir);
      // a module folder no call reaches stays where the project keeps it
      for (const where of at ?? [dir]) entries[`${where}/${name}`] = text;
    }
    return { entries, root };
  }
  return { entries: { ...files }, root: '' };
}
