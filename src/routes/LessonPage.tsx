/**
 * A lesson (/learn/:slug): its code opens in the editor store as the
 * lesson's draft (never a project), the lesson becomes "continue from
 * here", and the player takes the screen. An unknown slug goes back to the
 * map.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { flushPendingSave } from '@/features/editor/store';
import { openLessonCode } from '@/features/learn/player/lessonDraft';
import { LessonPlayer } from '@/features/learn/player/LessonPlayer';
import { useLocale } from '@/i18n/locale';
import { getLesson } from '@/learn/lessons';
import { useLearn } from '@/learn/progress';
import { textIn } from '@/learn/types';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export default function LessonPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const lesson = slug ? getLesson(slug) : undefined;
  const locale = useLocale((s) => s.locale);
  const [opened, setOpened] = useState<string | null>(null);
  useDocumentTitle(lesson ? textIn(lesson.title, locale) : null);

  useEffect(() => {
    if (!lesson) {
      navigate('/learn', { replace: true });
      return;
    }
    openLessonCode(lesson);
    useLearn.getState().openLesson(lesson.slug);
    setOpened(lesson.slug);
  }, [lesson, navigate]);

  // the last keystrokes reach the draft when the lesson closes
  useEffect(() => () => void flushPendingSave(), []);

  // the store holds this lesson's code from the player's first paint on
  if (!lesson || opened !== lesson.slug) return null;
  return <LessonPlayer key={lesson.slug} lesson={lesson} />;
}
