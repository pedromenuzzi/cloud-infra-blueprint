/**
 * The lesson panel: where the learner is (station, level, XP, minutes),
 * the lesson's prose and asides, the goals checked live with a hint each,
 * the finish (XP, next lesson), and the docs of the block in focus.
 */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Code2,
  Info,
  Lightbulb,
  PanelLeftClose,
  RotateCcw,
  Sparkles,
  Trophy,
  Workflow,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { confirmAction } from '@/components/Confirm';
import { shellMessages } from '@/components/messages';
import { showToast } from '@/components/Toast';
import { Button, buttonClass, LogoMark } from '@/components/ui';
import { HeaderButton } from '@/features/editor/PanelChrome';
import { useLocale } from '@/i18n/locale';
import { useMessages } from '@/i18n/messages';
import { lessonXp } from '@/learn/gamification';
import { levelOfLesson, nextLesson } from '@/learn/lessons';
import { useLearn } from '@/learn/progress';
import { textIn, type Aside, type Goal, type Lesson, type LessonMode } from '@/learn/types';
import { cn } from '@/lib/utils';
import { DocsPanel } from './DocsPanel';
import { resetLessonCode } from './lessonDraft';
import { playerMessages } from './player.messages';
import { rich } from './rich';
import { SolutionDialog } from './SolutionDialog';

const MODE_ICON: Record<LessonMode, typeof Workflow> = { canvas: Workflow, mixed: Workflow, code: Code2 };

type Tab = 'lesson' | 'docs';

/** `phone`: the panel fills its tab, and the page above it carries the way back */
export function LessonPanel({
  lesson,
  met,
  phone = false,
  onCollapse,
}: {
  lesson: Lesson;
  met: boolean[];
  phone?: boolean;
  onCollapse?(): void;
}) {
  const m = useMessages(playerMessages);
  const shell = useMessages(shellMessages);
  const locale = useLocale((s) => s.locale);
  const t = (text: { en: string; pt: string }) => textIn(text, locale);
  const progress = useLearn((s) => s.lessons[lesson.slug]);
  const [tab, setTab] = useState<Tab>('lesson');
  const [solution, setSolution] = useState(false);
  const uid = useId();
  const level = levelOfLesson(lesson.slug);
  const done = progress?.status === 'done';
  const ModeIcon = MODE_ICON[lesson.mode];

  const showSolution = async () => {
    const current = useLearn.getState().lessons[lesson.slug];
    // nothing left to lose once it's done or the solution was already seen
    if (current?.status !== 'done' && !current?.usedSolution) {
      const ok = await confirmAction({
        title: m.solutionAsk,
        body: m.solutionCost(lesson.xp, lessonXp(lesson, true)),
        confirmLabel: m.showSolution,
      });
      if (!ok) return;
      useLearn.getState().revealSolution(lesson.slug);
    }
    setSolution(true);
  };

  const reset = async () => {
    const ok = await confirmAction({ title: m.resetAsk, body: m.resetBody, confirmLabel: m.resetConfirm, danger: true });
    if (!ok) return;
    resetLessonCode(lesson);
    showToast(m.resetDone, 'info');
  };

  const tabs: Tab[] = ['lesson', 'docs'];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + 1) % tabs.length];
    setTab(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-surface-1" aria-label={m.lessonPanel}>
      {phone ? null : (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Link to="/" className="shrink-0 rounded-sm p-1 hover:bg-surface-2" aria-label={shell.home}>
            <LogoMark size={22} />
          </Link>
          <Link
            to="/learn"
            aria-label={m.backToMap}
            className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{m.map}</span>
          </Link>
          <span className="flex-1" />
          {onCollapse ? (
            <HeaderButton label={m.collapse} onClick={onCollapse} data-collapse-lesson>
              <PanelLeftClose className="h-3.5 w-3.5" />
            </HeaderButton>
          ) : null}
        </div>
      )}

      <div className="shrink-0 bg-gradient-to-b from-primary-soft/70 to-transparent px-5 pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <span
            className={cn(
              'rounded-[6px] px-1.5 py-0.5 font-mono text-[11.5px] normal-case tracking-normal',
              lesson.kind === 'challenge' ? 'bg-warning/15 text-warning' : 'bg-primary-soft text-primary',
            )}
            title={m.station(lesson.code)}
          >
            <span className="sr-only">{m.station(lesson.code)}</span>
            <span aria-hidden="true">{lesson.code}</span>
          </span>
          <span className="min-w-0 truncate">
            {lesson.kind === 'challenge' ? `${m.challenge} · ` : ''}
            {level ? m.level(level.index, t(level.title)) : null}
          </span>
        </div>
        <h1 className="mt-2 text-[20px] font-semibold leading-tight tracking-[-0.01em]">{t(lesson.title)}</h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium">
          <Chip icon={<Clock className="h-3 w-3" />}>{m.minutes(lesson.minutes)}</Chip>
          <Chip icon={<Sparkles className="h-3 w-3" />} className="text-primary">
            {done && progress?.xp !== undefined
              ? progress.usedSolution
                ? m.halfXp(progress.xp)
                : m.xp(progress.xp)
              : progress?.usedSolution
                ? m.halfXp(lessonXp(lesson, true))
                : m.xp(lesson.xp)}
          </Chip>
          <Chip icon={<ModeIcon className="h-3 w-3" />}>{m.modes[lesson.mode]}</Chip>
          {lesson.awsBasics ? <Chip>{m.awsBasics}</Chip> : null}
          {done ? (
            <Chip icon={<Check className="h-3 w-3" />} className="border-success/40 bg-success/10 text-success">
              {m.completed}
            </Chip>
          ) : null}
        </div>

        <div className="mt-4 flex gap-1 border-b" role="tablist" aria-label={m.lessonPanel} onKeyDown={onTabKey}>
          {tabs.map((id) => (
            <button
              key={id}
              id={`${uid}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${uid}-panel`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] font-semibold transition-colors',
                tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground',
              )}
            >
              {m.tabs[id]}
            </button>
          ))}
        </div>
      </div>

      <div
        id={`${uid}-panel`}
        role="tabpanel"
        aria-labelledby={`${uid}-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto"
        tabIndex={-1}
      >
        {tab === 'lesson' ? (
          <div className="space-y-5 px-5 py-4">
            <div className="space-y-3">
              {lesson.body.map((p, i) => (
                <p key={i} className="text-[13.5px] leading-relaxed text-muted">
                  {rich(t(p))}
                </p>
              ))}
            </div>
            {lesson.asides?.length ? (
              <div className="space-y-2">
                {lesson.asides.map((aside, i) => (
                  <AsideBox key={i} aside={aside} />
                ))}
              </div>
            ) : null}
            <Goals lesson={lesson} met={met} />
            {done && met.every(Boolean) ? <Finish lesson={lesson} /> : null}
          </div>
        ) : (
          <DocsPanel lesson={lesson} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => void showSolution()}>
          <Lightbulb className="h-3.5 w-3.5" /> {m.showSolution}
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => void reset()}>
          <RotateCcw className="h-3.5 w-3.5" /> {m.reset}
        </Button>
      </div>
      {solution ? <SolutionDialog lesson={lesson} onClose={() => setSolution(false)} /> : null}
    </aside>
  );
}

function Chip({ icon, className, children }: { icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border bg-surface-1 px-2 py-0.5 text-muted', className)}>
      {icon}
      {children}
    </span>
  );
}

/** "What is S3?": open unless the learner said they know AWS and it only explains AWS */
function AsideBox({ aside }: { aside: Aside }) {
  const locale = useLocale((s) => s.locale);
  const knowsAws = useLearn((s) => s.start === 'aws');
  const [open, setOpen] = useState(() => !(knowsAws && aside.awsBasics));
  const id = useId();
  return (
    <div className="rounded-[12px] border bg-surface-2/40">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-[13px] font-semibold transition-colors hover:bg-surface-2"
        >
          <Info className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{textIn(aside.title, locale)}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-faint transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </h2>
      <div id={id} hidden={!open} className="space-y-2 px-3 pb-3 pl-9">
        {aside.body.map((p, i) => (
          <p key={i} className="text-[12.5px] leading-relaxed text-muted">
            {rich(textIn(p, locale))}
          </p>
        ))}
      </div>
    </div>
  );
}

function Goals({ lesson, met }: { lesson: Lesson; met: boolean[] }) {
  const m = useMessages(playerMessages);
  const count = met.filter(Boolean).length;
  const total = lesson.goals.length;

  return (
    <section aria-labelledby="lesson-goals">
      <div className="flex items-baseline gap-2">
        <h2 id="lesson-goals" className="flex-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">
          {m.goals}
        </h2>
        <span className="text-[11.5px] font-semibold tabular-nums text-muted">{m.goalsProgress(count, total)}</span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label={m.goals}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={count}
        aria-valuetext={m.goalsProgress(count, total)}
      >
        <div
          className="h-full rounded-full bg-success transition-[width] duration-500 ease-out"
          style={{ width: `${total ? (count / total) * 100 : 0}%` }}
        />
      </div>
      <ol className="mt-3 space-y-2">
        {lesson.goals.map((goal, i) => (
          <GoalItem key={goal.id} goal={goal} met={met[i] === true} />
        ))}
      </ol>
    </section>
  );
}

function GoalItem({ goal, met }: { goal: Goal; met: boolean }) {
  const m = useMessages(playerMessages);
  const locale = useLocale((s) => s.locale);
  const [hint, setHint] = useState(false);
  const id = useId();
  return (
    <li
      data-goal={goal.id}
      data-met={met || undefined}
      className={cn(
        'rounded-[12px] border px-3 py-2.5 transition-colors duration-300',
        met ? 'border-success/35 bg-success/[0.07]' : 'bg-surface-1',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300',
            met ? 'border-success bg-success' : 'border-border-strong',
          )}
        >
          <Check
            strokeWidth={3}
            className={cn('h-3 w-3 text-white transition-transform duration-300 ease-out', met ? 'scale-100' : 'scale-0')}
          />
        </span>
        <span className={cn('min-w-0 flex-1 text-[13px] leading-snug', met ? 'text-muted' : 'text-foreground')}>
          {rich(textIn(goal.text, locale))}
          <span className="sr-only"> ({met ? m.goalDone : m.goalTodo})</span>
        </span>
        <button
          type="button"
          aria-expanded={hint}
          aria-controls={id}
          onClick={() => setHint((v) => !v)}
          className="-my-0.5 flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-medium text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Lightbulb className="h-3 w-3" />
          {hint ? m.hideHint : m.hint}
        </button>
      </div>
      <p id={id} hidden={!hint} className="mt-2 pl-7.5 text-[12.5px] leading-relaxed text-muted">
        {rich(textIn(goal.hint, locale))}
      </p>
    </li>
  );
}

/** every goal met: the XP it gave and where to go next (the celebration itself is CelebrationHost's) */
function Finish({ lesson }: { lesson: Lesson }) {
  const m = useMessages(playerMessages);
  const locale = useLocale((s) => s.locale);
  const progress = useLearn((s) => s.lessons[lesson.slug]);
  const next = nextLesson(lesson.slug);
  const xp = progress?.xp ?? lessonXp(lesson, progress?.usedSolution === true);
  return (
    <section
      aria-labelledby="lesson-finish"
      className="bp-pop-in overflow-hidden rounded-[14px] border border-success/40 bg-gradient-to-br from-success/[0.14] via-surface-1 to-primary/[0.08] p-4"
      data-testid="lesson-finish"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success text-white shadow-md">
          <Trophy className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="lesson-finish" className="text-[15px] font-semibold">
            {m.completeTitle}
          </h2>
          <p className="text-[12.5px] text-muted">{m.completeBody}</p>
        </div>
        <span className="shrink-0 text-[17px] font-bold tabular-nums text-success">{m.earned(xp)}</span>
      </div>
      {progress?.usedSolution ? <p className="mt-2 text-[12px] text-muted">{m.earnedHalf}</p> : null}
      <div className="mt-4 flex flex-col gap-2">
        {next ? (
          <Link to={`/learn/${next.slug}`} className={buttonClass('primary', 'md', 'w-full')}>
            <span className="truncate">{m.next(textIn(next.title, locale))}</span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        ) : (
          <p className="text-[12.5px] text-muted">{m.lastLesson}</p>
        )}
        <Link to="/learn" className={buttonClass(next ? 'outline' : 'primary', 'md', 'w-full')}>
          {m.backToMap}
        </Link>
      </div>
    </section>
  );
}
