/**
 * The learning map's contract: tracks hold levels, levels hold lessons, a
 * lesson is prose + starting files + goals checked live against the code +
 * a solution. Everything here is data (plus each goal's `test`), so the map,
 * the player, the simulated terminal and the content test share one shape.
 */
import type { Locale } from '@/i18n/locale';
import type { Diagnostic, IR, IREdge } from '@/ir/types';
import type { AuditResult } from '@/security/audit';

/** text a person reads, in both UI languages side by side; `backticks` are inline code, *stars* emphasis */
export interface T {
  en: string;
  pt: string;
}

export const textIn = (text: T, locale: Locale): string => (locale === 'pt-BR' ? text.pt : text.en);

export type Files = Record<string, string>;

/* ------------------------------------------------------------ terraform simulator */

export type SimCommand = 'init' | 'validate' | 'plan' | 'apply' | 'destroy';

export type PlanAction = 'create' | 'update' | 'replace' | 'delete';

export interface PlanChange {
  /** `aws_vpc.main`, `aws_subnet.public[0]`, `module.net.aws_vpc.this` */
  address: string;
  action: PlanAction;
  /** attribute → [before, after]; `null` after = "(known after apply)" */
  attributes?: Record<string, [string | null, string | null]>;
}

export interface PlanSummary {
  changes: PlanChange[];
  add: number;
  change: number;
  destroy: number;
}

/** what a simulated `apply` leaves behind: per address, its attributes as Terraform would store them */
export interface SimState {
  serial: number;
  resources: Record<string, Record<string, string>>;
  outputs: Record<string, string>;
}

/* ------------------------------------------------------------ goals */

/** everything a goal can look at; built once per code change (goals.ts `lessonContext`) */
export interface LessonCtx {
  files: Files;
  /** the root module, parsed (positions and containment derived like the editor's) */
  ir: IR;
  edges: IREdge[];
  /** parse errors and validation warnings */
  diagnostics: Diagnostic[];
  /** the code has a parse error */
  errored: boolean;
  /** the security audit, computed on first use */
  readonly audit: AuditResult;
  /** terminal commands the learner ran successfully in this lesson */
  ran: ReadonlySet<SimCommand>;
  /** the simulated state after the last apply (null: never applied, or destroyed) */
  state: SimState | null;
}

export interface Goal {
  /** stable within its lesson: progress remembers which goals were met */
  id: string;
  /** what to do, as a checklist item: "A VPC with `10.0.0.0/16`" */
  text: T;
  /** shown when the learner asks for help on this goal */
  hint: T;
  test(ctx: LessonCtx): boolean;
}

/* ------------------------------------------------------------ lessons */

/**
 * How the learner builds in this lesson:
 * - canvas: drag from the palette, read the generated code;
 * - mixed: the canvas works, some goals need typing;
 * - code: type it; the canvas draws the code live.
 */
export type LessonMode = 'canvas' | 'mixed' | 'code';

/** a collapsible "What is a VPC?" box; `awsBasics` boxes start collapsed for people who know AWS */
export interface Aside {
  title: T;
  body: T[];
  awsBasics?: boolean;
}

export interface Lesson {
  /** URL slug, unique across tracks: /learn/<slug> */
  slug: string;
  /** "0.2", "2.4", "C1" (a level's challenge): the station label on the map */
  code: string;
  kind: 'lesson' | 'challenge';
  mode: LessonMode;
  minutes: number;
  /** XP for completing it (halved when the solution was shown) */
  xp: number;
  title: T;
  /** one line on the map */
  summary: T;
  /** concept and instructions, one paragraph each */
  body: T[];
  asides?: Aside[];
  /** the whole lesson only explains AWS itself: optional for people who know AWS */
  awsBasics?: boolean;
  /** the code the lesson opens with */
  start: Files;
  /** a complete answer: every goal passes on it, and it passes `terraform validate` */
  solution: Files;
  /** checked live, in order; all met = lesson complete */
  goals: Goal[];
  /** resource / data types this lesson teaches: the editor links to it ("Learn about this") */
  teaches?: string[];
}

export interface Level {
  /** unique across tracks: 'aws-0', 'azure-0' */
  id: string;
  /** 0, 1, 2… within its track */
  index: number;
  title: T;
  summary: T;
  lessons: Lesson[];
}

export type TrackId = 'aws' | 'azure';

export interface Track {
  id: TrackId;
  title: T;
  /** a smaller track shown below the main one */
  preview?: boolean;
  levels: Level[];
}

/** "Where do you start?": new to everything, or knows AWS and is new to Terraform */
export type StartChoice = 'new' | 'aws';
