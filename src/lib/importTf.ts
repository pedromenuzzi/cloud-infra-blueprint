/**
 * Import existing Terraform: loose .tf files, a dropped folder, or a .zip.
 *
 * Only the ROOT module is imported — modules aren't supported yet, and
 * flattening them into one project breaks it (duplicate addresses, dangling
 * `source = "./modules/x"`). Module directories are skipped and counted so
 * the caller can say so. The layout is computed on open — no positions needed.
 */
import { strFromU8, unzipSync } from 'fflate';

export interface ImportedProject {
  name: string;
  files: Record<string, string>;
  /** directory the root module came from, relative to what was imported ('' = top level) */
  rootDir: string;
  /** .tf files outside the root module (modules, other roots) that were left out */
  skipped: number;
  /** .tf files left out because they were over the size caps */
  oversized: number;
}

/** One .tf file (a single file is ~KBs; generated monsters are skipped). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Everything read or inflated by one import. */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** Entries visited while walking a dropped folder. */
const MAX_ENTRIES = 20_000;

// never descended into / never inflated: provider caches, VCS, junk
const SKIP_DIR = /(^|\/)(\.terraform|\.git|__MACOSX|node_modules)(\/|$)/i;

/**
 * Is this path a Terraform source file we'd import? `.tf` only (any case) —
 * so state (`*.tfstate*`), `.terraform.lock.hcl` and everything under
 * `.terraform/` are never read, let alone inflated.
 */
export function isTerraformPath(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return /\.tf$/i.test(base) && !base.startsWith('._') && !SKIP_DIR.test(path);
}

interface Source {
  path: string;
  text: string;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.?\/)+/, '');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function depth(dir: string): number {
  return dir === '' ? 0 : dir.split('/').length;
}

function resolveDir(base: string, relative: string): string {
  const parts = base ? base.split('/') : [];
  for (const seg of relative.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Directories referenced as local modules (`source = "./x"`, `"../x"`) from `text` in `dir`. */
function localModuleDirs(dir: string, text: string): string[] {
  return [...text.matchAll(/\bsource\s*=\s*"(\.{1,2}\/[^"]*)"/g)].map((m) => resolveDir(dir, m[1]));
}

/**
 * The root module: not referenced as a module by another directory, not under
 * a `modules/` folder, as shallow as possible — ties go to the directory that
 * calls modules, then the one with more files, then alphabetical.
 */
export function pickRootDir(paths: Array<{ path: string; text: string }>): string {
  const count = new Map<string, number>();
  const callsModules = new Set<string>();
  const referenced = new Set<string>();
  for (const { path, text } of paths) {
    const dir = dirOf(path);
    count.set(dir, (count.get(dir) ?? 0) + 1);
    const refs = localModuleDirs(dir, text);
    if (refs.length > 0) callsModules.add(dir);
    for (const ref of refs) if (ref !== dir) referenced.add(ref);
  }
  const all = [...count.keys()];
  const roots = all.filter((d) => !referenced.has(d));
  const inModules = (d: string) => (/(^|\/)modules(\/|$)/.test(d) ? 1 : 0);
  return (roots.length > 0 ? roots : all).sort(
    (a, b) =>
      inModules(a) - inModules(b) ||
      depth(a) - depth(b) ||
      Number(callsModules.has(b)) - Number(callsModules.has(a)) ||
      count.get(b)! - count.get(a)! ||
      a.localeCompare(b),
  )[0];
}

/** Keep letters (any script), digits, `_ . -`; lowercase the `.tf` extension. */
function safeFileName(base: string): string {
  return base
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_.-]/gu, '-')
    .replace(/\.tf$/i, '.tf');
}

/** Adds `text` under a unique (case-insensitive) name: `main.tf`, `main_2.tf`… */
function addFile(files: Record<string, string>, base: string, text: string) {
  const name = safeFileName(base);
  const taken = new Set(Object.keys(files).map((k) => k.toLowerCase()));
  const stem = name.replace(/\.tf$/, '');
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${stem}_${i}.tf`;
  files[candidate] = text;
}

function stripExt(name: string) {
  return name.replace(/\.(zip|tf)$/i, '');
}

/** Tracks the size caps across one import. */
class Budget {
  used = 0;
  oversized = 0;
  take(size: number): boolean {
    if (size > MAX_FILE_BYTES || this.used + size > MAX_TOTAL_BYTES) {
      this.oversized += 1;
      return false;
    }
    this.used += size;
    return true;
  }
}

function readZip(bytes: Uint8Array, budget: Budget): Source[] {
  // the filter runs BEFORE an entry is inflated: skipped entries cost nothing,
  // and fflate inflates into a buffer of the declared size (a lying header can't grow it)
  const entries = unzipSync(bytes, {
    filter: (entry) => isTerraformPath(normalizePath(entry.name)) && budget.take(entry.originalSize),
  });
  return Object.entries(entries).map(([path, data]) => ({ path: normalizePath(path), text: strFromU8(data) }));
}

async function readFileSource(file: File, path: string, budget: Budget): Promise<Source[]> {
  if (/\.zip$/i.test(file.name)) {
    try {
      return readZip(new Uint8Array(await file.arrayBuffer()), budget);
    } catch {
      return []; // not a readable zip
    }
  }
  if (!isTerraformPath(path) || !budget.take(file.size)) return [];
  return [{ path, text: await file.text() }];
}

function buildProject(sources: Source[], name: string, budget: Budget): ImportedProject | null {
  if (sources.length === 0) return null;
  const rootDir = pickRootDir(sources);
  const files: Record<string, string> = {};
  let skipped = 0;
  for (const source of sources) {
    if (dirOf(source.path) !== rootDir) {
      skipped += 1;
      continue;
    }
    addFile(files, source.path.split('/').pop()!, source.text);
  }
  return { name, files, rootDir, skipped, oversized: budget.oversized };
}

/** Loose .tf files and/or .zip archives (e.g. from a file input). */
export async function readTerraformFiles(
  input: Iterable<File> | ArrayLike<File>,
): Promise<ImportedProject | null> {
  // copy BEFORE the first await: a live FileList (input.files, dataTransfer.files)
  // is emptied when the input is reset or the drop event ends
  const list = Array.from(input);
  const budget = new Budget();
  const sources: Source[] = [];
  let name: string | undefined;
  for (const file of list) {
    const relative = normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    const found = await readFileSource(file, relative, budget);
    sources.push(...found);
    if (found.length > 0) {
      if (/\.zip$/i.test(file.name)) name ??= stripExt(file.name);
      // a picked folder names the project
      else if (!name && relative.includes('/')) name = relative.split('/')[0];
    }
  }
  return buildProject(sources, name || 'imported-terraform', budget);
}

/* ---------------------------------------------------------- folder drop */

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walk(
  entry: FileSystemEntry,
  out: Array<{ file: File; path: string }>,
  seen: { count: number },
) {
  if (++seen.count > MAX_ENTRIES) return;
  const path = normalizePath(entry.fullPath || entry.name);
  if (entry.isFile) {
    if (isTerraformPath(path)) out.push({ file: await entryFile(entry as FileSystemFileEntry), path });
    return;
  }
  if (!entry.isDirectory || SKIP_DIR.test(`${path}/`)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns batches (≤100 in Chrome) until an empty one
  for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
    for (const child of batch) await walk(child, out, seen);
  }
}

/**
 * Everything dropped on the page: .tf files, .zip archives and whole folders
 * (walked recursively through `webkitGetAsEntry`, keeping relative paths so
 * the root module can be told apart from `modules/`).
 */
export async function readDroppedTerraform(transfer: DataTransfer): Promise<ImportedProject | null> {
  // a DataTransfer is emptied once the drop event returns — grab it synchronously
  const files = Array.from(transfer.files);
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  if (!entries.some((entry) => entry?.isDirectory)) return readTerraformFiles(files);

  const budget = new Budget();
  const sources: Source[] = [];
  let name: string | undefined;
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDirectory) {
      const found: Array<{ file: File; path: string }> = [];
      await walk(entry, found, { count: 0 });
      for (const { file, path } of found) sources.push(...(await readFileSource(file, path, budget)));
      if (found.length > 0) name ??= entry.name;
    } else {
      const file = files.find((f) => f.name === entry.name) ?? (await entryFile(entry as FileSystemFileEntry));
      const found = await readFileSource(file, normalizePath(file.name), budget);
      sources.push(...found);
      if (found.length > 0 && /\.zip$/i.test(file.name)) name ??= stripExt(file.name);
    }
  }
  return buildProject(sources, name || 'imported-terraform', budget);
}

/** A follow-up sentence when parts of the import were left out, else null. */
export function importNote(imported: ImportedProject): string | null {
  const notes: string[] = [];
  if (imported.skipped > 0) {
    const where = imported.rootDir ? ` (${imported.rootDir}/)` : '';
    notes.push(
      `Imported the root module${where}; ${imported.skipped} file${imported.skipped === 1 ? '' : 's'} in modules/ ` +
        `${imported.skipped === 1 ? 'was' : 'were'} skipped (modules aren't supported yet)`,
    );
  }
  if (imported.oversized > 0) {
    notes.push(`${imported.oversized} file${imported.oversized === 1 ? ' was' : 's were'} too large to import`);
  }
  return notes.length > 0 ? `${notes.join('. ')}.` : null;
}

/** Open the OS file picker for .tf / .zip files (call from a user gesture). */
export function pickTerraformFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.tf,.zip';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.length ? [...input.files] : null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
