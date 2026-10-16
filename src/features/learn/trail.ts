/**
 * What the map shows for a learner's progress, kept pure so it's testable:
 * each station's state, each level's tally, and the lesson "Continue" opens.
 */
import { getLesson, nextLesson, startLesson } from '@/learn/lessons';
import type { LearnProgress } from '@/learn/progress';
import type { Lesson, Level } from '@/learn/types';

/** not started (opened with nothing met counts as not started), some goals met, or done */
export type StationState = 'todo' | 'progress' | 'done';

export interface Station {
  lesson: Lesson;
  state: StationState;
  /** goals met so far, of `lesson.goals.length` */
  met: number;
  /** XP it gave (done only) */
  xp?: number;
  /** an AWS basics lesson for someone who knows AWS */
  optional: boolean;
}

export function stationOf(lesson: Lesson, progress: Pick<LearnProgress, 'lessons' | 'start'>): Station {
  const p = progress.lessons[lesson.slug];
  const met = Math.min(p?.met.length ?? 0, lesson.goals.length);
  const state: StationState = p?.status === 'done' ? 'done' : met > 0 ? 'progress' : 'todo';
  return { lesson, state, met, xp: state === 'done' ? p?.xp : undefined, optional: progress.start === 'aws' && lesson.awsBasics === true };
}

export function levelTally(level: Level, progress: Pick<LearnProgress, 'lessons'>): { done: number; total: number; xp: number } {
  let done = 0;
  let xp = 0;
  for (const lesson of level.lessons) {
    const p = progress.lessons[lesson.slug];
    if (p?.status !== 'done') continue;
    done++;
    xp += p.xp ?? 0;
  }
  return { done, total: level.lessons.length, xp };
}

/**
 * "Continue where I left off": the last lesson opened, or the one after it
 * once it's done; with nothing opened yet, where "Start here" points.
 */
export function continueLesson(progress: Pick<LearnProgress, 'lessons' | 'start' | 'last'>): Lesson | undefined {
  const last = progress.last ? getLesson(progress.last) : undefined;
  if (!last) return startLesson(progress.start);
  return progress.lessons[last.slug]?.status === 'done' ? (nextLesson(last.slug) ?? last) : last;
}

/* ------------------------------------------------- back on the map after a lesson */

type Seen = Pick<LearnProgress, 'lessons' | 'xp'>;

/** what the map last showed (for as long as the page is open): coming back, what's new since animates */
let seen: { done: Set<string>; xp: number } | null = null;

const doneOf = (progress: Seen) => Object.keys(progress.lessons).filter((slug) => progress.lessons[slug]?.status === 'done');

/** remember what the map shows now; `once`: only if nothing is remembered yet (a lesson opened before the map) */
export function noteMapSeen(progress: Seen, once = false) {
  if (once && seen) return;
  seen = { done: new Set(doneOf(progress)), xp: progress.xp };
}

/** the lessons finished since the map last showed, and the XP it showed then (null: nothing new) */
export function sinceMapSeen(progress: Seen): { fresh: Set<string>; xp: number } | null {
  const before = seen;
  if (!before) return null;
  const fresh = new Set(doneOf(progress).filter((slug) => !before.done.has(slug)));
  return fresh.size > 0 ? { fresh, xp: before.xp } : null;
}
