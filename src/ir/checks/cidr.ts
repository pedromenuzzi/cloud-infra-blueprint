/**
 * CIDR checks: ranges that don't parse, sit outside their network, overlap a
 * sibling or a peer, or break a cloud's size limits. Only values that are
 * certain (literals, variable defaults) are compared.
 */
import { messagesFor } from '@/i18n/messages';
import {
  blockContains,
  blocksOverlap,
  formatCidrBlock,
  type CidrBlock,
  type CloudProvider,
  type IpFamily,
} from '@/resources/cidr';
import type { ResourceNode } from '../types';
import { checkMessages } from './messages';
import { blocksOf, rangeValue, type NetworkInfo, type NetworkModel, type RangeValue, type SubnetInfo } from './network';
import { isRepeated, refTarget, resolveString } from './resolve';
import type { CheckContext } from './types';

const EXAMPLE = { ipv4: '10.0.0.0/16', ipv6: '2001:db8::/56' } as const;
/** AWS keeps each family in its own argument */
const AWS_FAMILY_ARG = { ipv4: 'cidr_block', ipv6: 'ipv6_cidr_block' } as const;

/** the warnings in the UI language in effect */
const t = () => messagesFor(checkMessages);

/** `cidr_block "10.0.1/24"`, with the variable it came from */
function quoted(r: RangeValue): string {
  return `${r.field} "${r.text}"${r.via ? t().from(r.via) : ''}`;
}

type Role = 'network' | 'subnet';

/** Why the cloud refuses a range of this size for its role, if it does. */
function sizeRule(provider: CloudProvider, role: Role, r: RangeValue): string | undefined {
  const block = r.block!;
  if (provider === 'aws' && block.family === 'ipv4' && (block.prefix < 16 || block.prefix > 28)) {
    return t().awsSize(r.field, r.text, block.prefix < 16, role);
  }
  if (provider === 'azure' && role === 'subnet') {
    if (block.family === 'ipv4' && block.prefix > 29) return t().azureSubnetTooSmall(r.field, r.text);
    if (block.family === 'ipv6' && block.prefix !== 64) return t().azureIpv6Size(r.field, r.text);
  }
  if (provider === 'gcp' && role === 'subnet' && r.field === 'ip_cidr_range' && block.prefix > 29) {
    return t().gcpSubnetTooSmall(r.field, r.text);
  }
  return undefined;
}

/** Syntax, address family, host bits and size of each range a resource writes itself. */
function checkRanges(ctx: CheckContext, node: ResourceNode, ranges: RangeValue[], provider: CloudProvider, role: Role) {
  for (const r of ranges) {
    if (r.owner) continue; // a secondary range: checked on the association that holds it
    if (!r.block) {
      ctx.warn(node, r.field, t().invalidCidr(quoted(r), EXAMPLE[r.expects ?? 'ipv4']));
      continue;
    }
    if (r.expects && r.block.family !== r.expects) {
      const other = provider === 'aws' ? AWS_FAMILY_ARG[r.block.family] : undefined;
      const fix = other ? t().putItIn(other) : t().takesFamily(r.field, r.expects);
      ctx.warn(node, r.field, t().wrongFamily(quoted(r), r.block.family, fix));
      continue;
    }
    if (r.hostBits) {
      ctx.warn(node, r.field, t().hostBits(quoted(r), formatCidrBlock(r.block)));
      continue;
    }
    const size = sizeRule(provider, role, r);
    if (size) ctx.warn(node, r.field, size);
  }
}

/** Ranges that are valid and of the family their argument takes. */
function usable(ranges: RangeValue[]): Array<RangeValue & { block: CidrBlock }> {
  return ranges.filter((r): r is RangeValue & { block: CidrBlock } => !!r.block && (!r.expects || r.block.family === r.expects));
}

/** A subnet range must sit inside one of its network's ranges of the same family. */
function checkInside(ctx: CheckContext, subnet: SubnetInfo, net: NetworkInfo) {
  if (!net.ranges.every((r) => r.block)) return; // the network's own range is broken — reported there
  for (const r of usable(subnet.ranges)) {
    const family = r.block.family;
    if (!net.known.has(family)) continue;
    const parents = net.ranges.filter((p) => p.block!.family === family);
    if (parents.some((p) => blockContains(p.block!, r.block))) continue;
    if (parents.length === 0) {
      ctx.warn(subnet.node, r.field, t().noFamilyRange(r.field, r.text, family, net.node.id));
      continue;
    }
    const partly = parents.some((p) => blocksOverlap(p.block!, r.block));
    ctx.warn(subnet.node, r.field, t().outsideNetwork(r.field, r.text, partly, net.node.id, parents.map((p) => p.text)));
  }
}

interface Owned {
  node: ResourceNode;
  range: RangeValue & { block: CidrBlock };
}

/** Pairwise overlaps between the ranges of different subnets, and within one subnet. */
function checkSiblings(ctx: CheckContext, net: NetworkInfo) {
  const owned: Owned[] = net.subnets
    .filter((s) => !isRepeated(s.node))
    .flatMap((s) => usable(s.ranges).map((range) => ({ node: s.node, range })));
  const reported = new Set<string>();
  for (let j = 1; j < owned.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = owned[i];
      const b = owned[j];
      if (!blocksOverlap(a.range.block, b.range.block)) continue;
      const key = `${b.node.id}|${a.node.id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      if (a.node === b.node) {
        const first = a.range.field === b.range.field ? a.range.text : `${a.range.field} ${a.range.text}`;
        ctx.warn(b.node, b.range.field, t().overlapsOwn(b.range.field, b.range.text, first));
      } else {
        ctx.warn(b.node, b.range.field, t().overlapsSibling(b.range.field, b.range.text, a.node.id, a.range.text, net.provider));
      }
    }
  }
}

function overlapBetween(a: CidrBlock[], b: CidrBlock[]): [CidrBlock, CidrBlock] | undefined {
  for (const x of a) for (const y of b) if (blocksOverlap(x, y)) return [x, y];
  return undefined;
}

/** A network's own ranges, when they are all valid (else nothing is compared). */
function ownBlocks(net: NetworkInfo): CidrBlock[] {
  return net.ranges.every((r) => r.block) ? [...blocksOf(net.ranges, 'ipv4'), ...blocksOf(net.ranges, 'ipv6')] : [];
}

/** GCP networks have no range: what peering compares is their subnetworks' ranges. */
function gcpBlocks(net: NetworkInfo): CidrBlock[] {
  return net.subnets.filter((s) => !isRepeated(s.node)).flatMap((s) => usable(s.ranges).map((r) => r.block));
}

const PEERINGS: Record<string, { a: string; b: string; cloud: CloudProvider }> = {
  aws_vpc_peering_connection: { a: 'vpc_id', b: 'peer_vpc_id', cloud: 'aws' },
  azurerm_virtual_network_peering: { a: 'virtual_network_name', b: 'remote_virtual_network_id', cloud: 'azure' },
  google_compute_network_peering: { a: 'network', b: 'peer_network', cloud: 'gcp' },
};

/** Peered networks can't overlap; unpeered ones in one project get a softer heads-up. */
function checkNetworkOverlaps(ctx: CheckContext, model: NetworkModel) {
  const byNode = new Map(model.networks.map((n) => [n.node.id, n] as const));
  const peered = new Set<string>();
  for (const peering of ctx.ir.resources) {
    const spec = PEERINGS[peering.type];
    if (!spec) continue;
    const a = byNode.get(refTarget(ctx.ir, peering.args[spec.a])?.id ?? '');
    const b = byNode.get(refTarget(ctx.ir, peering.args[spec.b])?.id ?? '');
    if (!a || !b || a === b || isRepeated(a.node) || isRepeated(b.node)) continue;
    peered.add(`${a.node.id}|${b.node.id}`).add(`${b.node.id}|${a.node.id}`);
    const blocks = (n: NetworkInfo) => (n.provider === 'gcp' ? gcpBlocks(n) : ownBlocks(n));
    const hit = overlapBetween(blocks(a), blocks(b));
    if (!hit) continue;
    ctx.warn(peering, spec.b, t().peeringOverlap(spec.cloud, a.node.id, formatCidrBlock(hit[0]), b.node.id, formatCidrBlock(hit[1])));
  }

  const candidates = model.networks.filter((n) => n.provider !== 'gcp' && !isRepeated(n.node));
  for (let j = 1; j < candidates.length; j++) {
    const b = candidates[j];
    for (let i = 0; i < j; i++) {
      const a = candidates[i];
      if (a.provider !== b.provider || peered.has(`${a.node.id}|${b.node.id}`)) continue;
      const hit = overlapBetween(ownBlocks(a), ownBlocks(b));
      if (!hit) continue;
      const field = b.ranges.find((r) => r.block && blocksOverlap(r.block, hit[1]) && !r.owner)?.field ?? b.ranges[0]?.field;
      ctx.warn(b.node, field, t().networksOverlap(formatCidrBlock(hit[1]), a.node.id, formatCidrBlock(hit[0]), b.provider));
      break;
    }
  }
}

const ASSOCIATIONS: Record<string, IpFamily> = {
  aws_vpc_ipv4_cidr_block_association: 'ipv4',
  aws_vpc_ipv6_cidr_block_association: 'ipv6',
};

/** Secondary VPC ranges (`aws_vpc_ipv4_cidr_block_association`) follow the VPC's syntax and size rules. */
function checkAssociations(ctx: CheckContext) {
  for (const node of ctx.ir.resources) {
    const family = ASSOCIATIONS[node.type];
    if (!family) continue;
    const field = AWS_FAMILY_ARG[family];
    const r = resolveString(ctx.ir, node.args[field]);
    if (r) checkRanges(ctx, node, [rangeValue(field, r.value, r.via, family)], 'aws', 'network');
  }
}

export function cidrChecks(ctx: CheckContext, model: NetworkModel) {
  for (const net of model.networks) {
    checkRanges(ctx, net.node, net.ranges, net.provider, 'network');
    checkSiblings(ctx, net);
  }
  for (const subnet of model.subnets) {
    checkRanges(ctx, subnet.node, subnet.ranges, subnet.provider, 'subnet');
    if (subnet.network) checkInside(ctx, subnet, subnet.network);
  }
  checkAssociations(ctx);
  checkNetworkOverlaps(ctx, model);
}
