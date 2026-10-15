/**
 * A lesson's draft in the editor: the store loads files whose edits go to a
 * sink (the learning progress) instead of the projects, with undo, canvas
 * ops and code edits working exactly as in a project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLearn } from '@/learn/progress';
import { createProject, listProjects, type Project } from '@/lib/storage';
import { flushPendingSave, useEditor, type FilesSink } from './store';

const START = { 'main.tf': 'provider "aws" {\n  region = "us-east-1"\n}\n' };
const BUCKET = 'resource "aws_s3_bucket" "assets" {\n  bucket = "demo"\n}\n';
const EPOCH = new Date(0).toISOString();

const lesson = (files: Record<string, string>): Project => ({
  id: 'lesson:demo',
  name: 'Demo',
  files,
  providers: [],
  createdAt: EPOCH,
  updatedAt: EPOCH,
});

const state = () => useEditor.getState();
const draft = () => useLearn.getState().drafts.demo;

function openLesson(files = START) {
  const sink = vi.fn<FilesSink>((f) => useLearn.getState().saveDraft('demo', f));
  state().load(lesson(files), { sink });
  return sink;
}

beforeEach(() => {
  vi.useFakeTimers();
  useLearn.getState().resetAll();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('editor store with a sink', () => {
  it('saves code edits to the draft, never to the projects', () => {
    const projects = listProjects().length;
    const sink = openLesson();
    state().onCodeChange('main.tf', START['main.tf'] + BUCKET);
    expect(state().saveState).toBe('saving');
    vi.advanceTimersByTime(600);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(draft()['main.tf']).toContain('aws_s3_bucket');
    expect(state().saveState).toBe('saved');
    expect(state().ir.resources.map((r) => r.id)).toEqual(['aws_s3_bucket.assets']);
    expect(listProjects()).toHaveLength(projects);
  });

  it('canvas ops, undo and redo reach the draft', () => {
    openLesson({ 'main.tf': START['main.tf'] + BUCKET });
    state().applyCanvasOps([{ kind: 'set_arg', nodeId: 'aws_s3_bucket.assets', field: 'bucket', value: { kind: 'literal', value: 'renamed' } }]);
    flushPendingSave();
    expect(draft()['main.tf']).toContain('bucket = "renamed"');

    state().undo();
    flushPendingSave();
    expect(draft()['main.tf']).toContain('"demo"');
    state().redo();
    flushPendingSave();
    expect(draft()['main.tf']).toContain('"renamed"');
  });

  it('replaces every file as one undo step', () => {
    openLesson();
    state().replaceFiles({ 'main.tf': START['main.tf'] + BUCKET });
    expect(state().filesRevision).toBeGreaterThan(0);
    expect(state().ir.resources).toHaveLength(1);
    flushPendingSave();
    expect(draft()['main.tf']).toContain('aws_s3_bucket');

    state().undo();
    expect(state().files).toEqual(START);
    expect(state().ir.resources).toHaveLength(0);
    flushPendingSave();
    expect(draft()).toEqual(START);
  });

  it('flushes the draft before a project replaces it, and the project saves to the projects again', () => {
    const sink = openLesson();
    state().onCodeChange('main.tf', START['main.tf'] + BUCKET);
    const project = createProject({ name: 'after', files: START });
    state().load(project);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(draft()['main.tf']).toContain('aws_s3_bucket');

    state().onCodeChange('main.tf', START['main.tf'] + '# edited\n');
    vi.advanceTimersByTime(600);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(listProjects().find((p) => p.id === project.id)?.files['main.tf']).toContain('# edited');
  });
});
