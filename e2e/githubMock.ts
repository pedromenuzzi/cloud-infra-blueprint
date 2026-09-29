/**
 * A fake GitHub for e2e: `page.route` answers api.github.com and
 * raw.githubusercontent.com, and every other off-site request is aborted —
 * no test ever reaches the real network.
 */
import type { Page, Request, Route } from '@playwright/test';

export interface FakeRepo {
  defaultBranch?: string;
  /** path → file text; folders are implied */
  files: Record<string, string>;
  /** only visible with `Authorization: Bearer <token>` */
  privateToken?: string;
}

export interface FakeGithub {
  /** every request that reached the fake, in order */
  requests: Request[];
  /** make the next API answers a spent rate limit */
  exhaustRateLimit(): void;
  /** API requests stop answering (until the page closes) */
  hang(): void;
  /**
   * Requests fail like a dropped connection. (Routed requests never reach the
   * network, so `context.setOffline` alone doesn't fail them — pair the two.)
   */
  setOffline(offline: boolean): void;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, accept, content-type',
  'access-control-expose-headers': 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-ratelimit-used',
};

export async function mockGithub(page: Page, repos: Record<string, FakeRepo>): Promise<FakeGithub> {
  const requests: Request[] = [];
  let remaining = 60;
  let exhausted = false;
  let hanging = false;
  let offline = false;
  const resetAt = Math.round(Date.now() / 1000) + 30 * 60;

  // anything off-site that isn't mocked below: refused (registered first = matched last)
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort('blockedbyclient'),
  );

  await page.route('https://api.github.com/**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET' } });
      return;
    }
    requests.push(request);
    if (offline) return route.abort('internetdisconnected');
    if (hanging) return new Promise<void>(() => undefined); // never answers
    const auth = request.headers()['authorization'] ?? null;
    const limit = auth ? 5000 : 60;
    remaining = exhausted ? 0 : Math.max(0, remaining - 1);
    const headers = {
      ...CORS,
      'content-type': 'application/json',
      'x-ratelimit-limit': String(limit),
      'x-ratelimit-remaining': String(auth && !exhausted ? 4990 : remaining),
      'x-ratelimit-reset': String(resetAt),
    };
    const json = (status: number, body: unknown) => route.fulfill({ status, headers, body: JSON.stringify(body) });
    if (exhausted) return json(403, { message: 'API rate limit exceeded for 127.0.0.1.' });

    const path = new URL(request.url()).pathname;
    const blob = /^\/repos\/([^/]+)\/([^/]+)\/git\/blobs\/([0-9a-f]+)$/.exec(path);
    const m = blob ? null : /^\/repos\/([^/]+)\/([^/]+)(\/git\/trees\/([^/?]+))?$/.exec(path);
    const key = blob ? `${blob[1]}/${blob[2]}` : m ? `${m[1]}/${m[2]}` : '';
    const repo = repos[key];
    if (!repo || (repo.privateToken && auth !== `Bearer ${repo.privateToken}`)) {
      return json(404, { message: 'Not Found' });
    }
    if (blob) {
      const text = repo.files[Buffer.from(blob[3]!, 'hex').toString()];
      return text === undefined
        ? json(404, { message: 'Not Found' })
        : json(200, { encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    if (!m) return json(404, { message: 'Not Found' });
    const branch = repo.defaultBranch ?? 'main';
    if (!m[3]) return json(200, { default_branch: branch, full_name: `${m[1]}/${m[2]}` });
    if (decodeURIComponent(m[4]!) !== branch) return json(404, { message: 'Not Found' });
    const dirs = new Set<string>();
    for (const file of Object.keys(repo.files)) {
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return json(200, {
      sha: 'root',
      truncated: false,
      tree: [
        ...[...dirs].map((d) => ({ path: d, type: 'tree', sha: `tree-${d}` })),
        // the blob "sha" is the path in hex, so the blobs API above can find the file
        ...Object.entries(repo.files).map(([p, text]) => ({
          path: p,
          type: 'blob',
          sha: Buffer.from(p).toString('hex'),
          size: Buffer.byteLength(text),
        })),
      ],
    });
  });

  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    const request = route.request();
    requests.push(request);
    if (offline) return route.abort('internetdisconnected');
    const [, owner, name, ref, ...rest] = new URL(request.url()).pathname.split('/');
    const repo = repos[`${owner}/${name}`];
    const text = repo && ref === (repo.defaultBranch ?? 'main') && !repo.privateToken ? repo.files[rest.map(decodeURIComponent).join('/')] : undefined;
    await route.fulfill({
      status: text === undefined ? 404 : 200,
      headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' },
      body: text ?? '404: Not Found',
    });
  });

  return {
    requests,
    exhaustRateLimit: () => {
      exhausted = true;
    },
    hang: () => {
      hanging = true;
    },
    setOffline: (value) => {
      offline = value;
    },
  };
}

/** A small multi-root repository: two root modules, a child module, state and the lock file. */
export const INFRA_REPO: FakeRepo = {
  files: {
    'README.md': '# infra\n',
    'main.tf': 'resource "aws_s3_bucket" "shared" {\n  bucket = "acme-shared"\n}\n',
    'modules/network/main.tf': 'resource "aws_vpc" "this" {\n  cidr_block = var.cidr\n}\n',
    'modules/network/variables.tf': 'variable "cidr" {}\n',
    'envs/prod/main.tf': [
      'resource "aws_vpc" "prod" {',
      '  cidr_block = var.cidr',
      '}',
      '',
      'resource "aws_subnet" "app" {',
      '  vpc_id     = aws_vpc.prod.id',
      '  cidr_block = "10.20.1.0/24"',
      '}',
      '',
    ].join('\n'),
    'envs/prod/variables.tf': 'variable "cidr" {\n  default = "10.20.0.0/16"\n}\n',
    'envs/prod/terraform.tfstate': '{"version": 4, "secret": "do-not-fetch"}',
    'envs/prod/.terraform.lock.hcl': '# lock\n',
    'envs/prod/.terraform/modules/modules.json': '{}',
  },
};
