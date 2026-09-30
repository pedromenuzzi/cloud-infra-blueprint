/**
 * Mistakes in how resources are wired that the cloud always refuses: two
 * resources claiming a name that must be unique in their scope, and AWS
 * resources joined across VPCs (an instance in one VPC guarded by another
 * VPC's security group).
 */
import { messagesFor } from '@/i18n/messages';
import { literalString, refTargetAddress } from '../expr';
import type { Expression, IR, ResourceNode } from '../types';
import { checkMessages, type CheckText } from './messages';
import { isRepeated, refTarget } from './resolve';
import type { CheckContext } from './types';

/** a sentence of the warning, picked from the messages in effect */
type Text = (m: CheckText) => string;

interface UniqueName {
  arg: string;
  /** where the name must be unique: the whole cloud, one provider configuration, or one parent */
  scope: 'global' | 'provider' | { args: string[]; what: Text };
  what: Text;
}

const UNIQUE: Record<string, UniqueName> = {
  aws_s3_bucket: { arg: 'bucket', scope: 'global', what: (m) => m.unique.s3Bucket },
  aws_security_group: {
    arg: 'name',
    scope: { args: ['vpc_id'], what: (m) => m.sameVpc },
    what: (m) => m.unique.securityGroup,
  },
  aws_iam_role: { arg: 'name', scope: 'provider', what: (m) => m.unique.iamRole },
  aws_lb: { arg: 'name', scope: 'provider', what: (m) => m.unique.loadBalancer },
  aws_lb_target_group: { arg: 'name', scope: 'provider', what: (m) => m.unique.targetGroup },
  aws_lambda_function: { arg: 'function_name', scope: 'provider', what: (m) => m.unique.lambda },
  aws_dynamodb_table: { arg: 'name', scope: 'provider', what: (m) => m.unique.dynamodb },
  azurerm_storage_account: { arg: 'name', scope: 'global', what: (m) => m.unique.storageAccount },
  azurerm_subnet: {
    arg: 'name',
    scope: { args: ['virtual_network_name', 'resource_group_name'], what: (m) => m.sameVnet },
    what: (m) => m.unique.azureSubnet,
  },
  google_storage_bucket: { arg: 'name', scope: 'global', what: (m) => m.unique.gcsBucket },
  google_compute_network: { arg: 'name', scope: 'provider', what: (m) => m.unique.gcpNetwork },
  google_compute_firewall: { arg: 'name', scope: 'provider', what: (m) => m.unique.gcpFirewall },
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
  const m = messagesFor(checkMessages);
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
    const where = typeof rule.scope === 'object' ? rule.scope.what(m) : '';
    ctx.warn(node, rule.arg, m.alreadyUsed(rule.arg, name, first.id, where, rule.what(m)));
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
  const m = messagesFor(checkMessages);
  for (const node of ir.resources) {
    if (node.type === 'aws_instance') {
      const subnet = refTarget(ir, node.args.subnet_id);
      const vpc = subnet?.type === 'aws_subnet' ? vpcOf(ir, subnet) : undefined;
      if (!vpc) continue;
      for (const field of ['vpc_security_group_ids', 'security_groups']) {
        const stray = targets(ir, node.args[field]).find((sg) => sg.type === 'aws_security_group' && vpcOf(ir, sg) && vpcOf(ir, sg) !== vpc);
        if (!stray) continue;
        ctx.warn(node, field, m.instanceCrossVpc(stray.id, vpcOf(ir, stray)!.id, subnet!.id, vpc.id));
      }
    } else if (node.type === 'aws_route_table_association') {
      const subnet = refTarget(ir, node.args.subnet_id);
      const table = refTarget(ir, node.args.route_table_id);
      const a = subnet?.type === 'aws_subnet' ? vpcOf(ir, subnet) : undefined;
      const b = table?.type === 'aws_route_table' ? vpcOf(ir, table) : undefined;
      if (!a || !b || a === b) continue;
      ctx.warn(node, 'route_table_id', m.routeTableCrossVpc(table!.id, b.id, subnet!.id, a.id));
    } else if (node.type === 'aws_lb') {
      const vpcs = [...new Set(targets(ir, node.args.subnets).filter((s) => s.type === 'aws_subnet').map((s) => vpcOf(ir, s)))];
      if (vpcs.length > 1 && vpcs.every(Boolean)) {
        ctx.warn(node, 'subnets', m.lbCrossVpc(vpcs.map((v) => v!.id)));
      }
    }
  }
}

export function wiringChecks(ctx: CheckContext) {
  duplicateNames(ctx);
  crossVpc(ctx);
}
