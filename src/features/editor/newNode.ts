/**
 * Builds the IR node for a resource dropped from the palette — pure, so the
 * catalog tests can exercise exactly what users get on the canvas.
 */
import { block, lit, list, literalString, refTargetAddress } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { instanceRef } from '@/ir/repeat';
import { CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { CanvasPosition, Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';
import { nextFreeCidr } from '@/resources/cidr';
import { findConnectionRule } from '@/resources/connect';
import { copyName, nameForLabel } from '@/resources/naming';
import { getDef, isContainerType } from '@/resources/registry';
import type { ResourceDef } from '@/resources/types';
import { freeSpotAround, makeRoomOps, sizeFor, slotIn } from './placement';

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

/** the literal CIDR of an argument: `"10.0.0.0/16"` or the first item of `["10.0.0.0/16"]` */
function literalCidr(e: Expression | undefined): string | undefined {
  return e?.kind === 'list' ? literalString(e.items[0]) : literalString(e);
}

/** ranges already used by subnets of `def.type` inside `parent` */
function siblingCidrs(ir: IR, def: ResourceDef, parent: ResourceNode, arg: string): string[] {
  const rule = findConnectionRule(def, parent.type);
  if (!rule || 'block' in rule) return [];
  return ir.resources
    .filter((r) => r.type === def.type)
    .filter((r) => {
      const link = r.args[rule.arg];
      return link?.kind === 'ref' && refTargetAddress(link.path) === parent.id;
    })
    .flatMap((r) => {
      const value = r.args[arg];
      const items = value?.kind === 'list' ? value.items : value ? [value] : [];
      return items.map((i) => literalString(i)).filter((c): c is string => c !== undefined);
    });
}

/** the container a resource's containment argument points at */
function containerOf(ir: IR, node: ResourceNode, def: ResourceDef): ResourceNode | undefined {
  for (const rule of def.containment ?? []) {
    const link = node.args[rule.arg];
    const address = link?.kind === 'ref' ? refTargetAddress(link.path) : null;
    const parent = address ? ir.resources.find((r) => r.id === address) : undefined;
    if (parent && rule.parentTypes.includes(parent.type)) return parent;
  }
  return undefined;
}

/** next free /24 of the parent network for a subnet, keeping the argument's shape (string or list) */
function freeSubnetCidr(
  ir: IR,
  def: ResourceDef,
  parent: ResourceNode | undefined,
  current: Expression | undefined,
): Expression | undefined {
  if (!def.subnetCidr || !parent) return undefined;
  const network = literalCidr(parent.args[def.subnetCidr.parentArg]);
  if (!network) return undefined;
  const taken = siblingCidrs(ir, def, parent, def.subnetCidr.arg);
  const cidr = nextFreeCidr(network, taken, literalCidr(current));
  if (!cidr) return undefined;
  return current?.kind === 'list' ? list([lit(cidr)]) : lit(cidr);
}

export function buildNewNode(
  ir: IR,
  def: ResourceDef,
  position: { x: number; y: number; w?: number; h?: number },
  parent?: ResourceNode,
  options: { name?: string } = {},
): { node: ResourceNode; ops: Op[] } {
  const name = options.name ?? uniqueResourceName(ir, def);
  const values: Record<string, Expression> = structuredClone(def.defaults ?? {});
  // name-ish fields get a helpful default, valid as a cloud-side name (`lb_2` → "lb-2")
  const nameArg = def.nameArg ?? 'name';
  if (def.fields.some((f) => f.name === nameArg) && !values[nameArg]) values[nameArg] = lit(nameForLabel(def, name));
  if (parent) {
    const rule = findConnectionRule(def, parent.type);
    if (rule && rule.mode === 'set') {
      // a repeated container (subnets per AZ): its first instance, `aws_subnet.private[0].id`
      const link = instanceRef(parent, rule.attr, { ir });
      if ('block' in rule) {
        // e.g. a GCP instance dropped in a subnetwork: network_interface { subnetwork = … }
        const current = values[rule.block];
        values[rule.block] = block({ ...(current?.kind === 'block' ? current.body : {}), [rule.arg]: link });
      } else {
        values[rule.arg] = link;
      }
    }
    // the container hands down what it shares with its children (Azure location / resource group)
    for (const arg of def.inherit ?? []) {
      if (arg === rule?.arg || !def.fields.some((f) => f.name === arg) || !parent.args[arg]) continue;
      values[arg] = instanceRef(parent, arg, { ir });
    }
    if (def.subnetCidr) {
      const cidr = freeSubnetCidr(ir, def, parent, values[def.subnetCidr.arg]);
      if (cidr) values[def.subnetCidr.arg] = cidr;
    }
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
 * A catalog resource dropped at `at` (canvas coordinates). Into `container`
 * (with its canvas top-left) when given: the drop spot if it's free, else the
 * container's next free cell — the container grows to fit and pushes its
 * neighbours aside, all in the same ops (one undo step). Otherwise on the top
 * level, nudged off anything it would cover.
 */
export function placeNewNode(
  ir: IR,
  def: ResourceDef,
  /** null: no particular spot — the container's next free cell */
  at: { x: number; y: number } | null,
  container?: { node: ResourceNode; x: number; y: number },
): { node: ResourceNode; ops: Op[] } {
  const size = sizeFor(def.type);
  const keep = isContainerType(def.type) ? size : {};
  const centered = at ? { x: at.x - size.w / 2, y: at.y - size.h / 2 } : undefined;
  if (!container) {
    return buildNewNode(ir, def, { ...freeSpotAround(ir, undefined, size, centered ?? { x: 40, y: 40 }), ...keep });
  }
  const spot = slotIn(ir, container.node, size, {
    preferred: centered ? { x: centered.x - container.x, y: centered.y - container.y } : undefined,
  });
  const { node, ops } = buildNewNode(ir, def, { ...spot, ...keep }, container.node);
  return { node, ops: [...ops, ...makeRoomOps(ir, container.node.id, { ...spot, ...size })] };
}

const DUPLICATE_GAP = 32;

function sizeOf(p: CanvasPosition): { w: number; h: number } {
  return p.w !== undefined ? { w: p.w, h: p.h ?? CONTAINER_MIN_H } : { w: NODE_W, h: NODE_H };
}

/**
 * The first spot next to `source` (right, below, then further out) where a
 * node of its size overlaps none of its siblings — so a copy never lands on
 * the original, and a copied container isn't drawn over the one it copies.
 */
export function freeSpotNear(ir: IR, source: ResourceNode, isContainer: boolean): CanvasPosition {
  const pos = source.position ?? { x: 0, y: 0 };
  const size = isContainer
    ? { w: pos.w ?? CONTAINER_MIN_W, h: pos.h ?? CONTAINER_MIN_H }
    : sizeOf(pos);
  // containment is derived (the store keeps it current); derive it on a copy for bare IRs
  const nodes = ir.resources.map((r) => ({ ...r }));
  deriveStructure({ ...ir, resources: nodes }, getDef);
  const parentId = nodes.find((r) => r.id === source.id)?.parentId ?? source.parentId;
  const siblings = nodes
    .filter((r) => r.parentId === parentId && r.position)
    .map((r) => ({ ...r.position!, ...sizeOf(r.position!) }));
  const free = (x: number, y: number) =>
    !siblings.some((s) => x < s.x + s.w && s.x < x + size.w && y < s.y + s.h && s.y < y + size.h);
  const stepX = size.w + DUPLICATE_GAP;
  const stepY = size.h + DUPLICATE_GAP;
  const candidates: Array<[number, number]> = [];
  for (let ring = 1; ring <= 8; ring++) {
    for (let row = 0; row <= ring; row++) candidates.push([ring, row]);
    for (let col = ring - 1; col >= 0; col--) candidates.push([col, ring]);
  }
  const [col, row] = candidates.find(([c, r]) => free(pos.x + c * stepX, pos.y + r * stepY)) ?? [1, 0];
  return { x: pos.x + col * stepX, y: pos.y + row * stepY, ...(isContainer ? size : {}) };
}

/**
 * Copy of a resource next to the original: same arguments (so it stays in the
 * same container and keeps its connections), a unique Terraform name, and a
 * `-copy` cloud-side name (valid for the type) so two real resources don't
 * collide. A copied subnet takes the next free range of its network.
 */
export function duplicateNode(
  ir: IR,
  source: ResourceNode,
  def: ResourceDef | undefined = getDef(source.type),
): { node: ResourceNode; ops: Op[] } {
  const taken = new Set(ir.resources.map((r) => r.id));
  const stem = source.name.replace(/_copy(_\d+)?$/, '');
  let name = `${stem}_copy`;
  for (let i = 2; taken.has(resourceAddress(source.type, name)); i++) name = `${stem}_copy_${i}`;

  const args = structuredClone(source.args);
  const nameArg = def?.nameArg ?? 'name';
  const current = args[nameArg];
  if (current?.kind === 'literal' && typeof current.value === 'string' && current.value) {
    args[nameArg] = lit(copyName(def, current.value, name));
  }
  if (def?.subnetCidr) {
    const cidr = freeSubnetCidr(ir, def, containerOf(ir, source, def), args[def.subnetCidr.arg]);
    if (cidr) args[def.subnetCidr.arg] = cidr;
  }

  const node: ResourceNode = {
    id: resourceAddress(source.type, name),
    provider: source.provider,
    type: source.type,
    name,
    args,
    position: freeSpotNear(ir, source, def?.container === true || source.position?.w !== undefined),
    trivia: { leadingComments: [] },
  };
  return { node, ops: [{ kind: 'add_resource', node }] };
}
