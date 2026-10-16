/**
 * The learning side's game rules, pure so they're testable: XP and ranks,
 * badges, the streak of days in a row. The build side (dashboard, editor)
 * has none of this on purpose.
 */
import type { LearnProgress } from './progress';
import type { Level, Lesson, SimCommand, T } from './types';

/* ------------------------------------------------------------ XP and ranks */

/** XP a completed lesson gives: all of it, or half when the solution was shown */
export const lessonXp = (lesson: Lesson, usedSolution: boolean): number =>
  usedSolution ? Math.round(lesson.xp / 2) : lesson.xp;

export interface Rank {
  /** XP needed to reach it */
  xp: number;
  title: T;
}

export const RANKS: Rank[] = [
  { xp: 0, title: { en: 'Newcomer', pt: 'Iniciante' } },
  { xp: 100, title: { en: 'Apprentice', pt: 'Aprendiz' } },
  { xp: 300, title: { en: 'Practitioner', pt: 'Praticante' } },
  { xp: 600, title: { en: 'Builder', pt: 'Construtor' } },
  { xp: 1000, title: { en: 'Architect', pt: 'Arquiteto' } },
  { xp: 1600, title: { en: 'Cloud Engineer', pt: 'Engenheiro de nuvem' } },
  // the curriculum gives over 5000 XP: the climb goes on through the last levels
  { xp: 2400, title: { en: 'Platform Engineer', pt: 'Engenheiro de plataforma' } },
  { xp: 3400, title: { en: 'Principal Engineer', pt: 'Engenheiro principal' } },
  { xp: 4600, title: { en: 'Terraform Master', pt: 'Mestre do Terraform' } },
];

/** the rank for an XP total, and how far along the way to the next one (0–1; 1 at the top rank) */
export function rankOf(xp: number): { index: number; rank: Rank; next: Rank | null; progress: number } {
  let index = 0;
  while (index + 1 < RANKS.length && xp >= RANKS[index + 1].xp) index++;
  const rank = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  return { index, rank, next, progress: next ? (xp - rank.xp) / (next.xp - rank.xp) : 1 };
}

/* ------------------------------------------------------------ days and streak */

/** today's date in the learner's own time zone, as `YYYY-MM-DD` */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayBefore = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
};

/**
 * Days in a row with progress, counting back from today, or from yesterday
 * when today has none yet (the streak isn't lost until the day is over).
 */
export function streakOf(days: readonly string[], today = localDay()): number {
  const set = new Set(days);
  let day = set.has(today) ? today : dayBefore(today);
  let streak = 0;
  while (set.has(day)) {
    streak++;
    day = dayBefore(day);
  }
  return streak;
}

/** the longest run of consecutive days ever */
export function bestStreakOf(days: readonly string[]): number {
  const set = new Set(days);
  let best = 0;
  for (const day of set) {
    if (set.has(dayBefore(day))) continue; // not the start of a run
    const [y, m, d] = day.split('-').map(Number);
    let length = 0;
    while (set.has(localDay(new Date(y, m - 1, d + length)))) length++;
    best = Math.max(best, length);
  }
  return best;
}

/* ------------------------------------------------------------ badges */

export interface Badge {
  id: string;
  title: T;
  description: T;
  /** a lucide-react icon name */
  icon: string;
  /** earned with this progress? (checked after every change; a badge, once earned, stays) */
  earned(progress: LearnProgress, levels: Level[]): boolean;
}

const ranCommand = (progress: LearnProgress, command: SimCommand) =>
  Object.values(progress.runs).some((runs) => runs.includes(command));

const levelDone = (progress: LearnProgress, level: Level) =>
  level.lessons.length > 0 && level.lessons.every((l) => progress.lessons[l.slug]?.status === 'done');

export const COMMAND_BADGES: Badge[] = [
  {
    id: 'first-init',
    title: { en: 'Initialized', pt: 'Inicializado' },
    description: { en: 'Ran `terraform init` for the first time.', pt: 'Rodou `terraform init` pela primeira vez.' },
    icon: 'Power',
    earned: (p) => ranCommand(p, 'init'),
  },
  {
    id: 'first-plan',
    title: { en: 'Look before you leap', pt: 'Olhe antes de pular' },
    description: { en: 'Read your first `terraform plan`.', pt: 'Leu o seu primeiro `terraform plan`.' },
    icon: 'ListChecks',
    earned: (p) => ranCommand(p, 'plan'),
  },
  {
    id: 'first-apply',
    title: { en: 'It is live', pt: 'Está no ar' },
    description: { en: 'Applied your first infrastructure (simulated).', pt: 'Aplicou a sua primeira infraestrutura (simulada).' },
    icon: 'Rocket',
    earned: (p) => ranCommand(p, 'apply'),
  },
  {
    id: 'first-destroy',
    title: { en: 'Leave no trace', pt: 'Sem deixar rastro' },
    description: { en: 'Cleaned up with `terraform destroy`.', pt: 'Limpou tudo com `terraform destroy`.' },
    icon: 'Trash2',
    earned: (p) => ranCommand(p, 'destroy'),
  },
];

export const EFFORT_BADGES: Badge[] = [
  {
    id: 'no-peek',
    title: { en: 'No peeking', pt: 'Sem espiar' },
    description: { en: 'Solved a challenge without opening the solution.', pt: 'Resolveu um desafio sem abrir a solução.' },
    icon: 'EyeOff',
    earned: (p, levels) =>
      levels.some((level) =>
        level.lessons.some((l) => l.kind === 'challenge' && p.lessons[l.slug]?.status === 'done' && !p.lessons[l.slug]?.usedSolution),
      ),
  },
  {
    id: 'streak-3',
    title: { en: 'On a roll', pt: 'Embalado' },
    description: { en: 'Learned 3 days in a row.', pt: 'Estudou 3 dias seguidos.' },
    icon: 'Flame',
    earned: (p) => bestStreakOf(p.days) >= 3,
  },
  {
    id: 'streak-7',
    title: { en: 'A week strong', pt: 'Uma semana firme' },
    description: { en: 'Learned 7 days in a row.', pt: 'Estudou 7 dias seguidos.' },
    icon: 'CalendarCheck',
    earned: (p) => bestStreakOf(p.days) >= 7,
  },
];

/** one badge per level, earned when every lesson in it is done */
export function levelBadge(level: Level): Badge {
  return {
    id: `level-${level.id}`,
    title: level.title,
    description: {
      en: `Completed every lesson of level ${level.index}.`,
      pt: `Concluiu todas as lições do nível ${level.index}.`,
    },
    icon: 'Award',
    earned: (p) => levelDone(p, level),
  };
}

export const allBadges = (levels: Level[]): Badge[] => [...COMMAND_BADGES, ...levels.map(levelBadge), ...EFFORT_BADGES];

/** badges this progress earns that it doesn't hold yet */
export const newBadges = (progress: LearnProgress, levels: Level[]): Badge[] =>
  allBadges(levels).filter((b) => !progress.badges[b.id] && b.earned(progress, levels));
