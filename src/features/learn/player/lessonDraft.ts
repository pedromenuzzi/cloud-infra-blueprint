/**
 * A lesson's code in the editor. It never becomes a project: the editor
 * store opens it with a sink, so every save lands in the learner's progress
 * as the lesson's draft. "Open in editor" is the one way out, as a copy.
 */
import { flushPendingSave, useEditor } from '@/features/editor/store';
import { currentLocale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { useLearn } from '@/learn/progress';
import { textIn, type Files, type Lesson } from '@/learn/types';
import { createProject, detectProviders, findProjectByOrigin, uniqueProjectName } from '@/lib/storage';
import { playerMessages } from './player.messages';

const EPOCH = new Date(0).toISOString();

/** the editor's id for a lesson's code (never a stored project's: those are `prj_…`) */
export const lessonProjectId = (slug: string) => `lesson:${slug}`;

function openFiles(lesson: Lesson, files: Files) {
  useEditor.getState().load(
    {
      id: lessonProjectId(lesson.slug),
      name: textIn(lesson.title, currentLocale()),
      files,
      providers: detectProviders(files),
      createdAt: EPOCH,
      updatedAt: EPOCH,
    },
    { sink: (next) => useLearn.getState().saveDraft(lesson.slug, next) },
  );
}

/** the lesson's draft (or its starting code) in the editor */
export function openLessonCode(lesson: Lesson) {
  // what's open now saves first: reopening this lesson then reads its latest draft
  flushPendingSave();
  openFiles(lesson, { ...(useLearn.getState().drafts[lesson.slug] ?? lesson.start) });
}

/** back to the starting code: draft, terminal runs and simulated state cleared (completion and XP stay) */
export function resetLessonCode(lesson: Lesson) {
  // loading saves the pending draft before the reset clears it
  openFiles(lesson, { ...lesson.start });
  useLearn.getState().resetLesson(lesson.slug);
}

/**
 * A project made from the lesson's code as it is now, for the editor; an
 * untouched copy made earlier from the same code is reused. Null when
 * storage is full (the storage notice says so).
 */
export function lessonAsProject(lesson: Lesson): string | null {
  flushPendingSave();
  const files = { ...useEditor.getState().files };
  const origin = `lesson:${lesson.slug}`;
  const existing = findProjectByOrigin(origin, files);
  if (existing) return existing.id;
  const title = textIn(lesson.title, currentLocale());
  try {
    return createProject({
      name: uniqueProjectName(title),
      files,
      description: messagesFor(playerMessages).fromLesson(title),
      origin,
    }).id;
  } catch {
    return null;
  }
}
