/**
 * The fixes offered when a drop is refused, as ops (one undo step each):
 * - create a DB / cache subnet group from the VPC's subnets (two zones when
 *   there are) and put the database in it — drawn in the VPC, spanning them;
 * - put it in the VPC's existing group;
 * - connect to the container instead of going inside it.
 * Computed from the editor state at the time the fix is used.
 */
import { list } from '@/ir/expr';
import { ARRANGE, CONTAINER_MIN_H, CONTAINER_MIN_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import { appendReference, instanceRef } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import type { Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { connectionOp, findConnectionRule } from '@/resources/connect';
import { getDef } from '@/resources/registry';
import { dropMessages } from './drop.messages';
import { nounOf, type DropFix } from './dropRules';
import { buildNewNode } from './newNode';
import { makeRoomOps, settleOps, slotIn } from './placement';
import { subnetTier, subnetZone } from './tidy';

export interface FixResult {
  ops: Op[];
  message: string;
  hint?: string;
  /** one more line: what's still worth doing (it isn't done for the user) */
  note?: string;
}

/** the label of the fix's button */
export function fixLabel(fix: DropFix, locale?: Locale): string {
  const m = messagesFor(dropMessages, locale);
  switch (fix.kind) {
    case 'create-group':
      return m.createGroup(nounOf(fix.groupType), fix.vpc.name);
    case 'use-group':
      return m.useGroup(nounOf(fix.group.type), fix.group.name);
    case 'connect':
      return m.connectTo(nounOf(fix.target.type), fix.target.name);
  }
}

/** A database that takes security groups but has none: the VPC's default group applies. */
function withoutSecurityGroup(node: ResourceNode): boolean {
  const rule = getDef(node.type)?.connections?.find((c) => c.targetTypes.includes('aws_security_group'));
  if (!rule) return false;
  const value = node.args[rule.arg];
  return value === undefined || (value.kind === 'list' && value.items.length === 0);
}

const isPublic = (s: ResourceNode) => {
  const flag = s.args.map_public_ip_on_launch;
  return (flag?.kind === 'literal' && flag.value === true) || /public/i.test(s.name);
};

/**
 * Subnets for a new subnet group in `vpc`: the one it was dropped on (else a
 * private one) and its tier in the other zones (public_a → public_b); one
 * more subnet from another zone when that tier sits in a single zone.
 */
export function chooseSubnets(ir: IR, vpc: ResourceNode, dropped?: ResourceNode): ResourceNode[] {
  const inVpc = ir.resources.filter((r) => r.type === 'aws_subnet' && r.parentId === vpc.id);
  const first = (dropped && inVpc.find((s) => s.id === dropped.id)) ?? inVpc.find((s) => !isPublic(s)) ?? inVpc[0];
  if (!first) return [];
  const chosen = [first, ...inVpc.filter((s) => s !== first && subnetTier(s) === subnetTier(first))];
  const zones = new Set(chosen.map((s) => subnetZone(s) ?? s.id));
  if (zones.size < 2) {
    const candidates = [...inVpc.filter((s) => !isPublic(s)), ...inVpc.filter(isPublic)];
    const extra = candidates.find((s) => !chosen.includes(s) && !zones.has(subnetZone(s) ?? s.id));
    if (extra) chosen.push(extra);
  }
  return chosen;
}

export function fixOps(ir: IR, nodeId: string, fix: DropFix, locale?: Locale): FixResult | null {
  const m = messagesFor(dropMessages, locale);
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const node = byId.get(nodeId);
  if (!node) return null;
  const def = getDef(node.type);

  if (fix.kind === 'create-group') {
    const vpc = byId.get(fix.vpc.id);
    const groupDef = getDef(fix.groupType);
    const rule = findConnectionRule(def, fix.groupType);
    if (!vpc || !groupDef || !rule) return null;
    const subnets = chooseSubnets(ir, vpc, fix.subnet && byId.get(fix.subnet.id));
    if (subnets.length === 0) return null;
    // named after what it holds: aws_db_subnet_group.main for aws_db_instance.main
    const taken = new Set(ir.resources.map((r) => r.id));
    let name = node.name;
    for (let i = 2; taken.has(`${fix.groupType}.${name}`); i++) name = `${node.name}_${i}`;
    const size = { w: CONTAINER_MIN_W, h: CONTAINER_MIN_H };
    const spot = slotIn(ir, vpc, size);
    const { node: group } = buildNewNode(ir, groupDef, { ...spot, ...size }, undefined, { name });
    // every instance of a repeated subnet: `aws_subnet.private[*].id`
    group.args.subnet_ids =
      subnets.reduce<Expression | undefined>((acc, s) => appendReference(acc, instanceRef(s, 'id', { ir, all: true })) ?? acc, undefined) ??
      list([]);
    const link = connectionOp(node, group, rule, ir);
    if (!link) return null;
    const zones = new Set(subnets.map(subnetZone).filter((z): z is string => z !== undefined));
    const known = subnets.every((s) => subnetZone(s) !== undefined);
    return {
      ops: [
        { kind: 'add_resource', node: group },
        link,
        { kind: 'move_node', nodeId, position: { x: ARRANGE.pad, y: ARRANGE.top } },
        ...makeRoomOps(ir, vpc.id, { ...spot, ...size }),
      ],
      message: m.createdGroup(group.id, subnets.map((s) => s.name), node.id),
      hint: subnets.length < 2 || (known && zones.size < 2) ? m.oneZone : undefined,
      // a nudge, not a change: no security group is created for the user
      note: withoutSecurityGroup(node) ? m.attachSecurityGroup(node.id) : undefined,
    };
  }

  const target = byId.get(fix.kind === 'use-group' ? fix.group.id : fix.target.id);
  const rule = target && (fix.kind === 'connect' ? fix.rule : findConnectionRule(def, target.type));
  const op = target && rule ? connectionOp(node, target, rule, ir) : null;
  if (!target || !op) return null;
  return {
    ops: settleOps(ir, [op], nodeId),
    message: fix.kind === 'use-group' ? m.movedInto(node.id, target.id) : m.connected(node.id, target.id),
  };
}
