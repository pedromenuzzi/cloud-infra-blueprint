import { describe, expect, it } from 'vitest';
import { ALL_LESSONS, nextLesson, startLesson } from '@/learn/lessons';
import { emptyProgress, type LessonProgress } from '@/learn/progress';
import type { Lesson, Level } from '@/learn/types';
import { continueLesson, levelTally, stationOf } from './trail';

const goal = (id: string) => ({ id, text: { en: id, pt: id }, hint: { en: id, pt: id }, test: () => false });

function lesson(slug: string, over: Partial<Lesson> = {}): Lesson {
  return {
    slug,
    code: slug,
    kind: 'lesson',
    mode: 'canvas',
    minutes: 5,
    xp: 40,
    title: { en: slug, pt: slug },
    summary: { en: slug, pt: slug },
    body: [],
    start: {},
    solution: {},
    goals: [goal('a'), goal('b'), goal('c')],
    ...over,
  };
}

const withLessons = (lessons: Record<string, LessonProgress>) => ({ ...emptyProgress(), lessons });

describe('a station on the map', () => {
  it('is not started until a goal is met, in progress after, done once finished', () => {
    const l = lesson('x');
    expect(stationOf(l, emptyProgress()).state).toBe('todo');
    // opened, nothing met yet
    expect(stationOf(l, withLessons({ x: { status: 'started', met: [] } })).state).toBe('todo');
    const progress = stationOf(l, withLessons({ x: { status: 'started', met: ['a', 'b'] } }));
    expect([progress.state, progress.met]).toEqual(['progress', 2]);
    const done = stationOf(l, withLessons({ x: { status: 'done', met: ['a', 'b', 'c'], xp: 20, usedSolution: true } }));
    expect([done.state, done.xp]).toEqual(['done', 20]);
  });

  it('marks AWS basics optional only for someone who knows AWS', () => {
    const basics = lesson('x', { awsBasics: true });
    expect(stationOf(basics, { ...emptyProgress(), start: 'aws' }).optional).toBe(true);
    expect(stationOf(basics, { ...emptyProgress(), start: 'new' }).optional).toBe(false);
    expect(stationOf(lesson('y'), { ...emptyProgress(), start: 'aws' }).optional).toBe(false);
  });
});

describe("a level's tally", () => {
  it('counts the lessons done and the XP they gave', () => {
    const level: Level = { id: 'l', index: 0, title: { en: 'L', pt: 'L' }, summary: { en: '', pt: '' }, lessons: [lesson('x'), lesson('y'), lesson('z')] };
    const tally = levelTally(level, withLessons({ x: { status: 'done', met: [], xp: 40 }, y: { status: 'started', met: ['a'] }, z: { status: 'done', met: [], xp: 20 } }));
    expect(tally).toEqual({ done: 2, total: 3, xp: 60 });
  });
});

describe('continue where you left off', () => {
  const first = ALL_LESSONS[0];

  it('starts where "Start here" points when nothing was opened', () => {
    expect(continueLesson(emptyProgress())).toBe(startLesson(null));
    expect(continueLesson({ ...emptyProgress(), start: 'aws' })).toBe(startLesson('aws'));
  });

  it('goes back to the last lesson, or past it once it is done', () => {
    expect(continueLesson({ ...withLessons({ [first.slug]: { status: 'started', met: [] } }), last: first.slug })).toBe(first);
    const done = { ...withLessons({ [first.slug]: { status: 'done', met: [] } }), last: first.slug };
    expect(continueLesson(done)).toBe(nextLesson(first.slug) ?? first);
  });

  it('ignores a lesson that no longer exists', () => {
    expect(continueLesson({ ...emptyProgress(), last: 'gone' })).toBe(startLesson(null));
  });
});
