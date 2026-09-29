/**
 * CIDR checks: ranges that don't parse, sit outside their network, overlap a
 * sibling or a peer, or break a cloud's size limits. Only values that are
 * certain (literals, variable defaults) are compared.
 */
import {
  blockContains,
  blocksOverlap,
  formatCidrBlock,
  type CidrBlock,
  type CloudProvider,
  type IpFamily,
} from '@/resources/cidr';
import type { ResourceNode } from '../types';
import { blocksOf, rangeValue, type NetworkInfo, type NetworkModel, type RangeValue, type SubnetInfo } from './network';
import { isRepeated, refTarget, resolveString } from './resolve';
import type { CheckContext } from './types';

const NETWORK_WORD: Record<CloudProvider, string> = { aws: 'VPC', azure: 'VNet', gcp: 'network' };
const EXAMPLE = { ipv4: '10.0.0.0/16', ipv6: '2001:db8::/56' } as const;
const FAMILY_NAME = { ipv4: 'IPv4', ipv6: 'IPv6' } as const;
/** AWS keeps each family in its own argument */
const AWS_FAMILY_ARG = { ipv4: 'cidr_block', ipv6: 'ipv6_cidr_block' } as const;

/** `cidr_block "10.0.1/24"`, with the variable it came from */
function quoted(r: RangeValue): string {
  return `${r.field} "${r.text}"${r.via ? ` (from ${r.via})` : ''}`;
}

const cidrList = (ranges: RangeValue[]) => ranges.map((r) => r.text).join(', ');

type Role = 'network' | 'subnet';

/** The smallest (and largest) prefix a range of this role may have, when the cloud limits it. */
function sizeRule(provider: CloudProvider, role: Role, r: RangeValue): string | undefined {
  const block = r.block!;
  if (provider === 'aws' && block.family === 'ipv4' && (block.prefix < 16 || block.prefix > 28)) {
    const what = role === 'subnet' ? 'subnet' : 'VPC';
    return `${r.field} ${r.text} is too ${block.prefix < 16 ? 'large' : 'small'} for a ${what} — AWS allows /16 to /28`;
  }
  if (provider === 'azure' && role === 'subnet') {
    if (block.family === 'ipv4' && block.prefix > 29) {
      return `${r.field} ${r.text} is too small — Azure subnets must be /29 or larger`;
    }
    if (block.family === 'ipv6' && block.prefix !== 64) {
      return `${r.field} ${r.text} can't be used — Azure IPv6 subnets must be exactly /64`;
    }
  }
  if (provider === 'gcp' && role === 'subnet' && r.field === 'ip_cidr_range' && block.prefix > 29) {
    return `${r.field} ${r.text} is too small — GCP subnet ranges must be /29 or larger`;
  }
  return undefined;
}

/** Syntax, address family, host bits and size of each range a resource writes itself. */
function checkRanges(ctx: CheckContext, node: ResourceNode, ranges: RangeValue[], provider: CloudProvider, role: Role) {
  for (const r of ranges) {
    if (r.owner) continue; // a secondary range: checked on the association that holds it
    if (!r.block) {
      const hint = EXAMPLE[r.expects ?? 'ipv4'];
      ctx.warn(node, r.field, `${quoted(r)} isn't a valid CIDR range (expected something like ${hint})`);
      continue;
    }
    if (r.expects && r.block.family !== r.expects) {
      const other = provider === 'aws' ? AWS_FAMILY_ARG[r.block.family] : undefined;
      const fix = other ? `put it in ${other}` : `${r.field} takes ${FAMILY_NAME[r.expects]} ranges`;
      ctx.warn(node, r.field, `${quoted(r)} is an ${FAMILY_NAME[r.block.family]} range — ${fix}`);
      continue;
    }
    if (r.hostBits) {
      ctx.warn(node, r.field, `${quoted(r)} has host bits set — the range it describes is ${formatCidrBlock(r.block)}, write that instead`);
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
      const name = FAMILY_NAME[family];
      ctx.warn(subnet.node, r.field, `${r.field} ${r.text} is ${name}, but ${net.node.id} has no ${name} range`);
      continue;
    }
    const partly = parents.some((p) => blocksOverlap(p.block!, r.block));
    const range = parents.length === 1 ? `range (${parents[0].text})` : `ranges (${cidrList(parents)})`;
    ctx.warn(
      subnet.node,
      r.field,
      `${r.field} ${r.text} is ${partly ? 'not fully inside' : 'outside'} ${net.node.id}'s ${range}`,
    );
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
  const word = NETWORK_WORD[net.provider];
  for (let j = 1; j < owned.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = owned[i];
      const b = owned[j];
      if (!blocksOverlap(a.range.block, b.range.block)) continue;
      const key = `${b.node.id}|${a.node.id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      if (a.node === b.node) {
        ctx.warn(b.node, b.range.field, `${a.range.field} ${a.range.text} and ${b.range.text} overlap`);
      } else {
        const who = net.provider === 'gcp' ? 'subnetworks of one network' : `subnets in one ${word}`;
        const why = `${who} need ranges of their own`;
        ctx.warn(b.node, b.range.field, `${b.range.field} ${b.range.text} overlaps ${a.node.id} (${a.range.text}) — ${why}`);
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

const PEERINGS: Record<string, { a: string; b: string; cloud: string; what: string }> = {
  aws_vpc_peering_connection: { a: 'vpc_id', b: 'peer_vpc_id', cloud: 'AWS', what: 'VPCs whose ranges overlap' },
  azurerm_virtual_network_peering: {
    a: 'virtual_network_name',
    b: 'remote_virtual_network_id',
    cloud: 'Azure',
    what: 'virtual networks whose address spaces overlap',
  },
  google_compute_network_peering: { a: 'network', b: 'peer_network', cloud: 'GCP', what: 'networks whose subnet ranges overlap' },
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
    ctx.warn(
      peering,
      spec.b,
      `${a.node.id} (${formatCidrBlock(hit[0])}) and ${b.node.id} (${formatCidrBlock(hit[1])}) overlap — ${spec.cloud} can't peer ${spec.what}`,
    );
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
      const word = NETWORK_WORD[b.provider];
      ctx.warn(
        b.node,
        field,
        `${formatCidrBlock(hit[1])} overlaps ${a.node.id} (${formatCidrBlock(hit[0])}) — ` +
          `fine while the two ${word}s stay apart, but they could never be peered`,
      );
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
