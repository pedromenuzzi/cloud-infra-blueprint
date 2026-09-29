import { describe, expect, it, vi } from 'vitest';
import { hashText } from './storage';
import {
  baselineFor,
  createLink,
  hashFiles,
  linkNeedsChoice,
  planSync,
  previewLink,
  readRootModule,
  syncFolder,
  type DirHandleLike,
  type FileHandleLike,
  type FolderLink,
  type SyncIO,
} from './fsSync';

/* ------------------------------------------------ an in-memory folder */

class FakeFileHandle implements FileHandleLike {
  readonly kind = 'file' as const;
  writes = 0;
  constructor(
    readonly name: string,
    public text = '',
  ) {}
  async getFile() {
    const text = this.text;
    return { size: new TextEncoder().encode(text).length, lastModified: Date.now(), text: async () => text };
  }
  async createWritable() {
    let buffer = '';
    return {
      write: async (data: string) => {
        buffer += data;
      },
      // like the real API: nothing lands until close()
      close: async () => {
        this.text = buffer;
        this.writes += 1;
      },
    };
  }
}

class FakeDir implements DirHandleLike {
  readonly kind = 'directory' as const;
  entries = new Map<string, FakeFileHandle | FakeDir>();
  permission: PermissionState = 'granted';
  gone = false;
  /** runs before a file handle is fetched (to simulate another program saving meanwhile) */
  beforeOpen?: (name: string) => void;
  constructor(readonly name: string) {}

  async *values() {
    if (this.gone) throw new DOMException('gone', 'NotFoundError');
    yield* [...this.entries.values()];
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    this.beforeOpen?.(name);
    let entry = this.entries.get(name);
    if (!entry) {
      if (!options.create) throw new DOMException('missing', 'NotFoundError');
      entry = new FakeFileHandle(name);
      this.entries.set(name, entry);
    }
    if (entry.kind !== 'file') throw new DOMException('a folder', 'TypeMismatchError');
    return entry;
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    let entry = this.entries.get(name);
    if (!entry && options.create) this.entries.set(name, (entry = new FakeDir(name)));
    if (!entry || entry.kind !== 'directory') throw new DOMException('missing', 'NotFoundError');
    return entry;
  }
  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw new DOMException('missing', 'NotFoundError');
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
  async isSameEntry(other: DirHandleLike) {
    return other === this;
  }

  /* test helpers */
  put(name: string, text: string) {
    const existing = this.entries.get(name);
    if (existing?.kind === 'file') existing.text = text;
    else this.entries.set(name, new FakeFileHandle(name, text));
    return this;
  }
  dir(name: string) {
    const d = new FakeDir(name);
    this.entries.set(name, d);
    return d;
  }
  text(name: string) {
    const e = this.entries.get(name);
    return e?.kind === 'file' ? e.text : undefined;
  }
  names() {
    return [...this.entries.keys()].sort();
  }
}

/** The editor side of a sync: a project's files, plus what the sync asked for. */
function fakeProject(files: Record<string, string>, { allowRemove = false } = {}) {
  const state = { files: { ...files } };
  const saved: FolderLink[] = [];
  const io: SyncIO = {
    appFiles: () => state.files,
    setAppFiles: vi.fn((next: Record<string, string>) => {
      state.files = next;
      return true;
    }),
    confirmRemove: vi.fn(async () => allowRemove),
    saveLink: vi.fn(async (link: FolderLink) => {
      saved.push(structuredClone({ ...link, dir: undefined }) as unknown as FolderLink);
    }),
  };
  return { state, io, saved };
}

const MAIN = 'resource "aws_vpc" "main" {}\n';
const VARS = 'variable "region" {}\n';

/** A project linked to a folder, both holding the same files. */
function linked(files: Record<string, string> = { 'main.tf': MAIN, 'variables.tf': VARS }) {
  const dir = new FakeDir('infra');
  for (const [name, text] of Object.entries(files)) dir.put(name, text);
  dir.put('README.md', '# docs\n');
  const link = createLink({ projectId: 'p1', dir, label: 'infra', synced: hashFiles(files) });
  return { dir, link, ...fakeProject(files) };
}

/* ------------------------------------------------------------ planning */

describe('planSync', () => {
  const h = hashText;
  it('compares project, disk and the last agreed version per file', () => {
    const synced = { 'same.tf': h('1'), 'app.tf': h('1'), 'disk.tf': h('1'), 'both.tf': h('1'), 'converged.tf': h('1'), 'app-del.tf': h('1'), 'disk-del.tf': h('1') };
    const app = { 'same.tf': '1', 'app.tf': 'A', 'disk.tf': '1', 'both.tf': 'A', 'converged.tf': 'X', 'disk-del.tf': '1', 'new-app.tf': 'n' };
    const disk = { 'same.tf': '1', 'app.tf': '1', 'disk.tf': 'D', 'both.tf': 'D', 'converged.tf': 'X', 'app-del.tf': '1', 'new-disk.tf': 'n2' };
    expect(planSync(app, disk, synced)).toEqual({
      write: ['app.tf', 'new-app.tf'],
      remove: ['app-del.tf'],
      pull: ['disk.tf', 'new-disk.tf'],
      drop: ['disk-del.tf'],
      conflicts: ['both.tf'],
      agreed: { 'converged.tf': h('X'), 'same.tf': h('1') },
    });
  });

  it('a folder with no .tf files left is a conflict, never a reason to empty the project', () => {
    const plan = planSync({ 'main.tf': MAIN }, {}, { 'main.tf': h(MAIN) });
    expect(plan).toMatchObject({ drop: [], conflicts: ['main.tf'] });
  });

  it('skips files the user chose to keep on disk only', () => {
    expect(planSync({}, { 'old.tf': 'x' }, {}, ['old.tf'])).toMatchObject({ pull: [], conflicts: [] });
  });
});

/* ------------------------------------------------------------- syncing */

describe('syncFolder', () => {
  it('writes project edits through to the .tf files — and only those', async () => {
    const { dir, link, io, state } = linked();
    state.files = { ...state.files, 'main.tf': `${MAIN}# edited\n`, 'outputs.tf': 'output "x" {\n  value = 1\n}\n' };
    const result = await syncFolder(link, io);
    expect(result).toEqual({ status: 'synced', wrote: ['main.tf', 'outputs.tf'], pulled: [], removed: [] });
    expect(dir.text('main.tf')).toBe(`${MAIN}# edited\n`);
    expect(dir.text('outputs.tf')).toContain('output "x"');
    expect(dir.text('README.md')).toBe('# docs\n');
    expect((dir.entries.get('variables.tf') as FakeFileHandle).writes).toBe(0);
    expect(link.synced['main.tf']).toBe(hashText(`${MAIN}# edited\n`));
    // it made outputs.tf, so it may delete it later without asking
    expect(link.created).toEqual(['outputs.tf']);
    expect(io.saveLink).toHaveBeenCalled();
  });

  it('never writes project files that could not live in the folder', async () => {
    const { dir, link, io, state } = linked();
    state.files = { ...state.files, 'notes.txt': 'hi', 'sub/dir.tf': 'x' };
    await syncFolder(link, io);
    expect(dir.names()).toEqual(['README.md', 'main.tf', 'variables.tf']);
  });

  it('takes changes made on disk into the project (only the disk changed: no question)', async () => {
    const { dir, link, io, state } = linked();
    dir.put('main.tf', `${MAIN}# from my editor\n`).put('extra.tf', 'locals {}\n');
    dir.entries.delete('variables.tf');
    const result = await syncFolder(link, io);
    expect(result).toMatchObject({ status: 'synced', wrote: [], pulled: ['extra.tf', 'main.tf', 'variables.tf'] });
    expect(state.files).toEqual({ 'main.tf': `${MAIN}# from my editor\n`, 'extra.tf': 'locals {}\n' });
    expect(io.setAppFiles).toHaveBeenCalledTimes(1);
    expect(link.synced).toEqual(hashFiles(state.files));
  });

  it('nothing changed: no writes, no reload', async () => {
    const { dir, link, io } = linked();
    expect(await syncFolder(link, io)).toMatchObject({ status: 'synced', wrote: [], pulled: [] });
    expect(io.setAppFiles).not.toHaveBeenCalled();
    expect((dir.entries.get('main.tf') as FakeFileHandle).writes).toBe(0);
  });

  it('both sides changed: reports a conflict and moves nothing until the user picks', async () => {
    const { dir, link, io, state } = linked();
    state.files = { ...state.files, 'main.tf': '# mine\n', 'variables.tf': `${VARS}# only here\n` };
    dir.put('main.tf', '# theirs\n');
    const result = await syncFolder(link, io);
    expect(result).toEqual({ status: 'conflict', conflicts: [{ name: 'main.tf', app: 'changed', disk: 'changed' }] });
    // not even the non-conflicting edit went out
    expect(dir.text('variables.tf')).toBe(VARS);
    expect(dir.text('main.tf')).toBe('# theirs\n');
    expect(io.setAppFiles).not.toHaveBeenCalled();

    // keep the project's side
    const mine = await syncFolder(link, io, { resolve: 'app' });
    expect(mine).toMatchObject({ status: 'synced', wrote: ['main.tf', 'variables.tf'] });
    expect(dir.text('main.tf')).toBe('# mine\n');
  });

  it('a conflict settled for the folder loads the disk version', async () => {
    const { dir, link, io, state } = linked();
    state.files = { ...state.files, 'main.tf': '# mine\n' };
    dir.put('main.tf', '# theirs\n');
    await syncFolder(link, io, { resolve: 'disk' });
    expect(state.files['main.tf']).toBe('# theirs\n');
    expect(dir.text('main.tf')).toBe('# theirs\n');
  });

  it('a file edited on disk between reading and writing is never overwritten', async () => {
    const { dir, link, io, state } = linked();
    state.files = { ...state.files, 'main.tf': '# mine\n' };
    let once = true;
    dir.beforeOpen = (name) => {
      if (name === 'main.tf' && once) {
        once = false;
        dir.put('main.tf', '# saved by another program\n');
      }
    };
    const result = await syncFolder(link, io);
    expect(result).toMatchObject({ status: 'conflict', conflicts: [{ name: 'main.tf', app: 'changed', disk: 'changed' }] });
    expect(dir.text('main.tf')).toBe('# saved by another program\n');
  });

  it('asks before deleting a file it did not create — and keeps it when told to', async () => {
    const { dir, link, io, state } = linked();
    delete state.files['variables.tf'];
    const result = await syncFolder(link, io);
    expect(io.confirmRemove).toHaveBeenCalledWith(['variables.tf']);
    expect(result).toMatchObject({ status: 'synced', removed: [] });
    expect(dir.text('variables.tf')).toBe(VARS);
    expect(link.ignored).toEqual(['variables.tf']);
    // the kept file isn't imported back into the project on the next sync
    await syncFolder(link, io);
    expect(Object.keys(state.files)).toEqual(['main.tf']);
    expect(io.confirmRemove).toHaveBeenCalledTimes(1);
  });

  it('deletes a file it created without asking', async () => {
    const { dir, link, io, state } = linked();
    state.files = { ...state.files, 'outputs.tf': 'output "x" {}\n' };
    await syncFolder(link, io);
    delete state.files['outputs.tf'];
    const result = await syncFolder(link, io);
    expect(result).toMatchObject({ status: 'synced', removed: ['outputs.tf'] });
    expect(io.confirmRemove).not.toHaveBeenCalled();
    expect(dir.names()).toEqual(['README.md', 'main.tf', 'variables.tf']);
  });

  it('deletes a file the user allowed (with the answer "yes")', async () => {
    const dir = new FakeDir('infra').put('main.tf', MAIN).put('old.tf', '# old\n');
    const link = createLink({ projectId: 'p1', dir, label: 'infra', synced: hashFiles({ 'main.tf': MAIN, 'old.tf': '# old\n' }) });
    const { io } = fakeProject({ 'main.tf': MAIN }, { allowRemove: true });
    expect(await syncFolder(link, io)).toMatchObject({ removed: ['old.tf'] });
    expect(dir.names()).toEqual(['main.tf']);
  });

  it('a folder emptied behind our back is a conflict', async () => {
    const { dir, link, io, state } = linked();
    dir.entries.clear();
    expect(await syncFolder(link, io)).toMatchObject({
      status: 'conflict',
      conflicts: [
        { name: 'main.tf', app: 'same', disk: 'deleted' },
        { name: 'variables.tf', app: 'same', disk: 'deleted' },
      ],
    });
    expect(Object.keys(state.files)).toEqual(['main.tf', 'variables.tf']);
  });

  it('needs permission again after a reload, and notices a folder that is gone', async () => {
    const { dir, link, io } = linked();
    dir.permission = 'prompt';
    expect(await syncFolder(link, io)).toEqual({ status: 'permission' });
    dir.permission = 'granted';
    dir.gone = true;
    expect(await syncFolder(link, io)).toEqual({ status: 'missing' });
  });
});

/* -------------------------------------------------------------- linking */

describe('linking a project to a folder', () => {
  it('an empty folder just receives the project', async () => {
    const dir = new FakeDir('infra').put('README.md', '# hi\n');
    const { io } = fakeProject({ 'main.tf': MAIN });
    const preview = previewLink({ 'main.tf': MAIN }, {});
    expect(linkNeedsChoice(preview)).toBe(false);
    const link = createLink({ projectId: 'p1', dir, label: 'infra', synced: baselineFor('app', { 'main.tf': MAIN }, {}) });
    await syncFolder(link, io);
    expect(dir.text('main.tf')).toBe(MAIN);
    expect(link.created).toEqual(['main.tf']);
  });

  it('a folder with other Terraform asks first: keep the project (replacing the folder files)', async () => {
    const dir = new FakeDir('infra').put('main.tf', '# on disk\n').put('network.tf', '# disk only\n');
    const app = { 'main.tf': MAIN, 'variables.tf': VARS };
    const { io } = fakeProject(app);
    const preview = previewLink(app, { 'main.tf': '# on disk\n', 'network.tf': '# disk only\n' });
    expect(preview).toEqual({ same: [], appOnly: ['variables.tf'], diskOnly: ['network.tf'], differ: ['main.tf'] });
    expect(linkNeedsChoice(preview)).toBe(true);
    const disk = { 'main.tf': '# on disk\n', 'network.tf': '# disk only\n' };
    const link = createLink({ projectId: 'p1', dir, label: 'infra', synced: baselineFor('app', app, disk) });
    await syncFolder(link, io, { allowRemove: preview.diskOnly });
    expect(io.confirmRemove).not.toHaveBeenCalled();
    expect(dir.names()).toEqual(['main.tf', 'variables.tf']);
    expect(dir.text('main.tf')).toBe(MAIN);
  });

  it('…or load the folder into the project', async () => {
    const dir = new FakeDir('infra').put('main.tf', '# on disk\n').put('network.tf', '# disk only\n');
    const app = { 'main.tf': MAIN, 'variables.tf': VARS };
    const { io, state } = fakeProject(app);
    const disk = { 'main.tf': '# on disk\n', 'network.tf': '# disk only\n' };
    const link = createLink({ projectId: 'p1', dir, label: 'infra', synced: baselineFor('disk', app, disk) });
    await syncFolder(link, io);
    expect(state.files).toEqual(disk);
    expect(dir.names()).toEqual(['main.tf', 'network.tf']);
  });
});

describe('readRootModule', () => {
  it('finds the root module the way importing does, skipping modules and tool folders', async () => {
    const repo = new FakeDir('repo').put('README.md', '#');
    const infra = repo.dir('infra');
    infra.put('main.tf', 'module "net" {\n  source = "./modules/net"\n}\n').put('variables.tf', VARS);
    infra.dir('modules').dir('net').put('main.tf', 'resource "aws_vpc" "x" {}\n');
    infra.dir('.terraform').put('junk.tf', 'nope');
    const module = await readRootModule(repo);
    expect(module).toMatchObject({ label: 'repo/infra', skipped: 1, oversized: 0 });
    expect(Object.keys(module!.files).sort()).toEqual(['main.tf', 'variables.tf']);
    expect(module!.dir).toBe(infra);
    expect(await readRootModule(new FakeDir('empty'))).toBeNull();
  });
});
