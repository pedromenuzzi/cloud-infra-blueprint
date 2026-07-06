/**
 * Ops — atomic IR mutations originated by the canvas / inspector.
 * `applyOps` is pure: it returns a new IR plus the set of block ids whose
 * HCL text must be re-emitted (the minimal-patch working set).
 */
import type { CanvasPosition, Expression, IR, ResourceNode } from './types';
import { resourceAddress } from './types';

export type Op =
  | { kind: 'add_resource'; node: ResourceNode }
  | { kind: 'remove_resource'; nodeId: string }
  | { kind: 'set_arg'; nodeId: string; field: string; value: Expression }
  | { kind: 'unset_arg'; nodeId: string; field: string }
  | { kind: 'rename_resource'; nodeId: string; newName: string }
  | { kind: 'move_node'; nodeId: string; position: CanvasPosition };

export interface ApplyResult {
  ir: IR;
  /** ids of blocks whose text changed (resources / variables / outputs / providers) */
  touched: Set<string>;
  /** old ids of removed resources */
  removed: Set<string>;
  /** rename map: old id → new id */
  renamed: Map<string, string>;
}

function mapExpression(e: Expression, fn: (path: string) => string): Expression {
  switch (e.kind) {
    case 'ref':
      return { kind: 'ref', path: fn(e.path) };
    case 'list':
      return { kind: 'list', items: e.items.map((i) => mapExpression(i, fn)) };
    case 'object':
      return { kind: 'object', fields: mapRecord(e.fields, fn) };
    case 'block':
      return { kind: 'block', body: mapRecord(e.body, fn) };
    case 'blocks':
      return { kind: 'blocks', items: e.items.map((b) => mapRecord(b, fn)) };
    default:
      return e;
  }
}

function mapRecord(
  r: Record<string, Expression>,
  fn: (path: string) => string,
): Record<string, Expression> {
  const out: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(r)) out[k] = mapExpression(v, fn);
  return out;
}

function exprMentions(e: Expression, address: string): boolean {
  switch (e.kind) {
    case 'ref':
      return e.path === address || e.path.startsWith(`${address}.`);
    case 'list':
      return e.items.some((i) => exprMentions(i, address));
    case 'object':
      return Object.values(e.fields).some((v) => exprMentions(v, address));
    case 'block':
      return Object.values(e.body).some((v) => exprMentions(v, address));
    case 'blocks':
      return e.items.some((b) => Object.values(b).some((v) => exprMentions(v, address)));
    default:
      return false;
  }
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

  const findIndex = (id: string) => next.resources.findIndex((r) => r.id === id);

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
        const newName = op.newName;
        const oldAddress = node.id;
        const newAddress = resourceAddress(node.type, newName);
        if (newAddress === oldAddress) break;
        const rewrite = (path: string) =>
          path === oldAddress
            ? newAddress
            : path.startsWith(`${oldAddress}.`)
              ? `${newAddress}${path.slice(oldAddress.length)}`
              : path;

        next.resources[i] = { ...node, id: newAddress, name: newName };
        touched.add(newAddress);
        renamed.set(oldAddress, newAddress);
        if (touched.has(oldAddress)) touched.delete(oldAddress);

        // rewrite references everywhere
        next.resources = next.resources.map((r) => {
          if (r.id === newAddress) return next.resources[i];
          if (!Object.values(r.args).some((e) => exprMentions(e, oldAddress))) return r;
          touched.add(r.id);
          return { ...r, args: mapRecord(r.args, rewrite) };
        });
        next.outputs = next.outputs.map((o) => {
          if (!Object.values(o.args).some((e) => exprMentions(e, oldAddress))) return o;
          touched.add(o.id);
          return { ...o, args: mapRecord(o.args, rewrite) };
        });
        break;
      }
    }
  }

  return { ir: next, touched, removed, renamed };
}
