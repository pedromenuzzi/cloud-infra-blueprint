import { describe, expect, it } from 'vitest';
import { bestStreakOf, newBadges, rankOf, streakOf } from './gamification';
import { ALL_LEVELS } from './lessons';
import { emptyProgress } from './progress';

describe('streak', () => {
  it('counts days in a row back from today, or from yesterday while today is still open', () => {
    expect(streakOf(['2026-10-13', '2026-10-14', '2026-10-15'], '2026-10-15')).toBe(3);
    expect(streakOf(['2026-10-13', '2026-10-14'], '2026-10-15')).toBe(2);
    expect(streakOf(['2026-10-12', '2026-10-13'], '2026-10-15')).toBe(0);
    expect(streakOf([], '2026-10-15')).toBe(0);
  });

  it('crosses month and year ends', () => {
    expect(streakOf(['2025-12-31', '2026-01-01'], '2026-01-01')).toBe(2);
    expect(streakOf(['2026-02-28', '2026-03-01'], '2026-03-01')).toBe(2);
  });

  it('remembers the best run', () => {
    expect(bestStreakOf(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10'])).toBe(3);
    expect(bestStreakOf([])).toBe(0);
  });
});

describe('ranks', () => {
  it('climbs with XP and reports the way to the next rank', () => {
    expect(rankOf(0).index).toBe(0);
    expect(rankOf(99).index).toBe(0);
    expect(rankOf(100).index).toBe(1);
    expect(rankOf(200).progress).toBeCloseTo(0.5);
    expect(rankOf(1_000_000).next).toBeNull();
  });
});

describe('badges', () => {
  it('awards a command badge once its command ran', () => {
    const progress = { ...emptyProgress(), runs: { 'first-resource': ['init' as const, 'plan' as const] } };
    const ids = newBadges(progress, ALL_LEVELS).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['first-init', 'first-plan']));
    expect(ids).not.toContain('first-apply');
    expect(newBadges({ ...progress, badges: { 'first-init': '2026-10-15' } }, ALL_LEVELS).map((b) => b.id)).not.toContain('first-init');
  });

  it('awards a level badge when every lesson of it is done', () => {
    const level = ALL_LEVELS[0];
    const lessons = Object.fromEntries(level.lessons.map((l) => [l.slug, { status: 'done' as const, met: [] }]));
    expect(newBadges({ ...emptyProgress(), lessons }, ALL_LEVELS).map((b) => b.id)).toContain(`level-${level.id}`);
  });
});
