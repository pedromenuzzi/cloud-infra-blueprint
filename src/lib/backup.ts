/**
 * Backup and restore of every project in this browser, as one .zip:
 *
 *   manifest.json            format version, and per project its id, name,
 *                            template, timestamps, content hash and files
 *   README.md                what the file is and how to restore it
 *   production-web/main.tf   one folder per project, its .tf files as-is
 *
 * Restoring never overwrites silently: `planRestore` sorts each project of the
 * backup into new / already here (same content) / conflict (same id, other
 * content), and the user decides whether conflicts become copies or replace
 * what's here. Everything lands in one storage write (all or nothing).
 */
import { safeRootPath } from './projectPath';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { messagesFor } from '@/i18n/messages';
import { backupMessages } from './backup.messages';
import { isTerraformPath } from './importTf';
import { filesHash, projectSize, putProjects, type Project, type PutProjectsResult } from './storage';
import { slugify, uid } from './utils';

export const BACKUP_FORMAT = 'cloud-blueprint-backup';
/** Bump when the manifest changes shape; older apps refuse newer backups. */
export const BACKUP_VERSION = 1;
const MANIFEST = 'manifest.json';

/** One .tf file (the same cap as importing Terraform). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Everything inflated by one restore (browser storage holds ~5 MB anyway). */
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PROJECTS = 2000;
const MAX_FILES = 500;

/* --------------------------------------------------------------- manifest */

export interface ManifestFile {
  /** the file's name in the project */
  name: string;
  /** where it sits in the zip */
  path: string;
}

export interface ManifestProject {
  id: string;
  name: string;
  description?: string;
  templateSlug?: string;
  /** where its root module was imported from (`envs/prod`) */
  rootPath?: string;
  createdAt: string;
  updatedAt: string;
  /** filesHash() of the files */
  hash: string;
  files: ManifestFile[];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: string;
  exportedAt: string;
  projects: ManifestProject[];
}

/** A project of a backup, files read from the zip. */
export interface BackupProject {
  id: string;
  name: string;
  description?: string;
  templateSlug?: string;
  rootPath?: string;
  createdAt: string;
  updatedAt: string;
  files: Record<string, string>;
  /** computed from the files (the manifest's own hash is not trusted) */
  hash: string;
}

export interface ParsedBackup {
  version: number;
  exportedAt: string;
  projects: BackupProject[];
  /** entries that can't be restored, and why */
  invalid: Array<{ name: string; reason: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** A relative path inside the zip: no `..`, no absolute or empty segments. */
function isSafePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512 || path.includes('\u0000')) return false;
  if (path.includes('\\') || path.startsWith('/')) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function isFileName(name: unknown): name is string {
  return typeof name === 'string' && name.trim() !== '' && name.length <= 255 && !name.includes('\u0000');
}

/** the messages in the UI language of the moment (checks and READMEs are made on demand) */
const text = () => messagesFor(backupMessages);

export type ManifestCheck =
  | { ok: true; manifest: BackupManifest; invalid: Array<{ name: string; reason: string }> }
  | { ok: false; error: string };

/**
 * Checks a parsed manifest.json. Problems with the file as a whole are fatal
 * (`ok: false`); a malformed project entry is only left out, with its reason.
 */
export function validateManifest(value: unknown): ManifestCheck {
  const m = text();
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) return { ok: false, error: m.notABackup };
  const { version } = value;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: m.unknownVersion };
  }
  if (version > BACKUP_VERSION) return { ok: false, error: m.newerVersion };
  if (!Array.isArray(value.projects)) return { ok: false, error: m.noProjectList };
  if (value.projects.length > MAX_PROJECTS) return { ok: false, error: m.tooManyProjects(MAX_PROJECTS) };
  const exportedAt = isIsoDate(value.exportedAt) ? value.exportedAt : new Date(0).toISOString();
  const projects: ManifestProject[] = [];
  const invalid: Array<{ name: string; reason: string }> = [];
  const ids = new Set<string>();
  value.projects.forEach((entry, i) => {
    const label = isRecord(entry) && typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : m.projectLabel(i + 1);
    const fail = (reason: string) => invalid.push({ name: label, reason });
    if (!isRecord(entry)) return fail(m.notAProject);
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 100) return fail(m.missingId);
    if (ids.has(entry.id)) return fail(m.listedTwice);
    if (!Array.isArray(entry.files) || entry.files.length > MAX_FILES) return fail(m.damagedFileList);
    const files: ManifestFile[] = [];
    const names = new Set<string>();
    for (const file of entry.files) {
      if (!isRecord(file) || !isFileName(file.name) || !isSafePath(file.path) || names.has(file.name)) {
        return fail(m.damagedFileList);
      }
      names.add(file.name);
      files.push({ name: file.name, path: file.path });
    }
    ids.add(entry.id);
    const createdAt = isIsoDate(entry.createdAt) ? entry.createdAt : isIsoDate(entry.updatedAt) ? entry.updatedAt : exportedAt;
    projects.push({
      id: entry.id,
      name: label,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      templateSlug: typeof entry.templateSlug === 'string' ? entry.templateSlug : undefined,
      rootPath: safeRootPath(entry.rootPath),
      createdAt,
      updatedAt: isIsoDate(entry.updatedAt) ? entry.updatedAt : createdAt,
      hash: typeof entry.hash === 'string' ? entry.hash : '',
      files,
    });
  });
  return {
    ok: true,
    manifest: { format: BACKUP_FORMAT, version, app: String(value.app ?? ''), exportedAt, projects },
    invalid,
  };
}

/* ------------------------------------------------------------------ write */

/** `base`, or `base-2`, `base-3`… — unique (case-insensitively) within `used`, which it joins. */
function uniqueSegment(base: string, used: Set<string>): string {
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${stem}-${i}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** A file name that extracts safely everywhere (the manifest keeps the real name). */
function safeSegment(name: string): string {
  const clean = name.normalize('NFC').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '');
  return clean.slice(0, 120) || 'file.tf';
}

function readme(manifest: BackupManifest): string {
  return text().readme(manifest.projects.length, manifest.exportedAt);
}

/** The backup .zip of `projects`. */
export function buildBackup(projects: Project[], now = new Date()): Uint8Array {
  const PLACEHOLDER = new Uint8Array(0);
  // manifest and README first: insertion order is the order in the archive
  const entries: Record<string, Uint8Array> = { [MANIFEST]: PLACEHOLDER, 'README.md': PLACEHOLDER };
  const folders = new Set<string>([MANIFEST, 'readme.md']);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: 'Cloud Blueprint',
    exportedAt: now.toISOString(),
    projects: projects.map((project) => {
      const folder = uniqueSegment(slugify(project.name), folders);
      const used = new Set<string>();
      const files = Object.keys(project.files)
        .sort()
        .map((name) => {
          const path = `${folder}/${uniqueSegment(safeSegment(name), used)}`;
          entries[path] = strToU8(project.files[name]);
          return { name, path };
        });
      return {
        id: project.id,
        name: project.name,
        ...(project.description !== undefined ? { description: project.description } : {}),
        ...(project.templateSlug !== undefined ? { templateSlug: project.templateSlug } : {}),
        ...(project.rootPath !== undefined ? { rootPath: project.rootPath } : {}),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        hash: filesHash(project.files),
        files,
      };
    }),
  };
  entries[MANIFEST] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries['README.md'] = strToU8(readme(manifest));
  return zipSync(entries, { level: 6, mtime: now });
}

/** `cloud-blueprint-backup-2026-09-29.zip` (local date). */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `cloud-blueprint-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

/* ------------------------------------------------------------------- read */

export type ParseResult =
  | { ok: true; backup: ParsedBackup }
  /** `terraform`: a zip of .tf files without a manifest — an export, meant for Import */
  | { ok: false; error: string; hint?: 'terraform' };

/** depth of a zip path: 0 for `a`, 1 for `x/a` */
const depthOf = (path: string) => path.split('/').length - 1;

interface ListedEntry {
  name: string;
  size: number;
}

/** The entries of a zip, without inflating any; null when it isn't a readable zip. */
function listEntries(bytes: Uint8Array): ListedEntry[] | null {
  const listed: ListedEntry[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        listed.push({ name: file.name, size: file.originalSize });
        return false;
      },
    });
  } catch {
    return null;
  }
  return listed;
}

/** The manifest at the top, or one folder down (a backup that was unzipped and zipped again). */
function manifestEntryOf(listed: ListedEntry[]): ListedEntry | undefined {
  return listed
    .filter((e) => (e.name === MANIFEST || e.name.endsWith(`/${MANIFEST}`)) && depthOf(e.name) <= 1)
    .sort((a, b) => depthOf(a.name) - depthOf(b.name))[0];
}

/**
 * Is this .zip a backup made by this app (rather than Terraform to import)?
 * Only its manifest is inflated: one of ours says `"format": "cloud-blueprint-backup"`
 * — whatever its version, so a newer backup still opens the restore dialog to say so.
 */
export function isBackupZip(bytes: Uint8Array): boolean {
  const listed = listEntries(bytes);
  const entry = listed && manifestEntryOf(listed);
  if (!entry || entry.size > MAX_MANIFEST_BYTES) return false;
  try {
    const json: unknown = JSON.parse(strFromU8(unzipSync(bytes, { filter: (file) => file.name === entry.name })[entry.name]));
    return isRecord(json) && json.format === BACKUP_FORMAT;
  } catch {
    return false;
  }
}

/** Reads and validates a backup .zip. Nothing is stored. */
export function parseBackup(bytes: Uint8Array): ParseResult {
  const m = text();
  // pass 1: list the entries without inflating any
  const listed = listEntries(bytes);
  if (!listed) return { ok: false, error: m.notAZip };

  const manifestEntry = manifestEntryOf(listed);
  if (!manifestEntry) {
    return listed.some((e) => isTerraformPath(e.name))
      ? { ok: false, hint: 'terraform', error: m.terraformExport }
      : { ok: false, error: m.noManifest };
  }
  if (manifestEntry.size > MAX_MANIFEST_BYTES) return { ok: false, error: m.manifestTooLarge };
  const prefix = manifestEntry.name.slice(0, manifestEntry.name.length - MANIFEST.length);

  let json: unknown;
  try {
    const out = unzipSync(bytes, { filter: (file) => file.name === manifestEntry.name });
    json = JSON.parse(strFromU8(out[manifestEntry.name]));
  } catch {
    return { ok: false, error: m.manifestNotJson };
  }
  const check = validateManifest(json);
  if (!check.ok) return check;

  // pass 2: inflate only the files the manifest lists, within the caps
  const wanted = new Set(check.manifest.projects.flatMap((p) => p.files.map((f) => prefix + f.path)));
  const oversized = new Set<string>();
  let total = 0;
  let contents: Record<string, Uint8Array>;
  try {
    contents = unzipSync(bytes, {
      filter: (file) => {
        if (!wanted.has(file.name)) return false;
        if (file.originalSize > MAX_FILE_BYTES || total + file.originalSize > MAX_TOTAL_BYTES) {
          oversized.add(file.name);
          return false;
        }
        total += file.originalSize;
        return true;
      },
    });
  } catch {
    return { ok: false, error: m.filesUnreadable };
  }

  const invalid = [...check.invalid];
  const projects: BackupProject[] = [];
  for (const entry of check.manifest.projects) {
    const files: Record<string, string> = {};
    let problem: string | null = null;
    for (const file of entry.files) {
      const data = contents[prefix + file.path];
      if (data) files[file.name] = strFromU8(data);
      else problem ??= oversized.has(prefix + file.path) ? m.fileTooLarge(file.name) : m.fileMissing(file.name);
    }
    if (problem) {
      invalid.push({ name: entry.name, reason: problem });
      continue;
    }
    projects.push({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      templateSlug: entry.templateSlug,
      rootPath: entry.rootPath,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      files,
      hash: filesHash(files),
    });
  }
  return {
    ok: true,
    backup: { version: check.manifest.version, exportedAt: check.manifest.exportedAt, projects, invalid },
  };
}

/* --------------------------------------------------------------- planning */

export type RestoreStatus =
  /** nothing like it here */
  | 'new'
  /** a project here already has exactly these files (by id or by content) */
  | 'duplicate'
  /** a project here has the same id but different files */
  | 'conflict';

export interface RestoreItem {
  project: BackupProject;
  status: RestoreStatus;
  /** the project here it matches */
  existing?: { id: string; name: string; updatedAt: string };
  /** a conflict whose copy here was changed after the backup's */
  existingIsNewer?: boolean;
}

export interface RestorePlan {
  items: RestoreItem[];
  counts: Record<RestoreStatus, number>;
}

/** What restoring `backup` into `existing` would do, project by project. */
export function planRestore(backup: ParsedBackup, existing: Project[]): RestorePlan {
  const byId = new Map(existing.map((p) => [p.id, p] as const));
  const byHash = new Map<string, Project>();
  for (const p of existing) {
    const hash = filesHash(p.files);
    if (!byHash.has(hash)) byHash.set(hash, p);
  }
  const counts: Record<RestoreStatus, number> = { new: 0, duplicate: 0, conflict: 0 };
  const items = backup.projects.map((project): RestoreItem => {
    const sameId = byId.get(project.id);
    // the same-id project wins when several here share the content
    const sameContent = sameId && filesHash(sameId.files) === project.hash ? sameId : byHash.get(project.hash);
    let item: RestoreItem;
    if (sameContent) {
      item = { project, status: 'duplicate', existing: pick(sameContent) };
    } else if (sameId) {
      item = {
        project,
        status: 'conflict',
        existing: pick(sameId),
        existingIsNewer: Date.parse(sameId.updatedAt) > Date.parse(project.updatedAt),
      };
    } else {
      item = { project, status: 'new' };
    }
    counts[item.status] += 1;
    return item;
  });
  return { items, counts };
}

function pick(p: Project) {
  return { id: p.id, name: p.name, updatedAt: p.updatedAt };
}

export type RestoreMode = 'copy' | 'replace';

export type RestoreAction =
  /** added under its own id */
  | 'add'
  /** a conflict, added next to the project here as a copy */
  | 'copy'
  /** a conflict, written over the project here */
  | 'replace'
  | 'skip';

export interface ResolvedRestore {
  entries: Array<{ item: RestoreItem; action: RestoreAction; name: string }>;
  add: Project[];
  replace: Project[];
  /** extra storage the restore takes (UTF-16 code units, like localStorage counts) */
  bytes: number;
}

/** `base`, `base-2`… (`base 2` with spaces) — never a name in `taken`, which it joins. */
function uniqueName(base: string, taken: Set<string>): string {
  const clean = base.trim() || 'restored-project';
  const sep = /\s/.test(clean) ? ' ' : '-';
  let candidate = clean;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${clean}${sep}${i}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Turns a plan and the user's choices into the projects to store. Duplicates
 * are always skipped; `selected` holds the backup ids to restore.
 */
export function resolveRestore(
  plan: RestorePlan,
  options: { mode: RestoreMode; selected: ReadonlySet<string>; existing: Project[] },
): ResolvedRestore {
  const { mode, selected, existing } = options;
  const byId = new Map(existing.map((p) => [p.id, p] as const));
  const replacing = new Set(
    mode === 'replace'
      ? plan.items.filter((i) => i.status === 'conflict' && selected.has(i.project.id)).map((i) => i.project.id)
      : [],
  );
  // names of the projects being replaced are freed (they take the backup's name)
  const taken = new Set(existing.filter((p) => !replacing.has(p.id)).map((p) => p.name.toLowerCase()));
  for (const id of replacing) {
    const item = plan.items.find((i) => i.project.id === id)!;
    taken.add(item.project.name.toLowerCase());
  }

  const add: Project[] = [];
  const replace: Project[] = [];
  let bytes = 0;
  const entries = plan.items.map((item) => {
    const { project } = item;
    const base = {
      description: project.description,
      files: project.files,
      providers: [],
      templateSlug: project.templateSlug,
      rootPath: project.rootPath,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    } satisfies Partial<Project>;
    if (item.status === 'duplicate' || !selected.has(project.id)) {
      return { item, action: 'skip' as const, name: item.existing?.name ?? project.name };
    }
    if (replacing.has(project.id)) {
      const next: Project = { ...byId.get(project.id)!, ...base, name: project.name };
      replace.push(next);
      bytes += projectSize(next) - projectSize(byId.get(project.id)!);
      return { item, action: 'replace' as const, name: project.name };
    }
    const name = uniqueName(project.name, taken);
    const next: Project = { ...base, id: item.status === 'new' ? project.id : uid('prj'), name, rev: 1 };
    add.push(next);
    bytes += projectSize(next);
    return { item, action: item.status === 'new' ? ('add' as const) : ('copy' as const), name };
  });
  return { entries, add, replace, bytes: Math.max(0, bytes) };
}

/** Stores a resolved restore in one write. */
export function applyRestore(resolved: ResolvedRestore): PutProjectsResult {
  return putProjects({ add: resolved.add, replace: resolved.replace });
}
