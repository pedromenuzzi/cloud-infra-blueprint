/** Celebrations on the learning side: XP, a finished lesson or level, a new rank, a badge. */
import { defineMessages } from '@/i18n/messages';

export const celebrationMessages = defineMessages(
  {
    xp: (n: number) => `+${n} XP`,
    lessonDone: 'Lesson complete',
    challengeDone: 'Challenge complete',
    newRank: 'New rank',
    badgeUnlocked: 'Badge unlocked',
    levelDone: 'Level complete',
    streak: 'Streak',
    streakDays: (n: number) => `${n} days in a row`,
    levelBody: (lessons: number, index: number) =>
      `You finished ${lessons === 1 ? 'the lesson' : `all ${lessons} lessons`} of level ${index} and earned its badge.`,
    levelXp: (xp: number) => `${xp} XP earned in this level`,
    nextLesson: (code: string, title: string) => `Next: ${code} ${title}`,
    backToMap: 'Back to the map',
    // what a screen reader hears
    sayXp: (n: number, total: number) => `${n} XP earned, ${total} XP in total.`,
    sayLesson: (title: string) => `Lesson complete: ${title}.`,
    sayRank: (title: string) => `New rank: ${title}.`,
    sayBadge: (title: string) => `Badge unlocked: ${title}.`,
    sayLevel: (title: string) => `Level complete: ${title}. Its badge is yours.`,
    sayStreak: (n: number) => `${n} days in a row of learning.`,
  },
  {
    xp: (n: number) => `+${n} XP`,
    lessonDone: 'Lição concluída',
    challengeDone: 'Desafio concluído',
    newRank: 'Nova patente',
    badgeUnlocked: 'Conquista desbloqueada',
    levelDone: 'Nível concluído',
    streak: 'Sequência',
    streakDays: (n: number) => `${n} dias seguidos`,
    levelBody: (lessons: number, index: number) =>
      `Você concluiu ${lessons === 1 ? 'a lição' : `as ${lessons} lições`} do nível ${index} e ganhou a conquista dele.`,
    levelXp: (xp: number) => `${xp} XP ganhos neste nível`,
    nextLesson: (code: string, title: string) => `Próxima: ${code} ${title}`,
    backToMap: 'Voltar ao mapa',
    sayXp: (n: number, total: number) => `${n} XP ganhos, ${total} XP no total.`,
    sayLesson: (title: string) => `Lição concluída: ${title}.`,
    sayRank: (title: string) => `Nova patente: ${title}.`,
    sayBadge: (title: string) => `Conquista desbloqueada: ${title}.`,
    sayLevel: (title: string) => `Nível concluído: ${title}. A conquista dele é sua.`,
    sayStreak: (n: number) => `${n} dias seguidos de estudo.`,
  },
);
