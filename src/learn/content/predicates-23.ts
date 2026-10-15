/**
 * Predicates the network and compute lessons (levels 2 and 3) need on top of
 * ../goals.ts. They read what the app already derives: the security audit's
 * topology (public / private subnets, internet exposure, every SG rule), the
 * address plan, and per-instance values of `count` / `for_each`. Candidates
 * to hoist into goals.ts.
 */
import { blocksOf as rangeBlocks, networkModel } from '@/ir/checks/network';
import { instancesOf as repeatInstances, stringFor } from '@/ir/checks/repeatValues';
import { exprText, instanceCount } from '@/ir/repeat';
import type { Expression, ResourceNode } from '@/ir/types';
import { blockContains, blocksOverlap, type CidrBlock } from '@/resources/cidr';
import { blocksOf, fromInternet } from '@/security/model';
import { portsHas, ruleTraffic } from '@/security/traffic';
import { referencedAddresses, resourcesOf, valueOf } from '../goals';
import type { LessonCtx } from '../types';

type Test = (ctx: LessonCtx) => boolean;
type SubnetKind = 'public' | 'private';

/**
 * One token per instance of a subnet for the zone it sits in: the value when
 * it is certain, else the expression (made unique per instance when it varies
 * with `count.index` / `each`, like `data.aws_availability_zones.x.names[count.index]`).
 */
function zoneTokens(ctx: LessonCtx, subnet: ResourceNode): string[] {
  const expr = subnet.args.availability_zone ?? subnet.args.availability_zone_id;
  if (!expr) return [];
  const perInstance = /\b(count\.index|each\.(key|value))\b/.test(exprText(expr));
  return (repeatInstances(subnet, ctx.ir) ?? [undefined]).map(
    (instance, i) => stringFor(expr, ctx.ir, instance) ?? `?${exprText(expr)}${perInstance ? `#${i}` : ''}`,
  );
}

/** the subnets the security lens calls public (routed to an internet gateway) or private */
const subnetsOf = (ctx: LessonCtx, kind: SubnetKind | 'any'): ResourceNode[] =>
  resourcesOf(ctx, 'aws_subnet').filter((s) => kind === 'any' || ctx.audit.topology.subnets.get(s.id) === kind);

/** at least `min` subnet instances of this kind (count / for_each count each), spread over two or more zones */
export const subnetsAcrossZones =
  (kind: SubnetKind | 'any', min = 2): Test =>
  (ctx) => {
    const subnets = subnetsOf(ctx, kind);
    const instances = subnets.reduce((n, s) => n + (instanceCount(s, ctx.ir) ?? 1), 0);
    return instances >= min && new Set(subnets.flatMap((s) => zoneTokens(ctx, s))).size >= 2;
  };

/** a subnet of this kind inside a VPC; `publicIp` also asks whether it hands out public IPs */
export const subnetIs =
  (kind: SubnetKind, publicIp?: boolean): Test =>
  (ctx) =>
    subnetsOf(ctx, kind).some(
      (s) => s.parentId?.startsWith('aws_vpc.') && (publicIp === undefined || (valueOf(ctx.ir, s.args.map_public_ip_on_launch) === true) === publicIp),
    );

/** some resource of `type` is drawn inside a subnet of this kind */
export const inSubnet =
  (type: string, kind: SubnetKind): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => r.parentId !== undefined && ctx.audit.topology.subnets.get(r.parentId) === kind);

/**
 * Every VPC subnet's known range sits inside its VPC and overlaps no other
 * (at least one subnet, and ranges written as expressions it can't read don't count against it).
 */
export const rangesFit: Test = (ctx) => {
  const vpcs = networkModel(ctx.ir).networks.filter((n) => n.node.type === 'aws_vpc');
  const subnets = vpcs.flatMap((n) => n.subnets);
  if (subnets.length === 0) return false;
  const taken: CidrBlock[] = [];
  for (const s of subnets) {
    const network = rangeBlocks(s.network!.ranges);
    for (const block of rangeBlocks(s.ranges)) {
      if (!network.some((n) => blockContains(n, block)) || taken.some((t) => blocksOverlap(t, block))) return false;
      taken.push(block);
    }
  }
  return true;
};

/** a `0.0.0.0/0` route to an internet gateway: inline in a route table, or an `aws_route` on one */
export const defaultRouteToIgw: Test = (ctx) => {
  const toIgw = (e: Expression | undefined) => referencedAddresses(e).some((a) => a.startsWith('aws_internet_gateway.'));
  const anywhere = (e: Expression | undefined) => valueOf(ctx.ir, e) === '0.0.0.0/0';
  const inline = [...resourcesOf(ctx, 'aws_route_table'), ...resourcesOf(ctx, 'aws_default_route_table')].some((t) =>
    blocksOf(t.args.route).some((route) => anywhere(route.cidr_block) && toIgw(route.gateway_id)),
  );
  return (
    inline ||
    resourcesOf(ctx, 'aws_route').some(
      (r) => anywhere(r.args.destination_cidr_block) && toIgw(r.args.gateway_id) && referencedAddresses(r.args.route_table_id).length > 0,
    )
  );
};

const sgRules = (ctx: LessonCtx) => [...ctx.audit.topology.rules.values()].flat().filter((r) => r.ownerKind === 'sg');

/** some security group lets TCP `port` in from the whole internet (inline block or rule resource) */
export const opensToInternet =
  (port: number): Test =>
  (ctx) =>
    sgRules(ctx).some((r) => {
      if (r.direction !== 'inbound' || r.action !== 'allow' || !fromInternet(r)) return false;
      const traffic = ruleTraffic(r);
      return traffic !== null && portsHas(traffic.tcp, port);
    });

/** some security group allows outbound traffic */
export const allowsOutbound: Test = (ctx) => sgRules(ctx).some((r) => r.direction === 'outbound' && r.action === 'allow');

/**
 * Some resource of `type` is reachable from the internet (public address,
 * route to an internet gateway and rules that let it in) on these TCP ports;
 * `only`: on nothing else.
 */
export const reachableOn =
  (type: string, ports: number[], only = false): Test =>
  (ctx) =>
    resourcesOf(ctx, type).some((r) => {
      const e = ctx.audit.topology.exposure.get(r.id);
      if (e?.level !== 'internet') return false;
      const wanted = ports.map(String);
      return wanted.every((p) => e.ports.includes(p)) && (!only || e.ports.every((p) => wanted.includes(p)));
    });

/** the security audit's grade */
export const grade =
  (letter: 'A' | 'B' | 'C' | 'D' | 'F'): Test =>
  (ctx) =>
    ctx.audit.grade === letter;

/**
 * Some `aws_iam_role` trusts this service principal (`ec2.amazonaws.com`) in
 * its `assume_role_policy`: written inline (`jsonencode`, a heredoc) or in a
 * `data "aws_iam_policy_document"` it reads.
 */
export const roleTrusts =
  (service: string): Test =>
  (ctx) =>
    resourcesOf(ctx, 'aws_iam_role').some((role) => {
      const policy = role.args.assume_role_policy;
      if (!policy) return false;
      if (JSON.stringify(policy).includes(service)) return true;
      const docs = referencedAddresses(policy);
      return ctx.ir.data.some(
        (d) => d.type === 'aws_iam_policy_document' && docs.some((a) => a.startsWith(`${d.id}.`)) && JSON.stringify(d.args).includes(service),
      );
    });
