/**
 * The learning map: the AWS track (the main one) and a small Azure preview.
 * Lesson content lives in ./content, one module per level.
 */
import { lessons as aws0 } from './content/aws-0';
import { lessons as aws1 } from './content/aws-1';
import { lessons as aws2 } from './content/aws-2';
import { lessons as aws3 } from './content/aws-3';
import { lessons as azure0 } from './content/azure-0';
import type { Lesson, Level, StartChoice, Track } from './types';

export const TRACKS: Track[] = [
  {
    id: 'aws',
    title: { en: 'Terraform on AWS', pt: 'Terraform na AWS' },
    levels: [
      {
        id: 'aws-0',
        index: 0,
        title: { en: 'Fundamentals', pt: 'Fundamentos' },
        summary: {
          en: 'What Terraform is, your first blocks, and the plan/apply cycle.',
          pt: 'O que é Terraform, seus primeiros blocos e o ciclo plan/apply.',
        },
        lessons: aws0,
      },
      {
        id: 'aws-1',
        index: 1,
        title: { en: 'First resources', pt: 'Primeiros recursos' },
        summary: {
          en: 'An S3 bucket, tags, variables, locals and outputs.',
          pt: 'Um bucket S3, tags, variáveis, locals e outputs.',
        },
        lessons: aws1,
      },
      {
        id: 'aws-2',
        index: 2,
        title: { en: 'Network', pt: 'Rede' },
        summary: {
          en: 'VPC, subnets and CIDR, internet gateway and routes, public and private.',
          pt: 'VPC, sub-redes e CIDR, internet gateway e rotas, público e privado.',
        },
        lessons: aws2,
      },
      {
        id: 'aws-3',
        index: 3,
        title: { en: 'Compute and security', pt: 'Computação e segurança' },
        summary: {
          en: 'Security groups, EC2, security findings as feedback, an IAM role.',
          pt: 'Security groups, EC2, achados de segurança como feedback, um perfil do IAM.',
        },
        lessons: aws3,
      },
    ],
  },
  {
    id: 'azure',
    title: { en: 'Azure (preview)', pt: 'Azure (prévia)' },
    preview: true,
    levels: [
      {
        id: 'azure-0',
        index: 0,
        title: { en: 'Azure basics', pt: 'Azure básico' },
        summary: {
          en: 'Resource groups and how Azure nests everything inside them.',
          pt: 'Grupos de recursos e como o Azure aninha tudo dentro deles.',
        },
        lessons: azure0,
      },
    ],
  },
];

export const ALL_LEVELS: Level[] = TRACKS.flatMap((t) => t.levels);
export const ALL_LESSONS: Lesson[] = ALL_LEVELS.flatMap((l) => l.lessons);

const BY_SLUG = new Map(ALL_LESSONS.map((l) => [l.slug, l] as const));

export const getLesson = (slug: string): Lesson | undefined => BY_SLUG.get(slug);

export const levelOfLesson = (slug: string): Level | undefined => ALL_LEVELS.find((l) => l.lessons.some((x) => x.slug === slug));

export const trackOfLevel = (levelId: string): Track | undefined => TRACKS.find((t) => t.levels.some((l) => l.id === levelId));

/** the lesson after this one in its track (null at the end) */
export function nextLesson(slug: string): Lesson | null {
  const level = levelOfLesson(slug);
  const track = level && trackOfLevel(level.id);
  if (!track) return null;
  const order = track.levels.flatMap((l) => l.lessons);
  return order[order.indexOf(BY_SLUG.get(slug)!) + 1] ?? null;
}

/** where "Start here" points: the first lesson, or for people who know AWS the first one that isn't AWS basics */
export function startLesson(choice: StartChoice | null): Lesson | undefined {
  const order = TRACKS[0].levels.flatMap((l) => l.lessons);
  return choice === 'aws' ? (order.find((l) => !l.awsBasics) ?? order[0]) : order[0];
}

/** lessons that teach a resource type (the editor's "Learn about this") */
export const lessonsTeaching = (type: string): Lesson[] => ALL_LESSONS.filter((l) => l.teaches?.includes(type));
