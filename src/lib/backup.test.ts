import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, StorageNotice } from './storage';

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

async function load() {
  vi.resetModules();
  const storage = await import('./storage');
  const backup = await import('./backup');
  const notices: StorageNotice[] = [];
  storage.onStorageNotice((n) => notices.push(n));
  return { ...storage, ...backup, notices };
}

function project(over: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return {
    files: { 'main.tf': `resource "aws_vpc" "${over.id}" {}\n` },
    providers: ['aws'],
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-02-03T04:05:06.000Z',
    rev: 3,
    ...over,
  };
}

const NOW = new Date('2026-09-29T12:00:00.000Z');

beforeEach(() => {
  ls = new FakeStorage();
  vi.stubGlobal('localStorage', ls);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('backup zip', () => {
  it('round-trips every project: ids, names, files, templates and dates', async () => {
    const b = await load();
    const projects = [
      project({
        id: 'prj_a',
        name: 'production-web',
        description: 'Demo',
        templateSlug: 'aws-web-app',
        files: { 'main.tf': 'resource "aws_vpc" "main" {}\n', 'variables.tf': '', 'outputs.tf': 'output "x" {\n  value = 1\n}\n' },
      }),
      // same folder name, file names that collide on case-insensitive disks, odd characters
      project({ id: 'prj_b', name: 'Production Web', files: { 'Main.tf': '# upper\n', 'main.tf': '# lower\n', 'rede ção.tf': '# ü\n' } }),
      project({ id: 'prj_c', name: 'empty', files: {} }),
    ];
    const zip = b.buildBackup(projects, NOW);
    const parsed = b.parseBackup(zip);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.invalid).toEqual([]);
    expect(parsed.backup.exportedAt).toBe(NOW.toISOString());
    expect(parsed.backup.projects).toEqual(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        templateSlug: p.templateSlug,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        files: p.files,
        hash: b.filesHash(p.files),
      })),
    );
  });

  it('lays out one folder per project with a manifest and a README', async () => {
    const b = await load();
    const zip = b.buildBackup(
      [project({ id: 'prj_a', name: 'web' }), project({ id: 'prj_b', name: 'web' })],
      NOW,
    );
    const entries = unzipSync(zip);
    expect(Object.keys(entries)).toEqual(['manifest.json', 'README.md', 'web/main.tf', 'web-2/main.tf']);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest).toMatchObject({ format: 'cloud-blueprint-backup', version: 1, exportedAt: NOW.toISOString() });
    expect(manifest.projects.map((p: { id: string }) => p.id)).toEqual(['prj_a', 'prj_b']);
    expect(manifest.projects[1]).toMatchObject({
      name: 'web',
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
      files: [{ name: 'main.tf', path: 'web-2/main.tf' }],
    });
    expect(b.backupFileName(new Date(2026, 8, 9))).toBe('cloud-blueprint-backup-2026-09-09.zip');
  });

  it('finds the manifest one folder down (a backup unzipped and zipped again)', async () => {
    const b = await load();
    const inner = unzipSync(b.buildBackup([project({ id: 'prj_a', name: 'web' })], NOW));
    const nested = zipSync(Object.fromEntries(Object.entries(inner).map(([k, v]) => [`my-backup/${k}`, v])));
    const parsed = b.parseBackup(nested);
    expect(parsed.ok && parsed.backup.projects.map((p) => p.name)).toEqual(['web']);
  });
});

describe('manifest validation', () => {
  const valid = {
    format: 'cloud-blueprint-backup',
    version: 1,
    exportedAt: NOW.toISOString(),
    projects: [{ id: 'a', name: 'ok', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), files: [{ name: 'main.tf', path: 'ok/main.tf' }] }],
  };

  it('accepts a well-formed manifest', async () => {
    const b = await load();
    const check = b.validateManifest(valid);
    expect(check.ok && check.manifest.projects.map((p) => p.id)).toEqual(['a']);
  });

  it('rejects files that are not backups, and backups from a newer app', async () => {
    const b = await load();
    expect(b.validateManifest(null)).toEqual({ ok: false, error: expect.stringMatching(/isn’t a Cloud Blueprint backup/) });
    expect(b.validateManifest({ ...valid, format: 'something-else' }).ok).toBe(false);
    expect(b.validateManifest({ ...valid, version: 'one' })).toEqual({ ok: false, error: expect.stringMatching(/damaged/) });
    expect(b.validateManifest({ ...valid, version: 2 })).toEqual({ ok: false, error: expect.stringMatching(/newer version/) });
    expect(b.validateManifest({ ...valid, projects: 'nope' })).toEqual({ ok: false, error: expect.stringMatching(/no project list/) });
  });

  it('leaves out malformed entries — never paths that escape the backup', async () => {
    const b = await load();
    const entry = valid.projects[0];
    const check = b.validateManifest({
      ...valid,
      projects: [
        entry,
        { ...entry, id: 'a', name: 'twice' },
        { ...entry, id: '', name: 'no id' },
        { ...entry, id: 'b', name: 'escape', files: [{ name: 'main.tf', path: '../../etc/main.tf' }] },
        { ...entry, id: 'c', name: 'absolute', files: [{ name: 'main.tf', path: '/main.tf' }] },
        { ...entry, id: 'd', name: 'windows', files: [{ name: 'main.tf', path: 'x\\main.tf' }] },
        { ...entry, id: 'e', name: 'same file twice', files: [entry.files[0], entry.files[0]] },
        { ...entry, id: 'f', name: 'bad dates', createdAt: 'yesterday', updatedAt: 42 },
        'garbage',
      ],
    });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.manifest.projects.map((p) => p.name)).toEqual(['ok', 'bad dates']);
    // unreadable dates fall back to the export time
    expect(check.manifest.projects[1]).toMatchObject({ createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(check.invalid).toEqual([
      { name: 'twice', reason: 'listed twice' },
      { name: 'no id', reason: 'missing id' },
      { name: 'escape', reason: 'damaged file list' },
      { name: 'absolute', reason: 'damaged file list' },
      { name: 'windows', reason: 'damaged file list' },
      { name: 'same file twice', reason: 'damaged file list' },
      { name: 'Project 9', reason: 'not a project entry' },
    ]);
  });

  it('explains what is wrong with the file', async () => {
    const b = await load();
    expect(b.parseBackup(strToU8('not a zip'))).toMatchObject({ ok: false, error: expect.stringMatching(/readable \.zip/) });
    expect(b.parseBackup(zipSync({ 'infra/main.tf': strToU8('resource "aws_vpc" "x" {}') }))).toMatchObject({
      ok: false,
      hint: 'terraform',
      error: expect.stringMatching(/Import \.tf/),
    });
    expect(b.parseBackup(zipSync({ 'notes.txt': strToU8('hi') }))).toMatchObject({ ok: false, error: expect.stringMatching(/no manifest/) });
    expect(b.parseBackup(zipSync({ 'manifest.json': strToU8('{ nope') }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/isn’t valid JSON/),
    });
  });

  it('marks a project whose files are missing from the zip', async () => {
    const b = await load();
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(valid)) });
    const parsed = b.parseBackup(zip);
    expect(parsed.ok && parsed.backup).toMatchObject({ projects: [], invalid: [{ name: 'ok', reason: 'main.tf is missing from the zip' }] });
  });
});

describe('restore planning', () => {
  async function setup() {
    const b = await load();
    const here = [
      project({ id: 'same', name: 'same' }),
      project({ id: 'changed', name: 'changed', updatedAt: '2026-09-01T00:00:00.000Z', files: { 'main.tf': '# edited here\n' } }),
      project({ id: 'local-copy', name: 'copied', files: { 'main.tf': '# copied content\n' } }),
      project({ id: 'other', name: 'fresh' }),
    ];
    const backup = [
      project({ id: 'same', name: 'same' }),
      project({ id: 'changed', name: 'changed', files: { 'main.tf': '# from the backup\n' } }),
      project({ id: 'elsewhere', name: 'copied', files: { 'main.tf': '# copied content\n' } }),
      project({ id: 'fresh', name: 'fresh', files: { 'main.tf': '# brand new\n' } }),
    ];
    const parsed = b.parseBackup(b.buildBackup(backup, NOW));
    if (!parsed.ok) throw new Error(parsed.error);
    return { b, here, plan: b.planRestore(parsed.backup, here) };
  }

  it('sorts projects into new, already here (by id or content) and conflicts', async () => {
    const { plan } = await setup();
    expect(plan.items.map((i) => [i.project.id, i.status, i.existing?.id])).toEqual([
      ['same', 'duplicate', 'same'],
      ['changed', 'conflict', 'changed'],
      ['elsewhere', 'duplicate', 'local-copy'],
      ['fresh', 'new', undefined],
    ]);
    expect(plan.counts).toEqual({ new: 1, duplicate: 2, conflict: 1 });
    // the copy here was edited after the backup was taken
    expect(plan.items[1].existingIsNewer).toBe(true);
  });

  it('"add as copies" keeps what is here and adds conflicts next to it', async () => {
    const { b, here, plan } = await setup();
    const selected = new Set(plan.items.map((i) => i.project.id));
    const resolved = b.resolveRestore(plan, { mode: 'copy', selected, existing: here });
    expect(resolved.entries.map((e) => [e.item.project.id, e.action, e.name])).toEqual([
      ['same', 'skip', 'same'],
      ['changed', 'copy', 'changed-2'],
      ['elsewhere', 'skip', 'copied'],
      // a name already taken here gets a suffix
      ['fresh', 'add', 'fresh-2'],
    ]);
    expect(resolved.replace).toEqual([]);
    expect(resolved.add.map((p) => p.id)).toEqual([expect.stringMatching(/^prj_/), 'fresh']);
    expect(resolved.add[1]).toMatchObject({ createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-02-03T04:05:06.000Z' });
    expect(resolved.bytes).toBeGreaterThan(0);
  });

  it('"replace existing" writes conflicts over the project with the same id', async () => {
    const { b, here, plan } = await setup();
    const resolved = b.resolveRestore(plan, { mode: 'replace', selected: new Set(['changed', 'fresh']), existing: here });
    expect(resolved.entries.map((e) => e.action)).toEqual(['skip', 'replace', 'skip', 'add']);
    expect(resolved.replace).toMatchObject([{ id: 'changed', name: 'changed', files: { 'main.tf': '# from the backup\n' } }]);
  });

  it('restores only the selected projects', async () => {
    const { b, here, plan } = await setup();
    const resolved = b.resolveRestore(plan, { mode: 'replace', selected: new Set(['fresh']), existing: here });
    expect(resolved.entries.map((e) => e.action)).toEqual(['skip', 'skip', 'skip', 'add']);
  });

  it('names stay unique across the projects of one restore', async () => {
    const b = await load();
    const parsed = b.parseBackup(
      b.buildBackup([project({ id: 'x1', name: 'web', files: { 'a.tf': '1' } }), project({ id: 'x2', name: 'web', files: { 'a.tf': '2' } })], NOW),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const here = [project({ id: 'h', name: 'web', files: { 'a.tf': '0' } })];
    const plan = b.planRestore(parsed.backup, here);
    const resolved = b.resolveRestore(plan, { mode: 'copy', selected: new Set(['x1', 'x2']), existing: here });
    expect(resolved.entries.map((e) => e.name)).toEqual(['web-2', 'web-3']);
  });
});

describe('applying a restore', () => {
  it('adds and replaces in one write, keeping local-only fields of what it replaces', async () => {
    const b = await load();
    const demo = b.createProject({ name: 'production-web', files: { 'main.tf': '# mine\n' }, demo: true });
    const backup = [
      { ...demo, files: { 'main.tf': '# backup\n' }, updatedAt: '2026-01-01T00:00:00.000Z' },
      project({ id: 'prj_new', name: 'new-one' }),
    ];
    const parsed = b.parseBackup(b.buildBackup(backup, NOW));
    if (!parsed.ok) throw new Error(parsed.error);
    const plan = b.planRestore(parsed.backup, b.listProjects());
    const resolved = b.resolveRestore(plan, {
      mode: 'replace',
      selected: new Set([demo.id, 'prj_new']),
      existing: b.listProjects(),
    });
    const result = b.applyRestore(resolved);
    expect(result.ok).toBe(true);

    const replaced = b.getProject(demo.id)!;
    expect(replaced).toMatchObject({ files: { 'main.tf': '# backup\n' }, demo: true, rev: (demo.rev ?? 0) + 1 });
    expect(replaced.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(b.getProject('prj_new')).toMatchObject({ name: 'new-one', rev: 1, providers: ['aws'], createdAt: '2026-01-02T03:04:05.000Z' });
  });

  it('a restore that does not fit changes nothing and says so', async () => {
    const b = await load();
    const mine = b.createProject({ name: 'mine', files: { 'main.tf': '# mine\n' } });
    const before = ls.getItem(b.PROJECTS_KEY);
    ls.quota = before!.length + 400;
    const parsed = b.parseBackup(
      b.buildBackup([project({ id: 'big', name: 'big', files: { 'main.tf': 'x'.repeat(5000) } })], NOW),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const plan = b.planRestore(parsed.backup, b.listProjects());
    const resolved = b.resolveRestore(plan, { mode: 'copy', selected: new Set(['big']), existing: b.listProjects() });
    expect(b.applyRestore(resolved)).toEqual({ ok: false, reason: 'quota' });
    expect(ls.getItem(b.PROJECTS_KEY)).toBe(before);
    expect(b.listProjects().map((p) => p.id)).toEqual([mine.id]);
    // nothing was lost, so no "storage is full, changes aren't saved" banner
    expect(b.notices).toEqual([]);
  });

  it('refuses to add an id that another tab took meanwhile', async () => {
    const b = await load();
    const taken = b.createProject({ name: 'taken', files: {} });
    expect(b.putProjects({ add: [project({ id: taken.id, name: 'dup' })], replace: [] })).toEqual({ ok: false, reason: 'conflict' });
    expect(b.putProjects({ add: [], replace: [project({ id: 'gone', name: 'gone' })] })).toEqual({ ok: false, reason: 'conflict' });
  });
});

describe('content hash', () => {
  it('depends on names and texts, not on key order', async () => {
    const b = await load();
    expect(b.filesHash({ 'a.tf': '1', 'b.tf': '2' })).toBe(b.filesHash({ 'b.tf': '2', 'a.tf': '1' }));
    expect(b.filesHash({ 'a.tf': '1' })).not.toBe(b.filesHash({ 'b.tf': '1' }));
    expect(b.filesHash({ 'a.tf': '12' })).not.toBe(b.filesHash({ 'a.tf': '1', '2': '' }));
    expect(b.hashText('x')).toMatch(/^[0-9a-z]{22}$/);
  });
});
