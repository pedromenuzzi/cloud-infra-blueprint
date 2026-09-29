/**
 * Mistakes in how resources are wired that the cloud always refuses: two
 * resources claiming a name that must be unique in their scope, and AWS
 * resources joined across VPCs (an instance in one VPC guarded by another
 * VPC's security group).
 */
import { literalString, refTargetAddress } from '../expr';
import type { Expression, IR, ResourceNode } from '../types';
import { isRepeated, refTarget } from './resolve';
import type { CheckContext } from './types';

interface UniqueName {
  arg: string;
  /** where the name must be unique: the whole cloud, one provider configuration, or one parent */
  scope: 'global' | 'provider' | { args: string[]; what: string };
  what: string;
}

const UNIQUE: Record<string, UniqueName> = {
  aws_s3_bucket: { arg: 'bucket', scope: 'global', what: 'S3 bucket names are global across all AWS accounts' },
  aws_security_group: {
    arg: 'name',
    scope: { args: ['vpc_id'], what: 'in the same VPC' },
    what: 'AWS needs security group names to be unique per VPC',
  },
  aws_iam_role: { arg: 'name', scope: 'provider', what: 'IAM role names are unique per account' },
  aws_lb: { arg: 'name', scope: 'provider', what: 'load balancer names are unique per region' },
  aws_lb_target_group: { arg: 'name', scope: 'provider', what: 'target group names are unique per region' },
  aws_lambda_function: { arg: 'function_name', scope: 'provider', what: 'function names are unique per region' },
  aws_dynamodb_table: { arg: 'name', scope: 'provider', what: 'table names are unique per region' },
  azurerm_storage_account: { arg: 'name', scope: 'global', what: 'storage account names are global across Azure' },
  azurerm_subnet: {
    arg: 'name',
    scope: { args: ['virtual_network_name', 'resource_group_name'], what: 'in the same VNet' },
    what: 'subnet names are unique per VNet',
  },
  google_storage_bucket: { arg: 'name', scope: 'global', what: 'Cloud Storage bucket names are global' },
  google_compute_network: { arg: 'name', scope: 'provider', what: 'network names are unique per project' },
  google_compute_firewall: { arg: 'name', scope: 'provider', what: 'firewall rule names are unique per project' },
};

/** the configuration a resource deploys with (`aws.west`, or the default one) */
function providerKey(node: ResourceNode): string {
  const p = node.args.provider;
  return p?.kind === 'ref' ? p.path : '';
}

/** the parent a scope argument points at, or its literal text (`virtual_network_name = "vnet"`) */
function scopeKey(e: Expression | undefined): string | undefined {
  if (!e) return '';
  if (e.kind === 'ref') return refTargetAddress(e.path) ?? e.path;
  return literalString(e);
}

function duplicateNames(ctx: CheckContext) {
  const seen = new Map<string, ResourceNode>();
  for (const node of ctx.ir.resources) {
    const rule = UNIQUE[node.type];
    if (!rule || isRepeated(node)) continue;
    const name = literalString(node.args[rule.arg]);
    if (!name) continue;
    const parents = typeof rule.scope === 'object' ? rule.scope.args.map((arg) => scopeKey(node.args[arg])) : [];
    // a scope we can't read (an expression) can't prove two names collide
    if (parents.some((p) => p === undefined)) continue;
    const scope = rule.scope === 'global' ? '' : [providerKey(node), ...parents].join('|');
    const key = `${node.type}|${scope}|${name}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, node);
      continue;
    }
    const where = typeof rule.scope === 'object' ? ` ${rule.scope.what}` : '';
    ctx.warn(node, rule.arg, `${rule.arg} "${name}" is already used by ${first.id}${where} — ${rule.what}`);
  }
}

/** The project VPC an AWS resource belongs to, through its `vpc_id` (a subnet, a security group, a route table…). */
function vpcOf(ir: IR, node: ResourceNode | undefined): ResourceNode | undefined {
  const vpc = refTarget(ir, node?.args.vpc_id);
  return vpc?.type === 'aws_vpc' ? vpc : undefined;
}

function targets(ir: IR, e: Expression | undefined): ResourceNode[] {
  const items = e?.kind === 'list' ? e.items : e ? [e] : [];
  return items.map((i) => refTarget(ir, i)).filter((r): r is ResourceNode => r !== undefined);
}

/** Security groups and route tables only work with subnets of their own VPC. */
function crossVpc(ctx: CheckContext) {
  const { ir } = ctx;
  for (const node of ir.resources) {
    if (node.type === 'aws_instance') {
      const subnet = refTarget(ir, node.args.subnet_id);
      const vpc = subnet?.type === 'aws_subnet' ? vpcOf(ir, subnet) : undefined;
      if (!vpc) continue;
      for (const field of ['vpc_security_group_ids', 'security_groups']) {
        const stray = targets(ir, node.args[field]).find((sg) => sg.type === 'aws_security_group' && vpcOf(ir, sg) && vpcOf(ir, sg) !== vpc);
        if (!stray) continue;
        ctx.warn(
          node,
          field,
          `${stray.id} belongs to ${vpcOf(ir, stray)!.id}, but ${subnet!.id} is in ${vpc.id} — ` +
            'an instance can only use security groups of its own VPC',
        );
      }
    } else if (node.type === 'aws_route_table_association') {
      const subnet = refTarget(ir, node.args.subnet_id);
      const table = refTarget(ir, node.args.route_table_id);
      const a = subnet?.type === 'aws_subnet' ? vpcOf(ir, subnet) : undefined;
      const b = table?.type === 'aws_route_table' ? vpcOf(ir, table) : undefined;
      if (!a || !b || a === b) continue;
      ctx.warn(
        node,
        'route_table_id',
        `${table!.id} belongs to ${b.id}, but ${subnet!.id} is in ${a.id} — a subnet can only use a route table of its own VPC`,
      );
    } else if (node.type === 'aws_lb') {
      const vpcs = [...new Set(targets(ir, node.args.subnets).filter((s) => s.type === 'aws_subnet').map((s) => vpcOf(ir, s)))];
      if (vpcs.length > 1 && vpcs.every(Boolean)) {
        ctx.warn(node, 'subnets', `subnets come from ${vpcs.map((v) => v!.id).join(' and ')} — a load balancer's subnets must all be in one VPC`);
      }
    }
  }
}

export function wiringChecks(ctx: CheckContext) {
  duplicateNames(ctx);
  crossVpc(ctx);
}
