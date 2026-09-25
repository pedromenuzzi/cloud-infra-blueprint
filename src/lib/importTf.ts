/**
 * Import existing Terraform: loose .tf files, a folder, or a .zip. Files are
 * flattened into one project (sub-directories become a filename prefix) and
 * the layout is computed on open — no positions needed.
 */
import { strFromU8, unzipSync } from 'fflate';

export interface ImportedProject {
  name: string;
  files: Record<string, string>;
}

const SKIP = /(^|\/)(\.terraform|__MACOSX|node_modules)\//;

function safeName(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\//g, '_').replace(/[^\w.-]/g, '-');
}

function add(files: Record<string, string>, path: string, text: string) {
  const base = path.split('/').pop() ?? path;
  let name = files[safeName(base)] === undefined ? safeName(base) : safeName(path);
  for (let i = 2; files[name] !== undefined; i++) name = name.replace(/(\.tf)$/, `_${i}$1`);
  files[name] = text;
}

function stripExt(name: string) {
  return name.replace(/\.(zip|tf)$/i, '');
}

export async function readTerraformFiles(input: Iterable<File>): Promise<ImportedProject | null> {
  const files: Record<string, string> = {};
  let name: string | undefined;

  for (const file of input) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (/\.zip$/i.test(file.name)) {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      for (const [path, bytes] of Object.entries(entries)) {
        if (!path.endsWith('.tf') || SKIP.test(path)) continue;
        add(files, path, strFromU8(bytes));
      }
      name ??= stripExt(file.name);
    } else if (/\.tf$/i.test(file.name) && !SKIP.test(relative)) {
      add(files, relative, await file.text());
      // a dropped folder names the project
      if (!name && relative.includes('/')) name = relative.split('/')[0];
    }
  }

  if (Object.keys(files).length === 0) return null;
  return { name: name || 'imported-terraform', files };
}
