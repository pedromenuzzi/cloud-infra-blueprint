/**
 * What a line typed at the simulated terminal's prompt asks for:
 * `terraform plan` (or `tf plan`), `terraform apply -auto-approve`, `help`,
 * `clear`, the few read-only extras (`version`, `output`, `state list`), or
 * something this terminal answers with a hint.
 */
import type { SimCommand } from '@/learn/types';

export type Typed =
  | { kind: 'empty' }
  | { kind: 'help' }
  | { kind: 'clear' }
  | { kind: 'sim'; command: SimCommand; autoApprove: boolean }
  | { kind: 'version' }
  | { kind: 'output' }
  | { kind: 'state-list' }
  /** a real Terraform command this terminal doesn't simulate */
  | { kind: 'not-here'; sub: string }
  /** `terraform plna`: Terraform has no such command */
  | { kind: 'no-such'; sub: string }
  /** not Terraform at all (`plan`, `ls`): the shell's "command not found", with a guess */
  | { kind: 'not-found'; word: string; guess?: SimCommand };

export const SIM_COMMANDS: readonly SimCommand[] = ['init', 'validate', 'plan', 'apply', 'destroy'];

const REAL = ['console', 'fmt', 'force-unlock', 'get', 'graph', 'import', 'login', 'logout', 'metadata', 'modules', 'providers', 'refresh', 'show', 'state', 'taint', 'test', 'untaint', 'workspace'];

const isSim = (word: string | undefined): word is SimCommand => SIM_COMMANDS.includes(word as SimCommand);

export function parseTyped(text: string): Typed {
  const [head, sub, ...rest] = text.trim().split(/\s+/).filter(Boolean);
  if (head === undefined) return { kind: 'empty' };
  if (head === 'help' || head === '?') return { kind: 'help' };
  if (head === 'clear' || head === 'cls') return { kind: 'clear' };
  if (head !== 'terraform' && head !== 'tf') return { kind: 'not-found', word: head, ...(isSim(head) ? { guess: head } : {}) };
  if (sub === undefined || ['help', '-help', '--help', '-h'].includes(sub)) return { kind: 'help' };
  if (isSim(sub)) return { kind: 'sim', command: sub, autoApprove: rest.some((f) => f === '-auto-approve' || f === '--auto-approve') };
  if (['version', '-version', '--version', '-v'].includes(sub)) return { kind: 'version' };
  if (sub === 'output') return { kind: 'output' };
  if (sub === 'state' && rest[0] === 'list') return { kind: 'state-list' };
  return REAL.includes(sub) ? { kind: 'not-here', sub } : { kind: 'no-such', sub };
}
