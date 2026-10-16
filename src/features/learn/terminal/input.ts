/**
 * What a line typed at the simulated terminal's prompt asks for:
 * `terraform plan` (or `tf plan`) with its flags (`-var 'name=value'`,
 * `-var-file=prod.tfvars`, `-out=tfplan`, `apply tfplan`…), `help`,
 * `clear`, the commands that read the state (`output`, `show`, `state list`,
 * `workspace`), or something this terminal answers with a hint. And what
 * Tab completes there.
 */
import type { SimContext, VarArg } from '@/learn/sim/simulate';
import type { SimCommand } from '@/learn/types';

/** what a command's flags add to the simulator's context */
export type SimFlags = Pick<SimContext, 'vars' | 'out' | 'generateConfig' | 'backendFlag'> & {
  /** `apply tfplan` */
  planFile?: string;
};

export type Typed =
  | { kind: 'empty' }
  | { kind: 'help' }
  | { kind: 'clear' }
  | { kind: 'sim'; command: SimCommand; autoApprove: boolean; flags?: SimFlags }
  | { kind: 'version' }
  /** `output`, `show`, `workspace`: the words after the subcommand */
  | { kind: 'output' | 'show' | 'workspace'; args: string[] }
  | { kind: 'state-list' }
  /** a flag the command doesn't take, or one without its value: Terraform's own error */
  | { kind: 'bad-flag'; sub: string; summary: string; detail: string }
  /** a real Terraform command this terminal doesn't simulate */
  | { kind: 'not-here'; sub: string }
  /** `terraform plna`: Terraform has no such command */
  | { kind: 'no-such'; sub: string }
  /** not Terraform at all (`plan`, `ls`): the shell's "command not found", with a guess */
  | { kind: 'not-found'; word: string; guess?: SimCommand };

export const SIM_COMMANDS: readonly SimCommand[] = ['init', 'validate', 'plan', 'apply', 'destroy'];

const REAL = ['console', 'fmt', 'force-unlock', 'get', 'graph', 'import', 'login', 'logout', 'metadata', 'modules', 'providers', 'refresh', 'taint', 'test', 'untaint'];

const isSim = (word: string | undefined): word is SimCommand => SIM_COMMANDS.includes(word as SimCommand);

/** a line split into words like a shell does: quotes group (`-var 'name=a b'`) and go away */
export function words(text: string): string[] {
  const out: string[] = [];
  let word = '';
  let started = false;
  let quote: string | null = null;
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) out.push(word);
      word = '';
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (started) out.push(word);
  return out;
}

/** the flags that take a value, and the commands that take them */
const VALUED: Record<string, readonly SimCommand[]> = {
  var: ['plan', 'apply', 'destroy'],
  'var-file': ['plan', 'apply', 'destroy'],
  out: ['plan'],
  'generate-config-out': ['plan'],
};

const flagError = (sub: string, message: string): Typed => ({ kind: 'bad-flag', sub, summary: 'Failed to parse command-line flags', detail: message });

/** a simulated command's flags, as its real one reads them */
function simFlags(command: SimCommand, rest: string[]): Typed {
  let autoApprove = false;
  const flags: SimFlags = {};
  const vars: VarArg[] = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (!w.startsWith('-')) {
      if (command === 'apply' && flags.planFile === undefined) {
        flags.planFile = w;
        continue;
      }
      return { kind: 'bad-flag', sub: command, summary: 'Too many command line arguments', detail: 'Expected at most one positional argument.' };
    }
    const [, name, inline] = /^--?([\w-]+)(?:=([\s\S]*))?$/.exec(w) ?? [];
    if (name === 'auto-approve' && (command === 'apply' || command === 'destroy')) autoApprove = true;
    else if ((name === 'migrate-state' || name === 'reconfigure') && command === 'init') flags.backendFlag = name;
    else if (name === 'upgrade' && command === 'init') continue;
    else if (name !== undefined && VALUED[name]?.includes(command)) {
      const value = inline ?? rest[++i];
      if (value === undefined) return flagError(command, `flag needs an argument: -${name}`);
      if (name === 'var') vars.push({ kind: 'var', text: value });
      else if (name === 'var-file') vars.push({ kind: 'file', name: value });
      else if (name === 'out') flags.out = value;
      else flags.generateConfig = value;
    } else return flagError(command, `flag provided but not defined: ${w.replace(/=[\s\S]*$/, '')}`);
  }
  if (vars.length > 0) flags.vars = vars;
  return { kind: 'sim', command, autoApprove, ...(Object.keys(flags).length > 0 ? { flags } : {}) };
}

export function parseTyped(text: string): Typed {
  const [head, sub, ...rest] = words(text.trim());
  if (head === undefined) return { kind: 'empty' };
  if (head === 'help' || head === '?') return { kind: 'help' };
  if (head === 'clear' || head === 'cls') return { kind: 'clear' };
  if (head !== 'terraform' && head !== 'tf') return { kind: 'not-found', word: head, ...(isSim(head) ? { guess: head } : {}) };
  if (sub === undefined || ['help', '-help', '--help', '-h'].includes(sub)) return { kind: 'help' };
  if (isSim(sub)) return simFlags(sub, rest);
  if (['version', '-version', '--version', '-v'].includes(sub)) return { kind: 'version' };
  if (sub === 'output' || sub === 'show' || sub === 'workspace') return { kind: sub, args: rest };
  if (sub === 'state' && rest[0] === 'list') return { kind: 'state-list' };
  return REAL.includes(sub) || sub === 'state' ? { kind: 'not-here', sub } : { kind: 'no-such', sub };
}

/* ------------------------------------------------------------------ Tab */

/** what Tab can offer besides the fixed words: names from the lesson */
export interface CompletionContext {
  outputs: string[];
  workspaces: string[];
  /** saved plans (`plan -out`) */
  plans: string[];
  /** the lesson's files (`-var-file=` offers the `.tfvars` ones) */
  files: string[];
}

const SUBCOMMANDS = ['init', 'validate', 'plan', 'apply', 'destroy', 'output', 'show', 'state', 'workspace', 'version'];

function candidates(prev: string[], word: string, ctx: CompletionContext): string[] {
  if (prev.length === 0) return ['terraform', 'tf', 'help', 'clear'];
  if (prev[0] !== 'terraform' && prev[0] !== 'tf') return [];
  if (prev.length === 1) return SUBCOMMANDS;
  if (word.startsWith('-var-file=')) return ctx.files.filter((f) => f.endsWith('.tfvars')).map((f) => `-var-file=${f}`);
  const vars = ['-var', '-var-file='];
  switch (prev[1]) {
    case 'init':
      return ['-migrate-state', '-reconfigure', '-upgrade'];
    case 'plan':
      return ['-out=', ...vars, '-generate-config-out='];
    case 'apply':
      return ['-auto-approve', ...vars, ...ctx.plans];
    case 'destroy':
      return ['-auto-approve', ...vars];
    case 'output':
      return ['-raw', '-json', ...ctx.outputs];
    case 'show':
      return ctx.plans;
    case 'state':
      return prev.length === 2 ? ['list'] : [];
    case 'workspace':
      return prev.length === 2 ? ['list', 'show', 'new', 'select', 'delete'] : prev.length === 3 && (prev[2] === 'select' || prev[2] === 'delete') ? ctx.workspaces : [];
    default:
      return [];
  }
}

/**
 * Tab at the end of `text`: the word being typed completed (to the longest
 * prefix its matches share), and the matches when there's more than one.
 * Null: nothing matches.
 */
export function complete(text: string, ctx: CompletionContext): { text: string; options: string[] } | null {
  const at = text.search(/\S*$/);
  const word = text.slice(at);
  const prev = text.slice(0, at).trim().split(/\s+/).filter(Boolean);
  const matches = [...new Set(candidates(prev, word, ctx))].filter((c) => c.startsWith(word));
  if (matches.length === 0) return null;
  let common = matches[0];
  for (const m of matches) while (!m.startsWith(common)) common = common.slice(0, -1);
  const done = matches.length === 1 && !common.endsWith('=');
  return { text: text.slice(0, at) + common + (done ? ' ' : ''), options: matches.length > 1 ? matches : [] };
}
