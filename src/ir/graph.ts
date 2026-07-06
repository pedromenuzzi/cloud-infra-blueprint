/**
 * Structure derivation: containment (parentId) and edges are *derived* from
 * real HCL references, so the text is always the source of truth.
 */
import { collectRefs, refTargetAddress } from './expr';
import type { IR, IREdge, ResourceNode } from './types';

export interface ContainmentRule {
  /** the argument that holds the reference, e.g. `vpc_id` */
  arg: string;
  /** resource types that can be the parent, e.g. ['aws_vpc'] */
  parentTypes: string[];
}

export interface DefLookup {
  (type: string):
    | {
        containment?: ContainmentRule[];
        container?: boolean;
      }
    | undefined;
}

const SECURITY_TYPES = /security_group|network_security|firewall/;

export function deriveStructure(ir: IR, lookup: DefLookup): IREdge[] {
  const byId = new Map<string, ResourceNode>();
  for (const r of ir.resources) byId.set(r.id, r);

  // --- containment -------------------------------------------------------
  for (const node of ir.resources) {
    node.parentId = undefined;
    const def = lookup(node.type);
    if (!def?.containment) continue;
    for (const rule of def.containment) {
      const expr = node.args[rule.arg];
      if (!expr) continue;
      const refs: Array<{ field: string; path: string }> = [];
      collectRefs(expr, rule.arg, refs);
      for (const r of refs) {
        const address = refTargetAddress(r.path);
        if (!address) continue;
        const target = byId.get(address);
        if (target && rule.parentTypes.includes(target.type)) {
          node.parentId = target.id;
          break;
        }
      }
      if (node.parentId) break;
    }
  }

  // guard against containment cycles (malformed configs)
  for (const node of ir.resources) {
    let cur = node.parentId;
    const seen = new Set<string>([node.id]);
    while (cur) {
      if (seen.has(cur)) {
        node.parentId = undefined;
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parentId;
    }
  }

  // --- edges --------------------------------------------------------------
  const edges: IREdge[] = [];
  const dedupe = new Set<string>();
  for (const node of ir.resources) {
    const refs: Array<{ field: string; path: string }> = [];
    for (const [field, expr] of Object.entries(node.args)) collectRefs(expr, field, refs);
    for (const r of refs) {
      const address = refTargetAddress(r.path);
      if (!address || address === node.id) continue;
      const target = byId.get(address);
      if (!target) continue;
      // containment is drawn as nesting, not as an edge
      if (target.id === node.parentId) continue;
      const rootField = r.field.split('.')[0];
      const key = `${node.id}->${target.id}:${rootField}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      edges.push({
        id: key,
        source: node.id,
        target: target.id,
        field: rootField,
        kind: SECURITY_TYPES.test(target.type) || SECURITY_TYPES.test(node.type)
          ? 'security'
          : 'reference',
      });
    }
  }
  return edges;
}

/** Depth of a node in the containment tree (0 = top level). */
export function nodeDepth(node: ResourceNode, byId: Map<string, ResourceNode>): number {
  let depth = 0;
  let cur = node.parentId;
  while (cur && depth < 12) {
    depth++;
    cur = byId.get(cur)?.parentId;
  }
  return depth;
}
