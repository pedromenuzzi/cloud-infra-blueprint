/**
 * The ops that record a module rename in a `moved` block, so Terraform keeps
 * the module's state instead of destroying and re-creating everything in it.
 * The same planner as resource renames (src/hcl/moved.ts): the block goes
 * right after the module call, blocks written this session collapse
 * (a → b → c is one move, renaming back removes it), history is never
 * rewritten.
 */
import { moveOps, type MovedStatement } from '@/hcl/moved';
import type { Op } from './ops';
import type { IR } from './types';

/** Ops recording that module call `from` (`module.old`) is now `to` (`module.new`); apply them after the rename. */
export function moduleMoveOps(ir: IR, from: string, to: string, isHistory?: (m: MovedStatement) => boolean): Op[] {
  if (from === to) return [];
  const call = ir.modules.find((m) => m.id === from);
  return moveOps(ir, [{ from, to }], { after: to, file: call?.trivia.sourceFile, isHistory });
}
