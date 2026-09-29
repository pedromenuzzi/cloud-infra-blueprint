/**
 * What happens when a resource is dropped at a point of the canvas — pure,
 * shared by the drag hint (while dragging), the drop itself and the tests.
 *
 * The container under the pointer decides:
 * - it can hold the resource (a containment rule) → nest;
 * - one of its ancestors can (a security group over a subnet → its VPC) →
 *   redirect there, and say why;
 * - neither → refuse with the specific reason (from ../../resources/dropReasons)
 *   and, when there is one, a fix: create or use a DB subnet group for a
 *   database dropped on a subnet, or connect to the container instead
 *   (a load balancer's `subnets`).
 */
import type { AbsRect } from '@/components/ProjectThumbnail';
import { exprMentions } from '@/ir/expr';
import type { IR, ResourceNode } from '@/ir/types';
import type { Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { findConnectionRule, type AnyConnectionRule } from '@/resources/connect';
import { FAMILY, nounFor, OVERRIDE, OWNER, reasonMessages, SUBNET_GROUP_OF, type Noun } from '@/resources/dropReasons';
import { getDef } from '@/resources/registry';

export interface DropSubject {
  /** undefined for a resource dragged in from the palette */
  id?: string;
  type: string;
  parentId?: string;
}

export type DropFix =
  | { kind: 'create-group'; groupType: string; vpc: ResourceNode; subnet?: ResourceNode }
  | { kind: 'use-group'; group: ResourceNode }
  | { kind: 'connect'; target: ResourceNode; rule: AnyConnectionRule };

export type DropVerdict =
  /** not over any container */
  | { kind: 'free' }
  | { kind: 'nest'; parent: ResourceNode; current: boolean }
  | { kind: 'redirect'; parent: ResourceNode; over: ResourceNode; reason: string }
  /** a resource drawn where its references put it (a subnet group) can't be dragged out */
  | { kind: 'stay'; parent: ResourceNode; reason: string }
  | { kind: 'refuse'; over: ResourceNode; reason: string; fix?: DropFix };

export const nounOf = (type: string): Noun => nounFor(type, getDef(type)?.shortName);

/** the deepest container under a canvas point, leaving out `excludeId` and what's inside it */
export function containerAt(
  rects: Map<string, AbsRect>,
  byId: Map<string, ResourceNode>,
  point: { x: number; y: number },
  excludeId?: string,
): AbsRect | undefined {
  const inside = (node: ResourceNode) => {
    for (let cur: ResourceNode | undefined = node, guard = 0; cur && guard < 16; guard++) {
      if (cur.id === excludeId) return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };
  let best: AbsRect | undefined;
  for (const rect of rects.values()) {
    if (!rect.isContainer) continue;
    if (point.x < rect.x || point.x > rect.x + rect.w || point.y < rect.y || point.y > rect.y + rect.h) continue;
    if (excludeId && inside(rect.node)) continue;
    if (!best || rect.depth > best.depth) best = rect;
  }
  return best;
}

/** `ancestor` can (eventually) hold `type` — VPC → subnet → instance */
function holds(ancestor: string, type: string, seen = new Set<string>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  for (const rule of getDef(type)?.containment ?? []) {
    for (const parent of rule.parentTypes) {
      if (parent === ancestor || holds(ancestor, parent, seen)) return true;
    }
  }
  return false;
}

/** why a resource of `type` can't be drawn inside `over` — specific to both */
export function refusalReason(type: string, over: ResourceNode, locale?: Locale): string {
  const m = messagesFor(reasonMessages, locale);
  const def = getDef(type);
  const cDef = getDef(over.type);
  const r = nounOf(type);
  const c = nounOf(over.type);
  if (def && cDef && def.provider !== cDef.provider && def.provider !== 'other' && cDef.provider !== 'other') {
    return m.otherCloud(r, def.provider, c, cDef.provider);
  }
  const group = SUBNET_GROUP_OF[type];
  if (group && over.type === 'aws_subnet') return m.subnetGroup(r, nounOf(group));
  if (group && over.type === 'aws_vpc') return m.subnetGroupVpc(r, nounOf(group));
  const special = OVERRIDE[type];
  if (special?.on.includes(over.type)) return m[special.override](r);

  const rules = def?.containment ?? [];
  const via = rules.find((rule) => rule.via);
  if (via) return via.via!.includes(over.type) ? m.groupSpans(r) : m.viaConnect(r);
  const accepted = [...new Set(rules.flatMap((rule) => rule.parentTypes))];
  if (accepted.length > 0) {
    const wider = accepted.find((p) => holds(p, over.type));
    if (wider) return m.wider(r, nounOf(wider), c);
    const narrower = accepted.find((p) => holds(over.type, p));
    if (narrower) return m.narrower(r, nounOf(narrower), c);
    return m.unrelated(r, accepted.map(nounOf), c);
  }

  switch (FAMILY[type]) {
    case 'regional':
      return m.regional(r, c);
    case 'identity':
      return m.identity(r);
    case 'edge':
      return m.edge(r, c);
    case 'lambda':
      return m.lambda();
    case 'serverless':
      return m.serverless(r);
    case 'spans':
      return m.spans(r, over.type !== 'aws_vpc');
    case 'eks':
      return m.eks();
    case 'links':
      return m.links(r);
    case 'partOf':
      return m.partOf(r, nounOf(OWNER[type]), c);
    case 'eip':
      return m.eip(c);
    case 'top':
      return m.top(r, c);
    case 'ecsCluster':
      return m.ecsCluster();
    case 'gcpLb':
      return m.gcpLb(r, c);
    case 'cloudSql':
      return m.cloudSql();
    default:
      return m.notInside(r, c);
  }
}

/** the fix offered with a refusal, if any */
export function dropFix(ir: IR, subject: DropSubject, over: ResourceNode): DropFix | undefined {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const def = getDef(subject.type);
  const groupType = SUBNET_GROUP_OF[subject.type];
  if (groupType && (over.type === 'aws_subnet' || over.type === 'aws_vpc')) {
    const vpc = over.type === 'aws_vpc' ? over : over.parentId ? byId.get(over.parentId) : undefined;
    if (vpc?.type === 'aws_vpc') {
      const existing = ir.resources.find((r) => r.type === groupType && r.parentId === vpc.id);
      if (existing) return { kind: 'use-group', group: existing };
      if (ir.resources.some((r) => r.type === 'aws_subnet' && r.parentId === vpc.id)) {
        return { kind: 'create-group', groupType, vpc, subnet: over.type === 'aws_subnet' ? over : undefined };
      }
    }
    return undefined;
  }
  const rule = findConnectionRule(def, over.type);
  if (!rule || def?.containment?.some((c) => !c.via && c.arg === rule.arg)) return undefined;
  const node = subject.id ? byId.get(subject.id) : undefined;
  // a subnet group only takes subnets of the VPC it is drawn in
  if (node?.parentId && def?.containment?.some((c) => c.via) && over.parentId !== node.parentId) return undefined;
  if (node) {
    const holder = 'block' in rule ? node.args[rule.block] : node.args[rule.arg];
    if (holder && exprMentions(holder, over.id)) return undefined;
  }
  return { kind: 'connect', target: over, rule };
}

/** the verdict for dropping `subject` with its center at `point` (canvas coordinates) */
export function dropVerdict(
  ir: IR,
  rects: Map<string, AbsRect>,
  subject: DropSubject,
  point: { x: number; y: number },
  locale?: Locale,
): DropVerdict {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const rules = getDef(subject.type)?.containment ?? [];
  const direct = rules.filter((rule) => !rule.via);
  const derived = rules.some((rule) => rule.via);
  const current = subject.parentId ? byId.get(subject.parentId) : undefined;
  const overRect = containerAt(rects, byId, point, subject.id);
  const m = messagesFor(reasonMessages, locale);

  if (!overRect) {
    // drawn where its subnets are: dragging it out would need other subnets
    if (current && derived && !direct.some((rule) => rule.parentTypes.includes(current.type))) {
      return { kind: 'stay', parent: current, reason: m.viaStays(nounOf(subject.type), nounOf(current.type)) };
    }
    return { kind: 'free' };
  }
  return verdictOver(ir, subject, overRect.node, locale);
}

/**
 * The verdict for dropping `subject` on the container `over` itself — a drop
 * whose container is already known (the palette clicked with a container
 * selected): nest, redirect to the ancestor that takes it, or refuse.
 */
export function verdictOver(
  ir: IR,
  subject: DropSubject,
  over: ResourceNode,
  locale?: Locale,
): Extract<DropVerdict, { kind: 'nest' | 'redirect' | 'refuse' }> {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const rules = getDef(subject.type)?.containment ?? [];
  const direct = rules.filter((rule) => !rule.via);
  const derived = rules.some((rule) => rule.via);
  const current = subject.parentId ? byId.get(subject.parentId) : undefined;
  if (derived && direct.length === 0) {
    if (current && over.id === current.id) return { kind: 'nest', parent: current, current: true };
    return { kind: 'refuse', over, reason: refusalReason(subject.type, over, locale), fix: dropFix(ir, subject, over) };
  }
  for (let cur: ResourceNode | undefined = over, guard = 0; cur && guard < 16; guard++) {
    if (direct.some((rule) => rule.parentTypes.includes(cur!.type))) {
      if (cur.id === over.id) return { kind: 'nest', parent: over, current: over.id === subject.parentId };
      return { kind: 'redirect', parent: cur, over, reason: refusalReason(subject.type, over, locale) };
    }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return { kind: 'refuse', over, reason: refusalReason(subject.type, over, locale), fix: dropFix(ir, subject, over) };
}
