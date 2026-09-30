/**
 * Ops on module calls. The canvas and inspector use the resource op kinds
 * with a module's id (`module.vpc`) — `move_node`, `set_arg`, `unset_arg`,
 * `remove_resource`, `rename_resource` — plus `add_module`; applyOps
 * (./ops.ts) hands those here.
 *
 * Renaming a module rewrites every `module.old…` reference and records a
 * `moved { from = module.old  to = module.new }` block so Terraform keeps the
 * module's state instead of destroying and re-creating everything in it.
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
  if (op.kind === 'add_module') return true;
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

// TODO(moved): a generic `moved` helper lands in src/hcl/moved.ts (the count /
// for_each work); reconcile this minimal module-only version with it.

const MOVED_FROM = /\bfrom\s*=\s*([^\s#/]+)/;
const MOVED_TO = /\bto\s*=\s*([^\s#/]+)/;

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

  // `moved` blocks keep the addresses they were written with (a chain
  // `a → b`, `b → c` is how Terraform follows successive renames)
  let backAgain: RawBlock | undefined;
  let already = false;
  next.extras = next.extras.map((b) => {
    const moved = movedAddresses(b.text);
    if (moved) {
      if (moved.from === to && moved.to === from) backAgain = b;
      if (moved.from === from && moved.to === to) already = true;
      return b;
    }
    const text = renameInHcl(b.text, from, to);
    if (text === b.text) return b;
    acc.touched.add(b.id);
    return { ...b, text };
  });
  if (backAgain) {
    // renamed back to what it was: the old move no longer applies
    next.extras = next.extras.filter((b) => b !== backAgain);
    return;
  }
  if (already) return;
  next.extras = [
    ...next.extras,
    {
      id: `raw.moved:${from}->${to}`,
      text: movedBlockText(from, to),
      trivia: { leadingComments: [], sourceFile: node.trivia.sourceFile },
    },
  ];
  acc.touched.add(`raw.moved:${from}->${to}`);
}
