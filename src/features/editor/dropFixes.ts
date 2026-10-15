/**
 * The fixes offered when a drop is refused, as ops (one undo step each):
 * - create a DB / cache subnet group from the VPC's subnets (two zones when
 *   there are) and put the database in it — drawn in the VPC, spanning them;
 * - put it in the VPC's existing group;
 * - connect to the container instead of going inside it.
 * A database now in a VPC's subnets also needs a security group of that VPC
 * (AWS refuses one of another VPC): the step after the fix offers it.
 * Computed from the editor state at the time the fix is used.
 */
import { exprMentions, list } from '@/ir/expr';
import { ARRANGE, CONTAINER_MIN_H, CONTAINER_MIN_W } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import { appendReference, instanceRef } from '@/ir/repeat';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import type { Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { connectionOp, findConnectionRule } from '@/resources/connect';
import { SUBNET_GROUP_OF } from '@/resources/dropReasons';
import { getDef } from '@/resources/registry';
import { extractRules, fromInternet } from '@/security/model';
import { dropMessages } from './drop.messages';
import { nounOf, type DropFix } from './dropRules';
import { buildNewNode } from './newNode';
import { makeRoomOps, settleOps, sizeFor, slotIn } from './placement';
import { subnetTier, subnetZone } from './tidy';

export interface FixResult {
  ops: Op[];
  message: string;
  hint?: string;
  /** one more line: what's still worth doing, or why the next step is offered */
  note?: string;
  /** the next step, offered with the result: the database's security group */
  securityGroup?: { vpcId: string; fix: SecurityGroupFix };
}

/** the security group a database in a VPC gets: the one the VPC's other databases use, or a new one */
export type SecurityGroupFix = { kind: 'use'; group: ResourceNode } | { kind: 'create' };

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

/** the argument holding a database's security groups (`vpc_security_group_ids`, `security_group_ids`) */
function securityGroupArg(type: string): string | undefined {
  return getDef(type)?.connections?.find((c) => c.targetTypes.includes('aws_security_group'))?.arg;
}

const groupsIn = (ir: IR, value: Expression | undefined) =>
  value ? ir.resources.filter((r) => r.type === 'aws_security_group' && exprMentions(value, r.id)) : [];

/**
 * What `node`'s security groups need once it runs in `vpc`'s subnets, and
 * the line that says why. Nothing when it has groups of that VPC, or ones
 * the canvas can't see (`var.db_security_groups`). With none it gets the
 * VPC's default group; a group of another VPC (or of the default one: no
 * `vpc_id`) AWS refuses. The fix: the group another database of this VPC
 * uses, else a new one.
 */
export function securityGroupNeed(
  ir: IR,
  node: ResourceNode,
  vpc: ResourceNode,
  locale?: Locale,
): { fix: SecurityGroupFix; note: string } | undefined {
  const m = messagesFor(dropMessages, locale);
  const arg = securityGroupArg(node.type);
  if (!arg) return undefined;
  const value = node.args[arg];
  const empty = value === undefined || (value.kind === 'list' && value.items.length === 0);
  const groups = groupsIn(ir, value);
  const elsewhere = groups.filter((g) => g.parentId !== vpc.id);
  if (!empty && elsewhere.length === 0) return undefined;
  const usedByAnother = (group: ResourceNode) =>
    ir.resources.some((r) => {
      const other = r.id !== node.id && SUBNET_GROUP_OF[r.type] ? securityGroupArg(r.type) : undefined;
      const held = other ? r.args[other] : undefined;
      return held !== undefined && exprMentions(held, group.id);
    });
  // never one open to the internet (the web tier's, which a database sometimes borrows)
  const rules = extractRules(ir);
  const open = (group: ResourceNode) =>
    (rules.get(group.id) ?? []).some((r) => r.direction === 'inbound' && r.action === 'allow' && fromInternet(r));
  const shared = ir.resources.find(
    (g) => g.type === 'aws_security_group' && g.parentId === vpc.id && usedByAnother(g) && !open(g),
  );
  return {
    fix: shared ? { kind: 'use', group: shared } : { kind: 'create' },
    note: empty ? m.noSecurityGroup(node.id, vpc.name) : m.securityGroupElsewhere(elsewhere.map((g) => g.id), vpc.name),
  };
}

/** the label of the security group step's button */
export function securityGroupLabel(fix: SecurityGroupFix, vpc: string, locale?: Locale): string {
  const m = messagesFor(dropMessages, locale);
  return fix.kind === 'use' ? m.useSecurityGroup(fix.group.name) : m.createSecurityGroup(vpc);
}

/**
 * The security group step, from the editor state when it's used (one undo
 * step): the database keeps its groups of the VPC, drops those of another,
 * and gets the shared group or a new one drawn in the VPC. A new group has
 * no inbound rule: nothing reaches the database until the user says what may.
 */
export function securityGroupOps(ir: IR, nodeId: string, vpcId: string, fix: SecurityGroupFix, locale?: Locale): FixResult | null {
  const m = messagesFor(dropMessages, locale);
  const node = ir.resources.find((r) => r.id === nodeId);
  const vpc = ir.resources.find((r) => r.id === vpcId);
  const arg = node && securityGroupArg(node.type);
  const sgDef = getDef('aws_security_group');
  if (!node || !vpc || !arg || !sgDef) return null;
  const ops: Op[] = [];
  let group = fix.kind === 'use' ? ir.resources.find((r) => r.id === fix.group.id && r.parentId === vpc.id) : undefined;
  if (fix.kind === 'use' && !group) return null;
  if (!group) {
    // named after the database it guards: aws_security_group.main for aws_db_instance.main
    const taken = new Set(ir.resources.map((r) => r.id));
    let name = node.name;
    for (let i = 2; taken.has(`aws_security_group.${name}`); i++) name = `${node.name}_${i}`;
    const size = sizeFor(sgDef.type);
    const spot = slotIn(ir, vpc, size);
    const built = buildNewNode(ir, sgDef, spot, vpc, { name });
    group = built.node;
    ops.push(...built.ops, ...makeRoomOps(ir, vpc.id, { ...spot, ...size }));
  }
  const current = node.args[arg];
  const away = groupsIn(ir, current).filter((g) => g.parentId !== vpc.id);
  const kept =
    current?.kind === 'list'
      ? current.items.filter((item) => !away.some((g) => exprMentions(item, g.id)))
      : current && away.length === 0
        ? [current]
        : [];
  const value = appendReference(list(kept), instanceRef(group, 'id', { ir }));
  if (value) ops.push({ kind: 'set_arg', nodeId, field: arg, value });
  return {
    ops,
    message: fix.kind === 'use' ? m.usedSecurityGroup(node.id, group.id) : m.createdSecurityGroup(group.id, vpc.name, node.id),
    note:
      [away.length > 0 ? m.securityGroupsDropped(away.map((g) => g.id)) : '', fix.kind === 'create' ? m.noInboundYet : '']
        .filter(Boolean)
        .join('. ') || undefined,
  };
}

/** the note and the next step for the security groups of a database moved into `vpc` */
function securityGroupStep(ir: IR, node: ResourceNode, vpc: ResourceNode, locale?: Locale): Pick<FixResult, 'note' | 'securityGroup'> {
  const need = securityGroupNeed(ir, node, vpc, locale);
  return need ? { note: need.note, securityGroup: { vpcId: vpc.id, fix: need.fix } } : {};
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
      ...securityGroupStep(ir, node, vpc, locale),
    };
  }

  const target = byId.get(fix.kind === 'use-group' ? fix.group.id : fix.target.id);
  const rule = target && (fix.kind === 'connect' ? fix.rule : findConnectionRule(def, target.type));
  const op = target && rule ? connectionOp(node, target, rule, ir) : null;
  if (!target || !op) return null;
  const vpc = fix.kind === 'use-group' && target.parentId ? byId.get(target.parentId) : undefined;
  return {
    ops: settleOps(ir, [op], nodeId),
    message: fix.kind === 'use-group' ? m.movedInto(node.id, target.id) : m.connected(node.id, target.id),
    ...(vpc?.type === 'aws_vpc' ? securityGroupStep(ir, node, vpc, locale) : {}),
  };
}
