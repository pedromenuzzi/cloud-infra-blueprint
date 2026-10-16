/**
 * What the map shows for a learner's progress, kept pure so it's testable:
 * each station's state, each level's tally, and the lesson "Continue" opens.
 */
import { getLesson, nextLesson, startLesson } from '@/learn/lessons';
import type { LearnProgress } from '@/learn/progress';
import type { Lesson, Level } from '@/learn/types';
import { safeStorage } from '@/lib/storage';

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

/** what the map last showed, kept in this browser: coming back (after a reload too), what's new since animates once */
const SEEN_KEY = 'cb-learn-seen-v1';

function readSeen(): { done: Set<string>; xp: number } | null {
  try {
    const v = JSON.parse(safeStorage.getItem(SEEN_KEY) ?? 'null') as { done?: unknown; xp?: unknown } | null;
    if (!v || !Array.isArray(v.done) || typeof v.xp !== 'number') return null;
    return { done: new Set(v.done.filter((s): s is string => typeof s === 'string')), xp: v.xp };
  } catch {
    return null;
  }
}

const doneOf = (progress: Seen) => Object.keys(progress.lessons).filter((slug) => progress.lessons[slug]?.status === 'done');

/** remember what the map shows now; `once`: only if nothing is remembered yet (a lesson opened before the map) */
export function noteMapSeen(progress: Seen, once = false) {
  if (once && readSeen()) return;
  const next = JSON.stringify({ done: doneOf(progress), xp: progress.xp });
  if (safeStorage.getItem(SEEN_KEY) !== next) safeStorage.setItem(SEEN_KEY, next);
}

/** the lessons finished since the map last showed, and the XP it showed then (null: nothing new) */
export function sinceMapSeen(progress: Seen): { fresh: Set<string>; xp: number } | null {
  const before = readSeen();
  if (!before) return null;
  const fresh = new Set(doneOf(progress).filter((slug) => !before.done.has(slug)));
  return fresh.size > 0 ? { fresh, xp: before.xp } : null;
}
