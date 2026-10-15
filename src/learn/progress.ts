/**
 * The learner's progress, kept in this browser like the projects (no
 * account): which lessons are started or done, the goals met, each lesson's
 * own code (drafts never show up as projects), the simulated terminal's
 * runs and state, XP, badges and the days with progress (the streak).
 *
 * Every change that earns something is announced through `onLearnEvent`
 * (XP, a new rank, a badge, a finished lesson or level), so the celebration
 * UI lives apart from the lesson player.
 */
import { create } from 'zustand';
import { safeStorage } from '@/lib/storage';
import { localDay, lessonXp, newBadges, rankOf } from './gamification';
import { ALL_LEVELS, getLesson, levelOfLesson } from './lessons';
import type { Files, SimCommand, SimState, StartChoice } from './types';

export const LEARN_KEY = 'cb-learn-v1';

export interface LessonProgress {
  status: 'started' | 'done';
  /** ids of the goals met so far (the best ever: a goal once met stays checked on the map) */
  met: string[];
  /** "Show solution" was used before finishing: the lesson gives half its XP */
  usedSolution?: boolean;
  /** ISO time it was completed */
  doneAt?: string;
  /** XP it gave */
  xp?: number;
}

export interface LearnProgress {
  /** the answer to "Where do you start?" (null: not answered yet) */
  start: StartChoice | null;
  lessons: Record<string, LessonProgress>;
  /** each lesson's code as the learner left it */
  drafts: Record<string, Files>;
  /** terminal commands that ran successfully, per lesson (each listed once) */
  runs: Record<string, SimCommand[]>;
  /** the simulated state per lesson (null after destroy) */
  sims: Record<string, SimState | null>;
  xp: number;
  /** badge id → local day it was earned */
  badges: Record<string, string>;
  /** local days (`YYYY-MM-DD`) with progress, ascending */
  days: string[];
  /** the lesson to continue from */
  last: string | null;
}

export type LearnEvent =
  | { kind: 'xp'; amount: number; total: number }
  | { kind: 'rank'; index: number }
  | { kind: 'badge'; id: string }
  | { kind: 'lesson'; slug: string }
  | { kind: 'level'; id: string };

export const emptyProgress = (): LearnProgress => ({
  start: null,
  lessons: {},
  drafts: {},
  runs: {},
  sims: {},
  xp: 0,
  badges: {},
  days: [],
  last: null,
});

/** a stored or restored value, shape-checked field by field (anything odd falls back to empty) */
export function readProgress(value: unknown): LearnProgress {
  const out = emptyProgress();
  if (!value || typeof value !== 'object') return out;
  const v = value as Partial<LearnProgress>;
  const record = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, never>) : {});
  if (v.start === 'new' || v.start === 'aws') out.start = v.start;
  out.lessons = record(v.lessons);
  out.drafts = record(v.drafts);
  out.runs = record(v.runs);
  out.sims = record(v.sims);
  out.badges = record(v.badges);
  if (typeof v.xp === 'number' && Number.isFinite(v.xp) && v.xp >= 0) out.xp = v.xp;
  if (Array.isArray(v.days)) out.days = v.days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (typeof v.last === 'string') out.last = v.last;
  return out;
}

function load(): LearnProgress {
  try {
    return readProgress(JSON.parse(safeStorage.getItem(LEARN_KEY) ?? 'null'));
  } catch {
    return emptyProgress();
  }
}

const listeners = new Set<(event: LearnEvent) => void>();

/** XP, ranks, badges and completions as they happen; returns the unsubscribe */
export function onLearnEvent(fn: (event: LearnEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const emit = (events: LearnEvent[]) => events.forEach((e) => listeners.forEach((fn) => fn(e)));

interface LearnActions {
  setStart(choice: StartChoice): void;
  /** the learner opened a lesson: it's started and becomes "continue from here" */
  openLesson(slug: string): void;
  saveDraft(slug: string, files: Files): void;
  /** back to the lesson's starting code: draft, runs and simulated state cleared (completion and XP stay) */
  resetLesson(slug: string): void;
  /** a terminal command ran successfully; `state` is what it left (apply / destroy) */
  recordRun(slug: string, command: SimCommand, state?: SimState | null): void;
  /** goals met right now (newly met ones count as progress for the streak) */
  noteGoals(slug: string, met: string[]): void;
  /** "Show solution" before finishing */
  revealSolution(slug: string): void;
  /** every goal met: XP, badges, level; does nothing the second time */
  completeLesson(slug: string): void;
  /** forget everything (the map's "Reset progress") */
  resetAll(): void;
  /** a restored backup's progress replaces this browser's */
  replace(progress: LearnProgress): void;
}

export const useLearn = create<LearnProgress & LearnActions>((set, get) => {
  const data = (): LearnProgress => {
    const { start, lessons, drafts, runs, sims, xp, badges, days, last } = get();
    return { start, lessons, drafts, runs, sims, xp, badges, days, last };
  };

  /** apply a change, award what it earned, persist, then announce */
  const commit = (patch: Partial<LearnProgress>, events: LearnEvent[] = []) => {
    const before = data();
    let next: LearnProgress = { ...before, ...patch };
    const earned = newBadges(next, ALL_LEVELS);
    if (earned.length > 0) {
      const today = localDay();
      next = { ...next, badges: { ...next.badges, ...Object.fromEntries(earned.map((b) => [b.id, today])) } };
      events.push(...earned.map((b) => ({ kind: 'badge', id: b.id }) as const));
    }
    const rankBefore = rankOf(before.xp).index;
    const rankAfter = rankOf(next.xp).index;
    if (rankAfter > rankBefore) events.push({ kind: 'rank', index: rankAfter });
    set(next);
    safeStorage.setItem(LEARN_KEY, JSON.stringify(next));
    emit(events);
  };

  /** today counts for the streak */
  const withToday = (days: string[]) => {
    const today = localDay();
    return days.includes(today) ? days : [...days, today].sort().slice(-400);
  };

  return {
    ...load(),

    setStart: (start) => commit({ start }),

    openLesson(slug) {
      const lessons = get().lessons;
      commit({
        last: slug,
        lessons: lessons[slug] ? lessons : { ...lessons, [slug]: { status: 'started', met: [] } },
      });
    },

    saveDraft: (slug, files) => commit({ drafts: { ...get().drafts, [slug]: files } }),

    resetLesson(slug) {
      const { drafts, runs, sims } = get();
      const without = <V>(r: Record<string, V>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== slug));
      commit({ drafts: without(drafts), runs: without(runs), sims: without(sims) });
    },

    recordRun(slug, command, state) {
      const { runs, sims, days } = get();
      const done = runs[slug] ?? [];
      commit({
        runs: done.includes(command) ? runs : { ...runs, [slug]: [...done, command] },
        sims: state === undefined ? sims : { ...sims, [slug]: state },
        days: withToday(days),
      });
    },

    noteGoals(slug, met) {
      const { lessons, days } = get();
      const current = lessons[slug] ?? { status: 'started', met: [] };
      const fresh = met.filter((id) => !current.met.includes(id));
      if (fresh.length === 0) return;
      commit({
        lessons: { ...lessons, [slug]: { ...current, met: [...current.met, ...fresh] } },
        days: withToday(days),
      });
    },

    revealSolution(slug) {
      const { lessons } = get();
      const current = lessons[slug] ?? { status: 'started', met: [] };
      if (current.status === 'done' || current.usedSolution) return;
      commit({ lessons: { ...lessons, [slug]: { ...current, usedSolution: true } } });
    },

    completeLesson(slug) {
      const lesson = getLesson(slug);
      const { lessons, xp, days } = get();
      const current = lessons[slug] ?? { status: 'started', met: [] };
      if (!lesson || current.status === 'done') return;
      const gained = lessonXp(lesson, current.usedSolution === true);
      const nextLessons = {
        ...lessons,
        [slug]: { ...current, status: 'done' as const, met: lesson.goals.map((g) => g.id), doneAt: new Date().toISOString(), xp: gained },
      };
      const events: LearnEvent[] = [
        { kind: 'lesson', slug },
        { kind: 'xp', amount: gained, total: xp + gained },
      ];
      const level = levelOfLesson(slug);
      if (level?.lessons.every((l) => nextLessons[l.slug]?.status === 'done')) events.push({ kind: 'level', id: level.id });
      commit({ lessons: nextLessons, xp: xp + gained, days: withToday(days) }, events);
    },

    resetAll: () => commit(emptyProgress()),

    replace: (progress) => commit(readProgress(progress)),
  };
});

/** the stored progress, for the backup */
export const learnSnapshot = (): LearnProgress => {
  const { start, lessons, drafts, runs, sims, xp, badges, days, last } = useLearn.getState();
  return { start, lessons, drafts, runs, sims, xp, badges, days, last };
};

if (typeof window !== 'undefined') {
  // another tab learned something: show it here too
  window.addEventListener('storage', (e) => {
    if (e.key === LEARN_KEY) useLearn.setState(load());
  });
}
