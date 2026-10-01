/**
 * The address plan of a project: every network (VPC, VNet, GCP network) with
 * its ranges and its subnets with theirs, values resolved where that is
 * certain. A repeated subnet (`count`, `for_each`) stands for the ranges of
 * all its instances when each one's is known (`cidrsubnet(…, count.index)`,
 * `each.value` of a literal map). The CIDR checks and the inspector's CIDR
 * planner both read it.
 */
import { blockSize, parseCidrBlock, type CidrBlock, type CloudProvider, type IpFamily } from '@/resources/cidr';
import type { Expression, IR, ResourceNode } from '../types';
import { evaluateFor, instancesOf, type Instance } from './repeatValues';
import { isRepeated, refTarget, resolveString, resolveStringList } from './resolve';

export interface RangeValue {
  /** the argument that holds it, for markers (`cidr_block`, `address_prefixes`…) */
  field: string;
  /** set when another resource holds it (a VPC's secondary range association) */
  owner?: string;
  /** the text as written or resolved */
  text: string;
  /** the variable it was resolved from */
  via?: string;
  /** undefined when `text` isn't a valid CIDR */
  block?: CidrBlock;
  hostBits: boolean;
  /** the family the argument takes (Azure lists take both) */
  expects?: IpFamily;
  /** the instance of a repeated subnet it belongs to: `aws_subnet.public[0]` */
  instance?: string;
}

export interface NetworkInfo {
  node: ResourceNode;
  provider: CloudProvider;
  ranges: RangeValue[];
  /** families whose ranges are all known — only those can prove a subnet is outside */
  known: Set<IpFamily>;
  /** the network's own range argument when it isn't a value we can read (an expression) */
  unresolved?: { field: string; expr: Expression };
  subnets: SubnetInfo[];
}

export interface SubnetInfo {
  node: ResourceNode;
  provider: CloudProvider;
  network?: NetworkInfo;
  /** for a repeated subnet with known `instances`: every instance's ranges */
  ranges: RangeValue[];
  /** a range argument that is an expression we can't read */
  unresolved?: { field: string; expr: Expression };
  /**
   * a repeated subnet (`count`, `for_each`) whose instances and their ranges
   * are known, in instance order; undefined for a plain subnet, or when how
   * many there are or what each gets is decided at plan time
   */
  instances?: SubnetInstance[];
}

export interface SubnetInstance {
  /** `aws_subnet.public[0]`, `aws_subnet.public["a"]` */
  address: string;
  /** what `count.index` / `each.*` are for it (to evaluate its other arguments) */
  instance: Instance;
  ranges: RangeValue[];
}

export interface NetworkModel {
  networks: NetworkInfo[];
  subnets: SubnetInfo[];
}

interface RangeArg {
  field: string;
  list?: boolean;
  expects?: IpFamily;
}

/** Network types and the arguments that hold their ranges. */
export const NETWORK_TYPES: Record<string, { provider: CloudProvider; ranges: RangeArg[] }> = {
  aws_vpc: {
    provider: 'aws',
    ranges: [
      { field: 'cidr_block', expects: 'ipv4' },
      { field: 'ipv6_cidr_block', expects: 'ipv6' },
    ],
  },
  azurerm_virtual_network: { provider: 'azure', ranges: [{ field: 'address_space', list: true }] },
  google_compute_network: { provider: 'gcp', ranges: [] },
};

/** Subnet types: the argument pointing at the network, and the ones holding the ranges. */
export const SUBNET_TYPES: Record<string, { provider: CloudProvider; parentArg: string; network: string; ranges: RangeArg[] }> = {
  aws_subnet: {
    provider: 'aws',
    parentArg: 'vpc_id',
    network: 'aws_vpc',
    ranges: [
      { field: 'cidr_block', expects: 'ipv4' },
      { field: 'ipv6_cidr_block', expects: 'ipv6' },
    ],
  },
  azurerm_subnet: {
    provider: 'azure',
    parentArg: 'virtual_network_name',
    network: 'azurerm_virtual_network',
    ranges: [{ field: 'address_prefixes', list: true }],
  },
  google_compute_subnetwork: {
    provider: 'gcp',
    parentArg: 'network',
    network: 'google_compute_network',
    ranges: [{ field: 'ip_cidr_range', expects: 'ipv4' }],
  },
};

/** secondary VPC ranges live in their own resources */
const AWS_SECONDARY = { aws_vpc_ipv4_cidr_block_association: 'ipv4', aws_vpc_ipv6_cidr_block_association: 'ipv6' } as const;

export function rangeValue(field: string, text: string, via: string | undefined, expects: IpFamily | undefined): RangeValue {
  const parsed = parseCidrBlock(text);
  return parsed.ok
    ? { field, text, via, block: parsed.block, hostBits: parsed.hostBits, expects }
    : { field, text, via, hostBits: false, expects };
}

/** Ranges of `args[field]`; `complete` is false when some of it is an expression. */
function readRanges(ir: IR, node: ResourceNode, arg: RangeArg): { ranges: RangeValue[]; complete: boolean } {
  const expr = node.args[arg.field];
  if (!expr) return { ranges: [], complete: true };
  if (arg.list) {
    const { items, complete } = resolveStringList(ir, expr);
    return { ranges: items.map((i) => rangeValue(arg.field, i.value, i.via, arg.expects)), complete };
  }
  const r = resolveString(ir, expr);
  return r ? { ranges: [rangeValue(arg.field, r.value, r.via, arg.expects)], complete: true } : { ranges: [], complete: false };
}

/** GCP secondary ranges: `secondary_ip_range { range_name, ip_cidr_range }` blocks */
function secondaryRanges(ir: IR, node: ResourceNode): RangeValue[] {
  const e = node.args.secondary_ip_range;
  const bodies = e?.kind === 'block' ? [e.body] : e?.kind === 'blocks' ? e.items : [];
  return bodies.flatMap((body) => {
    const r = resolveString(ir, body.ip_cidr_range);
    return r ? [rangeValue('secondary_ip_range', r.value, r.via, 'ipv4')] : [];
  });
}

function buildNetwork(ir: IR, node: ResourceNode): NetworkInfo {
  const spec = NETWORK_TYPES[node.type];
  const ranges: RangeValue[] = [];
  const known = new Set<IpFamily>(['ipv4', 'ipv6']);
  let unresolved: NetworkInfo['unresolved'];
  for (const arg of spec.ranges) {
    const present = node.args[arg.field] !== undefined;
    const read = readRanges(ir, node, arg);
    ranges.push(...read.ranges);
    if (present && !read.complete) unresolved ??= { field: arg.field, expr: node.args[arg.field] };
    if (present && read.complete) continue;
    // a range we can't read — or none at all (AWS IPAM, Amazon's IPv6 pool) — proves nothing
    if (arg.expects) known.delete(arg.expects);
    else known.clear();
  }
  if (node.type === 'aws_vpc') {
    for (const assoc of ir.resources) {
      const family = AWS_SECONDARY[assoc.type as keyof typeof AWS_SECONDARY];
      if (!family || refTarget(ir, assoc.args.vpc_id)?.id !== node.id) continue;
      const field = family === 'ipv4' ? 'cidr_block' : 'ipv6_cidr_block';
      const read = readRanges(ir, assoc, { field, expects: family });
      if (read.complete && assoc.args[field]) ranges.push(...read.ranges.map((r) => ({ ...r, owner: assoc.id })));
      else known.delete(family);
    }
  }
  if (node.type === 'google_compute_network') known.clear();
  return { node, provider: spec.provider, ranges, known, unresolved, subnets: [] };
}

/**
 * The ranges of each instance of a repeated subnet, or undefined when some
 * instance's can't be known here (an unknown count, a range written with
 * functions or values the evaluator doesn't follow).
 */
function instanceRanges(ir: IR, node: ResourceNode, args: RangeArg[]): SubnetInstance[] | undefined {
  const instances = instancesOf(node, ir);
  if (!instances) return undefined;
  const out: SubnetInstance[] = [];
  for (const instance of instances) {
    const ranges: RangeValue[] = [];
    for (const arg of args) {
      const expr = node.args[arg.field];
      if (!expr) continue;
      const value = evaluateFor(expr, ir, instance);
      const texts = arg.list ? value : [value];
      if (!Array.isArray(texts) || !texts.every((t): t is string => typeof t === 'string')) return undefined;
      ranges.push(...texts.map((text) => ({ ...rangeValue(arg.field, text, undefined, arg.expects), instance: instance.address })));
    }
    out.push({ address: instance.address, instance, ranges });
  }
  return out;
}

function buildSubnet(ir: IR, node: ResourceNode): SubnetInfo {
  const spec = SUBNET_TYPES[node.type];
  // GCP secondary ranges of a repeated subnetwork aren't expanded: such a plan stays unknown
  if (isRepeated(node) && !node.args.secondary_ip_range) {
    const instances = instanceRanges(ir, node, spec.ranges);
    if (instances) return { node, provider: spec.provider, ranges: instances.flatMap((i) => i.ranges), instances };
  }
  const ranges: RangeValue[] = [];
  let unresolved: SubnetInfo['unresolved'];
  for (const arg of spec.ranges) {
    const read = readRanges(ir, node, arg);
    ranges.push(...read.ranges);
    if (!read.complete) unresolved ??= { field: arg.field, expr: node.args[arg.field] };
  }
  if (node.type === 'google_compute_subnetwork') ranges.push(...secondaryRanges(ir, node));
  return { node, provider: spec.provider, ranges, unresolved };
}

export function networkModel(ir: IR): NetworkModel {
  const networks = ir.resources.filter((r) => NETWORK_TYPES[r.type]).map((r) => buildNetwork(ir, r));
  const byNode = new Map(networks.map((n) => [n.node.id, n] as const));
  const subnets = ir.resources
    .filter((r) => SUBNET_TYPES[r.type])
    .map((r) => {
      const subnet = buildSubnet(ir, r);
      const parent = refTarget(ir, r.args[SUBNET_TYPES[r.type].parentArg]);
      const network = parent && parent.type === SUBNET_TYPES[r.type].network ? byNode.get(parent.id) : undefined;
      if (network) {
        subnet.network = network;
        network.subnets.push(subnet);
      }
      return subnet;
    });
  return { networks, subnets };
}

/** Valid ranges of one family (the planner works on IPv4). */
export function blocksOf(ranges: RangeValue[], family: IpFamily = 'ipv4'): CidrBlock[] {
  return ranges.flatMap((r) => (r.block?.family === family ? [r.block] : []));
}

/** Addresses the ranges hold together (they may overlap when the plan is wrong — then it's an upper bound). */
export function totalSize(blocks: CidrBlock[]): bigint {
  return blocks.reduce((sum, b) => sum + blockSize(b), 0n);
}
