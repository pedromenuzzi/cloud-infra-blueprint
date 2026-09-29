/**
 * Persistence of the editor store: debounced saves, flushing, stale-write
 * refusal, cross-tab changes and full storage.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeStorage implements Storage {
  data = new Map<string, string>();
  quota = Number.POSITIVE_INFINITY;
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
    if (size > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

const ls = new FakeStorage();
const win = new EventTarget();
const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });

type Store = typeof import('./store');
type Storage_ = typeof import('@/lib/storage');
let store: Store;
let storage: Storage_;

const MAIN = 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n';

/** what another tab writing localStorage looks like to this one */
function otherTab(write: () => void) {
  write();
  win.dispatchEvent(Object.assign(new Event('storage'), { key: storage.PROJECTS_KEY }));
}

beforeAll(async () => {
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  store = await import('./store');
  storage = await import('@/lib/storage');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers();
  ls.quota = Number.POSITIVE_INFINITY;
});

function open() {
  const project = storage.createProject({ name: 'app', files: { 'main.tf': MAIN } });
  expect(store.loadProjectIntoEditor(project.id)).toBe(true);
  return project;
}

const state = () => store.useEditor.getState();

describe('editor persistence', () => {
  it('saves after the debounce, and flushes on demand', () => {
    const p = open();
    state().onCodeChange('main.tf', `${MAIN}# one\n`);
    expect(state().saveState).toBe('saving');
    vi.advanceTimersByTime(600);
    expect(state().saveState).toBe('saved');
    expect(storage.getProject(p.id)!.files['main.tf']).toContain('# one');

    state().onCodeChange('main.tf', `${MAIN}# two\n`);
    expect(store.flushPendingSave()).toBe(true); // what pagehide / visibilitychange do
    expect(storage.getProject(p.id)!.files['main.tf']).toContain('# two');
  });

  it('writes a pending edit before another project replaces it', () => {
    const a = open();
    state().onCodeChange('main.tf', `${MAIN}# pending\n`);
    const b = storage.createProject({ name: 'b', files: { 'main.tf': MAIN } });
    store.loadProjectIntoEditor(b.id);
    vi.advanceTimersByTime(600);
    expect(storage.getProject(a.id)!.files['main.tf']).toContain('# pending');
    expect(storage.getProject(b.id)!.files['main.tf']).not.toContain('# pending');
  });

  it('reloads silently when another tab saves and this one has nothing pending', () => {
    const p = open();
    otherTab(() => storage.updateProject(p.id, { files: { 'main.tf': `${MAIN}# from B\n` } }));
    expect(state().files['main.tf']).toContain('# from B');
    expect(state().conflict).toBeNull();
  });

  it('adopts a rename from another tab without touching local edits', () => {
    const p = open();
    state().onCodeChange('main.tf', `${MAIN}# local\n`);
    otherTab(() => storage.updateProject(p.id, { name: 'renamed elsewhere' }));
    expect(state().projectName).toBe('renamed elsewhere');
    vi.advanceTimersByTime(600);
    expect(state().saveState).toBe('saved');
    const saved = storage.getProject(p.id)!;
    expect(saved.name).toBe('renamed elsewhere');
    expect(saved.files['main.tf']).toContain('# local');
  });

  it('asks instead of overwriting when both tabs have changes', () => {
    const p = open();
    state().onCodeChange('main.tf', `${MAIN}# mine\n`);
    otherTab(() => storage.updateProject(p.id, { files: { 'main.tf': `${MAIN}# theirs\n` } }));
    expect(state().conflict).toBe('changed');
    expect(state().saveState).toBe('error');
    vi.advanceTimersByTime(600);
    expect(storage.getProject(p.id)!.files['main.tf']).toContain('# theirs'); // nothing overwritten

    state().resolveConflict('overwrite');
    expect(state().conflict).toBeNull();
    expect(storage.getProject(p.id)!.files['main.tf']).toContain('# mine');
  });

  it('refuses a stale write even when the storage event was missed', () => {
    const p = open();
    storage.updateProject(p.id, { files: { 'main.tf': `${MAIN}# theirs\n` } }); // no event
    state().onCodeChange('main.tf', `${MAIN}# mine\n`);
    vi.advanceTimersByTime(600);
    expect(state().conflict).toBe('changed');
    expect(storage.getProject(p.id)!.files['main.tf']).toContain('# theirs');

    state().resolveConflict('reload');
    expect(state().files['main.tf']).toContain('# theirs');
    expect(state().saveState).toBe('saved');
  });

  it('notices a deletion in another tab and can restore the project', () => {
    const p = open();
    otherTab(() => storage.deleteProject(p.id));
    expect(state().conflict).toBe('deleted');
    expect(state().saveState).toBe('error');

    state().resolveConflict('restore');
    expect(state().conflict).toBeNull();
    expect(storage.getProject(p.id)?.files['main.tf']).toBe(MAIN);
  });

  it('keeps a deleted project as a new one', () => {
    const p = open();
    state().onCodeChange('main.tf', `${MAIN}# unsaved\n`);
    otherTab(() => storage.deleteProject(p.id));
    const next = state().resolveConflict('fork');
    expect(next).not.toBe(p.id);
    expect(storage.getProject(next!)?.files['main.tf']).toContain('# unsaved');
    expect(state().projectId).toBe(next);
  });

  it('shows an error state when storage is full, and retries once there is room', () => {
    const p = open();
    ls.quota = 2000;
    state().onCodeChange('main.tf', `${MAIN}# ${'x'.repeat(5000)}\n`);
    vi.advanceTimersByTime(600);
    expect(state().saveState).toBe('error');
    expect(state().saveError).toBe('quota');
    expect(store.flushPendingSave()).toBe(false);

    // reopening the project (dashboard → editor) keeps the unsaved edits on screen
    store.loadProjectIntoEditor(p.id);
    expect(state().files['main.tf']).toContain('xxxx');

    // another tab frees space (deletes a project): the pending save goes through
    ls.quota = Number.POSITIVE_INFINITY;
    otherTab(() => storage.createProject({ name: 'other', files: {} }));
    expect(state().saveState).toBe('saved');
    expect(storage.getProject(p.id)!.files['main.tf']).toContain('xxxx');
  });
});
