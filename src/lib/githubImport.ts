/**
 * Open Terraform straight from GitHub — a repository, a folder, a single
 * file or a gist — using only public, CORS-enabled endpoints:
 *
 *   api.github.com/repos/{o}/{r}                      default branch (and: does it exist?)
 *   api.github.com/repos/{o}/{r}/git/trees/{ref}      the file listing (recursive)
 *   raw.githubusercontent.com/{o}/{r}/{ref}/{path}    file contents (outside the API quota)
 *   api.github.com/gists/{id}                         gists (contents inline)
 *
 * Unauthenticated by default (GitHub allows 60 API requests an hour per IP).
 * An optional token — held in memory by the caller, never stored, never put
 * in a URL — opens private repositories and raises the limit to 5,000; with
 * one, contents come from the git blobs API (same origin as the token).
 *
 * Only a ROOT module is imported, with the same rules and caps as a dropped
 * folder (see importTf): `.tf` files only — never state, the lock file or
 * `.terraform/` — at most 2 MB a file and 20 MB in all, checked against the
 * listing's sizes BEFORE anything is downloaded.
 */
import { formatDate, formatNumber } from '@/i18n/format';
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { githubMessages } from './githubImport.messages';
import { importNote, isTerraformPath, readTerraformFiles, type ImportedProject } from './importTf';

/** the messages in the UI language of the moment (errors are made when they happen) */
const text = () => messagesFor(githubMessages);

/* ---------------------------------------------------------------- parsing */

export type GithubTarget =
  | {
      kind: 'repo';
      owner: string;
      repo: string;
      /** the ref as written (`@ref`, or the first guess from a /tree/ URL); null = default branch */
      ref: string | null;
      /** folder inside the repository ('' = its root) */
      path: string;
      /** a link to one file (`/blob/…/main.tf`): its name — its folder is the pick */
      file: string | null;
      /**
       * `/tree/…` and `/blob/…` URLs: the segments after it. Branch names can
       * contain slashes (`feature/x`), so where the ref ends and the path
       * begins is only known once GitHub has been asked.
       */
      refPath: string[] | null;
    }
  | { kind: 'gist'; id: string; revision: string | null };

export type RepoTarget = Extract<GithubTarget, { kind: 'repo' }>;
export type ParseResult = { ok: true; target: GithubTarget } | { ok: false; error: string };

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const GIST_ID = /^(?:[0-9a-f]{20,40}|\d{1,12})$/i;
const REVISION = /^[0-9a-f]{40}$/i;
/** github.com/<these> are pages, not owners */
const RESERVED_OWNERS = new Set([
  'about', 'apps', 'codespaces', 'collections', 'enterprise', 'explore', 'features', 'issues', 'login',
  'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'settings',
  'sponsors', 'topics', 'trending',
]);

function validRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    ref.length <= 250 &&
    // git check-ref-format, roughly: no spaces, controls, ~^:?*[\ , "..", "@{", "//"
    !/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('@{') &&
    !ref.includes('//') &&
    !ref.startsWith('/') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.lock')
  );
}

function validSegment(seg: string): boolean {
  return seg !== '' && seg !== '.' && seg !== '..' && seg.length <= 255 && !/[\u0000-\u001f\u007f]/.test(seg);
}

function decodeSegments(pathname: string): string[] | null {
  try {
    return pathname
      .split('/')
      .filter((s) => s !== '')
      .map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
}

function repoTarget(
  owner: string,
  repo: string,
  rest: { ref?: string | null; path?: string[]; file?: string | null; refPath?: string[] | null },
): ParseResult {
  const m = text();
  const name = repo.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || RESERVED_OWNERS.has(owner.toLowerCase())) return { ok: false, error: m.notOwner(owner) };
  if (!REPO.test(name)) return { ok: false, error: m.notRepo(repo) };
  const path = rest.path ?? [];
  const segments = [...path, ...(rest.refPath ?? []), ...(rest.file ? [rest.file] : [])];
  if (!segments.every(validSegment)) return { ok: false, error: m.badFolder };
  const ref = rest.ref ?? null;
  if (ref !== null && !validRef(ref)) return { ok: false, error: m.badRef(ref) };
  return {
    ok: true,
    target: {
      kind: 'repo',
      owner,
      repo: name,
      ref,
      path: path.join('/'),
      file: rest.file ?? null,
      refPath: rest.refPath ?? null,
    },
  };
}

/** `/tree/<ref>/<path>` or `/blob/<ref>/<path>/<file>`, first guess: a one-segment ref. */
function treeOrBlob(owner: string, repo: string, kind: 'tree' | 'blob', after: string[]): ParseResult {
  if (after.length === 0) return repoTarget(owner, repo, {});
  if (kind === 'blob' && after.length < 2) {
    return { ok: false, error: text().fileLinkIncomplete };
  }
  const segs = stripRefsPrefix(after);
  const [ref, ...rest] = segs;
  const file = kind === 'blob' ? (rest.pop() ?? null) : null;
  return repoTarget(owner, repo, { ref, path: rest, file, refPath: after });
}

/** `refs/heads/main/…` → `main/…` (raw.githubusercontent.com links use that spelling) */
function stripRefsPrefix(segs: string[]): string[] {
  return segs.length > 2 && segs[0] === 'refs' && (segs[1] === 'heads' || segs[1] === 'tags') ? segs.slice(2) : segs;
}

function parseUrl(url: URL): ParseResult {
  const m = text();
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: m.notWebLink };
  const host = url.hostname.toLowerCase();
  const segs = decodeSegments(url.pathname);
  if (!segs) return { ok: false, error: m.brokenCharacters };

  if (host === 'github.com' || host === 'www.github.com') {
    const [owner, repo, kind, ...after] = segs;
    if (!owner) return { ok: false, error: m.addRepository };
    if (!repo) return { ok: false, error: m.addRepositoryName(owner) };
    if (kind === 'tree' || kind === 'blob') return treeOrBlob(owner, repo, kind, after);
    if (kind === 'commit' && after[0]) return repoTarget(owner, repo, { ref: after[0] });
    // any other page of the repository (issues, pulls, actions…): the repository itself
    return repoTarget(owner, repo, {});
  }

  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ...after] = segs;
    if (!owner || !repo || after.length < 2) {
      return { ok: false, error: m.rawLinkIncomplete };
    }
    return treeOrBlob(owner, repo, 'blob', after);
  }

  if (host === 'gist.github.com' || host === 'gist.githubusercontent.com') {
    // gist.github.com/<user>/<id>[/<revision>], gist.github.com/<id>, …/<id>/raw/<revision>/<file>
    const at = GIST_ID.test(segs[0] ?? '') && !GIST_ID.test(segs[1] ?? '') ? 0 : 1;
    const id = segs[at];
    if (!id || !GIST_ID.test(id)) return { ok: false, error: m.noGistId };
    const after = segs.slice(at + 1).filter((s) => s !== 'raw');
    const revision = after[0] && REVISION.test(after[0]) ? after[0].toLowerCase() : null;
    return { ok: true, target: { kind: 'gist', id: id.toLowerCase(), revision } };
  }

  if (/(^|\.)(gitlab\.com|bitbucket\.org|codeberg\.org)$/.test(host)) {
    return { ok: false, error: m.onlyGithub };
  }
  return { ok: false, error: m.notGithub };
}

/** `owner/repo[/path][@ref]` — also the shape of `#gh=` deep links. */
function parseShorthand(input: string): ParseResult {
  let body = input;
  let ref: string | null = null;
  const at = input.lastIndexOf('@');
  if (at !== -1) {
    body = input.slice(0, at);
    ref = input.slice(at + 1);
    if (ref === '') return { ok: false, error: text().addRef };
  }
  const segs = body.split('/').filter((s) => s !== '');
  if (segs.length < 2) return { ok: false, error: text().useOwnerRepo };
  const [owner, repo, ...path] = segs;
  const file = path.length > 0 && /\.tf$/i.test(path[path.length - 1]!) ? path.pop()! : null;
  return repoTarget(owner!, repo!, { ref, path, file });
}

/**
 * Everything the import dialog accepts: `owner/repo[/path][@ref]`,
 * github.com links (repository, `/tree/<ref>/<path>`, `/blob/<ref>/<file>.tf`,
 * `/commit/<sha>`), raw.githubusercontent.com file links, `git@github.com:`
 * clone URLs and gist links.
 */
export function parseGithubInput(input: string): ParseResult {
  const m = text();
  let s = input.trim();
  if (!s) return { ok: false, error: m.paste };
  if (s.length > 2048) return { ok: false, error: m.tooLong };
  s = s.replace(/^git\+/i, '');
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i.exec(s);
  if (ssh) s = `https://github.com/${ssh[1]}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return { ok: false, error: m.looksWrong };
    }
    return parseUrl(url);
  }
  if (/^(www\.)?(gist\.)?github\.com\//i.test(s) || /^(raw|gist)\.githubusercontent\.com\//i.test(s)) {
    try {
      return parseUrl(new URL(`https://${s}`));
    } catch {
      return { ok: false, error: m.looksWrong };
    }
  }
  if (/\s/.test(s)) return { ok: false, error: m.oneLink };
  // a host without the scheme (`gitlab.com/…`): owners never contain dots
  if (/^[^/@]+\.[^/@]+\//.test(s)) {
    try {
      return parseUrl(new URL(`https://${s}`));
    } catch {
      return { ok: false, error: m.notGithub };
    }
  }
  return parseShorthand(s);
}

/** `owner/repo/path@ref` — what the `#gh=` deep link and the badge snippet carry. */
export function targetShorthand(target: GithubTarget): string {
  if (target.kind === 'gist') return `https://gist.github.com/${target.id}${target.revision ? `/${target.revision}` : ''}`;
  const path = [target.path, target.file].filter(Boolean).join('/');
  return `${target.owner}/${target.repo}${path ? `/${path}` : ''}${target.ref ? `@${target.ref}` : ''}`;
}

/** Where the ref can end in a /tree/ or /blob/ URL: shortest ref first. */
export function refCandidates(target: RepoTarget): Array<{ ref: string; path: string }> {
  if (!target.refPath) return target.ref ? [{ ref: target.ref, path: target.path }] : [];
  const segs = stripRefsPrefix(target.refPath);
  const dirSegs = target.file ? segs.slice(0, -1) : segs;
  const out: Array<{ ref: string; path: string }> = [];
  for (let i = 1; i <= dirSegs.length && out.length < 5; i++) {
    out.push({ ref: dirSegs.slice(0, i).join('/'), path: dirSegs.slice(i).join('/') });
  }
  return out;
}

/* ------------------------------------------------------------ root modules */

export interface TreeFile {
  /** path from the repository root */
  path: string;
  size: number;
  /** git blob sha (repositories) — gists have none */
  sha?: string;
  /** gists: the inline content, when GitHub sent it whole */
  content?: string;
  /** gists: where the full content lives when it was truncated */
  rawUrl?: string;
}

export interface RootModule {
  /** folder from the repository root ('' = the root) */
  dir: string;
  files: TreeFile[];
  bytes: number;
  /** the folder the link points at */
  linked: boolean;
}

export interface RootModuleScan {
  modules: RootModule[];
  /** .tf files in child-module folders (`modules/…`) under the linked folder — left out */
  childModuleFiles: number;
}

const CHILD_MODULE_DIR = /(^|\/)modules?(\/|$)/i;

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function depth(dir: string): number {
  return dir === '' ? 0 : dir.split('/').length;
}

/**
 * The Terraform root modules at or under `basePath`: folders holding `.tf`
 * files, minus `.terraform/` & co (isTerraformPath) and child modules — a
 * `modules/` (or `module/`) folder below the link. A link that points INTO
 * such a folder picks it explicitly, so that one is kept. The linked folder
 * comes first, then shallow before deep, then alphabetical.
 */
export function findRootModules(files: TreeFile[], basePath = ''): RootModuleScan {
  const base = basePath.replace(/^\/+|\/+$/g, '');
  const byDir = new Map<string, TreeFile[]>();
  let childModuleFiles = 0;
  for (const file of files) {
    if (base && file.path !== base && !file.path.startsWith(`${base}/`)) continue;
    if (!isTerraformPath(file.path)) continue;
    const dir = dirOf(file.path);
    const below = base ? dir.slice(base.length + 1) : dir;
    if (dir !== base && CHILD_MODULE_DIR.test(below)) {
      childModuleFiles += 1;
      continue;
    }
    const list = byDir.get(dir);
    if (list) list.push(file);
    else byDir.set(dir, [file]);
  }
  const modules: RootModule[] = [...byDir.entries()].map(([dir, list]) => ({
    dir,
    files: list.sort((a, b) => a.path.localeCompare(b.path)),
    bytes: list.reduce((n, f) => n + f.size, 0),
    linked: dir === base,
  }));
  modules.sort(
    (a, b) => Number(b.linked) - Number(a.linked) || depth(a.dir) - depth(b.dir) || a.dir.localeCompare(b.dir),
  );
  return { modules, childModuleFiles };
}

/* --------------------------------------------------------------- network */

export interface RateLimit {
  limit: number;
  remaining: number;
  /** epoch ms */
  resetAt: number;
}

export type GithubErrorCode =
  | 'not-found'
  | 'ref-not-found'
  | 'path-not-found'
  | 'rate-limit'
  | 'bad-token'
  | 'forbidden'
  | 'offline'
  | 'network'
  | 'server'
  | 'empty'
  | 'no-terraform'
  | 'aborted';

export class GithubImportError extends Error {
  readonly code: GithubErrorCode;
  readonly rate: RateLimit | null;
  constructor(code: GithubErrorCode, message: string, rate: RateLimit | null = null) {
    super(message);
    this.name = 'GithubImportError';
    this.code = code;
    this.rate = rate;
  }
}

export interface GithubOptions {
  /** personal access token — memory only; sent to api.github.com and nowhere else */
  token?: string;
  signal?: AbortSignal;
  /** injected in tests */
  fetch?: typeof fetch;
  /** every API response's X-RateLimit-* headers */
  onRateLimit?(rate: RateLimit): void;
  onProgress?(progress: ImportProgress): void;
}

export type ImportProgress =
  | { phase: 'repo' }
  | { phase: 'tree' }
  | { phase: 'files'; done: number; total: number };

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** "02:32 PM" / "14:32" — when the rate limit resets, in the UI language. */
export function resetTime(rate: RateLimit, locale: Locale = currentLocale()): string {
  return formatDate(rate.resetAt, { hour: '2-digit', minute: '2-digit' }, locale);
}

function readRate(res: Response): RateLimit | null {
  const limit = Number(res.headers.get('x-ratelimit-limit'));
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!res.headers.has('x-ratelimit-remaining') || !Number.isFinite(remaining)) return null;
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 60,
    remaining,
    resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 3600_000,
  };
}

function abortError(): GithubImportError {
  return new GithubImportError('aborted', text().cancelled);
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (err instanceof DOMException && err.name === 'AbortError');
}

async function request(url: string, init: RequestInit, opts: GithubOptions): Promise<Response> {
  if (opts.signal?.aborted) throw abortError();
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    return await doFetch(url, { ...init, signal: opts.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (err) {
    if (isAbort(err, opts.signal)) throw abortError();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new GithubImportError('offline', text().offline);
    }
    throw new GithubImportError('network', text().unreachable);
  }
}

interface ApiError {
  status: number;
  rate: RateLimit | null;
  message: string;
}

/** Map a failed API response to what the user should read. `what` names the thing asked for. */
function apiFailure(err: ApiError, what: string, token: boolean): GithubImportError {
  const m = text();
  const { status, rate } = err;
  const limited =
    (status === 403 || status === 429) && (rate?.remaining === 0 || /rate limit/i.test(err.message));
  if (limited) {
    const when = rate ? m.resetsAt(resetTime(rate)) : m.tryLater;
    return new GithubImportError('rate-limit', token ? m.tokenLimit(when) : m.anonymousLimit(rate?.limit ?? 60, when), rate);
  }
  if (status === 401) return new GithubImportError('bad-token', m.badToken, rate);
  if (status === 404) return new GithubImportError('not-found', token ? m.notFoundWithToken(what) : m.notFound(what), rate);
  if (status === 403) {
    return new GithubImportError('forbidden', /sso|saml/i.test(err.message) ? m.sso : m.forbidden(what), rate);
  }
  if (status === 409) return new GithubImportError('empty', m.empty(what), rate);
  if (status >= 500) return new GithubImportError('server', m.serverTrouble(status), rate);
  return new GithubImportError('server', m.httpStatus(status, what), rate);
}

async function api<T>(path: string, what: string, opts: GithubOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await request(`${API}${path}`, { headers }, opts);
  const rate = readRate(res);
  if (rate) opts.onRateLimit?.(rate);
  if (!res.ok) {
    let message = '';
    try {
      message = String(((await res.json()) as { message?: unknown }).message ?? '');
    } catch {
      /* not JSON */
    }
    throw Object.assign(new Error(message), { api: { status: res.status, rate, message } satisfies ApiError, what });
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    if (isAbort(err, opts.signal)) throw abortError();
    throw new GithubImportError('server', text().unreadableAnswer(what), rate);
  }
}

function apiErrorOf(err: unknown): ApiError | null {
  return (err as { api?: ApiError }).api ?? null;
}

/** api() that turns HTTP failures into user-facing errors. */
async function apiOrFail<T>(path: string, what: string, opts: GithubOptions): Promise<T> {
  try {
    return await api<T>(path, what, opts);
  } catch (err) {
    const failure = apiErrorOf(err);
    if (failure) throw apiFailure(failure, what, Boolean(opts.token));
    throw err;
  }
}

/* --------------------------------------------------------------- listing */

interface GitTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

interface GitTree {
  sha: string;
  tree: GitTreeEntry[];
  truncated: boolean;
}

export interface RepoListing {
  kind: 'repo';
  owner: string;
  repo: string;
  /** the ref the files were listed at (as given, or the default branch) */
  ref: string;
  /** folder the link points at ('' = root) */
  basePath: string;
  /** a file link: that file's name */
  file: string | null;
  files: TreeFile[];
  /** GitHub cut the listing short (a huge repository) — not everything is shown */
  truncated: boolean;
}

export interface GistListing {
  kind: 'gist';
  id: string;
  revision: string | null;
  owner: string | null;
  description: string;
  files: TreeFile[];
  truncated: false;
  basePath: '';
  file: null;
}

export type Listing = RepoListing | GistListing;

const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');

async function listTree(owner: string, repo: string, ref: string, basePath: string, opts: GithubOptions) {
  const where = `${owner}/${repo}`;
  const root = await api<GitTree>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    where,
    opts,
  );
  if (!root.truncated || !basePath) return { entries: root.tree, truncated: root.truncated };
  // a huge repository: GitHub stops the recursive listing (~100k entries);
  // walk down to the linked folder and list only that subtree
  let sha = root.sha;
  let prefix = '';
  for (const seg of basePath.split('/')) {
    const want = prefix ? `${prefix}/${seg}` : seg;
    let entry = root.tree.find((e) => e.path === want && e.type === 'tree');
    if (!entry) {
      const level = await apiOrFail<GitTree>(`/repos/${owner}/${repo}/git/trees/${sha}`, where, opts);
      entry = level.tree.find((e) => e.path === seg && e.type === 'tree');
    }
    if (!entry) throw new GithubImportError('path-not-found', text().noFolder(basePath, where, ref));
    sha = entry.sha;
    prefix = want;
  }
  const sub = await apiOrFail<GitTree>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, where, opts);
  return {
    entries: [{ path: basePath, type: 'tree' as const, sha }, ...sub.tree.map((e) => ({ ...e, path: `${basePath}/${e.path}` }))],
    truncated: sub.truncated,
  };
}

async function listRepo(target: RepoTarget, opts: GithubOptions): Promise<RepoListing> {
  const { owner, repo } = target;
  const where = `${owner}/${repo}`;
  const token = Boolean(opts.token);
  let candidates = refCandidates(target);
  if (candidates.length === 0) {
    opts.onProgress?.({ phase: 'repo' });
    const info = await apiOrFail<{ default_branch?: string }>(`/repos/${owner}/${repo}`, where, opts);
    candidates = [{ ref: info.default_branch || 'main', path: target.path }];
  }
  opts.onProgress?.({ phase: 'tree' });
  let lastMiss: ApiError | null = null;
  for (const { ref, path } of candidates) {
    let listed: Awaited<ReturnType<typeof listTree>>;
    try {
      listed = await listTree(owner, repo, ref, path, opts);
    } catch (err) {
      const failure = apiErrorOf(err);
      if (!failure) throw err;
      // 404/422: no such ref here — the ref may go on past the next slash
      if (failure.status === 404 || failure.status === 422) {
        lastMiss = failure;
        continue;
      }
      throw apiFailure(failure, where, token);
    }
    let basePath = path;
    let file = target.file;
    const entries = listed.entries;
    // a /tree/ link to a file, or a shorthand path that names one: its folder is the pick
    const asBlob = basePath ? entries.find((e) => e.path === basePath && e.type === 'blob') : undefined;
    if (asBlob) {
      file = basePath.split('/').pop()!;
      basePath = dirOf(basePath);
    }
    if (basePath && !entries.some((e) => e.path === basePath && e.type === 'tree') && !listed.truncated) {
      throw new GithubImportError('path-not-found', text().noFolder(basePath, where, ref));
    }
    const files: TreeFile[] = entries
      .filter((e) => e.type === 'blob')
      .map((e) => ({ path: e.path, size: e.size ?? 0, sha: e.sha }));
    return { kind: 'repo', owner, repo, ref, basePath, file, files, truncated: listed.truncated };
  }
  // no candidate ref exists: is it the ref, or the whole repository?
  try {
    await api(`/repos/${owner}/${repo}`, where, opts);
  } catch (err) {
    const failure = apiErrorOf(err);
    if (failure) throw apiFailure(failure, where, token);
    throw err;
  }
  if (target.ref === null && !target.refPath) {
    // the default branch itself has no tree
    throw new GithubImportError('empty', text().empty(where), lastMiss?.rate);
  }
  const shown = candidates[0]!.ref;
  throw new GithubImportError('ref-not-found', text().noRef(where, shown));
}

interface GistResponse {
  id: string;
  description: string | null;
  owner?: { login?: string } | null;
  history?: Array<{ version?: string }>;
  files: Record<string, { filename?: string; size?: number; truncated?: boolean; content?: string; raw_url?: string } | null>;
}

async function listGist(target: Extract<GithubTarget, { kind: 'gist' }>, opts: GithubOptions): Promise<GistListing> {
  opts.onProgress?.({ phase: 'tree' });
  const path = `/gists/${target.id}${target.revision ? `/${target.revision}` : ''}`;
  let gist: GistResponse;
  const what = text().thatGist;
  try {
    gist = await api<GistResponse>(path, what, opts);
  } catch (err) {
    const failure = apiErrorOf(err);
    if (failure?.status === 404) throw new GithubImportError('not-found', text().gistNotFound, failure.rate);
    if (failure) throw apiFailure(failure, what, Boolean(opts.token));
    throw err;
  }
  const files: TreeFile[] = Object.values(gist.files ?? {})
    .filter((f): f is NonNullable<typeof f> => f !== null && typeof f.filename === 'string')
    .map((f) => ({
      path: f.filename!,
      size: typeof f.size === 'number' ? f.size : (f.content?.length ?? 0),
      content: f.truncated ? undefined : f.content,
      rawUrl: f.raw_url,
    }));
  return {
    kind: 'gist',
    id: target.id,
    revision: target.revision ?? gist.history?.[0]?.version ?? null,
    owner: gist.owner?.login ?? null,
    description: (gist.description ?? '').trim(),
    files,
    truncated: false,
    basePath: '',
    file: null,
  };
}

/** Step 1: what's there — the file listing the root modules are found in. */
export function listGithub(target: GithubTarget, opts: GithubOptions = {}): Promise<Listing> {
  return target.kind === 'gist' ? listGist(target, opts) : listRepo(target, opts);
}

/* -------------------------------------------------------------- fetching */

/** The caps importTf applies to a dropped folder (checked there again on the downloaded text). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** Files downloaded for one root module (a root module with more is generated, not written). */
export const MAX_FILES = 200;
const PARALLEL = 6;

export interface GithubImport {
  imported: ImportedProject;
  /** `github:owner/repo/path@ref` (`github:gist/<id>@<revision>` for gists) — for dedupe */
  origin: string;
  description: string;
  /** importNote plus what only a GitHub import can hit; null when nothing was left out */
  note: string | null;
}

/** `github:owner/repo/path@ref` */
export function githubOrigin(listing: Listing, dir: string): string {
  if (listing.kind === 'gist') return `github:gist/${listing.id}${listing.revision ? `@${listing.revision}` : ''}`;
  return `github:${listing.owner}/${listing.repo}${dir ? `/${dir}` : ''}@${listing.ref}`;
}

export function githubWebUrl(listing: Listing, dir = listing.basePath): string {
  if (listing.kind === 'gist') return `https://gist.github.com/${listing.id}`;
  const base = `https://github.com/${listing.owner}/${listing.repo}`;
  return dir || listing.ref ? `${base}/tree/${enc(listing.ref)}${dir ? `/${enc(dir)}` : ''}` : base;
}

function projectName(listing: Listing, dir: string): string {
  if (listing.kind === 'gist') {
    const first = listing.description.split('\n')[0]!.trim();
    return (first || `gist-${listing.id.slice(0, 7)}`).slice(0, 60);
  }
  if (!dir) return listing.repo;
  const name = `${listing.repo}/${dir}`;
  return name.length <= 80 ? name : `${listing.repo}/…${dir.slice(-Math.max(12, 78 - listing.repo.length))}`;
}

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function fetchText(listing: Listing, file: TreeFile, opts: GithubOptions): Promise<string> {
  if (file.content !== undefined) return file.content;
  const what = file.path;
  // a token only ever goes to api.github.com: private contents come from the blobs API
  if (listing.kind === 'repo' && opts.token && file.sha) {
    const blob = await apiOrFail<{ content?: string; encoding?: string }>(
      `/repos/${listing.owner}/${listing.repo}/git/blobs/${file.sha}`,
      what,
      opts,
    );
    return blob.encoding === 'base64' ? decodeBase64(blob.content ?? '') : (blob.content ?? '');
  }
  const url =
    listing.kind === 'repo'
      ? `${RAW}/${listing.owner}/${listing.repo}/${enc(listing.ref)}/${enc(file.path)}`
      : file.rawUrl;
  if (!url || !/^https:\/\/(raw|gist)\.githubusercontent\.com\//.test(url)) {
    throw new GithubImportError('server', text().noLocation(what));
  }
  const res = await request(url, {}, opts);
  if (!res.ok) {
    if (res.status === 404) throw new GithubImportError('not-found', text().disappeared(what));
    if (res.status === 429) throw new GithubImportError('rate-limit', text().downloadsLimited);
    throw new GithubImportError('server', text().httpStatus(res.status, what));
  }
  try {
    return await res.text();
  } catch (err) {
    if (isAbort(err, opts.signal)) throw abortError();
    throw new GithubImportError('network', text().interrupted(what));
  }
}

/** Run `fn` over `items`, at most `limit` at a time; the first failure stops the rest. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (next < items.length && failed === null) {
      if (signal?.aborted) throw abortError();
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (err) {
        failed ??= err;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Step 2: download one root module and turn it into an import. The size caps
 * are checked against the listing first (oversized files are never fetched),
 * then the text goes through importTf's own reader — same names, same caps.
 */
export async function fetchRootModule(
  listing: Listing,
  module: RootModule,
  childModuleFiles: number,
  opts: GithubOptions = {},
): Promise<GithubImport> {
  let used = 0;
  let oversized = 0;
  const wanted: TreeFile[] = [];
  for (const file of module.files) {
    if (file.size > MAX_FILE_BYTES || used + file.size > MAX_TOTAL_BYTES) {
      oversized += 1;
      continue;
    }
    used += file.size;
    wanted.push(file);
  }
  const overCount = Math.max(0, wanted.length - MAX_FILES);
  const picked = wanted.slice(0, MAX_FILES);
  if (picked.length === 0) {
    throw new GithubImportError('no-terraform', text().allOversized);
  }

  const texts = new Map<string, string>();
  let done = 0;
  opts.onProgress?.({ phase: 'files', done, total: picked.length });
  await pool(
    picked,
    PARALLEL,
    async (file) => {
      texts.set(file.path, await fetchText(listing, file, opts));
      done += 1;
      opts.onProgress?.({ phase: 'files', done, total: picked.length });
    },
    opts.signal,
  );
  if (opts.signal?.aborted) throw abortError();

  const asFiles = picked.map((f) => new File([texts.get(f.path) ?? ''], f.path.split('/').pop()!, { type: 'text/plain' }));
  const read = await readTerraformFiles(asFiles);
  if (!read || Object.keys(read.files).length === 0) {
    throw new GithubImportError('no-terraform', text().notTerraform);
  }
  const name = projectName(listing, module.dir);
  const imported: ImportedProject = {
    ...read,
    name,
    rootDir: module.dir,
    skipped: childModuleFiles,
    oversized: read.oversized + oversized,
  };
  const m = text();
  const extra: string[] = [];
  if (overCount > 0) extra.push(m.firstFilesOnly(MAX_FILES, overCount));
  if (listing.truncated) extra.push(m.repoTruncated);
  const base = importNote(imported);
  const note = [base?.replace(/\.$/, ''), ...extra].filter(Boolean).join('. ');
  const where =
    listing.kind === 'gist'
      ? m.gistLabel(listing.id.slice(0, 7), listing.owner)
      : `${listing.owner}/${listing.repo}${module.dir ? `/${module.dir}` : ''} @ ${listing.ref}`;
  return {
    imported,
    origin: githubOrigin(listing, module.dir),
    description: m.importedFrom(where),
    note: note ? `${note}.` : null,
  };
}

/** A short, human label for what a listing covers: `owner/repo · main` or `gist 1a2b3c4`. */
export function listingLabel(listing: Listing, locale: Locale = currentLocale()): string {
  return listing.kind === 'gist'
    ? messagesFor(githubMessages, locale).gistLabel(listing.id.slice(0, 7), listing.owner)
    : `${listing.owner}/${listing.repo}`;
}

/** Bytes, the way the dialog shows them: `940 B`, `12 KB`, `1.4 MB` (`1,4 MB` in Portuguese). */
export function formatBytes(n: number, locale: Locale = currentLocale()): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  if (locale === 'en') return `${mb.toFixed(1)} MB`;
  return `${formatNumber(mb, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }, locale)} MB`;
}
