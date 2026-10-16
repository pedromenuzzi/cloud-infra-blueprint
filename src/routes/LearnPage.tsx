/**
 * The learning map (/learn): the learner's card (rank, XP, streak, badges),
 * "Where do you start?", the trail of lessons level by level, and the badge
 * shelf. Each level is an island whose trail winds through its lessons to
 * the level's badge; underneath it is an ordered list, which is also what
 * phones and screen readers get.
 */
import { ArrowRight, Award, Check, ChevronDown, Cloud, Flame, Play, RotateCcw, Sprout, Swords, Trophy } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { AppRail } from '@/components/AppRail';
import { confirmAction } from '@/components/Confirm';
import { richText } from '@/components/RichText';
import { showToast } from '@/components/Toast';
import { Button, buttonClass } from '@/components/ui';
import { BadgeMedal, badgeHue, levelHue, RankMedal } from '@/features/learn/medals';
import { continueLesson, levelTally, noteMapSeen, sinceMapSeen, stationOf, type Station } from '@/features/learn/trail';
import { formatDate } from '@/i18n/format';
import { useLocale } from '@/i18n/locale';
import { messagesFor, useMessages } from '@/i18n/messages';
import { allBadges, bestStreakOf, levelBadge, localDay, rankOf, streakOf } from '@/learn/gamification';
import { ALL_LESSONS, ALL_LEVELS, startLesson, TRACKS } from '@/learn/lessons';
import { useLearn, type LearnProgress } from '@/learn/progress';
import { textIn, type Level, type StartChoice, type T, type Track } from '@/learn/types';
import { scrollBehavior } from '@/lib/motion';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { cn } from '@/lib/utils';
import { learnMessages } from './LearnPage.messages';

/** the text in the UI language */
function useText() {
  const locale = useLocale((s) => s.locale);
  return (t: T) => textIn(t, locale);
}

/* ------------------------------------------------------------ player card */

function PlayerCard({ progress, since }: { progress: LearnProgress; since: Since }) {
  const m = useMessages(learnMessages);
  const t = useText();
  const headingId = useId();
  const { index, rank, next, progress: toNext } = rankOf(progress.xp);
  const streak = streakOf(progress.days);
  const best = bestStreakOf(progress.days);
  const today = progress.days.includes(localDay());
  const badges = allBadges(ALL_LEVELS);
  const earned = badges.filter((b) => progress.badges[b.id]).length;
  const done = ALL_LESSONS.filter((l) => progress.lessons[l.slug]?.status === 'done').length;
  const nextText = next ? m.toNextRank(next.xp - progress.xp, t(next.title)) : m.topRank;
  // back from a lesson: the bar fills from where it was (from empty after a new rank)
  const before = since ? rankOf(since.xp) : null;
  const grown = useGrown(toNext, before ? (before.index === index ? before.progress : 0) : undefined);

  return (
    <section aria-labelledby={headingId} className="rounded-[20px] border bg-surface-1/90 p-5 shadow-md backdrop-blur" data-testid="player-card">
      <h2 id={headingId} className="sr-only">
        {m.yourProgress}
      </h2>
      {/* side by side while the card spans the hero (tablets), stacked beside it on wide screens */}
      <div className="sm:grid sm:grid-cols-2 sm:gap-x-8 lg:block">
      <div>
      <div className="flex items-center gap-4">
        <RankMedal index={index} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">{m.rank}</p>
          <p className="truncate text-[20px] font-bold leading-tight tracking-[-0.02em]">{t(rank.title)}</p>
          <p className="text-[12.5px] font-semibold tabular-nums text-muted">{m.totalXp(progress.xp)}</p>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={m.rankProgress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(toNext * 100)}
        aria-valuetext={nextText}
        className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#6366f1] via-[#2563eb] to-[#06b6d4] transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(3, grown * 100)}%`, transitionDelay: since ? '450ms' : undefined }}
        />
      </div>
      <p className="mt-1.5 text-[12px] text-muted">{nextText}</p>
      </div>

      <div className="mt-4 border-t pt-4 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0 lg:mt-4 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]',
            streak > 0 ? 'bg-gradient-to-br from-[#fbbf24] to-[#ea580c] text-white shadow-sm' : 'bg-surface-2 text-faint',
            streak > 0 && !today && 'opacity-70',
          )}
        >
          <Flame className="h-5 w-5" fill={streak > 0 ? 'currentColor' : 'none'} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">{m.streak}</p>
          <p className="text-[15px] font-bold tabular-nums">{m.days(streak)}</p>
          <p className="text-[11.5px] text-muted">{today ? m.streakToday : streak > 0 ? m.streakKeep(streak + 1) : m.streakStart}</p>
        </div>
        {best > 0 ? <p className="shrink-0 self-start text-[11.5px] font-semibold tabular-nums text-muted">{m.bestStreak(best)}</p> : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-3">
        <Stat label={m.badges} icon={<Award className="h-4 w-4 text-[#d97706]" />} value={m.countOf(earned, badges.length)} />
        <Stat label={m.lessons} icon={<Check className="h-4 w-4 text-success" />} value={m.countOf(done, ALL_LESSONS.length)} />
      </dl>
      </div>
      </div>
    </section>
  );
}

function Stat({ label, icon, value }: { label: string; icon: ReactNode; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-[14px] font-bold tabular-nums">
        <span aria-hidden="true">{icon}</span>
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------ where do you start */

const CHOICES: Array<{ id: StartChoice; icon: typeof Sprout }> = [
  { id: 'new', icon: Sprout },
  { id: 'aws', icon: Cloud },
];

/**
 * A pair of radios: on a first visit, big cards that are the page's one first step (with a quiet way
 * straight into the first lesson, the map right below never blocked), then a compact switch.
 */
function StartQuestion({ start, first, dive }: { start: StartChoice | null; first: boolean; dive?: { slug: string; label: string } }) {
  const m = useMessages(learnMessages);
  const name = useId();
  const headingId = useId();
  const setStart = useLearn((s) => s.setStart);
  const text = { new: [m.startNew, m.startNewHint], aws: [m.startAws, m.startAwsHint] } as const;
  // answering swaps the cards for the compact switch: focus follows to the same choice there
  const compact = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    compact.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, [start]);

  if (first) {
    return (
      <div className="mt-6 rounded-[18px] border border-primary/30 bg-primary-soft/70 p-4 shadow-sm sm:p-5" data-testid="start-question">
        <div role="radiogroup" aria-labelledby={headingId}>
          <h2 id={headingId} className="text-[16px] font-semibold">
            {m.whereStart}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">{m.whereStartHint}</p>
          <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
            {CHOICES.map(({ id, icon: Icon }) => (
              <label
                key={id}
                className="group flex cursor-pointer gap-3 rounded-[14px] border bg-surface-1 p-3.5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
              >
                <input
                  type="radio"
                  name={name}
                  value={id}
                  className="sr-only"
                  onChange={() => {
                    refocus.current = true;
                    setStart(id);
                  }}
                />
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-snug">{text[id][0]}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted">{text[id][1]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {/* not a gate: anyone can go straight in (or pick any lesson on the map below) */}
        {dive ? (
          <p className="mt-3.5 text-[12.5px] text-muted">
            {m.dive}{' '}
            <Link
              to={`/learn/${dive.slug}`}
              className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {dive.label}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id={headingId} className="text-[12.5px] font-medium text-muted">
        {m.whereStart}
      </span>
      <div
        ref={compact}
        role="radiogroup"
        aria-labelledby={headingId}
        className="flex max-w-full flex-wrap rounded-[10px] border bg-surface-1 p-0.5 shadow-xs"
      >
        {CHOICES.map(({ id, icon: Icon }) => (
          <label
            key={id}
            title={text[id][1]}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary',
              start === id ? 'bg-primary-soft text-primary' : 'text-muted hover:text-foreground',
            )}
          >
            <input type="radio" name={name} value={id} checked={start === id} className="sr-only" onChange={() => setStart(id)} />
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {text[id][0]}
          </label>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the trail */

/** the wave the stations ride on, as multiples of the amplitude */
const WAVE = [1, 2, 1, 0];
/** narrower than this per station, a level's trail turns back in a new row (a switchback) */
const MIN_COL = 128;
const MIN_COL_SMALL = 120;

/** what changed since the map last showed: the lessons just finished, and the XP shown then */
type Since = ReturnType<typeof sinceMapSeen>;

function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-full px-1.5 py-px text-[10px] font-bold uppercase leading-[15px] tracking-[0.06em]', className)}>
      {children}
    </span>
  );
}

/** `target`, reached from `from` with the CSS transition once it has painted (no `from`: at once) */
function useGrown(target: number, from: number | undefined): number {
  const [value, setValue] = useState(from ?? target);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setValue(target));
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function StationNode({ station, pulse, pop }: { station: Station; pulse: boolean; pop: boolean }) {
  const { lesson, state, met, optional } = station;
  const challenge = lesson.kind === 'challenge';
  const ratio = lesson.goals.length ? met / lesson.goals.length : 0;
  return (
    <span aria-hidden="true" data-node="" className="relative flex h-10 w-10 shrink-0 items-center justify-center md:h-[var(--node)] md:w-[var(--node)]">
      {pulse ? (
        <span className={cn('bp-pulse-ring absolute inset-0 border-2 border-[color:var(--lv)]', challenge ? 'rotate-45 scale-75 rounded-[10px]' : 'rounded-full')} />
      ) : null}
      <span
        className={cn(
          'relative flex items-center justify-center transition-transform duration-200 group-hover:scale-110',
          challenge ? 'h-[76%] w-[76%] rotate-45 rounded-[10px]' : 'h-full w-full rounded-full',
          state === 'done'
            ? 'bp-medal'
            : cn(
                'border-2 bg-surface-1 shadow-xs',
                state === 'progress' && challenge ? 'border-[color:var(--lv)]' : 'border-border-strong',
                optional && state === 'todo' && 'border-dashed',
              ),
        )}
      >
        {state === 'progress' && !challenge ? (
          <svg viewBox="0 0 36 36" className="absolute -inset-[2px] h-[calc(100%+4px)] w-[calc(100%+4px)] -rotate-90">
            <circle cx="18" cy="18" r="17" fill="none" stroke="var(--lv)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={`${Math.max(ratio, 0.04) * 106.8} 106.8`} />
          </svg>
        ) : null}
        {/* just finished: the medal pops in as the map comes back into view */}
        <span className={cn('flex items-center justify-center', challenge && '-rotate-45', pop && 'bp-medal-pop [animation-delay:400ms]')}>
          {state === 'done' ? (
            challenge ? <Trophy className="h-4 w-4 md:h-[18px] md:w-[18px]" /> : <Check className="h-4 w-4 md:h-5 md:w-5" strokeWidth={2.6} />
          ) : challenge ? (
            <Swords className="h-4 w-4 text-[color:var(--lv-text)]" />
          ) : (
            <span className={cn('font-mono text-[11px] font-bold md:text-[12px]', state === 'progress' ? 'text-[color:var(--lv-text)]' : 'text-muted')}>
              {lesson.code}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

/** a station's cell in the trail's grid on wide screens (the rows after the first turn back) */
interface Cell {
  row: number;
  col: number;
  /** where along its row (in walking order) */
  step: number;
}

function StationItem({
  station,
  cell,
  wave,
  marker,
  pulse,
  pop,
  align,
}: {
  station: Station;
  cell: Cell;
  wave: number;
  marker: string | null;
  pulse: boolean;
  pop: boolean;
  /** where the summary card sits on wide screens (the first and last columns keep it inside the page) */
  align: 'start' | 'center' | 'end';
}) {
  const m = useMessages(learnMessages);
  const t = useText();
  const summaryId = useId();
  const { lesson, state, met, xp, optional } = station;
  const challenge = lesson.kind === 'challenge';
  const title = t(lesson.title);
  const stateText = state === 'done' ? m.doneXp(xp ?? 0) : state === 'progress' ? m.inProgress(met, lesson.goals.length) : m.notStarted;
  const label = [
    `${lesson.code} ${title}`,
    challenge ? m.challenge : '',
    marker ?? '',
    optional ? m.optional : '',
    stateText,
    `${m.minutes(lesson.minutes)}, ${m.xp(lesson.xp)}`,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <li
      data-station={lesson.code}
      data-state={state}
      className={cn(
        'relative pb-5 md:pb-0',
        // the trail on a phone: a line down to the next station (the last one leads to the badge)
        "before:absolute before:bottom-1 before:left-[19px] before:top-11 before:border-l-2 before:content-[''] md:before:hidden",
        state === 'done' ? 'before:border-[color:var(--lv)]' : 'before:border-dashed before:border-border-strong',
      )}
      style={{ '--wave': `${wave}px`, gridRow: cell.row + 1, gridColumn: cell.col + 1 } as CSSProperties}
    >
      <Link
        to={`/learn/${lesson.slug}`}
        aria-label={label}
        aria-describedby={summaryId}
        className={cn(
          'group relative flex items-start gap-3.5 rounded-[14px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary',
          'md:flex-col md:items-center md:gap-2 md:px-1 md:pt-[calc(34px+var(--wave))] md:text-center',
          optional && state !== 'done' && 'opacity-80',
        )}
      >
        {marker ? (
          <span
            aria-hidden="true"
            className="bp-bob absolute left-1/2 top-[calc(var(--wave)+2px)] hidden -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-bold text-primary-fg shadow-md md:flex"
          >
            {marker}
            <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-primary" />
          </span>
        ) : null}
        <StationNode station={station} pulse={pulse} pop={pop} />
        <span
          className={cn(
            'min-w-0 flex-1 md:w-full md:flex-none md:pt-0',
            // no tag row: the title lines up with the middle of the node
            state === 'done' || challenge || optional || marker ? 'pt-0.5' : 'pt-2.5',
          )}
        >
          <span className="flex flex-wrap items-center gap-1.5 empty:hidden md:justify-center">
            {/* the node already shows the code of a lesson not done yet */}
            {state === 'done' || challenge ? (
              <span className="font-mono text-[11px] font-bold text-[color:var(--lv-text)]">{lesson.code}</span>
            ) : null}
            {challenge ? <Tag className="bg-[color-mix(in_srgb,var(--lv)_14%,transparent)] text-[color:var(--lv-text)]">{m.challenge}</Tag> : null}
            {optional ? <Tag className="bg-surface-2 text-muted">{m.optional}</Tag> : null}
            {marker ? <Tag className="bg-primary text-primary-fg md:hidden">{marker}</Tag> : null}
          </span>
          <span className="mt-0.5 block text-[13.5px] font-semibold leading-snug text-foreground md:line-clamp-2 md:text-[13px]">{title}</span>
          <span
            id={summaryId}
            className={cn(
              'mt-0.5 block text-[12.5px] leading-snug text-muted',
              // a phone's list stays short: a lesson already done keeps its summary for screen readers only
              state === 'done' && 'max-md:sr-only',
              // wide screens: a card that shows on hover and keyboard focus
              'md:pointer-events-none md:invisible md:absolute md:top-full md:z-20 md:mt-2 md:w-56 md:rounded-[12px] md:border md:bg-surface-1 md:p-3 md:text-left md:text-[12px] md:opacity-0 md:shadow-lg md:transition-opacity md:group-hover:visible md:group-hover:opacity-100 md:group-focus-visible:visible md:group-focus-visible:opacity-100',
              align === 'start' ? 'md:left-0' : align === 'end' ? 'md:right-0' : 'md:left-1/2 md:-translate-x-1/2',
            )}
          >
            {richText(t(lesson.summary), 'font-mono text-[11px]')}
          </span>
          <span className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-faint md:justify-center">
            <span>{m.minutes(lesson.minutes)}</span>
            <span aria-hidden="true">·</span>
            {state === 'done' ? (
              <span className="font-semibold text-success">{m.earned(xp ?? 0)}</span>
            ) : (
              <span>{m.xp(lesson.xp)}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** the middle of each station's node (and the badge's), measured in `box`, which they're laid out in */
function useNodeCenters(box: RefObject<HTMLElement | null>, layout: string): Array<{ x: number; y: number }> {
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const next = Array.from(el.querySelectorAll('[data-node]'), (node) => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.left - base.left + r.width / 2), y: Math.round(r.top - base.top + r.height / 2) };
      });
      setPoints((prev) => (prev.length === next.length && prev.every((p, i) => p.x === next[i].x && p.y === next[i].y) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [box, layout]);
  return points;
}

/** the width `ref` has to offer (followed as it resizes; 0 before the first layout) */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setWidth(el.clientWidth);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function Trail({
  level,
  stations,
  earned,
  startSlug,
  hereSlug,
  fresh,
  small,
}: {
  level: Level;
  stations: Station[];
  earned: boolean;
  startSlug?: string;
  hereSlug?: string;
  /** lessons just finished: their medal pops and the stretch after them draws itself in */
  fresh?: Set<string>;
  small?: boolean;
}) {
  const m = useMessages(learnMessages);
  const t = useText();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const node = small ? 44 : 52;
  const amp = small ? 12 : 22;
  // the lessons, then the level's badge at the end of the trail, in as many rows as the width needs
  const count = stations.length + 1;
  const width = useWidth(outer);
  const fit = width > 0 ? Math.max(3, Math.floor(width / (small ? MIN_COL_SMALL : MIN_COL))) : count;
  const rows = Math.ceil(count / fit);
  const perRow = Math.ceil(count / rows);
  const cell = (i: number): Cell => {
    const row = Math.floor(i / perRow);
    const step = i % perRow;
    return { row, step, col: row % 2 === 1 ? perRow - 1 - step : step };
  };
  const align = (c: Cell) => (c.col === 0 ? 'start' : c.col === perRow - 1 ? 'end' : 'center');
  const points = useNodeCenters(inner, `${perRow}`);
  const maxWidth = small ? 'md:max-w-[calc(var(--cols)*170px)]' : 'md:max-w-[calc(var(--cols)*210px)]';
  const badge = cell(count - 1);
  const badgePop = earned && !!fresh && stations.some((s) => fresh.has(s.lesson.slug));

  /** the path from one node to the next: a wave along a row, a U where the trail turns into the next row */
  const path = (i: number) => {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) return null;
    if (cell(i).row === cell(i + 1).row) {
      const mid = (a.x + b.x) / 2;
      return `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
    }
    const colWidth = (inner.current?.clientWidth ?? 0) / perRow;
    const out = Math.min((b.y - a.y) * 0.6, colWidth / 2 + 12) * (cell(i).col === perRow - 1 ? 1 : -1);
    return `M${a.x} ${a.y} C${a.x + out} ${a.y} ${b.x + out} ${b.y} ${b.x} ${b.y}`;
  };

  return (
    <div ref={outer} className="mt-5 md:mt-3" style={{ '--cols': perRow, '--node': `${node}px` } as CSSProperties}>
      <div ref={inner} className={cn('relative', maxWidth)}>
        <svg aria-hidden="true" data-trail="" className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible md:block">
          {stations.map((station, i) => {
            const d = path(i);
            if (!d) return null;
            const dashed = (
              <path d={d} fill="none" stroke="var(--border-strong)" strokeWidth={3} strokeDasharray="0.5 9" strokeLinecap="round" />
            );
            // walked once the station it leaves from is done
            if (station.state !== 'done') return <g key={station.lesson.slug}>{dashed}</g>;
            const drawn = fresh?.has(station.lesson.slug) ? { pathLength: 1, className: 'bp-trail-draw' } : {};
            return (
              <g key={station.lesson.slug}>
                {drawn.className ? dashed : null}
                <path d={d} fill="none" stroke="var(--lv)" strokeOpacity={0.16} strokeWidth={12} strokeLinecap="round" {...drawn} />
                <path d={d} fill="none" stroke="var(--lv)" strokeWidth={3.5} strokeLinecap="round" {...drawn} />
              </g>
            );
          })}
        </svg>
        <ol className="relative md:grid md:grid-cols-[repeat(var(--cols),minmax(0,1fr))] md:gap-y-7">
          {stations.map((station, i) => {
            const isStart = station.lesson.slug === startSlug && station.state !== 'done';
            const isHere = station.lesson.slug === hereSlug && station.state !== 'done';
            const c = cell(i);
            return (
              <StationItem
                key={station.lesson.slug}
                station={station}
                cell={c}
                wave={WAVE[c.step % 4] * amp}
                marker={isStart ? m.startHere : isHere ? m.youAreHere : null}
                pulse={isStart || isHere}
                pop={fresh?.has(station.lesson.slug) === true}
                align={align(c)}
              />
            );
          })}
          {/* the reward at the end of the trail; its state is read out in the level's header */}
          <li
            aria-hidden="true"
            className="relative flex items-center gap-3.5 md:flex-col md:gap-2 md:pt-[calc(34px+var(--wave))] md:text-center"
            style={{ '--wave': `${WAVE[badge.step % 4] * amp}px`, gridRow: badge.row + 1, gridColumn: badge.col + 1 } as CSSProperties}
          >
            <span
              data-node=""
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center [--m:40px] md:h-[var(--node)] md:w-[var(--node)]',
                small ? 'md:[--m:48px]' : 'md:[--m:62px]',
              )}
            >
              <BadgeMedal
                badge={levelBadge(level)}
                hue={levelHue(level)}
                earned={earned}
                className={badgePop ? 'bp-medal-pop [animation-delay:1100ms]' : undefined}
              />
            </span>
            <span className="min-w-0 md:mt-1.5">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--lv-text)]">{m.levelBadge}</span>
              <span className="block text-[13px] font-semibold leading-snug">{t(level.title)}</span>
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}

function LevelIsland({
  level,
  progress,
  startSlug,
  hereSlug,
  since,
  small,
  folded,
}: {
  level: Level;
  progress: LearnProgress;
  startSlug?: string;
  hereSlug?: string;
  since: Since;
  small?: boolean;
  /** on a phone, starts as a summary row (a level done, or one still far ahead) */
  folded: boolean;
}) {
  const m = useMessages(learnMessages);
  const t = useText();
  const headingId = useId();
  const bodyId = useId();
  const tally = levelTally(level, progress);
  const badgeTitle = t(level.title);
  const earned = !!progress.badges[levelBadge(level).id];
  const freshHere = since ? level.lessons.filter((l) => since.fresh.has(l.slug)).length : 0;
  // just finished here: it stays open to show it
  const [open, setOpen] = useState(!folded || freshHere > 0);
  const [tapped, setTapped] = useState(false);
  // the bar grows from where it was when the map last showed
  const ratio = tally.total ? tally.done / tally.total : 0;
  const grown = useGrown(ratio, freshHere > 0 ? (tally.done - freshHere) / tally.total : undefined);
  const available = level.lessons.reduce((sum, l) => sum + l.xp, 0);

  return (
    <section
      aria-labelledby={headingId}
      data-level={level.id}
      data-open={open}
      className={cn('bp-island rounded-[22px] border shadow-xs', levelHue(level), small ? 'p-4 sm:p-5' : 'p-5 sm:p-7', !open && 'max-md:py-3.5')}
    >
      {/* a phone's summary row: the level, its progress and badge; a tap opens the trail (wide screens show it all) */}
      <h3 className="md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setOpen(!open);
            setTapped(true);
          }}
          className="-m-1.5 flex w-[calc(100%+12px)] items-center gap-3 rounded-[16px] p-1.5 text-left focus-visible:outline-2 focus-visible:outline-primary"
        >
          <BadgeMedal badge={levelBadge(level)} hue={levelHue(level)} earned={earned} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--lv-text)]">{m.level(level.index)}</span>
            <span className={cn('block truncate font-bold leading-snug tracking-[-0.02em]', small ? 'text-[15px]' : 'text-[16px]')}>{t(level.title)}</span>
            {tally.total > 0 ? (
              <span className="mt-1 flex items-center gap-2">
                <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-[var(--lv)]" style={{ width: `${grown * 100}%` }} />
                </span>
                <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-muted">{m.levelDone(tally.done, tally.total)}</span>
              </span>
            ) : null}
          </span>
          <span className="sr-only">{earned ? m.badgeEarned(badgeTitle) : m.badgeLocked(badgeTitle)}</span>
          <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </h3>
      <div id={bodyId} className={cn(!open && 'max-md:hidden', tapped && open && 'bp-rise')}>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <div className="min-w-0 max-w-2xl max-md:mt-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--lv-text)] max-md:hidden">{m.level(level.index)}</p>
            <h3 id={headingId} className={cn('mt-0.5 font-bold tracking-[-0.02em] max-md:hidden', small ? 'text-[16px]' : 'text-[21px]')}>
              {t(level.title)}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{richText(t(level.summary), 'font-mono text-[12px]')}</p>
          </div>
          {tally.total > 0 ? (
            <div className="w-full max-md:hidden sm:mt-1 sm:w-64">
              <div className="flex items-baseline justify-between gap-3 whitespace-nowrap text-[12px]">
                <span className="font-semibold">{m.levelDone(tally.done, tally.total)}</span>
                {tally.done > 0 ? (
                  <span className="font-semibold tabular-nums text-[color:var(--lv-text)]">{m.levelXp(tally.xp)}</span>
                ) : (
                  <span className="tabular-nums text-muted">{m.levelXpToEarn(available)}</span>
                )}
              </div>
              <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-[var(--lv)] transition-[width] duration-700 ease-out"
                  style={{ width: `${grown * 100}%`, transitionDelay: freshHere > 0 ? '450ms' : undefined }}
                />
              </div>
              <p className="sr-only">{earned ? m.badgeEarned(badgeTitle) : m.badgeLocked(badgeTitle)}</p>
            </div>
          ) : null}
        </div>
        {level.lessons.length === 0 ? (
          <p className="mt-5 rounded-[14px] border border-dashed bg-surface-1/60 px-4 py-5 text-center text-[13px] text-muted">{m.comingSoon}</p>
        ) : (
          <Trail
            level={level}
            stations={level.lessons.map((lesson) => stationOf(lesson, progress))}
            earned={earned}
            startSlug={startSlug}
            hereSlug={hereSlug}
            fresh={freshHere > 0 ? since?.fresh : undefined}
            small={small}
          />
        )}
      </div>
    </section>
  );
}

function TrackMap({ track, progress, since }: { track: Track; progress: LearnProgress; since: Since }) {
  const t = useText();
  const headingId = useId();
  const startSlug = startLesson(progress.start)?.slug;
  const hereSlug = progress.last ? continueLesson(progress)?.slug : undefined;
  // a phone keeps the level you're on and the next one open; the ones done and the ones far ahead fold into a row
  const current = track.levels.findIndex((level) => level.lessons.some((l) => l.slug === (hereSlug ?? startSlug)));
  const folded = (level: Level, i: number) => {
    const tally = levelTally(level, progress);
    return i !== current && ((tally.total > 0 && tally.done === tally.total) || current === -1 || i > current + 1);
  };
  return (
    <section aria-labelledby={headingId} className={track.preview ? 'mt-12' : 'mt-10'} data-track={track.id}>
      <h2 id={headingId} className={cn('font-bold tracking-[-0.02em]', track.preview ? 'text-[16px] text-muted' : 'text-[20px]')}>
        {t(track.title)}
      </h2>
      <div className={cn('mt-4', track.preview ? 'space-y-3 lg:max-w-3xl' : 'space-y-5')}>
        {track.levels.map((level, i) => (
          <LevelIsland
            key={level.id}
            level={level}
            progress={progress}
            // under way, "You are here" is the one marker ("Start here" would point back at a lesson left behind)
            startSlug={hereSlug ? undefined : startSlug}
            hereSlug={hereSlug}
            since={since}
            small={track.preview}
            folded={folded(level, i)}
          />
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- badges */

/** a badge's day (`YYYY-MM-DD`, local) in the UI language */
function dayText(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  return formatDate(new Date(y, mo - 1, d), { dateStyle: 'medium' });
}

function BadgeShelf({ progress }: { progress: LearnProgress }) {
  const m = useMessages(learnMessages);
  const t = useText();
  const headingId = useId();
  const badges = allBadges(ALL_LEVELS);
  const earned = badges.filter((b) => progress.badges[b.id]).length;
  return (
    <section aria-labelledby={headingId} className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-[20px] font-bold tracking-[-0.02em]">
            {m.badges}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{m.badgesIntro}</p>
        </div>
        <p className="text-[13px] font-semibold tabular-nums text-muted">{m.countOf(earned, badges.length)}</p>
      </div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {badges.map((badge) => {
          const day = progress.badges[badge.id];
          return (
            <li
              key={badge.id}
              data-badge={badge.id}
              className={cn('flex items-center gap-3.5 rounded-[16px] border p-3.5', day ? 'bg-surface-1 shadow-xs' : 'border-dashed bg-surface-1/50')}
            >
              <BadgeMedal badge={badge} hue={badgeHue(badge, ALL_LEVELS)} earned={!!day} size={46} />
              <div className="min-w-0">
                <p className={cn('text-[13.5px] font-semibold leading-snug', !day && 'text-muted')}>{t(badge.title)}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-muted">{richText(t(badge.description), 'font-mono text-[11.5px]')}</p>
                {day ? (
                  <p className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold text-success">
                    <Check className="h-3 w-3" aria-hidden="true" /> {m.earnedOn(dayText(day))}
                  </p>
                ) : (
                  <p className="sr-only">{m.notEarned}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------- page */

async function resetProgress() {
  const m = messagesFor(learnMessages);
  const ok = await confirmAction({ title: m.resetTitle, body: m.resetBody, confirmLabel: m.reset, danger: true });
  if (!ok) return;
  useLearn.getState().resetAll();
  showToast(m.resetDone, 'success');
}

export default function LearnPage() {
  const m = useMessages(learnMessages);
  const t = useText();
  useDocumentTitle(m.title);
  const progress = useLearn();
  const next = continueLesson(progress);
  // never been anywhere and nothing chosen: the start question leads the page
  const first = progress.start === null && !progress.last;
  const [askedFirst] = useState(first);
  // back from a lesson: what was finished there animates once, and the map opens on it
  const [since] = useState(() => sinceMapSeen(useLearn.getState()));
  useEffect(() => noteMapSeen(progress), [progress]);
  const here = useRef(next?.code);
  useEffect(() => {
    if (!since || !here.current) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(`[data-track] [data-station="${here.current}"]`)
        ?.scrollIntoView({ block: 'center', behavior: scrollBehavior() }),
    );
    return () => cancelAnimationFrame(frame);
  }, [since]);

  return (
    <div className="flex h-full">
      <AppRail active="learn" />
      {/* relative: the absolutely placed bits (sr-only text, hover cards) scroll with the map, never the document under the rail */}
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <div className="bp-learn-hero grid gap-6 rounded-[26px] border bg-surface-1/60 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-10">
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">{m.eyebrow}</p>
              <h1 className="mt-2 text-balance text-[28px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[38px]">{m.heading}</h1>
              <p className="mt-3 max-w-xl text-pretty text-[14.5px] leading-relaxed text-muted">{m.intro}</p>
              {/* a first visit has one first step, the question; answering it brings "Start here" in */}
              {next && !first ? (
                <Link
                  to={`/learn/${next.slug}`}
                  className={buttonClass('primary', 'lg', cn('mt-6 h-auto max-w-full justify-start gap-3 py-2.5 pl-2.5 pr-5 text-left shadow-md', askedFirst && 'bp-rise'))}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20" aria-hidden="true">
                    <Play className="h-4 w-4 translate-x-px fill-current" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11.5px] font-medium">{progress.last ? m.continueFrom : m.startHere}</span>
                    <span className="line-clamp-2 block text-[14.5px] font-semibold leading-snug">{m.lessonCode(next.code, t(next.title))}</span>
                  </span>
                  <ArrowRight className="ml-1 h-4 w-4 shrink-0" aria-hidden="true" />
                </Link>
              ) : null}
              <StartQuestion
                start={progress.start}
                first={first}
                dive={next ? { slug: next.slug, label: m.lessonCode(next.code, t(next.title)) } : undefined}
              />
            </div>
            <PlayerCard progress={progress} since={since} />
          </div>

          {TRACKS.map((track) => (
            <TrackMap key={track.id} track={track} progress={progress} since={since} />
          ))}

          <BadgeShelf progress={progress} />

          <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <p className="text-[12px] text-muted">{m.savedHere}</p>
            <Button variant="ghost" size="sm" onClick={() => void resetProgress()}>
              <RotateCcw className="h-3.5 w-3.5" /> {m.reset}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
