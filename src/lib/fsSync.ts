/**
 * Local folder sync through the File System Access API (Chromium browsers).
 *
 * A project can be linked to a folder on disk — the Terraform root module.
 * The link remembers, per .tf file, the hash of the text both sides last
 * agreed on (`synced`). Each sync reads the folder and compares three texts
 * per file — the project's, the disk's and the agreed one:
 *
 *   project == disk            nothing to do
 *   only the project changed   write it to disk (or delete it there)
 *   only the disk changed      take it into the project (or drop it)
 *   both changed, differently  a conflict — nothing moves until the user picks
 *
 * Safety rules: only the .tf files directly in the linked folder are ever
 * touched; a file the app didn't create is never deleted without asking;
 * before a write, the file on disk is re-read and must still be the agreed
 * version (else it's a conflict, not an overwrite); a folder that suddenly
 * has no .tf files at all is a conflict too (moved or emptied), never a
 * reason to empty the project.
 *
 * Directory handles are kept in IndexedDB (`idbLinkStore`); after a reload
 * the browser asks for permission again (`requestFolderPermission`, from a
 * click). Everything here works on the small `DirHandleLike` interface, so
 * tests run against an in-memory folder.
 */
import { idb } from './idb';
import { isTerraformPath, pickRootDir } from './importTf';
import { hashText } from './storage';

/* -------------------------------------------- File System Access subset */

export interface FileLike {
  size: number;
  lastModified: number;
  text(): Promise<string>;
}

export interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<FileLike>;
  createWritable(): Promise<WritableLike>;
}

export interface DirHandleLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandleLike | DirHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  isSameEntry?(other: DirHandleLike): Promise<boolean>;
}

type PickerWindow = Window & {
  showDirectoryPicker?(options?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<DirHandleLike>;
};

/** Chromium desktop browsers (Chrome, Edge, Opera…) on https or localhost. */
export function isFolderSyncSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as PickerWindow).showDirectoryPicker === 'function' &&
    window.isSecureContext !== false
  );
}

/** The OS folder picker (call from a click). Null when the user cancels. */
export async function pickFolder(): Promise<DirHandleLike | null> {
  try {
    return await (window as PickerWindow).showDirectoryPicker!({ id: 'cloud-blueprint', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/** Is read/write access granted right now (no prompt)? */
export async function hasFolderPermission(dir: DirHandleLike): Promise<boolean> {
  if (!dir.queryPermission) return true;
  try {
    return (await dir.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Ask for read/write access again (after a reload). Needs a user gesture. */
export async function requestFolderPermission(dir: DirHandleLike): Promise<boolean> {
  if (await hasFolderPermission(dir)) return true;
  try {
    return (await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ reading */

/** Same caps as importing Terraform (importTf.ts). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const SKIP_DIR = /^(\.terraform|\.git|__MACOSX|node_modules)$/i;

/** A name we may write as one file directly in the folder. */
export function isSyncableName(name: string): boolean {
  return (
    isTerraformPath(name) &&
    name.length <= 255 &&
    !/[/\\\u0000]/.test(name) &&
    name.trim() === name &&
    name !== '.' &&
    name !== '..'
  );
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'NotReadableError');
}

async function readText(dir: DirHandleLike, name: string): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch (err) {
    if (isNotFound(err) || (err instanceof DOMException && err.name === 'TypeMismatchError')) return null;
    throw err;
  }
}

/** The .tf files directly in `dir`: exact disk name → text (files over the cap are left out). */
export async function readFolderFiles(dir: DirHandleLike): Promise<{ files: Record<string, string>; oversized: number }> {
  const files: Record<string, string> = {};
  let oversized = 0;
  let total = 0;
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !isSyncableName(entry.name)) continue;
    const file = await entry.getFile();
    if (file.size > MAX_FILE_BYTES || total + file.size > MAX_TOTAL_BYTES) {
      oversized += 1;
      continue;
    }
    total += file.size;
    files[entry.name] = await file.text();
  }
  return { files, oversized };
}

export interface FolderModule {
  /** the root module's folder: the picked one, or a folder inside it */
  dir: DirHandleLike;
  /** `infra`, or `repo/infra` when the root module sits below the picked folder */
  label: string;
  files: Record<string, string>;
  /** .tf files in other folders (modules) that were left out */
  skipped: number;
  oversized: number;
}

/**
 * "Open folder…": finds the Terraform root module in a picked folder with the
 * same rules as importing (importTf.ts — modules/ and referenced module
 * folders aren't the root; .terraform, .git… are never read).
 */
export async function readRootModule(picked: DirHandleLike): Promise<FolderModule | null> {
  const sources: Array<{ path: string; text: string }> = [];
  const dirs = new Map<string, DirHandleLike>([['', picked]]);
  let entries = 0;
  let total = 0;
  let oversized = 0;
  const walk = async (dir: DirHandleLike, prefix: string) => {
    for await (const entry of dir.values()) {
      if (++entries > MAX_ENTRIES) return;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (SKIP_DIR.test(entry.name)) continue;
        dirs.set(path, entry);
        await walk(entry, path);
      } else if (isSyncableName(entry.name) && isTerraformPath(path)) {
        const file = await entry.getFile();
        if (file.size > MAX_FILE_BYTES || total + file.size > MAX_TOTAL_BYTES) {
          oversized += 1;
          continue;
        }
        total += file.size;
        sources.push({ path, text: await file.text() });
      }
    }
  };
  await walk(picked, '');
  if (sources.length === 0) return null;
  const rootDir = pickRootDir(sources);
  const files: Record<string, string> = {};
  let skipped = 0;
  for (const { path, text } of sources) {
    const slash = path.lastIndexOf('/');
    if ((slash === -1 ? '' : path.slice(0, slash)) === rootDir) files[path.slice(slash + 1)] = text;
    else skipped += 1;
  }
  return {
    dir: dirs.get(rootDir) ?? picked,
    label: rootDir ? `${picked.name}/${rootDir}` : picked.name,
    files,
    skipped,
    oversized,
  };
}

/* ------------------------------------------------------------ the link */

export interface FolderLink {
  projectId: string;
  dir: DirHandleLike;
  /** the folder's name as shown to the user */
  label: string;
  /** file name → hash of the text both sides last agreed on */
  synced: Record<string, string>;
  /** files this app created in the folder — the only ones it deletes without asking */
  created: string[];
  /** removed from the project but kept on disk (the user said so): no longer synced */
  ignored: string[];
  linkedAt: string;
  syncedAt: string | null;
}

export function hashFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hashText(text)]));
}

export function createLink(input: {
  projectId: string;
  dir: DirHandleLike;
  label: string;
  synced?: Record<string, string>;
  created?: string[];
}): FolderLink {
  return {
    projectId: input.projectId,
    dir: input.dir,
    label: input.label,
    synced: input.synced ?? {},
    created: input.created ?? [],
    ignored: [],
    linkedAt: new Date().toISOString(),
    syncedAt: null,
  };
}

/** Where links live. */
export interface LinkStore {
  get(projectId: string): Promise<FolderLink | undefined>;
  set(link: FolderLink): Promise<void>;
  delete(projectId: string): Promise<void>;
  all(): Promise<FolderLink[]>;
}

const LINK_PREFIX = 'folder-link:';

/** Links in IndexedDB (directory handles survive reloads there). */
export const idbLinkStore: LinkStore = {
  get: (projectId) => idb.get<FolderLink>(`${LINK_PREFIX}${projectId}`),
  set: (link) => idb.set(`${LINK_PREFIX}${link.projectId}`, link),
  delete: (projectId) => idb.delete(`${LINK_PREFIX}${projectId}`),
  all: () => idb.values<FolderLink>(LINK_PREFIX),
};

/** The link (if any) whose folder is `dir`. */
export async function findLinkByFolder(store: LinkStore, dir: DirHandleLike): Promise<FolderLink | undefined> {
  for (const link of await store.all()) {
    try {
      if (await link.dir.isSameEntry?.(dir)) return link;
    } catch {
      /* a handle to a folder that's gone */
    }
  }
  return undefined;
}

/* ------------------------------------------------------------ planning */

export interface SyncPlan {
  /** created or changed in the project: write to disk */
  write: string[];
  /** removed from the project: delete from disk */
  remove: string[];
  /** created or changed on disk: take into the project */
  pull: string[];
  /** removed from disk: drop from the project */
  drop: string[];
  /** changed on both sides since the last sync, to different texts */
  conflicts: string[];
  /** files both sides already agree on (name → hash) */
  agreed: Record<string, string>;
}

const own = (files: Record<string, string>, name: string) => Object.hasOwn(files, name);

/** Only the project's files that can live in the folder take part. */
export function syncableFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([name]) => isSyncableName(name)));
}

/** The three-way comparison (see the top of this file). Pure. */
export function planSync(
  app: Record<string, string>,
  disk: Record<string, string>,
  synced: Record<string, string>,
  ignored: readonly string[] = [],
): SyncPlan {
  const plan: SyncPlan = { write: [], remove: [], pull: [], drop: [], conflicts: [], agreed: {} };
  const names = [...new Set([...Object.keys(app), ...Object.keys(disk), ...Object.keys(synced)])].sort();
  for (const name of names) {
    // kept on disk by choice: not part of the project unless the project writes it again
    if (ignored.includes(name) && !own(app, name)) continue;
    const a = own(app, name) ? hashText(app[name]) : null;
    const d = own(disk, name) ? hashText(disk[name]) : null;
    const s = own(synced, name) ? synced[name] : null;
    if (a === d) {
      if (a !== null) plan.agreed[name] = a;
    } else if (a === s) {
      (d === null ? plan.drop : plan.pull).push(name);
    } else if (d === s) {
      (a === null ? plan.remove : plan.write).push(name);
    } else {
      plan.conflicts.push(name);
    }
  }
  // no .tf files left at all: the folder was moved or emptied — ask, never empty the project
  if (Object.keys(disk).length === 0 && plan.drop.length > 0) {
    plan.conflicts.push(...plan.drop);
    plan.conflicts.sort();
    plan.drop = [];
  }
  return plan;
}

export type Side = 'added' | 'changed' | 'deleted' | 'same';

export interface ConflictInfo {
  name: string;
  /** what happened in the project since the last sync */
  app: Side;
  /** what happened on disk since the last sync */
  disk: Side;
}

function side(present: boolean, hash: string | null, synced: string | null): Side {
  if (!present) return 'deleted';
  if (synced === null) return 'added';
  return hash === synced ? 'same' : 'changed';
}

export function describeConflicts(
  names: string[],
  app: Record<string, string>,
  disk: Record<string, string>,
  synced: Record<string, string>,
): ConflictInfo[] {
  return names.map((name) => ({
    name,
    app: side(own(app, name), own(app, name) ? hashText(app[name]) : null, synced[name] ?? null),
    disk: side(own(disk, name), own(disk, name) ? hashText(disk[name]) : null, synced[name] ?? null),
  }));
}

export interface LinkPreview {
  /** identical on both sides */
  same: string[];
  /** only in the project: would be written */
  appOnly: string[];
  /** only in the folder */
  diskOnly: string[];
  /** in both, with different text */
  differ: string[];
}

/** Linking a project to a folder that may already hold .tf files: what differs. */
export function previewLink(app: Record<string, string>, disk: Record<string, string>): LinkPreview {
  const preview: LinkPreview = { same: [], appOnly: [], diskOnly: [], differ: [] };
  for (const name of [...new Set([...Object.keys(app), ...Object.keys(disk)])].sort()) {
    if (!own(disk, name)) preview.appOnly.push(name);
    else if (!own(app, name)) preview.diskOnly.push(name);
    else if (app[name] === disk[name]) preview.same.push(name);
    else preview.differ.push(name);
  }
  return preview;
}

/** Nothing on disk would be lost by writing the project there. */
export function linkNeedsChoice(preview: LinkPreview): boolean {
  return preview.diskOnly.length > 0 || preview.differ.length > 0;
}

/**
 * The agreed baseline for a new link, so the first sync makes the chosen
 * side win: 'app' writes the project over the folder (and deletes its other
 * .tf files — the caller asked), 'disk' loads the folder into the project.
 */
export function baselineFor(
  choice: 'app' | 'disk',
  app: Record<string, string>,
  disk: Record<string, string>,
): Record<string, string> {
  return hashFiles(choice === 'app' ? disk : app);
}

/* ------------------------------------------------------------ syncing */

export interface SyncIO {
  /** the project's files right now (the editor's, including unsaved edits) */
  appFiles(): Record<string, string>;
  /** take files from disk into the project; false when that could not be stored */
  setAppFiles(files: Record<string, string>): boolean;
  /** may these files, which the app didn't create, be deleted from the folder? */
  confirmRemove(names: string[]): Promise<boolean>;
  saveLink(link: FolderLink): Promise<void>;
}

export type SyncResult =
  | { status: 'synced'; wrote: string[]; pulled: string[]; removed: string[] }
  | { status: 'conflict'; conflicts: ConflictInfo[] }
  /** read/write access must be granted again (from a click) */
  | { status: 'permission' }
  /** the folder is gone (moved, renamed, deleted) */
  | { status: 'missing' }
  | { status: 'error'; message: string };

export interface SyncOptions {
  /** settle the conflicts: keep the project's side, or the disk's */
  resolve?: 'app' | 'disk';
  /** files the user already agreed to delete from the folder (e.g. when linking) */
  allowRemove?: readonly string[];
}

/** The file on disk changed between reading the folder and writing it. */
class RaceError extends Error {}

async function writeText(dir: DirHandleLike, name: string, text: string, expected: string | null) {
  // never overwrite a change we haven't seen: the disk must still hold what this pass read
  const current = await readText(dir, name);
  const now = current === null ? null : hashText(current);
  if (now !== expected && now !== hashText(text)) throw new RaceError(name);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function message(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Permission to the folder was revoked';
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return 'The disk is full';
  if (err instanceof DOMException && err.name === 'InvalidModificationError') return 'A file is locked by another program';
  return err instanceof Error && err.message ? err.message : 'The folder could not be read or written';
}

/**
 * One sync pass: read the folder, compare, apply. Mutates and saves `link`
 * (its agreed hashes) when something was applied.
 */
export async function syncFolder(link: FolderLink, io: SyncIO, options: SyncOptions = {}, attempt = 0): Promise<SyncResult> {
  if (!(await hasFolderPermission(link.dir))) return { status: 'permission' };
  let disk: Record<string, string>;
  try {
    disk = (await readFolderFiles(link.dir)).files;
  } catch (err) {
    return isNotFound(err) ? { status: 'missing' } : { status: 'error', message: message(err) };
  }
  const app = syncableFiles(io.appFiles());
  const plan = planSync(app, disk, link.synced, link.ignored);

  if (plan.conflicts.length > 0) {
    if (!options.resolve) {
      return { status: 'conflict', conflicts: describeConflicts(plan.conflicts, app, disk, link.synced) };
    }
    for (const name of plan.conflicts) {
      if (options.resolve === 'app') (own(app, name) ? plan.write : plan.remove).push(name);
      else (own(disk, name) ? plan.pull : plan.drop).push(name);
    }
  }

  // deleting files the app didn't create needs a yes (a chosen side counts as one)
  const allowed = new Set([...(options.allowRemove ?? []), ...link.created]);
  const conflictChoice = new Set(options.resolve === 'app' ? plan.conflicts : []);
  const ask = plan.remove.filter((name) => !allowed.has(name) && !conflictChoice.has(name));
  const keepOnDisk = new Set<string>();
  if (ask.length > 0 && !(await io.confirmRemove(ask))) for (const name of ask) keepOnDisk.add(name);

  const synced: Record<string, string> = { ...plan.agreed };
  const created = new Set(link.created);
  const ignored = new Set(link.ignored);

  // disk → project
  if (plan.pull.length > 0 || plan.drop.length > 0) {
    const next = { ...io.appFiles() };
    for (const name of plan.pull) next[name] = disk[name];
    for (const name of plan.drop) delete next[name];
    if (!io.setAppFiles(next)) return { status: 'error', message: 'The project could not be saved in this browser' };
    for (const name of plan.pull) synced[name] = hashText(disk[name]);
  }

  // project → disk
  const removed: string[] = [];
  try {
    for (const name of plan.write) {
      await writeText(link.dir, name, app[name], own(disk, name) ? hashText(disk[name]) : null);
      if (!own(disk, name)) created.add(name);
      ignored.delete(name);
      synced[name] = hashText(app[name]);
      link.synced = { ...link.synced, [name]: synced[name] }; // progress survives a failure half-way
    }
    for (const name of plan.remove) {
      if (keepOnDisk.has(name)) {
        ignored.add(name);
        continue;
      }
      await link.dir.removeEntry(name).catch((err: unknown) => {
        if (!isNotFound(err)) throw err;
      });
      created.delete(name);
      removed.push(name);
    }
  } catch (err) {
    if (err instanceof RaceError && attempt < 2) return syncFolder(link, io, options, attempt + 1);
    await io.saveLink(link).catch(() => undefined);
    return { status: 'error', message: message(err) };
  }

  link.synced = synced;
  link.created = [...created].filter((name) => own(synced, name));
  link.ignored = [...ignored];
  link.syncedAt = new Date().toISOString();
  // the in-memory link is what this tab uses next; storing it is for the next visit
  await io.saveLink(link).catch(() => undefined);
  return { status: 'synced', wrote: [...plan.write].sort(), pulled: [...plan.pull, ...plan.drop].sort(), removed: removed.sort() };
}
