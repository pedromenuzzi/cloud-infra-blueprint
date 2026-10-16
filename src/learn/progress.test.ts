import { afterEach, describe, expect, it } from 'vitest';
import { localDay } from './gamification';
import { emptyProgress, onLearnEvent, useLearn, type LearnEvent } from './progress';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d);
};

function heard(fn: () => void): LearnEvent[] {
  const events: LearnEvent[] = [];
  const off = onLearnEvent((e) => events.push(e));
  fn();
  off();
  return events;
}

afterEach(() => useLearn.setState(emptyProgress()));

describe('the streak going on', () => {
  it('is announced with the first progress of the day, from two days in a row', () => {
    useLearn.setState({ ...emptyProgress(), days: [daysAgo(2), daysAgo(1)] });
    expect(heard(() => useLearn.getState().noteGoals('a', ['g1']))).toContainEqual({ kind: 'streak', days: 3 });
    // once a day
    expect(heard(() => useLearn.getState().noteGoals('a', ['g2'])).some((e) => e.kind === 'streak')).toBe(false);
  });

  it('is not announced for a first day', () => {
    useLearn.setState({ ...emptyProgress(), days: [daysAgo(3)] });
    expect(heard(() => useLearn.getState().noteGoals('a', ['g1'])).some((e) => e.kind === 'streak')).toBe(false);
  });
});
