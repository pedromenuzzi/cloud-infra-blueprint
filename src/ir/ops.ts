/**
 * Ops — atomic IR mutations originated by the canvas / inspector.
 * `applyOps` is pure: it returns a new IR plus the set of block ids whose
 * HCL text must be re-emitted (the minimal-patch working set). Untouched
 * blocks keep their object identity, which is how the patcher skips them.
 */
import { renameInHcl, renameInRecord } from './expr';
import { applyModuleOp, isModuleOp } from './moduleOps';
import type { CanvasPosition, Expression, IR, ModuleNode, ResourceNode } from './types';
import { resourceAddress } from './types';

export type Op =
  | { kind: 'add_resource'; node: ResourceNode }
  | { kind: 'remove_resource'; nodeId: string }
  | { kind: 'set_arg'; nodeId: string; field: string; value: Expression }
  | { kind: 'unset_arg'; nodeId: string; field: string }
  | { kind: 'rename_resource'; nodeId: string; newName: string }
  | { kind: 'move_node'; nodeId: string; position: CanvasPosition }
  /** a new `module` call (the other kinds act on one through its id, `module.x`: see ./moduleOps.ts) */
  | { kind: 'add_module'; node: ModuleNode };

export interface ApplyResult {
  ir: IR;
  /** ids of blocks whose text changed (resources / variables / outputs / providers / extras) */
  touched: Set<string>;
  /** old ids of removed resources */
  removed: Set<string>;
  /** rename map: old id → new id */
  renamed: Map<string, string>;
}

export function applyOps(ir: IR, ops: Op[]): ApplyResult {
  const next: IR = {
    ...ir,
    resources: [...ir.resources],
    variables: [...ir.variables],
    outputs: [...ir.outputs],
    providers: [...ir.providers],
    modules: [...ir.modules],
    extras: [...ir.extras],
  };
  const touched = new Set<string>();
  const removed = new Set<string>();
  const renamed = new Map<string, string>();

  // Duplicate addresses are a Terraform error (the parser flags them); ops act on the first.
  const findIndex = (id: string) => next.resources.findIndex((r) => r.id === id);

  for (const op of ops) {
    if (isModuleOp(op)) {
      applyModuleOp(next, op, { touched, removed, renamed });
      continue;
    }
    switch (op.kind) {
      case 'add_resource': {
        next.resources.push(op.node);
        touched.add(op.node.id);
        break;
      }
      case 'remove_resource': {
        const i = findIndex(op.nodeId);
        if (i === -1) break;
        next.resources.splice(i, 1);
        removed.add(op.nodeId);
        touched.delete(op.nodeId);
        break;
      }
      case 'set_arg': {
        const i = findIndex(op.nodeId);
        if (i === -1) break;
        const node = next.resources[i];
        next.resources[i] = { ...node, args: { ...node.args, [op.field]: op.value } };
        touched.add(op.nodeId);
        break;
      }
      case 'unset_arg': {
        const i = findIndex(op.nodeId);
        if (i === -1) break;
        const node = next.resources[i];
        const args = { ...node.args };
        delete args[op.field];
        next.resources[i] = { ...node, args };
        touched.add(op.nodeId);
        break;
      }
      case 'move_node': {
        const i = findIndex(op.nodeId);
        if (i === -1) break;
        const node = next.resources[i];
        next.resources[i] = { ...node, position: { ...op.position } };
        touched.add(op.nodeId);
        break;
      }
      case 'rename_resource': {
        const i = findIndex(op.nodeId);
        if (i === -1) break;
        const node = next.resources[i];
        const from = node.id;
        const to = resourceAddress(node.type, op.newName);
        if (to === from) break;

        const renamedNode: ResourceNode = { ...node, id: to, name: op.newName };
        renamed.set(from, to);
        touched.delete(from);
        touched.add(to);

        // Rewrite references everywhere: bare refs, traversals inside raw
        // expressions (functions, templates, jsonencode…) and verbatim blocks.
        const retarget = <T extends { id: string; args: Record<string, Expression> }>(b: T): T => {
          const args = renameInRecord(b.args, from, to);
          if (args === b.args) return b;
          touched.add(b.id);
          return { ...b, args };
        };
        next.resources = next.resources.map((r, j) => (j === i ? renamedNode : retarget(r)));
        next.variables = next.variables.map(retarget);
        next.outputs = next.outputs.map(retarget);
        next.providers = next.providers.map(retarget);
        next.modules = next.modules.map(retarget);
        next.extras = next.extras.map((b) => {
          const text = renameInHcl(b.text, from, to);
          if (text === b.text) return b;
          touched.add(b.id);
          return { ...b, text };
        });
        break;
      }
    }
  }

  return { ir: next, touched, removed, renamed };
}
