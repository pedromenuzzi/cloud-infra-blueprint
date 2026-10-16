/** The learning map (/learn): player card, "Where do you start?", the trail, badges. */
import { defineMessages } from '@/i18n/messages';

const s = (n: number) => (n === 1 ? '' : 's');

export const learnMessages = defineMessages(
  {
    title: 'Learning map',
    eyebrow: 'Learning map',
    heading: 'Learn Terraform, one station at a time',
    intro:
      'Short hands-on lessons, from your first block to modules and a production setup. You write real code, the canvas draws it live and a simulated terminal runs init, plan and apply. Free, no account, no cloud bill.',
    continueFrom: 'Continue where you left off',
    startHere: 'Start here',
    lessonCode: (code: string, title: string) => `${code} · ${title}`,
    openLesson: (code: string, title: string) => `Open lesson ${code} ${title}`,

    // "Where do you start?"
    whereStart: 'Where do you start?',
    whereStartHint: 'Pick what fits. You can change it any time and nothing is ever locked.',
    startNew: 'New to AWS and Terraform',
    startNewHint: 'Start from zero: we explain the AWS parts along the way.',
    startAws: 'I know AWS, new to Terraform',
    startAwsHint: 'AWS basics become optional and you start at the first Terraform lesson.',

    // player card
    yourProgress: 'Your progress',
    rank: 'Rank',
    totalXp: (xp: number) => `${xp} XP`,
    toNextRank: (xp: number, rank: string) => `${xp} XP to ${rank}`,
    topRank: 'Top rank reached',
    rankProgress: 'XP toward the next rank',
    streak: 'Streak',
    days: (n: number) => `${n} day${s(n)}`,
    bestStreak: (n: number) => `Best: ${n}`,
    streakToday: 'Today counts',
    streakKeep: (next: number) => `One lesson today makes it ${next} days`,
    streakStart: 'Learn today to start one',
    badges: 'Badges',
    lessons: 'Lessons',
    countOf: (n: number, total: number) => `${n} of ${total}`,

    // the map
    level: (index: number) => `Level ${index}`,
    levelDone: (done: number, total: number) => `${done} of ${total} done`,
    levelXp: (xp: number) => `${xp} XP earned`,
    levelXpToEarn: (xp: number) => `${xp} XP to earn`,
    levelBadge: 'Level badge',
    badgeEarned: (title: string) => `Badge earned: ${title}`,
    badgeLocked: (title: string) => `Badge not earned yet: ${title}`,
    comingSoon: 'The lessons of this level are on the way.',
    preview: 'Preview',
    lessonsOf: (track: string) => `${track} lessons`,
    challenge: 'Challenge',
    optional: 'Optional',
    youAreHere: 'You are here',
    notStarted: 'Not started',
    inProgress: (met: number, total: number) => `In progress, ${met} of ${total} goals met`,
    doneXp: (xp: number) => `Done, ${xp} XP earned`,
    minutes: (n: number) => `${n} min`,
    xp: (n: number) => `${n} XP`,
    earned: (n: number) => `+${n} XP`,

    // badges
    badgesIntro: 'Earned by learning: finishing levels, running commands, keeping a streak.',
    earnedOn: (date: string) => `Earned ${date}`,
    notEarned: 'Not earned yet',

    // reset
    savedHere: 'Your progress is saved in this browser and goes into your backups.',
    reset: 'Reset progress',
    resetTitle: 'Reset your learning progress?',
    resetBody:
      'Your XP, rank, badges, streak, finished lessons and the code you wrote in lessons are removed from this browser. Your projects are not touched.',
    resetDone: 'Learning progress reset',
  },
  {
    title: 'Mapa de aprendizado',
    eyebrow: 'Mapa de aprendizado',
    heading: 'Aprenda Terraform, uma estação de cada vez',
    intro:
      'Lições curtas e práticas, do seu primeiro bloco até módulos e uma configuração pronta para produção. Você escreve código de verdade, o canvas desenha ao vivo e um terminal simulado roda init, plan e apply. Gratuito, sem cadastro e sem fatura de nuvem.',
    continueFrom: 'Continue de onde parou',
    startHere: 'Comece aqui',
    lessonCode: (code: string, title: string) => `${code} · ${title}`,
    openLesson: (code: string, title: string) => `Abrir a lição ${code} ${title}`,

    whereStart: 'Por onde você começa?',
    whereStartHint: 'Escolha o que combina com você. Dá para mudar quando quiser e nada fica bloqueado.',
    startNew: 'Sou novo em AWS e Terraform',
    startNewHint: 'Comece do zero: explicamos as partes da AWS pelo caminho.',
    startAws: 'Conheço AWS, sou novo em Terraform',
    startAwsHint: 'O básico de AWS fica opcional e você começa na primeira lição de Terraform.',

    yourProgress: 'Seu progresso',
    rank: 'Patente',
    totalXp: (xp: number) => `${xp} XP`,
    toNextRank: (xp: number, rank: string) => `Faltam ${xp} XP para ${rank}`,
    topRank: 'Patente máxima alcançada',
    rankProgress: 'XP até a próxima patente',
    streak: 'Sequência',
    days: (n: number) => `${n} dia${s(n)}`,
    bestStreak: (n: number) => `Recorde: ${n}`,
    streakToday: 'Hoje já conta',
    streakKeep: (next: number) => `Uma lição hoje e são ${next} dias`,
    streakStart: 'Estude hoje para começar uma',
    badges: 'Conquistas',
    lessons: 'Lições',
    countOf: (n: number, total: number) => `${n} de ${total}`,

    level: (index: number) => `Nível ${index}`,
    levelDone: (done: number, total: number) => `${done} de ${total} concluídas`,
    levelXp: (xp: number) => `${xp} XP ganhos`,
    levelXpToEarn: (xp: number) => `${xp} XP para ganhar`,
    levelBadge: 'Conquista do nível',
    badgeEarned: (title: string) => `Conquista obtida: ${title}`,
    badgeLocked: (title: string) => `Conquista ainda não obtida: ${title}`,
    comingSoon: 'As lições deste nível estão a caminho.',
    preview: 'Prévia',
    lessonsOf: (track: string) => `Lições de ${track}`,
    challenge: 'Desafio',
    optional: 'Opcional',
    youAreHere: 'Você está aqui',
    notStarted: 'Não iniciada',
    inProgress: (met: number, total: number) => `Em andamento, ${met} de ${total} objetivos cumpridos`,
    doneXp: (xp: number) => `Concluída, ${xp} XP ganhos`,
    minutes: (n: number) => `${n} min`,
    xp: (n: number) => `${n} XP`,
    earned: (n: number) => `+${n} XP`,

    badgesIntro: 'Ganhas aprendendo: concluindo níveis, rodando comandos, mantendo a sequência.',
    earnedOn: (date: string) => `Obtida em ${date}`,
    notEarned: 'Ainda não obtida',

    savedHere: 'Seu progresso fica salvo neste navegador e entra nos seus backups.',
    reset: 'Zerar o progresso',
    resetTitle: 'Zerar seu progresso de aprendizado?',
    resetBody:
      'Seu XP, patente, conquistas, sequência, lições concluídas e o código que você escreveu nas lições são removidos deste navegador. Seus projetos não são afetados.',
    resetDone: 'Progresso de aprendizado zerado',
  },
);
