/**
 * Celebrations for the learning side (XP, rank, badge, streak, lesson and
 * level done), driven by `onLearnEvent`. A finished lesson, a badge, a new
 * rank or a streak going on is a small card at the top that never takes
 * focus or a click, so typing in a lesson goes on; what's earned in the
 * same moment shares one card (the lesson's carries its XP, and a rank or
 * badge earned with it rides along underneath), and two cards at most are
 * on screen. A finished level gets a dialog (Esc closes it), a beat after
 * the lesson card, that also shows the rank and badges earned with it. A
 * polite live region reads each one out. Confetti is skipped for reduced
 * motion.
 */
import { ArrowRight, Check, Flame, Trophy, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMatch, useNavigate } from 'react-router-dom';
import { Button, Modal } from '@/components/ui';
import { currentLocale, useLocale } from '@/i18n/locale';
import { messagesFor, useMessages } from '@/i18n/messages';
import { allBadges, levelBadge, RANKS } from '@/learn/gamification';
import { ALL_LEVELS, getLesson, nextLesson } from '@/learn/lessons';
import { onLearnEvent, useLearn, type LearnEvent } from '@/learn/progress';
import { textIn } from '@/learn/types';
import { prefersReducedMotion } from '@/lib/motion';
import { celebrationMessages } from './celebration.messages';
import { BadgeMedal, badgeHue, Confetti, levelHue, RankMedal } from './medals';

/** a streak, rank or badge that rides on another card, earned in the same moment */
type Extra = Extract<LearnEvent, { kind: 'streak' | 'rank' | 'badge' }>;

/** which of a moment's news leads its card */
const CARD_ORDER: Array<LearnEvent['kind']> = ['lesson', 'streak', 'rank', 'badge'];

/** a card on screen: what it's for, the XP a lesson gave, and what was earned along with it */
type Cheer = Exclude<LearnEvent, { kind: 'level' }> & { key: number; xp?: number; extras: Extra[] };

/** a finished level waiting for (or in) its dialog, with what was earned along with it */
interface LevelCheer {
  key: number;
  id: string;
  rank?: number;
  badges: string[];
  /** the beat after the last goal has passed: the dialog shows */
  ready: boolean;
}

/** how long each card stays (ms), and a little longer for each thing riding on it */
const STAYS: Record<Cheer['kind'], number> = { xp: 2200, lesson: 4000, rank: 5000, badge: 5000, streak: 4000 };
const PER_EXTRA = 900;
const MAX_STAY = 7000;
/** cards on screen at once: a new one sends the oldest away */
const MAX_CARDS = 2;
/** the last goal turns green and the lesson card shows a moment before the level's dialog takes over */
const LEVEL_BEAT = 1100;

const badgeById = (id: string) => allBadges(ALL_LEVELS).find((b) => b.id === id);
const rankTitle = (index: number) => (RANKS[index] ?? RANKS[0]).title;

let seq = 0;

function XpChip({ amount, className }: { amount: number; className?: string }) {
  const m = useMessages(celebrationMessages);
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-[#f59e0b] to-[#ea580c] px-2.5 py-0.5 text-[12.5px] font-bold tabular-nums text-white shadow-md ${className ?? ''}`}
    >
      <Zap className="h-3.5 w-3.5" fill="currentColor" /> {m.xp(amount)}
    </span>
  );
}

/** a streak, rank or badge earned along with a card's news: a small chip under it */
function ExtraChip({ extra, delay }: { extra: Extra; delay: number }) {
  const m = useMessages(celebrationMessages);
  const locale = useLocale((s) => s.locale);
  const badge = extra.kind === 'badge' ? badgeById(extra.id) : undefined;
  if (extra.kind === 'badge' && !badge) return null;
  return (
    <span
      className="bp-cheer-in flex min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-surface-1 py-0.5 pl-0.5 pr-2.5 text-[11.5px] shadow-xs"
      style={{ animationDelay: `${delay}ms` }}
    >
      {extra.kind === 'streak' ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#fbbf24] to-[#ea580c] text-white">
          <Flame className="h-3 w-3" fill="currentColor" />
        </span>
      ) : extra.kind === 'rank' ? (
        <RankMedal index={extra.index} size={18} />
      ) : badge ? (
        <BadgeMedal badge={badge} hue={badgeHue(badge, ALL_LEVELS)} earned size={20} />
      ) : null}
      <span className="truncate">
        <span className="font-semibold">{extra.kind === 'streak' ? m.streak : extra.kind === 'rank' ? m.newRank : m.badgeUnlocked}</span>
        {': '}
        {extra.kind === 'streak'
          ? m.streakDays(extra.days)
          : extra.kind === 'rank'
            ? textIn(rankTitle(extra.index), locale)
            : badge
              ? textIn(badge.title, locale)
              : null}
      </span>
    </span>
  );
}

function CheerCard({ cheer, confetti }: { cheer: Cheer; confetti: boolean }) {
  const m = useMessages(celebrationMessages);
  const locale = useLocale((s) => s.locale);
  if (cheer.kind === 'xp') return <XpChip amount={cheer.amount} className="bp-xp-float" />;

  let medal: ReactNode = null;
  let eyebrow = '';
  let title = '';
  if (cheer.kind === 'lesson') {
    const lesson = getLesson(cheer.slug);
    const level = ALL_LEVELS.find((l) => l.lessons.some((x) => x.slug === cheer.slug));
    if (!lesson) return null;
    eyebrow = lesson.kind === 'challenge' ? m.challengeDone : m.lessonDone;
    title = `${lesson.code} ${textIn(lesson.title, locale)}`;
    medal = (
      <span className={`bp-medal bp-medal-pop flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${level ? levelHue(level) : 'bp-gold'}`}>
        {lesson.kind === 'challenge' ? <Trophy className="h-4 w-4" /> : <Check className="h-[18px] w-[18px]" strokeWidth={2.6} />}
      </span>
    );
  } else if (cheer.kind === 'rank') {
    eyebrow = m.newRank;
    title = textIn(rankTitle(cheer.index), locale);
    medal = <RankMedal index={cheer.index} size={36} className="bp-medal-pop" />;
  } else if (cheer.kind === 'streak') {
    eyebrow = m.streak;
    title = m.streakDays(cheer.days);
    medal = (
      <span className="bp-medal-pop flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#fbbf24] to-[#ea580c] text-white shadow-sm">
        <Flame className="h-[18px] w-[18px]" fill="currentColor" />
      </span>
    );
  } else {
    const badge = badgeById(cheer.id);
    if (!badge) return null;
    eyebrow = m.badgeUnlocked;
    title = textIn(badge.title, locale);
    medal = <BadgeMedal badge={badge} hue={badgeHue(badge, ALL_LEVELS)} earned size={36} className="bp-medal-pop" />;
  }
  return (
    <span className="bp-cheer-in relative flex max-w-[min(440px,calc(100vw-24px))] flex-col gap-1.5 rounded-[14px] border bg-surface-1/95 py-2 pl-2.5 pr-3 shadow-lg backdrop-blur">
      {confetti && cheer.kind === 'lesson' ? <Confetti pieces={24} spread={0.8} /> : null}
      <span className="flex items-center gap-3">
        {medal}
        <span className="min-w-0 flex-1 pr-1">
          <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-faint">{eyebrow}</span>
          <span className="block truncate text-[13.5px] font-semibold">{title}</span>
        </span>
        {cheer.kind === 'lesson' && cheer.xp ? <XpChip amount={cheer.xp} className="bp-medal-pop [animation-delay:180ms]" /> : null}
      </span>
      {cheer.extras.length > 0 ? (
        <span className="flex flex-wrap gap-1.5 pl-12">
          {cheer.extras.map((extra, i) => (
            <ExtraChip key={extra.kind === 'badge' ? extra.id : extra.kind} extra={extra} delay={350 + i * 120} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

function LevelDialog({ cheer, onClose }: { cheer: LevelCheer; onClose(): void }) {
  const m = useMessages(celebrationMessages);
  const locale = useLocale((s) => s.locale);
  const navigate = useNavigate();
  const onMap = useMatch('/learn') !== null;
  const lessons = useLearn((s) => s.lessons);
  const level = ALL_LEVELS.find((l) => l.id === cheer.id);
  const [confetti] = useState(() => !prefersReducedMotion());
  if (!level) return null;
  const title = textIn(level.title, locale);
  const last = level.lessons[level.lessons.length - 1];
  const next = last ? nextLesson(last.slug) : null;
  const xp = level.lessons.reduce((sum, l) => sum + (lessons[l.slug]?.xp ?? 0), 0);
  const extras = cheer.badges.filter((id) => id !== levelBadge(level).id).flatMap((id) => badgeById(id) ?? []);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <Modal open onClose={onClose} label={`${m.levelDone}: ${title}`}>
      <div className={`relative overflow-hidden rounded-lg px-6 pb-6 pt-9 text-center max-sm:px-4 ${levelHue(level)}`} data-testid="level-complete">
        <div aria-hidden="true" className="bp-island pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          {confetti ? <Confetti pieces={48} spread={1.4} /> : null}
          <BadgeMedal badge={levelBadge(level)} hue={levelHue(level)} earned size={84} className="bp-medal-pop" />
        </div>
        <p className="relative mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--lv-text)]">{m.levelDone}</p>
        <h2 className="relative mt-1 text-[24px] font-bold tracking-[-0.02em]">{title}</h2>
        <p className="relative mx-auto mt-2 max-w-xs text-[13.5px] leading-relaxed text-muted">{m.levelBody(level.lessons.length, level.index)}</p>
        <p className="relative mt-3 inline-flex items-center gap-1 rounded-full border bg-surface-1 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums">
          <Zap className="h-3 w-3 text-[#d97706]" fill="currentColor" aria-hidden="true" /> {m.levelXp(xp)}
        </p>
        {cheer.rank !== undefined || extras.length > 0 ? (
          <ul className="relative mt-4 flex flex-wrap justify-center gap-2">
            {cheer.rank !== undefined ? (
              <li className="bp-cheer-in flex items-center gap-2 rounded-full border bg-surface-1 py-1 pl-1 pr-3 text-left shadow-xs [animation-delay:250ms]">
                <RankMedal index={cheer.rank} size={26} />
                <span className="text-[12px] leading-tight">
                  <span className="block text-[9.5px] font-bold uppercase tracking-[0.1em] text-faint">{m.newRank}</span>
                  <span className="font-semibold">{textIn(rankTitle(cheer.rank), locale)}</span>
                </span>
              </li>
            ) : null}
            {extras.map((badge) => (
              <li key={badge.id} className="bp-cheer-in flex items-center gap-2 rounded-full border bg-surface-1 py-1 pl-1 pr-3 text-left shadow-xs [animation-delay:350ms]">
                <BadgeMedal badge={badge} hue={badgeHue(badge, ALL_LEVELS)} earned size={26} />
                <span className="text-[12px] leading-tight">
                  <span className="block text-[9.5px] font-bold uppercase tracking-[0.1em] text-faint">{m.badgeUnlocked}</span>
                  <span className="font-semibold">{textIn(badge.title, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="relative mt-6 flex flex-col gap-2">
          {next ? (
            <Button data-autofocus size="lg" className="w-full" onClick={() => go(`/learn/${next.slug}`)}>
              <span className="truncate">{m.nextLesson(next.code, textIn(next.title, locale))}</span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </Button>
          ) : null}
          <Button
            data-autofocus={next ? undefined : true}
            variant={next ? 'ghost' : 'primary'}
            size="lg"
            className="w-full"
            onClick={() => (onMap ? onClose() : go('/learn'))}
          >
            {m.backToMap}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function CelebrationHost() {
  const [cheers, setCheers] = useState<Cheer[]>([]);
  const [levels, setLevels] = useState<LevelCheer[]>([]);
  const [said, setSaid] = useState<Array<{ key: number; text: string }>>([]);
  // read inside the event handler, which runs before React re-renders
  const levelsOpen = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const later = (ms: number, fn: () => void) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        fn();
      }, ms);
      timers.current.add(timer);
    };
    const show = (cheer: Cheer) => {
      setCheers((c) => [...c, cheer].slice(-MAX_CARDS));
      const stay = Math.min(MAX_STAY, STAYS[cheer.kind] + PER_EXTRA * cheer.extras.length);
      later(stay, () => setCheers((c) => c.filter((x) => x.key !== cheer.key)));
    };

    /** the events of one change (a progress commit announces them together): one card, or the level's dialog */
    const celebrate = (events: LearnEvent[]) => {
      const rest: Array<Exclude<LearnEvent, { kind: 'level' }>> = [];
      for (const event of events) {
        if (event.kind === 'level') {
          const key = ++seq;
          levelsOpen.current++;
          setLevels((l) => [...l, { key, id: event.id, badges: [], ready: false }]);
          later(LEVEL_BEAT, () => {
            setLevels((l) => l.map((x) => (x.key === key ? { ...x, ready: true } : x)));
            // the dialog says it all: the cards it would hide go
            setCheers([]);
          });
        } else rest.push(event);
      }
      // earned along with a level: its dialog shows it
      const toDialog = (e: LearnEvent): e is Extract<LearnEvent, { kind: 'rank' | 'badge' }> =>
        levelsOpen.current > 0 && (e.kind === 'rank' || e.kind === 'badge');
      for (const event of rest.filter(toDialog)) {
        setLevels((l) => {
          const last = l[l.length - 1];
          const next = event.kind === 'rank' ? { ...last, rank: event.index } : { ...last, badges: [...last.badges, event.id] };
          return [...l.slice(0, -1), next];
        });
      }
      const xp = rest.find((e) => e.kind === 'xp')?.amount;
      // one card: the lesson (with its XP) or else the streak, rank or badge, and the rest riding on it
      const [main, ...extras] = rest
        .filter((e) => e.kind !== 'xp' && !toDialog(e))
        .sort((a, b) => CARD_ORDER.indexOf(a.kind) - CARD_ORDER.indexOf(b.kind));
      if (main) show({ ...main, key: ++seq, xp: main.kind === 'lesson' ? xp : undefined, extras: extras as Extra[] });
      // XP on its own (no lesson to carry it): a floating chip
      else if (xp !== undefined) show({ kind: 'xp', amount: xp, total: 0, key: ++seq, extras: [] });
    };

    let batch: LearnEvent[] = [];
    const off = onLearnEvent((event) => {
      const key = ++seq;
      const text = spoken(event);
      if (text) {
        setSaid((s) => [...s, { key, text }]);
        later(8000, () => setSaid((s) => s.filter((x) => x.key !== key)));
      }
      // a change's events arrive one after another in the same task
      if (batch.length === 0) {
        queueMicrotask(() => {
          const events = batch;
          batch = [];
          celebrate(events);
        });
      }
      batch.push(event);
    });
    const pending = timers.current;
    return () => {
      off();
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const confetti = !prefersReducedMotion();
  const dialog = levels[0]?.ready ? levels[0] : null;
  return (
    <>
      {createPortal(
        // data-bp-live: the level dialog makes the page inert, not this
        <div data-bp-live="" data-testid="celebrations" className="pointer-events-none fixed inset-x-0 top-3 z-[85] flex flex-col items-center gap-2 px-3">
          <div aria-live="polite" className="sr-only">
            {said.map((s) => (
              <p key={s.key}>{s.text}</p>
            ))}
          </div>
          {/* a level's dialog celebrates on its own */}
          {dialog
            ? null
            : cheers.map((cheer) => (
                <div key={cheer.key} aria-hidden="true" data-cheer={cheer.kind}>
                  <CheerCard cheer={cheer} confetti={confetti} />
                </div>
              ))}
        </div>,
        document.body,
      )}
      {dialog ? (
        <LevelDialog
          key={dialog.key}
          cheer={dialog}
          onClose={() => {
            levelsOpen.current--;
            setLevels((l) => l.slice(1));
          }}
        />
      ) : null}
    </>
  );
}

/** what the live region says for an event, in the language of the moment */
function spoken(event: LearnEvent): string | null {
  const m = messagesFor(celebrationMessages);
  const locale = currentLocale();
  switch (event.kind) {
    case 'xp':
      return m.sayXp(event.amount, event.total);
    case 'lesson': {
      const lesson = getLesson(event.slug);
      return lesson ? m.sayLesson(textIn(lesson.title, locale)) : null;
    }
    case 'rank':
      return RANKS[event.index] ? m.sayRank(textIn(RANKS[event.index].title, locale)) : null;
    case 'badge': {
      const badge = badgeById(event.id);
      return badge ? m.sayBadge(textIn(badge.title, locale)) : null;
    }
    case 'streak':
      return m.sayStreak(event.days);
    case 'level': {
      const level = ALL_LEVELS.find((l) => l.id === event.id);
      return level ? m.sayLevel(textIn(level.title, locale)) : null;
    }
  }
}
