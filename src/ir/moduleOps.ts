/**
 * Ops on module calls. The canvas and inspector use the resource op kinds
 * with a module's id (`module.vpc`) — `move_node`, `set_arg`, `unset_arg`,
 * `remove_resource`, `rename_resource` — plus `add_module` and
 * `module_moved`; applyOps (./ops.ts) hands those here.
 *
 * Renaming a module rewrites every `module.old…` reference (`moved` and
 * `removed` blocks keep the addresses they were written with). Keeping the
 * module's state is asked for separately, through ./moduleMoved.ts.
 */
import { isStateBlockText } from '@/hcl/moved';
import { renameInExpression, renameInHcl, renameInRecord } from './expr';
import { isModuleId, moduleAddress } from './modules';
import type { Op, TextRewrite } from './ops';
import type { Expression, IR, ModuleNode } from './types';

interface Acc {
  touched: Set<string>;
  removed: Set<string>;
  renamed: Map<string, string>;
  /** renames in op order — the patcher rewrites those tokens in place */
  rewrites: TextRewrite[];
}

/** Does `op` act on a module call? */
export function isModuleOp(op: Op): boolean {
  if (op.kind === 'add_module') return true;
  // add_resource and the ops on verbatim blocks / references carry no node id
  return 'nodeId' in op && isModuleId(op.nodeId);
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
  if (!('nodeId' in op)) return;
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

function renameModule(next: IR, i: number, newName: string, acc: Acc) {
  const node = next.modules[i];
  const from = node.id;
  const to = moduleAddress(newName);
  if (to === from) return;
  acc.renamed.set(from, to);
  acc.rewrites.push({ expr: (e) => renameInExpression(e, from, to), hcl: (t) => renameInHcl(t, from, to) });
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
    if (isStateBlockText(b.text)) return b;
    const text = renameInHcl(b.text, from, to);
    if (text === b.text) return b;
    acc.touched.add(b.id);
    return { ...b, text };
  });
}
