/**
 * The editor store's read-only mode (view links): every edit path is refused
 * and nothing is ever written to storage — not by a debounce, a flush, a
 * rename, another tab's write, or leaving the page.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/lib/storage';

class RecordingStorage implements Storage {
  data = new Map<string, string>();
  writes: string[] = [];
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
    this.writes.push(key);
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.writes.push(`-${key}`);
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

const ls = new RecordingStorage();
const win = new EventTarget();
const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });

type Store = typeof import('./store');
type Storage_ = typeof import('@/lib/storage');
let store: Store;
let storage: Storage_;

const MAIN = [
  'resource "aws_vpc" "main" {',
  '  cidr_block = "10.0.0.0/16"',
  '}',
  '',
  'resource "aws_subnet" "a" {',
  '  vpc_id     = aws_vpc.main.id',
  '  cidr_block = "10.0.1.0/24"',
  '}',
  '',
].join('\n');

const viewed: Project = {
  id: 'view_abc',
  name: 'shared view',
  files: { 'main.tf': MAIN },
  providers: ['aws'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

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
  ls.writes = [];
});

const state = () => store.useEditor.getState();

function openView() {
  state().load(viewed, { readOnly: true });
  ls.writes = [];
}

describe('read-only editor store', () => {
  it('opens a view link read-only, with everything derived as usual', () => {
    openView();
    expect(state().readOnly).toBe(true);
    expect(state().projectId).toBe('view_abc');
    expect(state().ir.resources.map((r) => r.id).sort()).toEqual(['aws_subnet.a', 'aws_vpc.main']);
    expect(state().ir.resources.find((r) => r.id === 'aws_subnet.a')?.parentId).toBe('aws_vpc.main');
  });

  it('refuses canvas ops, typing, renames, deletes and undo — and writes nothing', () => {
    openView();
    const before = { ...state().files };
    state().applyCanvasOps([{ kind: 'move_node', nodeId: 'aws_vpc.main', position: { x: 400, y: 400 } }]);
    state().onCodeChange('main.tf', `${MAIN}resource "aws_s3_bucket" "b" {}\n`);
    state().renameProject('renamed');
    expect(state().deleteResources(['aws_subnet.a'])).toBe(0);
    state().undo();
    state().redo();
    vi.advanceTimersByTime(5_000);

    expect(state().files).toEqual(before);
    expect(state().projectName).toBe('shared view');
    expect(state().ir.resources).toHaveLength(2);
    expect(state().past).toHaveLength(0);
    expect(state().saveState).toBe('saved');
    expect(ls.writes).toEqual([]);
    expect(ls.getItem(storage.PROJECTS_KEY)).toBeNull();
  });

  it('still lets you look around: select, reveal in code, switch files', () => {
    openView();
    state().setSelection('aws_subnet.a');
    expect(state().selection).toBe('aws_subnet.a');
    state().revealInCode('aws_vpc.main');
    expect(state().selection).toBe('aws_vpc.main');
    expect(state().activeFile).toBe('main.tf');
    expect(ls.writes).toEqual([]);
  });

  it('never saves on flush or when the page goes away', () => {
    openView();
    expect(store.flushPendingSave()).toBe(true);
    win.dispatchEvent(new Event('pagehide'));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible';
    const unload = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    expect(ls.writes).toEqual([]);
  });

  it("ignores other tabs' writes (the view isn't a stored project)", () => {
    openView();
    storage.createProject({ name: 'elsewhere', files: { 'main.tf': MAIN } });
    ls.writes = [];
    win.dispatchEvent(Object.assign(new Event('storage'), { key: storage.PROJECTS_KEY }));
    expect(state().conflict).toBeNull();
    expect(state().saveError).toBeNull();
    expect(store.flushPendingSave()).toBe(true);
    expect(ls.writes).toEqual([]);
  });

  it('opening a stored project afterwards is editable and saves again', () => {
    openView();
    const project = storage.createProject({ name: 'mine', files: { 'main.tf': MAIN } });
    expect(store.loadProjectIntoEditor(project.id)).toBe(true);
    expect(state().readOnly).toBe(false);
    state().onCodeChange('main.tf', `${MAIN}# edited\n`);
    vi.advanceTimersByTime(600);
    expect(storage.getProject(project.id)!.files['main.tf']).toBe(`${MAIN}# edited\n`);
  });
});
