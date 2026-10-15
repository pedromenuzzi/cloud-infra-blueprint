/**
 * Every lesson keeps its promises: its starting code doesn't already pass,
 * its solution passes every goal and parses cleanly (CI also runs
 * `terraform validate` on it), and its text exists in both languages with
 * the same code spans and no dash as punctuation.
 */
import { describe, expect, it } from 'vitest';
import { sentenceDash } from '@/i18n/dashes';
import { readLocalModule } from '@/ir/localModules';
import { dirOfPath } from '@/ir/modules';
import { getDef } from '@/resources/registry';
import { checkGoals, lessonContext } from './goals';
import { ALL_LESSONS, ALL_LEVELS, TRACKS, startLesson } from './lessons';
import { simulate } from './sim/simulate';
import type { SimCommand, SimState, T } from './types';

const EVERY_COMMAND: SimCommand[] = ['init', 'validate', 'plan', 'apply', 'destroy'];

/** what the simulated terminal leaves after `terraform init` and `terraform apply` on the code */
function appliedState(files: Record<string, string>): SimState {
  const out = (r: { lines: Array<{ text: string }> }) => r.lines.map((l) => l.text).join('\n');
  const init = simulate('init', files, null, { initialized: false });
  expect(init.ok, out(init)).toBe(true);
  const apply = simulate('apply', files, null, { initialized: true, autoApprove: true });
  expect(apply.ok, out(apply)).toBe(true);
  return apply.state!;
}

/** every bilingual text inside a value */
function texts(value: unknown, out: T[] = []): T[] {
  if (Array.isArray(value)) value.forEach((v) => texts(v, out));
  else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 2 && keys.includes('en') && keys.includes('pt')) out.push(value as T);
    else Object.values(value).forEach((v) => texts(v, out));
  }
  return out;
}

/** module folders of a lesson whose code doesn't parse (the root is checked through the lesson context) */
const brokenModules = (files: Record<string, string>): string[] =>
  [...new Set(Object.keys(files).map(dirOfPath))].filter((dir) => dir !== '' && readLocalModule(files, dir)?.broken);

const codeSpans = (s: string) => s.split('`').filter((_, i) => i % 2 === 1);

describe('learning map structure', () => {
  it('has unique slugs, level ids and goal ids', () => {
    const slugs = ALL_LESSONS.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const levels = ALL_LEVELS.map((l) => l.id);
    expect(new Set(levels).size).toBe(levels.length);
    for (const lesson of ALL_LESSONS) {
      const ids = lesson.goals.map((g) => g.id);
      expect(new Set(ids).size, lesson.slug).toBe(ids.length);
    }
  });

  it('has unique station codes within each track', () => {
    for (const track of TRACKS) {
      const codes = track.levels.flatMap((l) => l.lessons.map((x) => x.code));
      expect(new Set(codes).size, track.id).toBe(codes.length);
    }
  });

  it('points "Start here" at a lesson for both answers', () => {
    expect(startLesson('new')).toBeDefined();
    expect(startLesson('aws')).toBeDefined();
  });

  it('level texts are bilingual', () => {
    for (const t of texts(TRACKS.map((tr) => ({ title: tr.title, levels: tr.levels.map((l) => [l.title, l.summary]) })))) {
      expect(t.en.trim(), JSON.stringify(t)).not.toBe('');
      expect(t.pt.trim(), JSON.stringify(t)).not.toBe('');
    }
  });
});

describe.each(ALL_LESSONS.map((l) => [l.slug, l] as const))('lesson %s', (_slug, lesson) => {
  it('is well formed', () => {
    expect(lesson.goals.length).toBeGreaterThan(0);
    expect(lesson.minutes).toBeGreaterThan(0);
    expect(lesson.xp).toBeGreaterThan(0);
    expect(lesson.body.length).toBeGreaterThan(0);
    for (const type of lesson.teaches ?? []) expect(getDef(type), type).toBeDefined();
  });

  it('starts with code that parses and does not pass yet', () => {
    const ctx = lessonContext(lesson.start);
    expect(ctx.errored).toBe(false);
    expect(brokenModules(lesson.start)).toEqual([]);
    expect(checkGoals(lesson.goals, ctx).every(Boolean)).toBe(false);
  });

  it('is solved by its solution', () => {
    const ctx = lessonContext(lesson.solution, { ran: EVERY_COMMAND, state: appliedState(lesson.solution) });
    expect(ctx.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(brokenModules(lesson.solution)).toEqual([]);
    const results = checkGoals(lesson.goals, ctx);
    const failing = lesson.goals.filter((_, i) => !results[i]).map((g) => g.id);
    expect(failing).toEqual([]);
  });

  it('reads the same in both languages', () => {
    for (const t of texts(lesson)) {
      expect(t.en.trim(), JSON.stringify(t)).not.toBe('');
      expect(t.pt.trim(), JSON.stringify(t)).not.toBe('');
      expect(codeSpans(t.pt), t.pt).toEqual(codeSpans(t.en));
      expect(sentenceDash(t.en), t.en).toBeNull();
      expect(sentenceDash(t.pt), t.pt).toBeNull();
    }
  });
});
