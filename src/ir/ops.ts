/**
 * Ops — atomic IR mutations originated by the canvas / inspector.
 * `applyOps` is pure: it returns a new IR plus the set of block ids whose
 * HCL text must be re-emitted (the minimal-patch working set). Untouched
 * blocks keep their object identity, which is how the patcher skips them.
 */
import { isStateBlockText } from '@/hcl/moved';
import { renameInExpression, renameInHcl, renameInRecord } from './expr';
import { rekeyInExpression, rekeyInHcl, rekeyInRecord, type Rekey } from './repeat';
import type { CanvasPosition, Expression, IR, RawBlock, ResourceNode } from './types';
import { resourceAddress } from './types';

export type Op =
  | { kind: 'add_resource'; node: ResourceNode }
  | { kind: 'remove_resource'; nodeId: string }
  | { kind: 'set_arg'; nodeId: string; field: string; value: Expression }
  | { kind: 'unset_arg'; nodeId: string; field: string }
  | { kind: 'rename_resource'; nodeId: string; newName: string }
  | { kind: 'move_node'; nodeId: string; position: CanvasPosition }
  /** a verbatim top-level block (`moved {}`), written right after resource `after` when given, else at the end of its file */
  | { kind: 'add_extra'; block: RawBlock; after?: string }
  | { kind: 'remove_extra'; blockId: string }
  | { kind: 'set_extra'; blockId: string; text: string }
  /** references to `address` change instance key (repetition added / removed), see repeat.ts */
  | { kind: 'rekey_refs'; address: string; rekey: Rekey };

/** how a value's text follows a rename / re-key — the patcher rewrites those tokens in place */
export interface TextRewrite {
  expr(e: Expression): Expression;
  hcl(text: string): string;
}

export interface ApplyResult {
  ir: IR;
  /** ids of blocks whose text changed (resources / variables / outputs / providers / extras) */
  touched: Set<string>;
  /** old ids of removed resources */
  removed: Set<string>;
  /** rename map: old id → new id */
  renamed: Map<string, string>;
  /** renames and re-keys, in op order */
  rewrites: TextRewrite[];
  /** new extras placed after a resource: extra id → resource id */
  placements: Map<string, string>;
}

export function applyOps(ir: IR, ops: Op[]): ApplyResult {
  const next: IR = {
    ...ir,
    resources: [...ir.resources],
    variables: [...ir.variables],
    outputs: [...ir.outputs],
    providers: [...ir.providers],
    extras: [...ir.extras],
  };
  const touched = new Set<string>();
  const removed = new Set<string>();
  const renamed = new Map<string, string>();
  const rewrites: TextRewrite[] = [];
  const placements = new Map<string, string>();

  // Duplicate addresses are a Terraform error (the parser flags them); ops act on the first.
  const findIndex = (id: string) => next.resources.findIndex((r) => r.id === id);

  /** rewrite references in every block; `moved` / `removed` blocks name state and are left alone */
  const rewriteAll = (rewrite: TextRewrite, inRecord: (r: Record<string, Expression>) => Record<string, Expression>) => {
    rewrites.push(rewrite);
    const retarget = <T extends { id: string; args: Record<string, Expression> }>(b: T): T => {
      const args = inRecord(b.args);
      if (args === b.args) return b;
      touched.add(b.id);
      return { ...b, args };
    };
    next.resources = next.resources.map(retarget);
    next.variables = next.variables.map(retarget);
    next.outputs = next.outputs.map(retarget);
    next.providers = next.providers.map(retarget);
    next.extras = next.extras.map((b) => {
      if (isStateBlockText(b.text)) return b;
      const text = rewrite.hcl(b.text);
      if (text === b.text) return b;
      touched.add(b.id);
      return { ...b, text };
    });
  };

  for (const op of ops) {
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
        rewrites.push({ expr: (e) => renameInExpression(e, from, to), hcl: (t) => renameInHcl(t, from, to) });
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
        next.extras = next.extras.map((b) => {
          // `moved` / `removed` name addresses in the state: hcl/moved.ts decides about those
          if (isStateBlockText(b.text)) return b;
          const text = renameInHcl(b.text, from, to);
          if (text === b.text) return b;
          touched.add(b.id);
          return { ...b, text };
        });
        break;
      }
      case 'rekey_refs': {
        const { address, rekey } = op;
        rewriteAll(
          { expr: (e) => rekeyInExpression(e, address, rekey), hcl: (t) => rekeyInHcl(t, address, rekey) },
          (r) => rekeyInRecord(r, address, rekey),
        );
        break;
      }
      case 'add_extra': {
        next.extras.push(op.block);
        touched.add(op.block.id);
        if (op.after) placements.set(op.block.id, op.after);
        break;
      }
      case 'remove_extra': {
        const i = next.extras.findIndex((b) => b.id === op.blockId);
        if (i === -1) break;
        next.extras.splice(i, 1);
        touched.delete(op.blockId);
        break;
      }
      case 'set_extra': {
        const i = next.extras.findIndex((b) => b.id === op.blockId);
        if (i === -1 || next.extras[i].text === op.text) break;
        next.extras[i] = { ...next.extras[i], text: op.text };
        touched.add(op.blockId);
        break;
      }
    }
  }

  return { ir: next, touched, removed, renamed, rewrites, placements };
}
