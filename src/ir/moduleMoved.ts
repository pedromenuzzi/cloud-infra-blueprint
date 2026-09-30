/**
 * SEAM(moved) — the ops that record a module rename in a `moved` block, so
 * Terraform keeps the module's state instead of destroying and re-creating
 * everything in it. Callers (the module inspector's rename) ask this one
 * function; nothing else writes module `moved` blocks.
 *
 * INTEGRATION: when feat/repeat's generic helper lands (src/hcl/moved.ts),
 * make this return `moveOps(ir, [{ from, to }], …)` and drop the
 * `module_moved` op (src/ir/ops.ts, handled in src/ir/moduleOps.ts).
 */
import type { Op } from './ops';
import type { IR } from './types';

/** Ops recording that module call `from` (`module.old`) is now `to` (`module.new`). */
export function moduleMoveOps(_ir: IR, from: string, to: string): Op[] {
  return from === to ? [] : [{ kind: 'module_moved', from, to }];
}
