import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, useEditor } from '@/features/editor/store';
import { getLesson } from '@/learn/lessons';
import { useLearn } from '@/learn/progress';
import { getProject, listProjects } from '@/lib/storage';
import { lessonAsProject, lessonProjectId, openLessonCode, resetLessonCode } from './lessonDraft';

const lesson = getLesson('first-resource')!;
const BUCKET = 'resource "aws_s3_bucket" "b" {\n  bucket = "x"\n}\n';
const typed = () => `${lesson.start['main.tf']}\n${BUCKET}`;

beforeEach(() => {
  vi.useFakeTimers();
  useLearn.getState().resetAll();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('a lesson in the editor', () => {
  it('opens the starting code, then the draft it saved', () => {
    const projects = listProjects().length;
    openLessonCode(lesson);
    expect(useEditor.getState().projectId).toBe(lessonProjectId(lesson.slug));
    expect(useEditor.getState().files).toEqual(lesson.start);

    useEditor.getState().onCodeChange('main.tf', typed());
    // reopening stores the pending edit first, then reads it back
    openLessonCode(lesson);
    expect(useLearn.getState().drafts[lesson.slug]?.['main.tf']).toBe(typed());
    expect(useEditor.getState().files['main.tf']).toBe(typed());
    expect(listProjects()).toHaveLength(projects);
  });

  it('resets to the start, clearing the draft and the terminal', () => {
    openLessonCode(lesson);
    useLearn.getState().recordRun(lesson.slug, 'init');
    useEditor.getState().onCodeChange('main.tf', typed());
    resetLessonCode(lesson);
    flushPendingSave();
    expect(useEditor.getState().files).toEqual(lesson.start);
    expect(useLearn.getState().drafts[lesson.slug]).toBeUndefined();
    expect(useLearn.getState().runs[lesson.slug]).toBeUndefined();
  });

  it('opens a copy in the editor once per version of the code', () => {
    openLessonCode(lesson);
    useEditor.getState().onCodeChange('main.tf', typed());
    const id = lessonAsProject(lesson)!;
    expect(getProject(id)).toMatchObject({ origin: 'lesson:first-resource', files: { 'main.tf': typed() } });
    expect(lessonAsProject(lesson)).toBe(id);

    useEditor.getState().onCodeChange('main.tf', `${typed()}# more\n`);
    expect(lessonAsProject(lesson)).not.toBe(id);
  });
});
