/**
 * Local-first persistence: projects live in localStorage. No account, no
 * server — the free tier is the whole product. (A future sync backend slots
 * in behind this same interface.)
 *
 * Data-safety rules:
 * - a write that the browser refuses (quota) is REPORTED, never swallowed;
 * - unreadable or invalid stored data is backed up before anything overwrites it;
 * - every project carries a `rev` so a tab can't overwrite a newer save made
 *   in another tab (`updateProject(..., { expectedRev })`);
 * - storage the browser blocks outright falls back to memory (`safeStorage`)
 *   and says so, instead of crashing.
 */
import { safeRootPath } from './projectPath';
import { messagesFor } from '@/i18n/messages';
import type { Provider } from '@/ir/types';
import { getTemplate } from '@/templates';
import { libMessages } from './messages';
import { uid } from './utils';

export interface Project {
  id: string;
  name: string;
  description?: string;
  files: Record<string, string>;
  providers: Provider[];
  templateSlug?: string;
  /** the seeded demo — "Open live demo" only ever opens this one */
  demo?: boolean;
  /** where a copy came from, for dedupe: `share:<hash>`, `tutorial:<slug>:<step>` */
  origin?: string;
  /** the folder its root module was imported from (`envs/prod`), for the Terraform zip */
  rootPath?: string;
  /** bumped on every write (always set on stored projects) */
  rev?: number;
  createdAt: string;
  updatedAt: string;
}

export const PROJECTS_KEY = 'cb-projects-v1';
const SCHEMA_KEY = 'cb-projects-schema';
const SEED_KEY = 'cb-seeded-v1';
export const BACKUP_PREFIX = 'cb-projects-backup-';
/** Bump when the stored shape changes, and add the upgrade to MIGRATIONS. */
export const SCHEMA_VERSION = 2;

/* ------------------------------------------------------------ notices */

export type StorageNotice =
  /** the browser blocks storage: everything lives in memory for this visit */
  | { type: 'blocked' }
  /** a write was refused — storage is full */
  | { type: 'quota' }
  /** a write succeeded again after a quota failure */
  | { type: 'recovered' }
  /** close to the quota: warn before writes start failing */
  | { type: 'nearly-full'; percent: number }
  /** unreadable/invalid stored projects were copied to `key` before any overwrite */
  | { type: 'backup'; key: string };

const listeners = new Set<(notice: StorageNotice) => void>();
// notices raised before the app shell subscribed (e.g. while the first page renders)
let queued: StorageNotice[] = [];

function notify(notice: StorageNotice) {
  if (listeners.size === 0) {
    queued.push(notice);
    return;
  }
  for (const fn of listeners) fn(notice);
}

/** Subscribe to storage problems (the app shell turns them into toasts/banners). */
export function onStorageNotice(fn: (notice: StorageNotice) => void): () => void {
  listeners.add(fn);
  const backlog = queued;
  queued = [];
  for (const notice of backlog) fn(notice);
  return () => {
    listeners.delete(fn);
  };
}

/* -------------------------------------------------------- safeStorage */

function isQuotaError(err: unknown): boolean {
  if (typeof DOMException === 'undefined' || !(err instanceof DOMException)) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}

const memory = new Map<string, string>();
let backend: Storage | null | undefined;

/** The real localStorage, or null when the browser blocks it (probed once). */
function local(): Storage | null {
  if (backend !== undefined) return backend;
  try {
    const ls = globalThis.localStorage;
    if (!ls) throw new Error('localStorage unavailable');
    const probe = '__cb_probe__';
    try {
      ls.setItem(probe, probe);
      ls.removeItem(probe);
    } catch (err) {
      // a FULL store still works for reads — that's "full", not "blocked"
      if (!isQuotaError(err)) throw err;
      ls.getItem(probe);
    }
    backend = ls;
  } catch {
    backend = null;
    notify({ type: 'blocked' });
  }
  return backend;
}

/**
 * localStorage that never throws. When the browser blocks site data it keeps
 * working in memory for this visit (`persistent` is false and a 'blocked'
 * notice is raised once). `setItem` returns false when a write is refused.
 */
export const safeStorage = {
  get persistent(): boolean {
    return local() !== null;
  },
  getItem(key: string): string | null {
    const ls = local();
    if (!ls) return memory.get(key) ?? null;
    try {
      return ls.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): boolean {
    const ls = local();
    if (!ls) {
      memory.set(key, value);
      return true;
    }
    try {
      ls.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  removeItem(key: string) {
    const ls = local();
    if (!ls) {
      memory.delete(key);
      return;
    }
    try {
      ls.removeItem(key);
    } catch {
      /* nothing to do */
    }
  },
  keys(): string[] {
    const ls = local();
    if (!ls) return [...memory.keys()];
    try {
      const out: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i);
        if (key !== null) out.push(key);
      }
      return out;
    } catch {
      return [];
    }
  },
};

/* ------------------------------------------------ read / repair / write */

const PROVIDERS: readonly Provider[] = ['aws', 'azure', 'gcp', 'other'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * MIGRATIONS[n] upgrades raw stored entries from schema n to n + 1. They run
 * before validation and must be idempotent (the schema marker is a separate
 * key, so a migration can run twice).
 */
const MIGRATIONS: Record<number, (entries: unknown[]) => unknown[]> = {
  // v1 → v2: `rev` counters (filled in by normalize) and an explicit demo tag
  // for the project the first visit seeded
  1: (entries) =>
    entries.map((e) =>
      isRecord(e) &&
      e.demo === undefined &&
      e.templateSlug === 'aws-web-app' &&
      e.name === 'production-web' &&
      typeof e.description === 'string' &&
      e.description.startsWith('Demo project —')
        ? { ...e, demo: true }
        : e,
    ),
};

interface Normalized {
  project: Project | null;
  /** part of the stored entry was dropped (not just filled in) */
  lossy: boolean;
}

/**
 * The seeded demo's description as it was first written (with a dash), in
 * each language: an untouched one reads as today's text, so the dashboard
 * still recognizes it as ours and shows it in the UI language.
 */
const LEGACY_DEMO_DESCRIPTION = new Map<string, string>([
  ['Demo project — a classic VPC + EC2 + RDS web stack. Safe to edit or delete.', libMessages.en.demoDescription],
  [
    'Projeto de demonstração — uma stack web clássica com VPC + EC2 + RDS. Pode editar ou excluir à vontade.',
    libMessages['pt-BR'].demoDescription,
  ],
]);

function normalizeProject(value: unknown): Normalized {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') {
    return { project: null, lossy: true };
  }
  let lossy = false;
  const files: Record<string, string> = {};
  if (isRecord(value.files)) {
    for (const [name, text] of Object.entries(value.files)) {
      if (typeof text === 'string') files[name] = text;
      else lossy = true;
    }
  } else if (value.files !== undefined) {
    lossy = true;
  }
  const providers =
    Array.isArray(value.providers) && value.providers.every((p) => PROVIDERS.includes(p as Provider))
      ? (value.providers as Provider[])
      : detectProviders(files);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const createdAt = str(value.createdAt) ?? str(value.updatedAt) ?? new Date(0).toISOString();
  const description = str(value.description);
  const project: Project = {
    ...value, // keep fields a newer version may have added
    id: value.id,
    name: str(value.name)?.trim() || messagesFor(libMessages).untitledProject,
    description: (value.demo === true && description !== undefined && LEGACY_DEMO_DESCRIPTION.get(description)) || description,
    files,
    providers,
    templateSlug: str(value.templateSlug),
    demo: value.demo === true ? true : undefined,
    origin: str(value.origin),
    rootPath: safeRootPath(value.rootPath),
    rev: typeof value.rev === 'number' && Number.isInteger(value.rev) && value.rev >= 0 ? value.rev : 0,
    createdAt,
    updatedAt: str(value.updatedAt) ?? createdAt,
  };
  return { project, lossy };
}

// parsed projects for the last raw string seen — unchanged storage keeps the
// same objects, so memoized cards/thumbnails don't re-render or re-parse
let cache: { raw: string; projects: Project[] } | null = null;
// the stored data is unreadable and could not be backed up: never overwrite it
let writesLocked = false;
let schemaWritten = false;
// the last write was refused; the next successful one raises 'recovered'
let quotaFailing = false;

function backupRaw(raw: string) {
  const existing = safeStorage.keys().filter((k) => k.startsWith(BACKUP_PREFIX));
  if (existing.some((k) => safeStorage.getItem(k) === raw)) return;
  const key = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (safeStorage.setItem(key, raw)) {
    notify({ type: 'backup', key });
  } else {
    writesLocked = true;
    notify({ type: 'quota' });
  }
}

function readAll(): Project[] {
  const raw = safeStorage.getItem(PROJECTS_KEY);
  if (!raw) return [];
  if (cache?.raw === raw) return cache.projects.slice();

  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    entries = undefined;
  }
  if (!Array.isArray(entries)) {
    backupRaw(raw);
    cache = { raw, projects: [] };
    return [];
  }
  const version = Number(safeStorage.getItem(SCHEMA_KEY)) || 1;
  for (let v = version; v < SCHEMA_VERSION; v++) entries = MIGRATIONS[v]?.(entries as unknown[]) ?? entries;

  const seen = new Set<string>();
  const projects: Project[] = [];
  let lossy = false;
  for (const entry of entries as unknown[]) {
    const { project, lossy: dropped } = normalizeProject(entry);
    lossy ||= dropped;
    if (!project) continue;
    if (seen.has(project.id)) {
      lossy = true;
      continue;
    }
    seen.add(project.id);
    projects.push(project);
  }
  if (lossy) backupRaw(raw);
  cache = { raw, projects };
  return projects.slice();
}

/** Write the full list; false when the browser refused it (a 'quota' notice is raised). */
function writeAll(projects: Project[]): boolean {
  const raw = JSON.stringify(projects);
  if (writesLocked || !safeStorage.setItem(PROJECTS_KEY, raw)) {
    quotaFailing = true;
    notify({ type: 'quota' });
    return false;
  }
  if (!schemaWritten) schemaWritten = safeStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
  cache = { raw, projects: projects.slice() };
  if (quotaFailing) {
    quotaFailing = false;
    notify({ type: 'recovered' });
  }
  checkHeadroom(raw.length);
  return true;
}

/* ------------------------------------------------------------ headroom */

/** Browsers give an origin ~5 MiB of localStorage (UTF-16 code units). */
const LOCAL_BUDGET = 5 * 1024 * 1024;
const WARN_AT = 0.8;
let warned = false;
let otherKeysSize: number | null = null;
let lastEstimate = 0;

function checkHeadroom(ownSize: number) {
  if (otherKeysSize === null) {
    otherKeysSize = 0;
    for (const k of safeStorage.keys()) {
      if (k !== PROJECTS_KEY) otherKeysSize += k.length + (safeStorage.getItem(k)?.length ?? 0);
    }
  }
  const ratio = (ownSize + PROJECTS_KEY.length + otherKeysSize) / LOCAL_BUDGET;
  if (ratio < WARN_AT - 0.1) warned = false;
  if (ratio >= WARN_AT) warn(ratio);

  // the origin-wide quota can be far smaller than usual (e.g. low disk space)
  const now = Date.now();
  if (now - lastEstimate < 60_000 || typeof navigator === 'undefined') return;
  lastEstimate = now;
  void navigator.storage
    ?.estimate?.()
    .then(({ usage, quota }) => {
      if (usage && quota && usage / quota >= 0.9) warn(usage / quota);
    })
    .catch(() => undefined);
}

function warn(ratio: number) {
  if (warned) return;
  warned = true;
  notify({ type: 'nearly-full', percent: Math.min(99, Math.round(ratio * 100)) });
}

/* ------------------------------------------------------------- queries */

export function detectProviders(files: Record<string, string>): Provider[] {
  const text = Object.values(files).join('\n');
  const out: Provider[] = [];
  if (/\b(?:resource|data)\s+"aws_/.test(text) || /provider\s+"aws"/.test(text)) out.push('aws');
  if (/\b(?:resource|data)\s+"azurerm_/.test(text) || /provider\s+"azurerm"/.test(text)) {
    out.push('azure');
  }
  if (/\b(?:resource|data)\s+"google_/.test(text) || /provider\s+"google"/.test(text)) {
    out.push('gcp');
  }
  return out;
}

export function listProjects(): Project[] {
  return readAll().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getProject(id: string): Project | undefined {
  return readAll().find((p) => p.id === id);
}

/** A copy made earlier from the same source (share link, tutorial step…). */
export function findProjectByOrigin(
  origin: string,
  files?: Record<string, string>,
): Project | undefined {
  return readAll().find((p) => p.origin === origin && (!files || sameFiles(p.files, files)));
}

export function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] === a[k]);
}

/** `base`, or `base-2`, `base-3`… (`base 2` for names with spaces) — never a name already in use. */
export function uniqueProjectName(base: string): string {
  const taken = new Set(readAll().map((p) => p.name.toLowerCase()));
  const clean = base.trim() || 'my-app';
  if (!taken.has(clean.toLowerCase())) return clean;
  const sep = /\s/.test(clean) ? ' ' : '-';
  for (let i = 2; ; i++) {
    const candidate = `${clean}${sep}${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Default name for a blank project: `my-aws-app`, then `my-aws-app-2`… */
export function blankProjectName(provider: Provider): string {
  return uniqueProjectName(`my-${provider}-app`);
}

/* ----------------------------------------------------------- mutations */

export class StorageFullError extends Error {
  constructor() {
    super(messagesFor(libMessages).storageFull);
    this.name = 'StorageFullError';
  }
}

export type SaveResult =
  | { ok: true; project: Project }
  /** the project is gone (deleted in another tab) */
  | { ok: false; reason: 'missing' }
  /** another tab saved a newer revision — `current` is what's stored now */
  | { ok: false; reason: 'conflict'; current: Project }
  /** the browser refused the write (storage full) */
  | { ok: false; reason: 'quota' };

/** Creates and stores a project. Throws StorageFullError when it could not be stored. */
export function createProject(input: {
  name: string;
  files: Record<string, string>;
  description?: string;
  templateSlug?: string;
  demo?: boolean;
  origin?: string;
  rootPath?: string;
}): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: uid('prj'),
    name: input.name,
    description: input.description,
    files: input.files,
    providers: detectProviders(input.files),
    templateSlug: input.templateSlug,
    demo: input.demo || undefined,
    origin: input.origin,
    rootPath: safeRootPath(input.rootPath),
    rev: 1,
    createdAt: now,
    updatedAt: now,
  };
  if (!writeAll([project, ...readAll()])) throw new StorageFullError();
  return project;
}

/**
 * Saves a patch. With `expectedRev`, the write is refused ('conflict') when
 * another tab stored a newer revision since this one loaded or last saved it.
 */
export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'files'>>,
  options: { expectedRev?: number } = {},
): SaveResult {
  const all = readAll();
  const i = all.findIndex((p) => p.id === id);
  if (i === -1) return { ok: false, reason: 'missing' };
  const current = all[i];
  if (options.expectedRev !== undefined && (current.rev ?? 0) !== options.expectedRev) {
    return { ok: false, reason: 'conflict', current };
  }
  const next: Project = {
    ...current,
    ...patch,
    providers: patch.files ? detectProviders(patch.files) : current.providers,
    rev: (current.rev ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  all[i] = next;
  return writeAll(all) ? { ok: true, project: next } : { ok: false, reason: 'quota' };
}

/** Puts back a project that was deleted (e.g. in another tab) under the same id. */
export function restoreProject(project: Project): SaveResult {
  const all = readAll();
  const current = all.find((p) => p.id === project.id);
  if (current) return { ok: false, reason: 'conflict', current };
  const restored: Project = {
    ...project,
    providers: detectProviders(project.files),
    rev: (project.rev ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  return writeAll([restored, ...all]) ? { ok: true, project: restored } : { ok: false, reason: 'quota' };
}

/** False when the deletion could not be stored. */
export function deleteProject(id: string): boolean {
  return writeAll(readAll().filter((p) => p.id !== id));
}

/** Throws StorageFullError when the copy could not be stored. */
export function duplicateProject(id: string): Project | undefined {
  const source = getProject(id);
  if (!source) return undefined;
  return createProject({
    name: uniqueProjectName(messagesFor(libMessages).copyOf(source.name)),
    files: { ...source.files },
    description: source.description,
    templateSlug: source.templateSlug,
    rootPath: source.rootPath,
  });
}

/** Calls `fn` when another tab changes the stored projects. */
export function subscribeProjects(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (e.key === PROJECTS_KEY || e.key === null) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/* ---------------------------------------------------------------- demo */

const DEMO_NAME = 'production-web';

/**
 * The seeded demo project, recreated if it was deleted. Its description is
 * written in the UI language of the moment (then it's the user's data).
 * Throws StorageFullError.
 */
export function openDemoProject(): Project {
  const existing = readAll().find((p) => p.demo);
  if (existing) return existing;
  const template = getTemplate('aws-web-app')!;
  return createProject({
    name: uniqueProjectName(DEMO_NAME),
    description: messagesFor(libMessages).demoDescription,
    files: template.build(DEMO_NAME),
    templateSlug: template.slug,
    demo: true,
  });
}

/** First visit: seed a demo project so the dashboard tells a story. */
export function ensureSeed() {
  if (safeStorage.getItem(SEED_KEY)) return;
  if (!safeStorage.setItem(SEED_KEY, '1')) return;
  if (readAll().length > 0) return;
  try {
    openDemoProject();
  } catch {
    /* storage full — the 'quota' notice already told the user */
  }
}

/* ------------------------------------------------- backup / restore / meter */

/** ~5 Mi UTF-16 code units: what browsers give an origin's localStorage. */
export const LOCAL_STORAGE_BUDGET = LOCAL_BUDGET;

/** Everything this origin keeps in localStorage (keys + values, in UTF-16 code units). */
export function localStorageUsage(): { used: number; budget: number } {
  let used = 0;
  for (const key of safeStorage.keys()) used += key.length + (safeStorage.getItem(key)?.length ?? 0);
  return { used, budget: LOCAL_BUDGET };
}

/** The size one project takes in the stored list (UTF-16 code units). */
export function projectSize(project: Project): number {
  return JSON.stringify(project).length + 1;
}

export type PutProjectsResult =
  | { ok: true; added: Project[]; replaced: Project[] }
  /** the browser refused the write — nothing was changed */
  | { ok: false; reason: 'quota' }
  /** an id to add is already taken, or one to replace is gone (another tab changed the list) */
  | { ok: false; reason: 'conflict' };

/**
 * Adds and replaces projects in ONE write (a restore): all of it lands, or
 * none of it. Added projects keep their id (when it is free) and timestamps;
 * replaced ones keep this browser's local-only fields (demo, origin) and get
 * a new `rev`, so a tab that has them open notices. A refused write changes
 * nothing, so it's reported to the caller only — no storage-full notice.
 */
export function putProjects(input: { add: Project[]; replace: Project[] }): PutProjectsResult {
  const all = readAll();
  const byId = new Map(all.map((p, i) => [p.id, i] as const));
  const replaced: Project[] = [];
  for (const incoming of input.replace) {
    const i = byId.get(incoming.id);
    if (i === undefined) return { ok: false, reason: 'conflict' };
    const current = all[i];
    const next: Project = {
      ...current,
      name: incoming.name,
      description: incoming.description,
      files: incoming.files,
      providers: detectProviders(incoming.files),
      templateSlug: incoming.templateSlug,
      rootPath: incoming.rootPath,
      createdAt: incoming.createdAt,
      updatedAt: incoming.updatedAt,
      rev: (current.rev ?? 0) + 1,
    };
    all[i] = next;
    replaced.push(next);
  }
  const added: Project[] = [];
  for (const incoming of input.add) {
    if (byId.has(incoming.id) || added.some((p) => p.id === incoming.id)) return { ok: false, reason: 'conflict' };
    added.push({ ...incoming, providers: detectProviders(incoming.files), rev: 1 });
  }
  const next = [...added, ...all];
  const raw = JSON.stringify(next);
  if (writesLocked || !safeStorage.setItem(PROJECTS_KEY, raw)) return { ok: false, reason: 'quota' };
  if (!schemaWritten) schemaWritten = safeStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
  cache = { raw, projects: next.slice() };
  if (quotaFailing) {
    quotaFailing = false;
    notify({ type: 'recovered' });
  }
  checkHeadroom(raw.length);
  return { ok: true, added, replaced };
}

/* ------------------------------------------------------- content hashes */

/** cyrb53: a fast, well-mixed 53-bit string hash (not cryptographic). */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Content hash of one text (two seeds: ~106 bits, collisions are not a concern). */
export function hashText(text: string): string {
  return `${cyrb53(text, 0).toString(36).padStart(11, '0')}${cyrb53(text, 0x9e3779b9).toString(36).padStart(11, '0')}`;
}

/** Content hash of a project's files: names and texts, independent of key order. */
export function filesHash(files: Record<string, string>): string {
  return hashText(
    Object.keys(files)
      .sort()
      .map((name) => `${name.length}:${name}\u0000${files[name].length}:${files[name]}`)
      .join('\u0001'),
  );
}
