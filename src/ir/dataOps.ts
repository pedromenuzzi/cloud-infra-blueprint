/**
 * Ops on data blocks. The canvas and inspector use the resource op kinds
 * with a data source's id (`data.aws_ami.ubuntu`): `move_node`, `set_arg`,
 * `unset_arg`, `remove_resource`, `rename_resource`, plus `add_data`;
 * applyOps (./ops.ts) hands those here.
 *
 * Renaming a data source rewrites every `data.type.old…` reference. A data
 * source holds no state, so a rename never needs a `moved` block.
 */
import { isStateBlockText } from '@/hcl/moved';
import { isDataId } from './dataSources';
import { renameInExpression, renameInHcl, renameInRecord } from './expr';
import type { Op, TextRewrite } from './ops';
import type { DataNode, Expression, IR } from './types';
import { dataAddress } from './types';

interface Acc {
  touched: Set<string>;
  removed: Set<string>;
  renamed: Map<string, string>;
  /** renames in op order: the patcher rewrites those tokens in place */
  rewrites: TextRewrite[];
}

/** Does `op` act on a data block? */
export function isDataOp(op: Op): boolean {
  if (op.kind === 'add_data') return true;
  return 'nodeId' in op && isDataId(op.nodeId);
}

/**
 * Apply one data op to `next`, applyOps' working copy (its arrays are
 * already copies; blocks are replaced, never mutated).
 */
export function applyDataOp(next: IR, op: Op, acc: Acc): void {
  if (op.kind === 'add_data') {
    next.data = [...next.data, op.node];
    acc.touched.add(op.node.id);
    return;
  }
  if (!('nodeId' in op)) return;
  // duplicate addresses are a Terraform error (the parser flags them); ops act on the first
  const i = next.data.findIndex((d) => d.id === op.nodeId);
  if (i === -1) return;
  const node = next.data[i];
  const replace = (d: DataNode) => {
    next.data = next.data.map((x, j) => (j === i ? d : x));
    acc.touched.add(d.id);
  };
  switch (op.kind) {
    case 'remove_resource':
      next.data = next.data.filter((_, j) => j !== i);
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
      renameData(next, i, op.newName, acc);
      return;
  }
}

function renameData(next: IR, i: number, newName: string, acc: Acc) {
  const node = next.data[i];
  const from = node.id;
  const to = dataAddress(node.type, newName);
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
  const renamed: DataNode = { ...node, id: to, name: newName };
  next.data = next.data.map((d, j) => (j === i ? { ...renamed, args: renameInRecord(renamed.args, from, to) } : retarget(d)));
  next.resources = next.resources.map(retarget);
  next.modules = next.modules.map(retarget);
  next.variables = next.variables.map(retarget);
  next.outputs = next.outputs.map(retarget);
  next.providers = next.providers.map(retarget);
  next.extras = next.extras.map((b) => {
    // `moved` / `removed` blocks name state addresses, which data sources have none of
    if (isStateBlockText(b.text)) return b;
    const text = renameInHcl(b.text, from, to);
    if (text === b.text) return b;
    acc.touched.add(b.id);
    return { ...b, text };
  });
}
