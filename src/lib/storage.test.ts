import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageNotice } from './storage';

/** localStorage with a size quota (key + value lengths, like browsers count UTF-16 units). */
class FakeStorage implements Storage {
  data = new Map<string, string>();
  constructor(public quota = Number.POSITIVE_INFINITY) {}
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    let size = key.length + value.length;
    for (const [k, v] of this.data) if (k !== key) size += k.length + v.length;
    if (size > this.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

let ls: FakeStorage;

/** A fresh copy of the module (its caches and probe are per page load). */
async function load() {
  vi.resetModules();
  const mod = await import('./storage');
  const notices: StorageNotice[] = [];
  mod.onStorageNotice((n) => notices.push(n));
  return { ...mod, notices };
}

const files = { 'main.tf': 'resource "aws_vpc" "main" {}\n' };

beforeEach(() => {
  ls = new FakeStorage();
  vi.stubGlobal('localStorage', ls);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quota', () => {
  it('reports a refused create instead of pretending it worked', async () => {
    const s = await load();
    ls.quota = 200;
    expect(() => s.createProject({ name: 'big', files: { 'main.tf': 'x'.repeat(500) } })).toThrow(
      s.StorageFullError,
    );
    expect(s.listProjects()).toEqual([]);
    expect(s.notices).toContainEqual({ type: 'quota' });
  });

  it('reports a refused save, and recovers once there is room again', async () => {
    const s = await load();
    const p = s.createProject({ name: 'app', files });
    ls.quota = ls.getItem(s.PROJECTS_KEY)!.length + 100;
    const failed = s.updateProject(p.id, { files: { 'main.tf': 'x'.repeat(1000) } });
    expect(failed).toEqual({ ok: false, reason: 'quota' });
    expect(s.getProject(p.id)!.files).toEqual(files);

    ls.quota = Number.POSITIVE_INFINITY;
    expect(s.updateProject(p.id, { name: 'renamed' }).ok).toBe(true);
    expect(s.notices.map((n) => n.type)).toEqual(['quota', 'recovered']);
  });

  it('warns before the quota is reached', async () => {
    const s = await load();
    s.createProject({ name: 'a', files });
    // ~5 MiB budget: 4.5 M characters of Terraform is over the 80% mark
    s.createProject({ name: 'b', files: { 'main.tf': `# ${'x'.repeat(4_500_000)}` } });
    expect(s.notices).toContainEqual({ type: 'nearly-full', percent: expect.any(Number) });
  });
});

describe('corrupted storage', () => {
  it('backs up unreadable data before anything overwrites it', async () => {
    const raw = '[{"id":"prj_1","name":"trunc';
    ls.setItem('cb-projects-v1', raw);
    const s = await load();
    expect(s.listProjects()).toEqual([]);
    const backups = [...ls.data.keys()].filter((k) => k.startsWith(s.BACKUP_PREFIX));
    expect(backups).toHaveLength(1);
    expect(ls.getItem(backups[0])).toBe(raw);
    expect(s.notices).toContainEqual({ type: 'backup', key: backups[0] });

    s.createProject({ name: 'fresh', files });
    expect(ls.getItem(backups[0])).toBe(raw); // still there
    s.listProjects();
    expect([...ls.data.keys()].filter((k) => k.startsWith(s.BACKUP_PREFIX))).toHaveLength(1);
  });

  it('never overwrites unreadable data it could not back up', async () => {
    const raw = `{"broken": "${'x'.repeat(300)}`;
    ls.setItem('cb-projects-v1', raw);
    ls.quota = raw.length + 50; // no room for a copy
    const s = await load();
    expect(s.listProjects()).toEqual([]);
    expect(() => s.createProject({ name: 'x', files: {} })).toThrow(s.StorageFullError);
    expect(ls.getItem('cb-projects-v1')).toBe(raw);
  });

  it('repairs or drops invalid entries instead of breaking the dashboard', async () => {
    ls.setItem(
      'cb-projects-v1',
      JSON.stringify([
        null,
        'nope',
        { id: 'a', name: 'no files or providers' },
        { id: 'b', name: 'bad providers', files: { 'main.tf': 'resource "google_x" "y" {}', 'x.tf': 42 }, providers: 'aws' },
        { id: 'a', name: 'duplicate id' },
        { id: 'c', name: 'ok', files: {}, providers: ['aws'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', extra: 1 },
      ]),
    );
    const s = await load();
    const list = s.listProjects();
    expect(list.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    const a = s.getProject('a')!;
    expect(a.files).toEqual({});
    expect(a.providers).toEqual([]);
    expect(typeof a.createdAt).toBe('string');
    const b = s.getProject('b')!;
    expect(b.files).toEqual({ 'main.tf': 'resource "google_x" "y" {}' });
    expect(b.providers).toEqual(['gcp']);
    expect((s.getProject('c') as unknown as { extra: number }).extra).toBe(1); // unknown fields survive
    // entries were dropped → the original was backed up first
    expect([...ls.data.keys()].some((k) => k.startsWith(s.BACKUP_PREFIX))).toBe(true);
  });

  it('migrates v1 data: rev counters and an explicit demo tag', async () => {
    ls.setItem(
      'cb-projects-v1',
      JSON.stringify([
        { id: 'mine', name: 'Web App on AWS', templateSlug: 'aws-web-app', description: 'A web app', files, providers: ['aws'], createdAt: '2026-01-02', updatedAt: '2026-01-02' },
        { id: 'seed', name: 'production-web', templateSlug: 'aws-web-app', description: 'Demo project — a classic VPC + EC2 + RDS web stack. Safe to edit or delete.', files, providers: ['aws'], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]),
    );
    const s = await load();
    expect(s.getProject('seed')!.demo).toBe(true);
    expect(s.getProject('mine')!.demo).toBeUndefined();
    expect(s.getProject('mine')!.rev).toBe(0);
    expect(s.openDemoProject().id).toBe('seed');

    s.updateProject('mine', { name: 'x' });
    expect(ls.getItem('cb-projects-schema')).toBe(String(s.SCHEMA_VERSION));
  });
});

describe('revisions', () => {
  it('refuses stale writes and reports missing projects', async () => {
    const s = await load();
    const p = s.createProject({ name: 'app', files });
    expect(p.rev).toBe(1);

    const tabA = s.updateProject(p.id, { files: { 'main.tf': 'a' } }, { expectedRev: 1 });
    expect(tabA.ok && tabA.project.rev).toBe(2);

    const tabB = s.updateProject(p.id, { files: { 'main.tf': 'b' } }, { expectedRev: 1 });
    expect(tabB.ok).toBe(false);
    expect(!tabB.ok && tabB.reason).toBe('conflict');
    expect(s.getProject(p.id)!.files['main.tf']).toBe('a');

    expect(s.deleteProject(p.id)).toBe(true);
    expect(s.updateProject(p.id, { name: 'gone' })).toEqual({ ok: false, reason: 'missing' });

    const restored = s.restoreProject({ ...p, files: { 'main.tf': 'b' } });
    expect(restored.ok).toBe(true);
    expect(s.getProject(p.id)!.files['main.tf']).toBe('b');
  });

  it('keeps the same objects while storage is unchanged (cheap dashboard refreshes)', async () => {
    const s = await load();
    s.createProject({ name: 'a', files });
    expect(s.listProjects()[0]).toBe(s.listProjects()[0]);
  });
});

describe('safeStorage', () => {
  it('falls back to memory when the browser blocks storage', async () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    const s = await load();
    expect(s.safeStorage.persistent).toBe(false);
    expect(s.safeStorage.setItem('k', 'v')).toBe(true);
    expect(s.safeStorage.getItem('k')).toBe('v');
    const p = s.createProject({ name: 'in-memory', files });
    expect(s.getProject(p.id)?.name).toBe('in-memory');
    expect(s.notices).toContainEqual({ type: 'blocked' });
  });

  it('treats a full store as full, not blocked', async () => {
    ls.setItem('filler', 'x'.repeat(100));
    ls.quota = 105;
    const s = await load();
    expect(s.safeStorage.persistent).toBe(true);
    expect(s.safeStorage.getItem('filler')).toHaveLength(100);
    expect(s.safeStorage.setItem('more', 'x'.repeat(50))).toBe(false);
  });
});

describe('names and origins', () => {
  it('gives blank projects unique, consistent names', async () => {
    const s = await load();
    expect(s.blankProjectName('aws')).toBe('my-aws-app');
    s.createProject({ name: s.blankProjectName('aws'), files });
    expect(s.blankProjectName('aws')).toBe('my-aws-app-2');
    s.createProject({ name: 'Web App on AWS', files });
    expect(s.uniqueProjectName('Web App on AWS')).toBe('Web App on AWS 2');
  });

  it('finds an earlier copy from the same origin', async () => {
    const s = await load();
    const p = s.createProject({ name: 't', files, origin: 'tutorial:x:2' });
    expect(s.findProjectByOrigin('tutorial:x:2', files)?.id).toBe(p.id);
    expect(s.findProjectByOrigin('tutorial:x:2', { 'main.tf': 'edited' })).toBeUndefined();
  });
});
