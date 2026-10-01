/**
 * The CIDR planner behind the inspector card: how a network's addresses are
 * used, and the ops that carve new subnets out of its free space — placed
 * inside the network on the canvas, built by buildNewNode so they get the
 * same defaults, names and wiring as a subnet dropped from the palette.
 * Pure, so tests can apply the ops and check the HCL.
 */
import { messagesFor } from '@/i18n/messages';
import { exprPreview, lit, list } from '@/ir/expr';
import { deriveStructure } from '@/ir/graph';
import { CONTAINER_MIN_H, CONTAINER_MIN_W, NODE_H, NODE_W } from '@/ir/layout';
import { applyOps, type Op } from '@/ir/ops';
import type { CanvasPosition, Expression, IR, ResourceNode } from '@/ir/types';
import { blocksOf, networkModel, totalSize, type NetworkInfo, type RangeValue, type SubnetInfo } from '@/ir/checks/network';
import { stringFor } from '@/ir/checks/repeatValues';
import { providerFor, resolveString } from '@/ir/checks/resolve';
import { awsRegionOfZone } from '@/ir/checks/regions';
import {
  allocateBlocks,
  blockContains,
  blockSize,
  coveredSize,
  formatCidrBlock,
  usableRange,
  type CidrBlock,
  type CloudProvider,
} from '@/resources/cidr';
import { getDef } from '@/resources/registry';
import { cidrPlannerMessages } from './CidrPlanner.messages';
import { buildNewNode } from './newNode';

/** The subnet resource each network type holds (GCP subnetworks pick their own ranges: no planner). */
const SUBNET_OF: Record<string, string> = { aws_vpc: 'aws_subnet', azurerm_virtual_network: 'azurerm_subnet' };
/** smallest subnet each cloud accepts */
const MAX_PREFIX: Record<CloudProvider, number> = { aws: 28, azure: 29, gcp: 29 };
/** larger subnets are rare enough to leave out of the size picker */
const MIN_PREFIX = 16;
const AZ_LETTERS = 'abcdef';

export interface PlanRow {
  node: ResourceNode;
  /** what the list calls it: the resource name, or `public[0]` for an instance of a repeated subnet */
  name: string;
  /** the instance of a repeated subnet the row is: `aws_subnet.public[0]` */
  instance?: string;
  /** the subnet's IPv4 range, when it is known and valid */
  block?: CidrBlock;
  /** what to show for the range: the CIDR, or the expression it is written as (UI language in effect) */
  label: string;
  /** AWS availability zone / GCP region */
  zone?: string;
}

export interface NetworkPlan {
  network: NetworkInfo;
  provider: CloudProvider;
  /** IPv4 ranges new subnets are carved from (primary first) */
  ranges: CidrBlock[];
  /**
   * set when the planner can't allocate: the range is an expression, isn't a
   * valid CIDR, isn't set (AWS IPAM), or doesn't exist (GCP networks)
   */
  blocked?: { reason: 'expression' | 'invalid' | 'missing' | 'none'; field?: string; text?: string };
  rows: PlanRow[];
  /** subnets whose range is an expression: new ranges might collide with them */
  unknown: number;
  allocated: bigint;
  total: bigint;
  /** the region of the AWS provider this VPC deploys with */
  region?: string;
}

export interface SizeChoice {
  prefix: number;
  addresses: bigint;
  usable: bigint;
  fits: boolean;
}

/** where a subnet lives, for the list: its AZ (AWS) or region (GCP) */
const ZONE_ARG: Record<string, string> = { aws_subnet: 'availability_zone', google_compute_subnetwork: 'region' };

/** the subnet's rows: one, or one per instance of a repeated subnet whose ranges are known */
function rowsOf(subnet: SubnetInfo, ir: IR): PlanRow[] {
  const zoneArg = ZONE_ARG[subnet.node.type];
  const { node } = subnet;
  if (subnet.instances) {
    // `count = 0`: no subnet at all, but it stays in the list
    if (subnet.instances.length === 0) return [{ node, name: node.name, label: '×0' }];
    return subnet.instances.map(({ address, instance, ranges }) => {
      const valid = blocksOf(ranges)[0];
      return {
        node,
        name: `${node.name}${address.slice(node.id.length)}`,
        instance: address,
        block: valid,
        label: valid ? formatCidrBlock(valid) : (ranges[0]?.text ?? messagesFor(cidrPlannerMessages).noRangeRow),
        zone: zoneArg ? stringFor(node.args[zoneArg], ir, instance) : undefined,
      };
    });
  }
  const valid = blocksOf(subnet.ranges)[0];
  const written =
    subnet.ranges[0]?.text ?? (subnet.unresolved ? exprPreview(subnet.unresolved.expr) : messagesFor(cidrPlannerMessages).noRangeRow);
  const zone = zoneArg ? resolveString(ir, node.args[zoneArg])?.value : undefined;
  return [{ node, name: node.name, block: valid, label: valid ? formatCidrBlock(valid) : written, zone }];
}

function awsRegion(ir: IR, node: ResourceNode): string | undefined {
  const region = resolveString(ir, providerFor(ir, node, 'aws')?.args.region)?.value;
  return region && awsRegionOfZone(`${region}a`) === region ? region : undefined;
}

function blockedBy(network: NetworkInfo): NetworkPlan['blocked'] {
  if (network.provider === 'gcp') return { reason: 'none' };
  const broken = network.ranges.find((r) => !r.block && !r.owner);
  if (broken) return { reason: 'invalid', field: broken.field, text: broken.text };
  const { unresolved } = network;
  if (unresolved) return { reason: 'expression', field: unresolved.field, text: exprPreview(unresolved.expr) };
  if (blocksOf(network.ranges).length === 0) {
    return { reason: 'missing', field: network.provider === 'aws' ? 'cidr_block' : 'address_space' };
  }
  return undefined;
}

export function networkPlan(ir: IR, networkId: string): NetworkPlan | undefined {
  const network = networkModel(ir).networks.find((n) => n.node.id === networkId);
  if (!network) return undefined;
  const ranges = blocksOf(network.ranges);
  const rows = network.subnets.flatMap((s) => rowsOf(s, ir));
  const inside = rows.flatMap((r) => (r.block && ranges.some((n) => blockContains(n, r.block!)) ? [r.block] : []));
  return {
    network,
    provider: network.provider,
    ranges,
    blocked: blockedBy(network),
    rows,
    unknown: network.subnets.filter((s) => s.unresolved).length,
    allocated: coveredSize(inside),
    total: totalSize(ranges),
    region: network.provider === 'aws' ? awsRegion(ir, network.node) : undefined,
  };
}

/** Subnet sizes the picker offers, and whether one more of each still fits. */
export function sizeChoices(plan: NetworkPlan): SizeChoice[] {
  if (plan.blocked || plan.ranges.length === 0) return [];
  const widest = Math.min(...plan.ranges.map((r) => r.prefix));
  const taken = takenBlocks(plan);
  const out: SizeChoice[] = [];
  for (let prefix = Math.max(widest, MIN_PREFIX); prefix <= MAX_PREFIX[plan.provider]; prefix++) {
    const probe = { family: 'ipv4' as const, start: 0n, end: (1n << BigInt(32 - prefix)) - 1n, prefix };
    out.push({
      prefix,
      addresses: blockSize(probe),
      usable: usableRange(probe, plan.provider)?.count ?? 0n,
      fits: allocateBlocks(plan.ranges, taken, prefix, 1) !== undefined,
    });
  }
  return out;
}

/** Whether `count` more /`prefix` subnets fit in the network's free space. */
export function fitsBlocks(plan: NetworkPlan, prefix: number, count: number): boolean {
  return !plan.blocked && allocateBlocks(plan.ranges, takenBlocks(plan), prefix, count) !== undefined;
}

/** /24 when it fits, else the fitting size closest to it. */
export function defaultPrefix(choices: SizeChoice[]): number | undefined {
  const fitting = choices.filter((c) => c.fits);
  return fitting.sort((a, b) => Math.abs(a.prefix - 24) - Math.abs(b.prefix - 24) || b.prefix - a.prefix)[0]?.prefix;
}

function takenBlocks(plan: NetworkPlan): CidrBlock[] {
  return plan.rows.flatMap((r) => (r.block ? [r.block] : []));
}

/** `count` availability zones of the region, a, b, c… */
export function zonesFor(region: string, count: number): string[] {
  return AZ_LETTERS.slice(0, count).split('').map((letter) => `${region}${letter}`);
}

/** The zone of a/b/c with the fewest subnets already (the first on a tie). */
function quietestZone(plan: NetworkPlan): string | undefined {
  if (!plan.region) return undefined;
  const zones = zonesFor(plan.region, 3);
  const used = (z: string) => plan.rows.filter((r) => r.zone === z).length;
  return zones.reduce((best, z) => (used(z) < used(best) ? z : best), zones[0]);
}

/* ------------------------------------------------------------- placement */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 24;
const TITLE = 56;
const GAP = 24;
/** room for one resource card inside a subnet */
const MIN_BOX = { w: NODE_W + 2 * PAD, h: NODE_H + TITLE + PAD };

/** Children of the container as drawn (positions are relative to it). */
function childBoxes(ir: IR, containerId: string): Box[] {
  const nodes = ir.resources.map((r) => ({ ...r }));
  deriveStructure({ ...ir, resources: nodes }, getDef);
  return nodes
    .filter((r) => r.parentId === containerId && r.position)
    .map((r) => {
      const p = r.position!;
      const container = getDef(r.type)?.container === true || p.w !== undefined;
      if (!container) return { x: p.x, y: p.y, w: NODE_W, h: NODE_H };
      return { x: p.x, y: p.y, w: p.w ?? CONTAINER_MIN_W, h: p.h ?? CONTAINER_MIN_H };
    });
}

const clash = (a: Box, b: Box) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * The first spot inside the container's width, reading row by row, where a
 * box of `size` clashes with no child; below everything when none is left
 * (the container grows to fit, as it does for any child).
 */
function freeSpot(width: number, boxes: Box[], size: { w: number; h: number }): { x: number; y: number } {
  const ascending = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const xs = ascending([PAD, ...boxes.map((b) => b.x + b.w + GAP)]).filter((x) => x + size.w + PAD <= width);
  const ys = ascending([TITLE, ...boxes.map((b) => b.y + b.h + GAP)]);
  for (const y of ys) {
    for (const x of xs) {
      if (!boxes.some((b) => clash(b, { x, y, ...size }))) return { x, y };
    }
  }
  return { x: PAD, y: Math.max(TITLE, ...boxes.map((b) => b.y + b.h + GAP)) };
}

/** New subnets take the size of the smallest one already drawn (so rows line up), else the palette's. */
function subnetSize(ir: IR, plan: NetworkPlan): { w: number; h: number } {
  const drawn = plan.rows
    .map((r) => ir.resources.find((n) => n.id === r.node.id)?.position)
    .filter((p): p is CanvasPosition & { w: number } => p?.w !== undefined);
  if (drawn.length === 0) return { w: CONTAINER_MIN_W, h: CONTAINER_MIN_H };
  return {
    w: Math.max(MIN_BOX.w, Math.min(...drawn.map((p) => p.w))),
    h: Math.max(MIN_BOX.h, Math.min(...drawn.map((p) => p.h ?? CONTAINER_MIN_H))),
  };
}

/* ------------------------------------------------------------------- ops */

export interface PlanResult {
  ops: Op[];
  created: Array<{ id: string; cidr: string; zone?: string }>;
}

/** arguments back in the catalog's field order once the range and zone are set */
function inFieldOrder(node: ResourceNode, values: Record<string, Expression>): Record<string, Expression> {
  const def = getDef(node.type)!;
  const merged = { ...node.args, ...values };
  const out: Record<string, Expression> = {};
  for (const f of def.fields) if (merged[f.name]) out[f.name] = merged[f.name];
  for (const [k, v] of Object.entries(merged)) if (!out[k]) out[k] = v;
  return out;
}

/** `error` is in the UI language in effect */
export type PlanOutcome = PlanResult | { error: string };

function createSubnets(ir: IR, plan: NetworkPlan, prefix: number, zones: Array<string | undefined>): PlanOutcome {
  const type = SUBNET_OF[plan.network.node.type];
  const def = type ? getDef(type) : undefined;
  const m = messagesFor(cidrPlannerMessages);
  if (!def || plan.blocked) return { error: m.notLiteral };
  const blocks = allocateBlocks(plan.ranges, takenBlocks(plan), prefix, zones.length);
  if (!blocks) return { error: m.noRoomFor(zones.length, prefix, plan.network.node.id) };
  const container = plan.network.node;
  const width = container.position?.w ?? CONTAINER_MIN_W;
  const boxes = childBoxes(ir, container.id);
  const size = subnetSize(ir, plan);
  const { arg } = def.subnetCidr!;
  const ops: Op[] = [];
  const created: PlanResult['created'] = [];
  let running = ir;
  blocks.forEach((block, i) => {
    const spot = freeSpot(width, boxes, size);
    boxes.push({ ...spot, ...size });
    const position: CanvasPosition = { ...spot, ...size };
    const parent = running.resources.find((r) => r.id === container.id)!;
    const { node } = buildNewNode(running, def, position, parent);
    const cidr = formatCidrBlock(block);
    // keep the argument's shape: a string for AWS, a list of prefixes for Azure
    const range = node.args[arg]?.kind === 'list' ? list([lit(cidr)]) : lit(cidr);
    const values: Record<string, Expression> = { [arg]: range };
    const zone = zones[i];
    if (zone) values.availability_zone = lit(zone);
    const op: Op = { kind: 'add_resource', node: { ...node, args: inFieldOrder(node, values) } };
    ops.push(op);
    created.push({ id: node.id, cidr, zone });
    running = applyOps(running, [op]).ir;
  });
  return { ops, created };
}

/** One subnet of /`prefix` in the network's next free block (AWS: in its least-used AZ). */
export function addSubnetOps(ir: IR, networkId: string, prefix: number): PlanOutcome {
  const plan = networkPlan(ir, networkId);
  if (!plan) return { error: messagesFor(cidrPlannerMessages).unknownNetwork(networkId) };
  return createSubnets(ir, plan, prefix, [quietestZone(plan)]);
}

/** `count` subnets of /`prefix`, one per availability zone (a, b, c…) of the AWS provider's region. */
export function splitAcrossZonesOps(ir: IR, networkId: string, prefix: number, count: number): PlanOutcome {
  const plan = networkPlan(ir, networkId);
  if (!plan || plan.provider !== 'aws') return { error: messagesFor(cidrPlannerMessages).awsOnly };
  if (!plan.region) return { error: messagesFor(cidrPlannerMessages).needsRegion };
  return createSubnets(ir, plan, prefix, zonesFor(plan.region, count));
}

/* ---------------------------------------------------------------- subnet */

export interface SubnetPlan {
  subnet: SubnetInfo;
  provider: CloudProvider;
  /** the IPv4 range the numbers describe (a repeated subnet's: its first instance's) */
  block?: CidrBlock;
  /** a repeated subnet whose instances are known: each one's range and zone, as the network's list shows them */
  instances?: PlanRow[];
  /** the subnet's other ranges (IPv6, GCP secondary ranges) */
  others: RangeValue[];
  unresolved?: string;
  usable?: { first: bigint; last: bigint; count: bigint };
  parent?: NetworkPlan;
  /** fraction of the parent's addresses this subnet takes (0–1) */
  share?: number;
  /** the range isn't inside the parent's */
  outside?: boolean;
}

export function subnetPlan(ir: IR, subnetId: string): SubnetPlan | undefined {
  const subnet = networkModel(ir).subnets.find((s) => s.node.id === subnetId);
  if (!subnet) return undefined;
  const own = subnet.instances ? (subnet.instances[0]?.ranges ?? []) : subnet.ranges;
  const block = blocksOf(own)[0];
  const parent = subnet.network ? networkPlan(ir, subnet.network.node.id) : undefined;
  const usableParent = parent && !parent.blocked && parent.ranges.length > 0 ? parent : undefined;
  const container = block && usableParent?.ranges.find((r) => blockContains(r, block));
  return {
    subnet,
    provider: subnet.provider,
    block,
    instances: subnet.instances ? rowsOf(subnet, ir) : undefined,
    others: own.filter((r) => r.block !== block),
    unresolved: subnet.unresolved ? exprPreview(subnet.unresolved.expr) : undefined,
    usable: block ? usableRange(block, subnet.provider) : undefined,
    parent,
    // a repeated subnet: what all its instances take together
    share:
      block && usableParent && container
        ? Number(subnet.instances ? coveredSize(blocksOf(subnet.ranges)) : blockSize(block)) / Number(usableParent.total)
        : undefined,
    outside: !!(block && usableParent && !container),
  };
}
