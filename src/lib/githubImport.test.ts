import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRootModule,
  findRootModules,
  GithubImportError,
  listGithub,
  MAX_FILES,
  parseGithubInput,
  refCandidates,
  targetShorthand,
  type GithubTarget,
  type RateLimit,
  type RepoTarget,
  type TreeFile,
} from './githubImport';

afterEach(() => {
  vi.unstubAllGlobals();
});

/* --------------------------------------------------------------- parsing */

function target(input: string): GithubTarget {
  const parsed = parseGithubInput(input);
  if (!parsed.ok) throw new Error(`expected ${input} to parse: ${parsed.error}`);
  return parsed.target;
}

function repo(input: string): RepoTarget {
  const t = target(input);
  if (t.kind !== 'repo') throw new Error('expected a repository');
  return t;
}

function error(input: string): string {
  const parsed = parseGithubInput(input);
  if (parsed.ok) throw new Error(`expected ${input} to be refused`);
  return parsed.error;
}

describe('parseGithubInput', () => {
  it('reads owner/repo shorthands, with a path and a ref', () => {
    expect(repo('hashicorp/learn-terraform')).toMatchObject({
      owner: 'hashicorp',
      repo: 'learn-terraform',
      ref: null,
      path: '',
      file: null,
      refPath: null,
    });
    expect(repo(' acme/infra/envs/prod@v1.2.0 ')).toMatchObject({ path: 'envs/prod', ref: 'v1.2.0' });
    expect(repo('acme/infra@feature/new-vpc')).toMatchObject({ path: '', ref: 'feature/new-vpc' });
    expect(repo('acme/infra/stacks/main.tf')).toMatchObject({ path: 'stacks', file: 'main.tf' });
    expect(repo('acme/infra.git')).toMatchObject({ repo: 'infra' });
  });

  it('reads repository links in every spelling', () => {
    for (const input of [
      'github.com/acme/infra',
      'www.github.com/acme/infra/',
      'https://github.com/acme/infra',
      'https://github.com/acme/infra.git',
      'http://www.github.com/acme/infra?tab=readme-ov-file#readme',
      'git@github.com:acme/infra.git',
      'git+https://github.com/acme/infra.git',
      // any other page of the repository means the repository
      'https://github.com/acme/infra/issues/12',
    ]) {
      expect(repo(input), input).toMatchObject({ owner: 'acme', repo: 'infra', ref: null, path: '' });
    }
  });

  it('reads /tree/ folder links, keeping the segments for ref resolution', () => {
    const t = repo('https://github.com/acme/infra/tree/main/envs/prod');
    expect(t).toMatchObject({ ref: 'main', path: 'envs/prod', file: null, refPath: ['main', 'envs', 'prod'] });
    expect(repo('https://github.com/acme/infra/tree/main')).toMatchObject({ ref: 'main', path: '' });
    expect(repo('https://github.com/acme/infra/tree/main/my%20stack')).toMatchObject({ path: 'my stack' });
    expect(repo('https://github.com/acme/infra/commit/0a1b2c3d')).toMatchObject({ ref: '0a1b2c3d', path: '' });
  });

  it('reads /blob/ file links and raw file links: the file names its folder', () => {
    expect(repo('https://github.com/acme/infra/blob/main/envs/prod/main.tf')).toMatchObject({
      ref: 'main',
      path: 'envs/prod',
      file: 'main.tf',
    });
    expect(repo('https://github.com/acme/infra/blob/v2/main.tf')).toMatchObject({ ref: 'v2', path: '', file: 'main.tf' });
    expect(repo('https://raw.githubusercontent.com/acme/infra/main/envs/main.tf')).toMatchObject({
      ref: 'main',
      path: 'envs',
      file: 'main.tf',
    });
    expect(repo('raw.githubusercontent.com/acme/infra/refs/heads/dev/main.tf')).toMatchObject({ ref: 'dev', file: 'main.tf' });
  });

  it('reads gist links', () => {
    const id = 'aa5a315d61ae9438b18d';
    expect(target(`https://gist.github.com/octocat/${id}`)).toEqual({ kind: 'gist', id, revision: null });
    expect(target(`gist.github.com/${id}`)).toEqual({ kind: 'gist', id, revision: null });
    const rev = 'b'.repeat(40);
    expect(target(`https://gist.github.com/octocat/${id}/${rev}`)).toEqual({ kind: 'gist', id, revision: rev });
    expect(target(`https://gist.githubusercontent.com/octocat/${id}/raw/${rev}/main.tf`)).toEqual({
      kind: 'gist',
      id,
      revision: rev,
    });
    expect(target(`https://gist.github.com/octocat/${id.toUpperCase()}`)).toMatchObject({ id });
  });

  it('refuses everything else with a helpful sentence', () => {
    expect(error('')).toMatch(/Paste/);
    expect(error('   ')).toMatch(/Paste/);
    expect(error('acme')).toMatch(/owner\/repo/);
    expect(error('https://gitlab.com/acme/infra')).toMatch(/Only GitHub/);
    expect(error('gitlab.com/acme/infra')).toMatch(/Only GitHub/);
    expect(error('https://example.com/acme/infra')).toMatch(/not a GitHub link/);
    expect(error('example.com/acme/infra')).toMatch(/not a GitHub link/);
    expect(error('ftp://github.com/acme/infra')).toMatch(/web link/);
    expect(error('acme/infra/../../etc')).toMatch(/invalid folder/);
    expect(error('bad owner!/infra')).toMatch(/Paste one link|isn't a GitHub user/);
    expect(error('-acme/infra')).toMatch(/isn't a GitHub user/);
    expect(error('acme/in fra')).toMatch(/one link/);
    expect(error('acme/infra@')).toMatch(/after “@”/);
    expect(error('acme/infra@bad..ref')).toMatch(/isn't a valid branch/);
    expect(error('https://github.com/orgs/acme')).toMatch(/isn't a GitHub user/);
    expect(error('https://github.com/acme')).toMatch(/repository name/);
    expect(error('https://github.com/acme/infra/blob/main')).toMatch(/incomplete/);
    expect(error('https://gist.github.com/octocat')).toMatch(/no gist id/);
    expect(error('https://github.com/acme/infra/tree/main/%E0%A4%A')).toMatch(/broken characters/);
    expect(error(`acme/${'x'.repeat(3000)}`)).toMatch(/too long/);
  });

  it('writes a target back as the shorthand deep links carry', () => {
    for (const input of ['acme/infra', 'acme/infra/envs/prod@v1', 'acme/infra/stack/main.tf@main']) {
      expect(targetShorthand(target(input))).toBe(input);
    }
    expect(targetShorthand(target('https://github.com/acme/infra/tree/main/envs'))).toBe('acme/infra/envs@main');
  });
});

describe('refCandidates', () => {
  it('tries the shortest ref first — branch names can contain slashes', () => {
    expect(refCandidates(repo('https://github.com/a/b/tree/feature/x/infra'))).toEqual([
      { ref: 'feature', path: 'x/infra' },
      { ref: 'feature/x', path: 'infra' },
      { ref: 'feature/x/infra', path: '' },
    ]);
    // a file link: the file itself is never part of the ref
    expect(refCandidates(repo('https://github.com/a/b/blob/main/infra/main.tf'))).toEqual([
      { ref: 'main', path: 'infra' },
      { ref: 'main/infra', path: '' },
    ]);
    expect(refCandidates(repo('a/b/infra@feature/x'))).toEqual([{ ref: 'feature/x', path: 'infra' }]);
    expect(refCandidates(repo('a/b'))).toEqual([]);
  });
});

/* ---------------------------------------------------------- root modules */

const blob = (path: string, size = 100): TreeFile => ({ path, size, sha: `sha-${path}` });

describe('findRootModules', () => {
  const tree = [
    blob('main.tf'),
    blob('variables.tf'),
    blob('README.md'),
    blob('terraform.tfstate'),
    blob('.terraform.lock.hcl'),
    blob('modules/vpc/main.tf'),
    blob('modules/vpc/outputs.tf'),
    blob('envs/prod/main.tf', 300),
    blob('envs/prod/backend.tf'),
    blob('envs/prod/.terraform/modules/vpc/main.tf'),
    blob('envs/prod/terraform.tfstate.backup'),
    blob('envs/dev/main.tf'),
    blob('examples/basic/main.tf'),
    blob('examples/basic/module/inner/main.tf'),
  ];

  it('lists folders with .tf files, shallow first — child modules, state, lock and .terraform left out', () => {
    const scan = findRootModules(tree);
    expect(scan.modules.map((m) => [m.dir, m.files.length])).toEqual([
      ['', 2],
      ['envs/dev', 1],
      ['envs/prod', 2],
      ['examples/basic', 1],
    ]);
    expect(scan.childModuleFiles).toBe(3); // modules/vpc (2) + examples/basic/module/inner (1)
    expect(scan.modules.find((m) => m.dir === 'envs/prod')!.bytes).toBe(400);
    expect(scan.modules[0]!.linked).toBe(true);
  });

  it('only looks under the linked folder, which comes first', () => {
    expect(findRootModules(tree, 'envs').modules.map((m) => m.dir)).toEqual(['envs/dev', 'envs/prod']);
    const prod = findRootModules([...tree, blob('envs/prod/tests/fixture/main.tf'), blob('envs/a/main.tf')], 'envs/prod');
    expect(prod.modules.map((m) => [m.dir, m.linked])).toEqual([
      ['envs/prod', true],
      ['envs/prod/tests/fixture', false],
    ]);
  });

  it('keeps a child module that the link points at', () => {
    const scan = findRootModules([...tree, blob('modules/vpc/modules/subnets/main.tf')], 'modules/vpc');
    expect(scan.modules.map((m) => m.dir)).toEqual(['modules/vpc']);
    expect(scan.childModuleFiles).toBe(1);
  });

  it('finds nothing where there is no Terraform', () => {
    expect(findRootModules([blob('README.md'), blob('app/index.ts')]).modules).toEqual([]);
    expect(findRootModules(tree, 'docs').modules).toEqual([]);
  });
});

/* ------------------------------------------------------------ networking */

interface Route {
  status?: number;
  body?: unknown;
  text?: string;
  rate?: Partial<RateLimit> | false;
  /** never answers until aborted */
  hang?: boolean;
  headers?: Record<string, string>;
}

/**
 * A fake GitHub: `routes` maps a URL (exact, or a prefix ending with `*`)
 * to its answer. Unknown URLs are a test failure (404 + recorded).
 */
function fakeGithub(routes: Record<string, Route | (() => Route)>) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get('authorization') });
    const key = Object.keys(routes).find((k) => (k.endsWith('*') ? url.startsWith(k.slice(0, -1)) : k === url));
    const route = key ? routes[key]! : { status: 599, body: { message: `unexpected ${url}` } };
    const r = typeof route === 'function' ? route() : route;
    if (r.hang) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    const out = new Headers(r.headers);
    if (r.rate !== false && url.startsWith('https://api.github.com')) {
      out.set('x-ratelimit-limit', String(r.rate?.limit ?? 60));
      out.set('x-ratelimit-remaining', String(r.rate?.remaining ?? 57));
      out.set('x-ratelimit-reset', String(Math.round((r.rate?.resetAt ?? Date.now() + 1800_000) / 1000)));
    }
    const body = r.text ?? JSON.stringify(r.body ?? {});
    return new Response(body, { status: r.status ?? 200, headers: out });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

function tree(entries: Array<[string, number?]>, truncated = false) {
  return {
    sha: 'root-sha',
    truncated,
    tree: entries.map(([path, size]) =>
      size === undefined ? { path, type: 'tree', sha: `t-${path}` } : { path, type: 'blob', sha: `sha-${path}`, size },
    ),
  };
}

const INFRA_TREE = tree([
  ['main.tf', 40],
  ['variables.tf', 30],
  ['terraform.tfstate', 99],
  ['.terraform.lock.hcl', 99],
  ['modules', undefined],
  ['modules/vpc', undefined],
  ['modules/vpc/main.tf', 20],
  ['envs', undefined],
  ['envs/prod', undefined],
  ['envs/prod/main.tf', 25],
]);

describe('listGithub + fetchRootModule', () => {
  it('lists the default branch, then imports the picked root module from raw.githubusercontent.com', async () => {
    const gh = fakeGithub({
      [`${API}/repos/acme/infra`]: { body: { default_branch: 'trunk' }, rate: { remaining: 58 } },
      [`${API}/repos/acme/infra/git/trees/trunk?recursive=1`]: { body: INFRA_TREE, rate: { remaining: 57 } },
      [`${RAW}/acme/infra/trunk/main.tf`]: { text: 'resource "aws_vpc" "main" {\n  cidr_block = var.cidr\n}\n' },
      [`${RAW}/acme/infra/trunk/variables.tf`]: { text: 'variable "cidr" {}\n' },
    });
    const rates: number[] = [];
    const phases: string[] = [];
    const opts = {
      fetch: gh.fetch,
      onRateLimit: (r: RateLimit) => rates.push(r.remaining),
      onProgress: (p: { phase: string }) => phases.push(p.phase),
    };
    const listing = await listGithub(target('acme/infra'), opts);
    expect(listing).toMatchObject({ kind: 'repo', ref: 'trunk', basePath: '', truncated: false });
    const scan = findRootModules(listing.files, listing.basePath);
    expect(scan.modules.map((m) => m.dir)).toEqual(['', 'envs/prod']);
    const result = await fetchRootModule(listing, scan.modules[0]!, scan.childModuleFiles, opts);

    expect(Object.keys(result.imported.files).sort()).toEqual(['main.tf', 'variables.tf']);
    expect(result.imported.name).toBe('infra');
    expect(result.origin).toBe('github:acme/infra@trunk');
    expect(result.description).toBe('Imported from GitHub: acme/infra @ trunk.');
    expect(result.note).toMatch(/1 other file was left out/);
    expect(rates).toEqual([58, 57]);
    expect(phases).toEqual(['repo', 'tree', 'files', 'files', 'files']);
    // state and the lock file are never downloaded; no token → no Authorization anywhere
    expect(gh.calls.map((c) => c.url)).not.toContain(`${RAW}/acme/infra/trunk/terraform.tfstate`);
    expect(gh.calls.every((c) => c.auth === null)).toBe(true);
  });

  it('records the folder in the origin and the name', async () => {
    const gh = fakeGithub({
      [`${API}/repos/acme/infra/git/trees/main?recursive=1`]: { body: INFRA_TREE },
      [`${RAW}/acme/infra/main/envs/prod/main.tf`]: { text: 'resource "aws_s3_bucket" "logs" {}\n' },
    });
    const listing = await listGithub(target('https://github.com/acme/infra/tree/main/envs/prod'), { fetch: gh.fetch });
    const scan = findRootModules(listing.files, listing.basePath);
    expect(scan.modules.map((m) => [m.dir, m.linked])).toEqual([['envs/prod', true]]);
    const result = await fetchRootModule(listing, scan.modules[0]!, scan.childModuleFiles, { fetch: gh.fetch });
    expect(result.origin).toBe('github:acme/infra/envs/prod@main');
    expect(result.imported.name).toBe('infra/envs/prod');
    expect(result.imported.rootDir).toBe('envs/prod');
    expect(result.note).toBeNull();
    // an explicit ref needs no repository lookup: one API call for the whole listing
    expect(gh.calls.filter((c) => c.url.startsWith(API))).toHaveLength(1);
  });

  it('brings the child modules the root module calls, from anywhere in the repository', async () => {
    const gh = fakeGithub({
      [`${API}/repos/acme/infra/git/trees/main?recursive=1`]: { body: INFRA_TREE },
      [`${RAW}/acme/infra/main/envs/prod/main.tf`]: { text: 'module "vpc" {\n  source = "../../modules/vpc"\n}\n' },
      [`${RAW}/acme/infra/main/modules/vpc/main.tf`]: { text: 'resource "aws_vpc" "this" {}\n' },
    });
    const listing = await listGithub(target('https://github.com/acme/infra/tree/main/envs/prod'), { fetch: gh.fetch });
    const scan = findRootModules(listing.files, listing.basePath);
    const progress: string[] = [];
    const result = await fetchRootModule(listing, scan.modules[0]!, scan.childModuleFiles, {
      fetch: gh.fetch,
      onProgress: (p) => progress.push(p.phase === 'files' ? `${p.done}/${p.total}` : p.phase),
    });
    expect(result.imported.files).toEqual({
      'main.tf': 'module "vpc" {\n  source = "../../modules/vpc"\n}\n',
      'modules/vpc/main.tf': 'resource "aws_vpc" "this" {}\n',
    });
    expect(result.imported.modules).toEqual(['modules/vpc']);
    expect(result.note).toBe('Imported the root module (envs/prod/) and kept its child module.');
    expect(progress).toEqual(['0/1', '1/1', '1/2', '2/2']);
  });

  it('finds where a slashed branch name ends', async () => {
    const gh = fakeGithub({
      [`${API}/repos/acme/infra/git/trees/feature?recursive=1`]: { status: 404, body: { message: 'Not Found' } },
      [`${API}/repos/acme/infra/git/trees/feature%2Fvpc?recursive=1`]: { body: INFRA_TREE },
    });
    const listing = await listGithub(target('https://github.com/acme/infra/tree/feature/vpc/envs'), { fetch: gh.fetch });
    expect(listing).toMatchObject({ ref: 'feature/vpc', basePath: 'envs' });
  });

  it('says whether the repository or the ref is missing', async () => {
    const missingRepo = fakeGithub({
      [`${API}/repos/acme/nope`]: { status: 404, body: { message: 'Not Found' } },
    });
    await expect(listGithub(target('acme/nope'), { fetch: missingRepo.fetch })).rejects.toMatchObject({
      code: 'not-found',
      message: expect.stringMatching(/Couldn't find acme\/nope.*add a token/),
    });

    const missingRef = fakeGithub({
      [`${API}/repos/acme/infra/git/trees/v9?recursive=1`]: { status: 404, body: { message: 'Not Found' } },
      [`${API}/repos/acme/infra`]: { body: { default_branch: 'main' } },
    });
    await expect(listGithub(target('acme/infra@v9'), { fetch: missingRef.fetch })).rejects.toMatchObject({
      code: 'ref-not-found',
      message: 'acme/infra has no branch, tag or commit named “v9”.',
    });

    const missingPath = fakeGithub({ [`${API}/repos/acme/infra/git/trees/main?recursive=1`]: { body: INFRA_TREE } });
    await expect(listGithub(target('acme/infra/nowhere@main'), { fetch: missingPath.fetch })).rejects.toMatchObject({
      code: 'path-not-found',
    });

    const empty = fakeGithub({
      [`${API}/repos/acme/empty`]: { body: { default_branch: 'main' } },
      [`${API}/repos/acme/empty/git/trees/main?recursive=1`]: { status: 409, body: { message: 'Git Repository is empty.' } },
    });
    await expect(listGithub(target('acme/empty'), { fetch: empty.fetch })).rejects.toMatchObject({ code: 'empty' });
  });

  it('reports an exhausted rate limit with its reset time', async () => {
    const resetAt = Date.now() + 20 * 60_000;
    const gh = fakeGithub({
      [`${API}/repos/acme/infra`]: {
        status: 403,
        body: { message: 'API rate limit exceeded for 1.2.3.4.' },
        rate: { remaining: 0, limit: 60, resetAt },
      },
    });
    const rates: RateLimit[] = [];
    const err = (await listGithub(target('acme/infra'), { fetch: gh.fetch, onRateLimit: (r) => rates.push(r) }).catch(
      (e: unknown) => e,
    )) as GithubImportError;
    expect(err).toBeInstanceOf(GithubImportError);
    expect(err.code).toBe('rate-limit');
    expect(err.message).toMatch(/limit of 60 requests an hour without a token is used up\. It resets at .+ add a token/);
    expect(err.rate?.remaining).toBe(0);
    expect(rates[0]?.remaining).toBe(0);
    expect(Math.abs(rates[0]!.resetAt - resetAt)).toBeLessThan(1000);
  });

  it('maps a rejected token, SSO and server trouble', async () => {
    const bad = fakeGithub({ [`${API}/repos/acme/infra`]: { status: 401, body: { message: 'Bad credentials' } } });
    await expect(listGithub(target('acme/infra'), { fetch: bad.fetch, token: 'x' })).rejects.toMatchObject({
      code: 'bad-token',
    });
    const sso = fakeGithub({
      [`${API}/repos/acme/infra`]: { status: 403, body: { message: 'Resource protected by organization SAML enforcement.' } },
    });
    await expect(listGithub(target('acme/infra'), { fetch: sso.fetch, token: 'x' })).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringMatching(/single sign-on/),
    });
    const down = fakeGithub({ [`${API}/repos/acme/infra`]: { status: 502, body: {} } });
    await expect(listGithub(target('acme/infra'), { fetch: down.fetch })).rejects.toMatchObject({ code: 'server' });
  });

  it('tells offline apart from an unreachable GitHub', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    vi.stubGlobal('navigator', { onLine: false });
    await expect(listGithub(target('acme/infra'), { fetch: failing })).rejects.toMatchObject({ code: 'offline' });
    vi.stubGlobal('navigator', { onLine: true });
    await expect(listGithub(target('acme/infra'), { fetch: failing })).rejects.toMatchObject({ code: 'network' });
  });

  it('with a token: private contents come from the blobs API, and the token goes nowhere else', async () => {
    const gh = fakeGithub({
      [`${API}/repos/acme/secret`]: { body: { default_branch: 'main', private: true }, rate: { limit: 5000, remaining: 4999 } },
      [`${API}/repos/acme/secret/git/trees/main?recursive=1`]: { body: tree([['main.tf', 30]]) },
      [`${API}/repos/acme/secret/git/blobs/sha-main.tf`]: {
        body: { encoding: 'base64', content: btoa('resource "aws_sqs_queue" "q" {}\n').replace(/(.{8})/g, '$1\n') },
      },
    });
    const opts = { fetch: gh.fetch, token: 'github_pat_TEST' };
    const listing = await listGithub(target('acme/secret'), opts);
    const scan = findRootModules(listing.files);
    const result = await fetchRootModule(listing, scan.modules[0]!, 0, opts);
    expect(result.imported.files['main.tf']).toBe('resource "aws_sqs_queue" "q" {}\n');
    expect(gh.calls.every((c) => c.url.startsWith(API))).toBe(true);
    expect(gh.calls.every((c) => c.auth === 'Bearer github_pat_TEST')).toBe(true);
    expect(gh.calls.some((c) => c.url.includes('github_pat_TEST'))).toBe(false);

    const hidden = fakeGithub({ [`${API}/repos/acme/secret`]: { status: 404, body: { message: 'Not Found' } } });
    await expect(listGithub(target('acme/secret'), { fetch: hidden.fetch, token: 't' })).rejects.toMatchObject({
      message: "Couldn't find acme/secret, or your token can't see it.",
    });
  });

  it('can be cancelled while listing and while downloading', async () => {
    const hanging = fakeGithub({ [`${API}/repos/acme/infra`]: { hang: true } });
    const controller = new AbortController();
    const pending = listGithub(target('acme/infra'), { fetch: hanging.fetch, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });

    const gh = fakeGithub({
      [`${API}/repos/acme/infra/git/trees/main?recursive=1`]: { body: INFRA_TREE },
      [`${RAW}/acme/infra/main/main.tf`]: { text: 'resource "aws_vpc" "a" {}\n' },
      [`${RAW}/acme/infra/main/variables.tf`]: { hang: true },
    });
    const listing = await listGithub(target('acme/infra@main'), { fetch: gh.fetch });
    const scan = findRootModules(listing.files);
    const downloading = new AbortController();
    const download = fetchRootModule(listing, scan.modules[0]!, 0, {
      fetch: gh.fetch,
      signal: downloading.signal,
      onProgress: (p) => {
        if (p.phase === 'files' && p.done === 1) downloading.abort();
      },
    });
    await expect(download).rejects.toMatchObject({ code: 'aborted' });
    // an already-aborted signal never reaches the network
    const before = gh.calls.length;
    await expect(listGithub(target('acme/infra@main'), { fetch: gh.fetch, signal: downloading.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(gh.calls.length).toBe(before);
  });

  it('applies the size and file caps before downloading anything', async () => {
    const MB = 1024 * 1024;
    const entries: Array<[string, number]> = [
      ['huge.tf', 3 * MB], // over the 2 MB per-file cap
      ...Array.from({ length: 12 }, (_, i): [string, number] => [`big${String(i).padStart(2, '0')}.tf`, 1.9 * MB]),
      ['small.tf', 10],
    ];
    const gh = fakeGithub({
      [`${API}/repos/acme/infra/git/trees/main?recursive=1`]: { body: tree(entries) },
      [`${RAW}/acme/infra/main/*`]: { text: '# generated\n' },
    });
    const listing = await listGithub(target('acme/infra@main'), { fetch: gh.fetch });
    const scan = findRootModules(listing.files);
    const result = await fetchRootModule(listing, scan.modules[0]!, 0, { fetch: gh.fetch });
    const downloaded = gh.calls.filter((c) => c.url.startsWith(RAW)).map((c) => c.url.split('/').pop());
    expect(downloaded).not.toContain('huge.tf');
    // 20 MB in all: ten 1.9 MB files fit, the eleventh and twelfth don't; small.tf still does
    expect(downloaded).toHaveLength(11);
    expect(downloaded).toContain('small.tf');
    expect(result.imported.oversized).toBe(3);
    expect(result.note).toMatch(/3 files were too large to import/);

    const many = fakeGithub({
      [`${API}/repos/acme/gen/git/trees/main?recursive=1`]: {
        body: tree(Array.from({ length: MAX_FILES + 5 }, (_, i): [string, number] => [`f${String(i).padStart(3, '0')}.tf`, 5])),
      },
      [`${RAW}/acme/gen/main/*`]: { text: 'locals {}\n' },
    });
    const genListing = await listGithub(target('acme/gen@main'), { fetch: many.fetch });
    const gen = await fetchRootModule(genListing, findRootModules(genListing.files).modules[0]!, 0, { fetch: many.fetch });
    expect(Object.keys(gen.imported.files)).toHaveLength(MAX_FILES);
    expect(gen.note).toMatch(/Only the first 200 files were imported \(5 more left out\)/);
  });

  it('lists only the linked folder of a repository too large to list whole', async () => {
    const gh = fakeGithub({
      [`${API}/repos/big/mono/git/trees/main?recursive=1`]: {
        body: { sha: 'root', truncated: true, tree: [{ path: 'infra', type: 'tree', sha: 'infra-sha' }] },
      },
      [`${API}/repos/big/mono/git/trees/infra-sha`]: {
        body: { sha: 'infra-sha', truncated: false, tree: [{ path: 'prod', type: 'tree', sha: 'prod-sha' }] },
      },
      [`${API}/repos/big/mono/git/trees/prod-sha?recursive=1`]: {
        body: { sha: 'prod-sha', truncated: false, tree: [{ path: 'main.tf', type: 'blob', sha: 's1', size: 12 }] },
      },
    });
    const listing = await listGithub(target('big/mono/infra/prod@main'), { fetch: gh.fetch });
    expect(listing.truncated).toBe(false);
    expect(listing.files.map((f) => f.path)).toEqual(['infra/prod/main.tf']);
    expect(findRootModules(listing.files, listing.basePath).modules.map((m) => m.dir)).toEqual(['infra/prod']);
  });

  it('imports a gist: inline contents, the raw URL only for a truncated file', async () => {
    const id = 'aa5a315d61ae9438b18d';
    const gh = fakeGithub({
      [`${API}/gists/${id}`]: {
        body: {
          id,
          description: 'Tiny VPC\nwith notes',
          owner: { login: 'octocat' },
          history: [{ version: 'c'.repeat(40) }],
          files: {
            'main.tf': { filename: 'main.tf', size: 26, content: 'resource "aws_vpc" "v" {}\n' },
            'big.tf': { filename: 'big.tf', size: 2000, truncated: true, raw_url: `https://gist.githubusercontent.com/octocat/${id}/raw/x/big.tf` },
            'notes.md': { filename: 'notes.md', size: 5, content: '# hi' },
          },
        },
      },
      [`https://gist.githubusercontent.com/octocat/${id}/raw/x/big.tf`]: { text: 'resource "aws_sqs_queue" "q" {}\n' },
    });
    const listing = await listGithub(target(`https://gist.github.com/octocat/${id}`), { fetch: gh.fetch });
    const scan = findRootModules(listing.files);
    expect(scan.modules.map((m) => m.files.map((f) => f.path))).toEqual([['big.tf', 'main.tf']]);
    const result = await fetchRootModule(listing, scan.modules[0]!, 0, { fetch: gh.fetch });
    expect(result.imported.name).toBe('Tiny VPC');
    expect(Object.keys(result.imported.files).sort()).toEqual(['big.tf', 'main.tf']);
    expect(result.origin).toBe(`github:gist/${id}@${'c'.repeat(40)}`);
    expect(gh.calls.map((c) => c.url)).toHaveLength(2);

    const gone = fakeGithub({ [`${API}/gists/${id}`]: { status: 404, body: { message: 'Not Found' } } });
    await expect(listGithub(target(`gist.github.com/${id}`), { fetch: gone.fetch })).rejects.toMatchObject({
      code: 'not-found',
      message: expect.stringMatching(/gist/),
    });
  });
});
