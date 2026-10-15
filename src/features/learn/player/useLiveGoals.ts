/**
 * A lesson's goals, checked live against the code in the editor: once
 * typing or a canvas edit settles, and whenever the simulated terminal runs.
 * Goals met are noted in the progress, and all of them complete the lesson
 * (XP, badges and celebrations follow from `completeLesson`).
 */
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/features/editor/store';
import { checkGoals, lessonContext } from '@/learn/goals';
import { useLearn } from '@/learn/progress';
import type { Lesson } from '@/learn/types';

const SETTLE_MS = 300;

function evaluate(lesson: Lesson): boolean[] {
  const { runs, sims } = useLearn.getState();
  const ctx = lessonContext(useEditor.getState().files, { ran: runs[lesson.slug], state: sims[lesson.slug] });
  return checkGoals(lesson.goals, ctx);
}

const same = (a: boolean[], b: boolean[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** each goal's state, in order (the editor store must hold this lesson's code) */
export function useLiveGoals(lesson: Lesson): boolean[] {
  const [met, setMet] = useState(() => evaluate(lesson));

  // subscribed, not selected: a keystroke re-renders nothing until a goal changes
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = evaluate(lesson);
        setMet((prev) => (same(prev, next) ? prev : next));
      }, SETTLE_MS);
    };
    const offCode = useEditor.subscribe((s, prev) => {
      if (s.files !== prev.files) settle();
    });
    const offTerminal = useLearn.subscribe((s, prev) => {
      if (s.runs[lesson.slug] !== prev.runs[lesson.slug] || s.sims[lesson.slug] !== prev.sims[lesson.slug]) settle();
    });
    settle();
    return () => {
      clearTimeout(timer);
      offCode();
      offTerminal();
    };
  }, [lesson]);

  const completed = useRef(false);
  useEffect(() => {
    const ids = lesson.goals.filter((_, i) => met[i]).map((g) => g.id);
    if (ids.length > 0) useLearn.getState().noteGoals(lesson.slug, ids);
    if (met.length > 0 && met.every(Boolean) && !completed.current) {
      completed.current = true;
      useLearn.getState().completeLesson(lesson.slug);
    }
  }, [met, lesson]);

  return met;
}
