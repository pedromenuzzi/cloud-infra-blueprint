/**
 * A lesson on screen: the lesson panel on the left (resizable, or collapsed
 * to a slim strip) and the editor on the right; on phones the two are tabs.
 * The goals are checked here, once for both sides, and read out to screen
 * readers as they turn green, wherever the learner is.
 */
import { ArrowLeft, PanelLeftOpen } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import { textIn, type Lesson } from '@/learn/types';
import { cn } from '@/lib/utils';
import { LessonPanel } from './LessonPanel';
import { LessonWorkspace } from './LessonWorkspace';
import { playerMessages } from './player.messages';
import { plain } from './rich';
import { useLiveGoals } from './useLiveGoals';

const PANEL_KEY = 'cb-lesson-panel';
const PANEL_DEFAULT = 380;
const PANEL_MIN = 300;
const PANEL_MAX = 560;
const PHONE = '(max-width: 767px)';

interface PanelPrefs {
  width: number;
  collapsed: boolean;
}

const clampWidth = (px: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, px)));

function readPanel(): PanelPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? 'null') as Partial<PanelPrefs> | null;
    return {
      width: typeof saved?.width === 'number' && Number.isFinite(saved.width) ? clampWidth(saved.width) : PANEL_DEFAULT,
      collapsed: saved?.collapsed === true,
    };
  } catch {
    return { width: PANEL_DEFAULT, collapsed: false };
  }
}

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setMatches(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [query]);
  return matches;
}

/** what to read out when goals turn green (not the ones already met on opening) */
function useGoalNews(lesson: Lesson, met: boolean[]): string {
  const m = useMessages(playerMessages);
  const locale = useLocale((s) => s.locale);
  const [said, setSaid] = useState('');
  const before = useRef(met);
  useEffect(() => {
    const fresh = lesson.goals.filter((_, i) => met[i] && !before.current[i]);
    before.current = met;
    if (fresh.length === 0) return;
    setSaid(met.every(Boolean) ? m.allMet : fresh.map((g) => m.goalMet(plain(textIn(g.text, locale)))).join(' '));
  }, [met, lesson, m, locale]);
  return said;
}

export function LessonPlayer({ lesson }: { lesson: Lesson }) {
  const m = useMessages(playerMessages);
  const locale = useLocale((s) => s.locale);
  const met = useLiveGoals(lesson);
  const said = useGoalNews(lesson, met);
  const phone = useMatches(PHONE);
  const [view, setView] = useState<'lesson' | 'build'>('lesson');
  const [panel, setPanel] = useState(readPanel);
  const uid = useId();
  const count = met.filter(Boolean).length;
  const total = lesson.goals.length;

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(panel));
    } catch {
      /* private mode: the panel still works for this visit */
    }
  }, [panel]);

  // on a phone the finish (XP, next lesson) is on the lesson tab: show it when the last goal turns green
  const allMet = met.every(Boolean);
  const wasAllMet = useRef(allMet);
  useEffect(() => {
    if (allMet && !wasAllMet.current) setView('lesson');
    wasAllMet.current = allMet;
  }, [allMet]);

  const setWidth = (px: number) => setPanel((p) => ({ ...p, width: clampWidth(px) }));
  const collapse = (collapsed: boolean) => {
    setPanel((p) => ({ ...p, collapsed }));
    // keep the keyboard on the control that replaced the one just used
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(collapsed ? '[data-expand-lesson]' : '[data-collapse-lesson]')?.focus(),
    );
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.width;
    const onMove = (ev: PointerEvent) => setWidth(startWidth + ev.clientX - startX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.removeProperty('cursor');
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const collapsed = panel.collapsed && !phone;
  const tabProps = (id: 'lesson' | 'build') =>
    phone ? { role: 'tabpanel', id: `${uid}-${id}`, 'aria-labelledby': `${uid}-${id}-tab`, hidden: view !== id } : {};

  return (
    <div className="flex h-full flex-col">
      {phone ? (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-surface-1 px-2">
          <Link
            to="/learn"
            aria-label={m.backToMap}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div role="tablist" aria-label={m.views} className="flex flex-1 gap-0.5 rounded-[10px] bg-surface-2 p-0.5">
            {(['lesson', 'build'] as const).map((id) => (
              <button
                key={id}
                id={`${uid}-${id}-tab`}
                type="button"
                role="tab"
                aria-selected={view === id}
                aria-controls={`${uid}-${id}`}
                onClick={() => setView(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-[13px] font-semibold transition-colors',
                  view === id ? 'bg-surface-1 text-foreground shadow-xs' : 'text-muted hover:text-foreground',
                )}
              >
                {id === 'lesson' ? m.lessonPanel : m.build}
                {id === 'lesson' ? (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px] tabular-nums',
                      count === total ? 'bg-success/15 text-success' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {count}/{total}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {collapsed ? (
          <button
            key="strip"
            type="button"
            data-expand-lesson
            aria-label={m.expand}
            title={m.expand}
            onClick={() => collapse(false)}
            className="flex w-12 shrink-0 flex-col items-center gap-3 border-r bg-surface-1 py-3 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          >
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
            <span className="rounded-[6px] bg-primary-soft px-1 py-0.5 font-mono text-[11px] text-primary">{lesson.code}</span>
            <GoalRing met={count} total={total} />
            <span className="min-h-0 overflow-hidden text-[11.5px] font-semibold [writing-mode:vertical-rl]">
              {textIn(lesson.title, locale)}
            </span>
          </button>
        ) : (
          <div
            key="panel"
            {...tabProps('lesson')}
            className={cn('min-h-0', phone ? 'flex min-w-0 flex-1' : 'flex max-w-[42vw] shrink-0')}
            style={phone ? undefined : { width: panel.width }}
          >
            <LessonPanel lesson={lesson} met={met} phone={phone} onCollapse={phone ? undefined : () => collapse(true)} />
          </div>
        )}
        {!phone && !collapsed ? (
          <div
            key="resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={m.resize}
            aria-valuemin={PANEL_MIN}
            aria-valuemax={PANEL_MAX}
            aria-valuenow={panel.width}
            tabIndex={0}
            onPointerDown={startResize}
            onDoubleClick={() => setWidth(PANEL_DEFAULT)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
              if (!step) return;
              e.preventDefault();
              setWidth(panel.width + step);
            }}
            className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none active:bg-primary"
          />
        ) : null}
        <div key="build" {...tabProps('build')} className="flex min-h-0 min-w-0 flex-1">
          <LessonWorkspace lesson={lesson} />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="goal-news">
        {said}
      </p>
    </div>
  );
}

/** goals met, as a ring around the count (the collapsed panel's strip) */
function GoalRing({ met, total }: { met: number; total: number }) {
  const r = 13;
  const length = 2 * Math.PI * r;
  return (
    <span className="relative flex h-8 w-8 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" className="stroke-surface-2" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-success transition-[stroke-dashoffset] duration-500"
          strokeDasharray={length}
          strokeDashoffset={total ? length * (1 - met / total) : length}
        />
      </svg>
      <span className="text-[10.5px] font-bold tabular-nums text-foreground">
        {met}/{total}
      </span>
    </span>
  );
}
