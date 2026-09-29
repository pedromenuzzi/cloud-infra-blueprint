/**
 * One Terraform project per provider holding every palette resource, dropped
 * exactly as buildNewNode drops it (inside a container when it has one),
 * wired through the def's connection rules the way a user draws edges, and
 * with any remaining required plain input set to a typed placeholder.
 *
 * `scripts/emit-catalog.ts` writes these so CI can `terraform validate` them:
 * a catalog entry whose defaults can't validate fails the build.
 */
import { buildNewNode } from '@/features/editor/newNode';
import { emitProject } from '@/hcl/emitter';
import { parseProject } from '@/hcl/parser';
import { lit, list, obj, ref } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { CONTAINER_MIN_H, CONTAINER_MIN_W } from '@/ir/layout';
import { applyOps } from '@/ir/ops';
import type { Expression, IR, Provider, ResourceNode } from '@/ir/types';
import { scratchProject } from '@/templates';
import { connectionOp, connectionRules, isConnected } from './connect';
import { allDefs, getDef } from './registry';
import type { FieldDef, ResourceDef } from './types';

export const CATALOG_PROVIDERS: Provider[] = ['aws', 'azure', 'gcp'];

/** containers before what goes inside them (VPC → subnet → instance) */
function containmentDepth(def: ResourceDef, seen = new Set<string>()): number {
  if (!def.containment?.length || seen.has(def.type)) return 0;
  seen.add(def.type);
  const parents = def.containment.flatMap((c) => c.parentTypes).map((t) => getDef(t));
  return 1 + Math.min(...parents.map((p) => (p ? containmentDepth(p, seen) : 0)));
}

function placeholder(field: FieldDef): Expression {
  switch (field.type) {
    case 'number':
      return lit(field.min ?? 1);
    case 'boolean':
      return lit(false);
    case 'select':
      return lit(field.options?.[0] ?? 'example');
    case 'tags':
      return obj({});
    case 'list':
      return list([lit(field.placeholder ?? 'example')]);
    case 'string':
      return lit(field.placeholder ?? 'example');
  }
}

export function buildCatalogIR(provider: Provider): IR {
  let { ir } = parseProject(scratchProject(provider, 'catalog'));
  const defs = allDefs()
    .filter((d) => d.provider === provider)
    .map((def, i) => ({ def, i, depth: containmentDepth(def) }))
    .sort((a, b) => a.depth - b.depth || a.i - b.i)
    .map((d) => d.def);

  // 1. drop every resource, into the first container that can hold it
  let top = 0;
  const children = new Map<string, number>();
  for (const def of defs) {
    const parent = (def.containment ?? [])
      .flatMap((c) => c.parentTypes)
      .map((t) => ir.resources.find((r) => r.type === t))
      .find((r): r is ResourceNode => r !== undefined);
    const size = def.container ? { w: CONTAINER_MIN_W, h: CONTAINER_MIN_H } : {};
    const slot = parent ? (children.get(parent.id) ?? 0) : top++;
    if (parent) children.set(parent.id, slot + 1);
    const position = parent
      ? { x: 24, y: 56 + slot * 100, ...size }
      : { x: (slot % 6) * 380, y: Math.floor(slot / 6) * 240, ...size };
    const { ops } = buildNewNode(ir, def, position, parent);
    ir = applyOps(ir, ops).ir;
  }

  // 2. draw an edge for every connection rule that isn't satisfied yet
  for (const id of ir.resources.map((r) => r.id)) {
    for (const rule of connectionRules(getDef(id.split('.')[0]))) {
      const node = ir.resources.find((r) => r.id === id)!;
      if (isConnected(node, rule)) continue;
      const target = ir.resources.find((r) => r.id !== id && rule.targetTypes.includes(r.type));
      const op = target && connectionOp(node, target, rule);
      if (op) ir = applyOps(ir, [op]).ir;
    }
  }

  // 3. required inputs nobody can connect: pick a resource of the right type, or a typed placeholder
  for (const node of ir.resources) {
    const def = getDef(node.type)!;
    for (const field of def.fields) {
      const value = node.args[field.name];
      const empty = !value || (value.kind === 'literal' && (value.value === '' || value.value === null));
      if (!field.required || !empty) continue;
      const target = ir.resources.find((r) => r.id !== node.id && field.refTo?.includes(r.type));
      node.args[field.name] = target ? ref(`${target.id}.${field.refAttr ?? 'id'}`) : placeholder(field);
    }
  }

  // connected arguments go with the other attributes, ahead of nested blocks
  const isBlock = (e: Expression) => e.kind === 'block' || e.kind === 'blocks';
  for (const node of ir.resources) {
    const entries = Object.entries(node.args);
    node.args = Object.fromEntries([...entries.filter(([, v]) => !isBlock(v)), ...entries.filter(([, v]) => isBlock(v))]);
  }
  deriveStructure(ir, getDef);
  return ir;
}

/** `.tf` files of the catalog project for one provider. */
export function catalogProject(provider: Provider): Record<string, string> {
  return emitProject(buildCatalogIR(provider));
}
