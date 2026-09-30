/**
 * Ops on module calls. The canvas and inspector use the resource op kinds
 * with a module's id (`module.vpc`) — `move_node`, `set_arg`, `unset_arg`,
 * `remove_resource`, `rename_resource` — plus `add_module` and
 * `module_moved`; applyOps (./ops.ts) hands those here.
 *
 * Renaming a module rewrites every `module.old…` reference (`moved` and
 * `removed` blocks keep the addresses they were written with). Keeping the
 * module's state is a separate op, `module_moved`, which records
 * `moved { from = module.old  to = module.new }` — asked for through
 * ./moduleMoved.ts, the one seam for it.
 */
import { renameInHcl, renameInRecord } from './expr';
import { isModuleId, moduleAddress } from './modules';
import type { Op } from './ops';
import type { Expression, IR, ModuleNode, RawBlock } from './types';

interface Acc {
  touched: Set<string>;
  removed: Set<string>;
  renamed: Map<string, string>;
}

/** Does `op` act on a module call? */
export function isModuleOp(op: Op): boolean {
  if (op.kind === 'add_module' || op.kind === 'module_moved') return true;
  if (op.kind === 'add_resource') return false;
  return isModuleId(op.nodeId);
}

/**
 * Apply one module op to `next` — applyOps' working copy (its arrays are
 * already copies; blocks are replaced, never mutated).
 */
export function applyModuleOp(next: IR, op: Op, acc: Acc): void {
  if (op.kind === 'add_module') {
    next.modules = [...next.modules, op.node];
    acc.touched.add(op.node.id);
    return;
  }
  if (op.kind === 'module_moved') {
    recordMove(next, op.from, op.to, acc);
    return;
  }
  if (op.kind === 'add_resource') return;
  const i = next.modules.findIndex((m) => m.id === op.nodeId);
  if (i === -1) return;
  const node = next.modules[i];
  const replace = (m: ModuleNode) => {
    next.modules = next.modules.map((x, j) => (j === i ? m : x));
    acc.touched.add(m.id);
  };
  switch (op.kind) {
    case 'remove_resource':
      next.modules = next.modules.filter((_, j) => j !== i);
      acc.removed.add(op.nodeId);
      acc.touched.delete(op.nodeId);
      return;
    case 'set_arg':
      replace({ ...node, args: { ...node.args, [op.field]: op.value } });
      return;
    case 'unset_arg': {
      if (!(op.field in node.args)) return;
      const args = { ...node.args };
      delete args[op.field];
      replace({ ...node, args });
      return;
    }
    case 'move_node':
      replace({ ...node, position: { ...op.position } });
      return;
    case 'rename_resource':
      renameModule(next, i, op.newName, acc);
      return;
  }
}

/* ---------------------------------------------------------------- moved */

// TODO(moved): a minimal, module-only version — see ./moduleMoved.ts for the
// seam to point at the generic helper (src/hcl/moved.ts) when it lands.

const MOVED_FROM = /\bfrom\s*=\s*([^\s#/]+)/;
const MOVED_TO = /\bto\s*=\s*([^\s#/]+)/;
/** blocks that name addresses as they were: never rewritten by a rename */
const HISTORY_BLOCK = /^\s*(?:moved|removed)\s*\{/;

/** `{ from, to }` of a `moved {}` block's text, else null. */
export function movedAddresses(text: string): { from: string; to: string } | null {
  if (!/^\s*moved\s*\{/.test(text)) return null;
  const from = MOVED_FROM.exec(text)?.[1];
  const to = MOVED_TO.exec(text)?.[1];
  return from && to ? { from, to } : null;
}

export function movedBlockText(from: string, to: string): string {
  return `moved {\n  from = ${from}\n  to   = ${to}\n}`;
}

function renameModule(next: IR, i: number, newName: string, acc: Acc) {
  const node = next.modules[i];
  const from = node.id;
  const to = moduleAddress(newName);
  if (to === from) return;
  acc.renamed.set(from, to);
  acc.touched.delete(from);
  acc.touched.add(to);

  const retarget = <T extends { id: string; args: Record<string, Expression> }>(b: T): T => {
    const args = renameInRecord(b.args, from, to);
    if (args === b.args) return b;
    acc.touched.add(b.id);
    return { ...b, args };
  };
  const renamed: ModuleNode = { ...node, id: to, name: newName };
  next.modules = next.modules.map((m, j) => (j === i ? { ...renamed, args: renameInRecord(renamed.args, from, to) } : retarget(m)));
  next.resources = next.resources.map(retarget);
  next.variables = next.variables.map(retarget);
  next.outputs = next.outputs.map(retarget);
  next.providers = next.providers.map(retarget);
  next.extras = next.extras.map((b) => {
    // `moved` / `removed` blocks keep the addresses they were written with (a chain
    // `a → b`, `b → c` is how Terraform follows successive renames)
    if (HISTORY_BLOCK.test(b.text)) return b;
    const text = renameInHcl(b.text, from, to);
    if (text === b.text) return b;
    acc.touched.add(b.id);
    return { ...b, text };
  });
}

/** Record `from → to` in a `moved` block, next to the module call (renamed back: the old move goes away). */
function recordMove(next: IR, from: string, to: string, acc: Acc) {
  if (from === to) return;
  const back = next.extras.find((b) => {
    const moved = movedAddresses(b.text);
    return moved?.from === to && moved.to === from;
  });
  if (back) {
    next.extras = next.extras.filter((b) => b !== back);
    return;
  }
  if (next.extras.some((b) => {
    const moved = movedAddresses(b.text);
    return moved?.from === from && moved.to === to;
  })) {
    return;
  }
  const call = next.modules.find((m) => m.id === to) ?? next.modules.find((m) => m.id === from);
  const block: RawBlock = {
    id: `raw.moved:${from}->${to}`,
    text: movedBlockText(from, to),
    trivia: { leadingComments: [], sourceFile: call?.trivia.sourceFile },
  };
  next.extras = [...next.extras, block];
  acc.touched.add(block.id);
}
