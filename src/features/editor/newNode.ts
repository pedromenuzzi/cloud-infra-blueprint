/**
 * Builds the IR node for a resource dropped from the palette — pure, so the
 * catalog tests can exercise exactly what users get on the canvas.
 */
import { lit, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';
import type { ResourceDef } from '@/resources/types';

/** terraform-style default name: last word of the type, made unique */
export function uniqueResourceName(ir: IR, def: ResourceDef): string {
  const base =
    def.type
      .replace(/^(aws|azurerm|google)_/, '')
      .split('_')
      .pop() || 'main';
  const taken = new Set(ir.resources.map((r) => r.id));
  if (!taken.has(resourceAddress(def.type, base))) return base;
  for (let i = 2; i < 100; i++) {
    if (!taken.has(resourceAddress(def.type, `${base}_${i}`))) return `${base}_${i}`;
  }
  return `${base}_${Date.now() % 1000}`;
}

export function buildNewNode(
  ir: IR,
  def: ResourceDef,
  position: { x: number; y: number; w?: number; h?: number },
  parent?: ResourceNode,
): { node: ResourceNode; ops: Op[] } {
  const name = uniqueResourceName(ir, def);
  const values: Record<string, Expression> = structuredClone(def.defaults ?? {});
  // name-ish fields get a helpful default
  const nameArg = def.nameArg ?? 'name';
  if (def.fields.some((f) => f.name === nameArg) && !values[nameArg]) values[nameArg] = lit(name);
  if (parent) {
    const rule = def.connections?.find((c) => c.targetTypes.includes(parent.type));
    if (rule && rule.mode === 'set') values[rule.arg] = ref(`${parent.id}.${rule.attr}`);
  }
  // tidy block: arguments in field order, then other attributes, then nested blocks
  const isBlock = (e: Expression) => e.kind === 'block' || e.kind === 'blocks';
  const args: Record<string, Expression> = {};
  for (const field of def.fields) {
    if (values[field.name]) args[field.name] = values[field.name];
  }
  for (const [k, v] of Object.entries(values)) if (!args[k] && !isBlock(v)) args[k] = v;
  for (const [k, v] of Object.entries(values)) if (!args[k]) args[k] = v;
  const node: ResourceNode = {
    id: resourceAddress(def.type, name),
    provider: def.provider,
    type: def.type,
    name,
    args,
    position,
    trivia: { leadingComments: [] },
  };
  return { node, ops: [{ kind: 'add_resource', node }] };
}

/**
 * Copy of a resource next to the original: same arguments (so it stays in the
 * same container and keeps its connections), a unique Terraform name, and
 * `-copy` on its cloud-side name so two real resources don't collide.
 */
export function duplicateNode(
  ir: IR,
  source: ResourceNode,
  def?: ResourceDef,
): { node: ResourceNode; ops: Op[] } {
  const taken = new Set(ir.resources.map((r) => r.id));
  const stem = source.name.replace(/_copy(_\d+)?$/, '');
  let name = `${stem}_copy`;
  for (let i = 2; taken.has(resourceAddress(source.type, name)); i++) name = `${stem}_copy_${i}`;

  const args = structuredClone(source.args);
  const nameArg = def?.nameArg ?? 'name';
  const current = args[nameArg];
  if (current?.kind === 'literal' && typeof current.value === 'string' && current.value) {
    args[nameArg] = lit(`${current.value}-copy`);
  }

  const pos = source.position ?? { x: 0, y: 0 };
  const node: ResourceNode = {
    id: resourceAddress(source.type, name),
    provider: source.provider,
    type: source.type,
    name,
    args,
    position: { ...pos, x: pos.x + 32, y: pos.y + 32 },
    trivia: { leadingComments: [] },
  };
  return { node, ops: [{ kind: 'add_resource', node }] };
}
