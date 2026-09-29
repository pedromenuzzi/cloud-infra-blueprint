/**
 * Who is protected by what, what is reachable from the internet, and which
 * traffic the rules allow between resources.
 *
 * Internet-facing means both halves are true: the resource has a public
 * address (public IP / EIP, internet-facing LB, public endpoint) AND its
 * subnet routes to an internet gateway — and the rules in front of it (SG ∧
 * NACL on AWS, subnet NSG ∧ NIC NSG on Azure, firewalls by priority on GCP)
 * let internet traffic through.
 */
import { collectRefs, exprPreview, refTargetAddress } from '@/ir/expr';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import {
  blocksOf,
  extractSecurity,
  isRuleResource,
  OWNER_TYPES,
  portLabel,
  SG_TYPES,
  type HiddenRules,
  type SecurityRule,
} from './model';
import {
  ALL_TRAFFIC,
  evaluateInbound,
  NO_TRAFFIC,
  trafficEmpty,
  trafficIntersect,
  trafficLabels,
  trafficUnion,
  type Traffic,
} from './traffic';

export type ExposureLevel = 'internet' | 'unknown' | 'restricted' | 'isolated';
export type Reach = 'yes' | 'no' | 'unknown';

export interface Exposure {
  level: ExposureLevel;
  /** ports reachable from the internet (level = internet) */
  ports: string[];
  /** SGs / NSGs / firewalls protecting the resource */
  owners: string[];
  /** why exposure can't be determined (level = unknown) */
  reason?: string;
}

export interface Flow {
  id: string;
  /** resource id, or 'internet' */
  from: string;
  to: string;
  ports: string[];
  rules: string[];
}

export interface SecurityTopology {
  rules: Map<string, SecurityRule[]>;
  /** owner id → rules the model can't read (dynamic blocks, expressions) */
  hidden: Map<string, HiddenRules[]>;
  /** resource id → protecting owners */
  attachments: Map<string, string[]>;
  /** owner id → resources it protects */
  protects: Map<string, string[]>;
  /** subnet id → public (routes to an internet gateway) or private */
  subnets: Map<string, 'public' | 'private'>;
  /** subnet id → NACLs on it */
  subnetNacls: Map<string, string[]>;
  exposure: Map<string, Exposure>;
  flows: Flow[];
  /** allow rule id → internet traffic it admits within its owner, after earlier denies */
  effective: Map<string, Traffic>;
}

function refsIn(e: Expression | undefined): string[] {
  if (!e) return [];
  const out: Array<{ field: string; path: string }> = [];
  collectRefs(e, '', out);
  return out
    .map((r) => refTargetAddress(r.path)?.replace(/\[.*$/, ''))
    .filter((a): a is string => !!a);
}

function strings(e: Expression | undefined): string[] {
  if (!e) return [];
  const list = e.kind === 'list' ? e.items : [e];
  return list.flatMap((i) => (i.kind === 'literal' && i.value !== null ? [String(i.value)] : []));
}

/** true / false / absent, or 'unknown' for an expression */
function boolArg(e: Expression | undefined): Reach | undefined {
  if (!e || (e.kind === 'literal' && e.value === null)) return undefined;
  if (e.kind === 'literal') return e.value === true || e.value === 'true' ? 'yes' : 'no';
  return 'unknown';
}

const anyOf = (...xs: Reach[]): Reach => (xs.includes('yes') ? 'yes' : xs.includes('unknown') ? 'unknown' : 'no');
const both = (a: Reach, b: Reach): Reach => (a === 'no' || b === 'no' ? 'no' : a === 'yes' && b === 'yes' ? 'yes' : 'unknown');

/** config, not a running thing: its exposure shows on whatever uses it */
const NOT_WORKLOADS = new Set([
  'aws_subnet',
  'azurerm_subnet',
  'aws_launch_template',
  'aws_launch_configuration',
  'aws_network_interface_sg_attachment',
]);

export function analyzeSecurity(ir: IR): SecurityTopology {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const typeOf = (id: string) => byId.get(id)?.type;
  const ofType = (e: Expression | undefined, type: string) => refsIn(e).filter((id) => typeOf(id) === type);
  const { rules, hidden } = extractSecurity(ir);
  const rulesOf = (owners: string[]) => owners.flatMap((o) => rules.get(o) ?? []);
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k) ?? [];
    if (!list.includes(v)) list.push(v);
    m.set(k, list);
  };

  // ---------------------------------------------------------- AWS links
  const enisOf = new Map<string, string[]>(); // instance → ENIs
  const eipInstances = new Set<string>();
  const eipEnis = new Set<string>();
  for (const r of ir.resources) {
    if (r.type === 'aws_instance') {
      for (const ni of blocksOf(r.args.network_interface)) {
        for (const eni of ofType(ni.network_interface_id, 'aws_network_interface')) push(enisOf, r.id, eni);
      }
    }
    if (r.type === 'aws_network_interface_attachment') {
      const [inst] = ofType(r.args.instance_id, 'aws_instance');
      const [eni] = ofType(r.args.network_interface_id, 'aws_network_interface');
      if (inst && eni) push(enisOf, inst, eni);
    }
    if (r.type === 'aws_eip' || r.type === 'aws_eip_association') {
      ofType(r.type === 'aws_eip' ? r.args.instance : r.args.instance_id, 'aws_instance').forEach((i) => eipInstances.add(i));
      ofType(r.type === 'aws_eip' ? r.args.network_interface : r.args.network_interface_id, 'aws_network_interface').forEach((n) =>
        eipEnis.add(n),
      );
    }
  }
  const usedEnis = new Set([...enisOf.values()].flat());
  const launchTemplateOf = (r: ResourceNode) => {
    const spec = blocksOf(r.args.launch_template)[0];
    const [id] = spec ? [...ofType(spec.id, 'aws_launch_template'), ...ofType(spec.name, 'aws_launch_template')] : [];
    return id ? byId.get(id) : undefined;
  };
  const launchConfigOf = (r: ResourceNode) => byId.get(ofType(r.args.launch_configuration, 'aws_launch_configuration')[0] ?? '');
  const clusterOf = (r: ResourceNode) => byId.get(ofType(r.args.cluster_identifier, 'aws_rds_cluster')[0] ?? '');
  const primaryNic = (lt: ResourceNode | undefined) => blocksOf(lt?.args.network_interfaces)[0];

  // ---------------------------------------------------------- attachments
  const attachments = new Map<string, string[]>();
  const attach = (resource: string, owner: string) => push(attachments, resource, owner);
  const sgRefs = (r: ResourceNode) =>
    [...new Set(Object.values(r.args).flatMap(refsIn))].filter((t) => SG_TYPES.has(typeOf(t) ?? ''));

  // AWS: any reference from a workload to a security group (vpc_security_group_ids,
  // security_groups, network_configuration.security_groups, vpc_config.security_group_ids…)
  for (const r of ir.resources) {
    if (OWNER_TYPES[r.type] || isRuleResource(r.type) || !r.type.startsWith('aws_')) continue;
    if (r.type === 'aws_network_interface_sg_attachment') {
      const [eni] = ofType(r.args.network_interface_id, 'aws_network_interface');
      if (eni) sgRefs(r).forEach((sg) => attach(eni, sg));
      continue;
    }
    sgRefs(r).forEach((sg) => attach(r.id, sg));
  }
  // …and what workloads inherit: ENIs → instances, launch templates → ASGs / instances,
  // cluster → cluster instances, the VPC's default SG → instances that name none
  const inherited = (id: string) => [...(attachments.get(id) ?? [])];
  const defaultSgOf = (vpc: string | undefined) =>
    ir.resources.find(
      (r) => r.type === 'aws_default_security_group' && (vpc ? ofType(r.args.vpc_id, 'aws_vpc').includes(vpc) : !r.args.vpc_id),
    )?.id;
  const vpcOfSubnetExpr = (e: Expression | undefined) =>
    ofType(e, 'aws_subnet').flatMap((s) => ofType(byId.get(s)?.args.vpc_id, 'aws_vpc'))[0];
  for (const r of ir.resources) {
    const add = (owners: string[]) => owners.forEach((o) => attach(r.id, o));
    if (r.type === 'aws_instance') {
      (enisOf.get(r.id) ?? []).forEach((eni) => add(inherited(eni)));
      const lt = launchTemplateOf(r);
      if (!attachments.has(r.id) && lt) add(inherited(lt.id));
      if (!attachments.has(r.id) && !r.args.vpc_security_group_ids && !r.args.security_groups) {
        const sg = r.args.subnet_id ? defaultSgOf(vpcOfSubnetExpr(r.args.subnet_id)) : defaultSgOf(undefined);
        if (sg) attach(r.id, sg);
      }
    }
    if (r.type === 'aws_autoscaling_group') {
      const lt = launchTemplateOf(r);
      const lc = launchConfigOf(r);
      if (lt) add(inherited(lt.id));
      if (lc) add(inherited(lc.id));
    }
    if (r.type === 'aws_rds_cluster_instance') {
      const cluster = clusterOf(r);
      if (cluster) add(inherited(cluster.id));
    }
  }

  // AWS NACLs live on subnets; subnets nobody associates use the VPC's default NACL
  const subnetNacls = new Map<string, string[]>();
  const defaultNaclOfVpc = new Map<string, string>();
  for (const r of ir.resources) {
    if (r.type === 'aws_network_acl' || r.type === 'aws_default_network_acl') {
      for (const s of ofType(r.args.subnet_ids, 'aws_subnet')) push(subnetNacls, s, r.id);
    }
    if (r.type === 'aws_default_network_acl') {
      for (const vpc of ofType(r.args.default_network_acl_id, 'aws_vpc')) defaultNaclOfVpc.set(vpc, r.id);
    }
    if (r.type === 'aws_network_acl_association') {
      const [s] = ofType(r.args.subnet_id, 'aws_subnet');
      const [n] = refsIn(r.args.network_acl_id);
      if (s && n) push(subnetNacls, s, n);
    }
  }
  for (const s of ir.resources) {
    if (s.type !== 'aws_subnet' || subnetNacls.has(s.id)) continue;
    const nacl = defaultNaclOfVpc.get(ofType(s.args.vpc_id, 'aws_vpc')[0] ?? '');
    if (nacl) push(subnetNacls, s.id, nacl);
  }

  // Azure: NSG ↔ subnet / NIC associations; VMs inherit through their NICs
  const nsgOfSubnet = new Map<string, string[]>();
  const nsgOfNic = new Map<string, string[]>();
  for (const r of ir.resources) {
    if (r.type === 'azurerm_subnet_network_security_group_association') {
      const [s] = refsIn(r.args.subnet_id);
      const [n] = refsIn(r.args.network_security_group_id);
      if (s && n) push(nsgOfSubnet, s, n);
    }
    if (r.type === 'azurerm_network_interface_security_group_association') {
      const [nic] = refsIn(r.args.network_interface_id);
      const [n] = refsIn(r.args.network_security_group_id);
      if (nic && n) push(nsgOfNic, nic, n);
    }
  }
  for (const [subnet, nsgs] of nsgOfSubnet) nsgs.forEach((n) => attach(subnet, n));
  const isAzureVm = (r: ResourceNode) => r.type.startsWith('azurerm_') && r.type.endsWith('virtual_machine');
  const nicsOf = (r: ResourceNode) => ofType(r.args.network_interface_ids, 'azurerm_network_interface');
  const nicSubnets = (nic: string) => blocksOf(byId.get(nic)?.args.ip_configuration).flatMap((b) => refsIn(b.subnet_id));
  const nicPublic = (nic: string) =>
    blocksOf(byId.get(nic)?.args.ip_configuration).some(
      (b) => b.public_ip_address_id !== undefined && !(b.public_ip_address_id.kind === 'literal' && b.public_ip_address_id.value === null),
    );
  for (const r of ir.resources) {
    if (!isAzureVm(r)) continue;
    for (const nic of nicsOf(r)) {
      (nsgOfNic.get(nic) ?? []).forEach((n) => attach(r.id, n));
      for (const s of nicSubnets(nic)) (nsgOfSubnet.get(s) ?? []).forEach((n) => attach(r.id, n));
    }
  }

  // GCP: firewalls target instances by network + target service accounts / target tags
  const netKey = (e: Expression | undefined): string | undefined => {
    if (!e) return undefined;
    const [ref] = refsIn(e);
    if (ref) return ref;
    return e.kind === 'literal' && e.value !== null ? `lit:${String(e.value).split('/').pop()}` : undefined;
  };
  const exprKey = (e: Expression) => (e.kind === 'literal' ? String(e.value) : exprPreview(e));
  const fwTargets = (fw: ResourceNode) => ({
    accounts: fw.args.target_service_accounts?.kind === 'list' ? fw.args.target_service_accounts.items.map(exprKey) : [],
    tags: strings(fw.args.target_tags),
  });
  const fwDisabled = (fw: ResourceNode) => fw.args.disabled?.kind === 'literal' && fw.args.disabled.value === true;
  const firewalls = ir.resources.filter((r) => r.type === 'google_compute_firewall');
  for (const fw of firewalls) {
    if (fwDisabled(fw)) continue;
    const fwNet = netKey(fw.args.network);
    const targets = fwTargets(fw);
    for (const r of ir.resources) {
      if (r.type !== 'google_compute_instance') continue;
      const nets = blocksOf(r.args.network_interface).flatMap((ni) => [
        netKey(ni.network),
        ...refsIn(ni.subnetwork).map((s) => netKey(byId.get(s)?.args.network)),
      ]);
      if (fwNet && !nets.includes(fwNet)) continue;
      if (targets.accounts.length > 0) {
        const emails = blocksOf(r.args.service_account).flatMap((sa) => (sa.email ? [exprKey(sa.email)] : []));
        if (emails.some((e) => targets.accounts.includes(e))) attach(r.id, fw.id);
        continue;
      }
      const tags = strings(r.args.tags);
      if (targets.tags.length === 0 || targets.tags.some((t) => tags.includes(t))) attach(r.id, fw.id);
    }
  }

  const protects = new Map<string, string[]>();
  for (const [resource, owners] of attachments) for (const o of owners) push(protects, o, resource);

  // ---------------------------------------------------------- subnets
  // public = routes to an internet gateway, explicitly or through the VPC's main route table
  const viaIgw = (b: Record<string, Expression>) => ofType(b.gateway_id, 'aws_internet_gateway').length > 0;
  const igwTables = new Set<string>();
  const mainTableOfVpc = new Map<string, string>();
  const igwMainVpcs = new Set<string>();
  for (const r of ir.resources) {
    if ((r.type === 'aws_route_table' || r.type === 'aws_default_route_table') && blocksOf(r.args.route).some(viaIgw)) {
      igwTables.add(r.id);
    }
    if (r.type === 'aws_default_route_table') {
      for (const vpc of ofType(r.args.default_route_table_id, 'aws_vpc')) mainTableOfVpc.set(vpc, r.id);
    }
    if (r.type === 'aws_main_route_table_association') {
      const [vpc] = ofType(r.args.vpc_id, 'aws_vpc');
      const [table] = refsIn(r.args.route_table_id);
      if (vpc && table) mainTableOfVpc.set(vpc, table);
    }
    if (r.type === 'aws_route' && viaIgw(r.args)) {
      for (const t of refsIn(r.args.route_table_id)) {
        if (typeOf(t) === 'aws_vpc') igwMainVpcs.add(t);
        else igwTables.add(t);
      }
    }
  }
  const explicitTable = new Map<string, string>();
  for (const r of ir.resources) {
    if (r.type !== 'aws_route_table_association') continue;
    const [s] = ofType(r.args.subnet_id, 'aws_subnet');
    const [t] = refsIn(r.args.route_table_id);
    if (s && t) explicitTable.set(s, t);
  }
  const subnets = new Map<string, 'public' | 'private'>();
  for (const r of ir.resources) {
    if (r.type !== 'aws_subnet') continue;
    const table = explicitTable.get(r.id);
    const vpc = ofType(r.args.vpc_id, 'aws_vpc')[0];
    const main = vpc ? mainTableOfVpc.get(vpc) : undefined;
    const pub = table
      ? igwTables.has(table)
      : !!vpc && (igwMainVpcs.has(vpc) || (main !== undefined && igwTables.has(main)));
    subnets.set(r.id, pub ? 'public' : 'private');
  }

  // ---------------------------------------------------------- reachability
  /** subnets an expression points at; anything else (var, module, data, literal ids) is unknown */
  const subnetRefs = (e: Expression | undefined) => {
    const refs: Array<{ field: string; path: string }> = [];
    if (e) collectRefs(e, '', refs);
    const ids = ofType(e, 'aws_subnet');
    const literal = e && (e.kind === 'literal' || (e.kind === 'list' && e.items.some((i) => i.kind !== 'ref')));
    return { ids, unknown: !!literal || refs.length > ids.length };
  };
  /** absent = the default VPC, whose subnets route to an IGW and hand out public IPs */
  const routeOf = (e: Expression | undefined, absent: Reach = 'yes'): Reach => {
    if (!e) return absent;
    const { ids, unknown } = subnetRefs(e);
    return anyOf(...ids.map((s): Reach => (subnets.get(s) === 'public' ? 'yes' : 'no')), unknown ? 'unknown' : 'no');
  };
  const autoPublicIp = (e: Expression | undefined): Reach => {
    if (!e) return 'yes';
    const { ids, unknown } = subnetRefs(e);
    return anyOf(...ids.map((s) => boolArg(byId.get(s)?.args.map_public_ip_on_launch) ?? 'no'), unknown ? 'unknown' : 'no');
  };
  const dbRoute = (group: Expression | undefined): Reach => {
    if (!group) return 'yes';
    const [id] = ofType(group, 'aws_db_subnet_group');
    return id ? routeOf(byId.get(id)?.args.subnet_ids, 'no') : 'unknown';
  };
  const instanceReach = (r: ResourceNode): Reach => {
    const enis = enisOf.get(r.id) ?? [];
    const eip = eipInstances.has(r.id) || enis.some((e) => eipEnis.has(e));
    const eniSubnets = enis.map((e) => byId.get(e)?.args.subnet_id);
    if (blocksOf(r.args.network_interface).length > 0) {
      // an existing ENI as the primary interface never gets an auto-assigned public IP
      return eip ? anyOf(...eniSubnets.map((s) => routeOf(s, 'no'))) : 'no';
    }
    const nic = primaryNic(launchTemplateOf(r));
    const subnet = r.args.subnet_id ?? nic?.subnet_id;
    const address = eip
      ? 'yes'
      : (boolArg(r.args.associate_public_ip_address) ?? boolArg(nic?.associate_public_ip_address) ?? autoPublicIp(subnet));
    return both(address, anyOf(routeOf(subnet), ...eniSubnets.map((s) => routeOf(s, 'no'))));
  };
  const reachOf = (r: ResourceNode): Reach => {
    switch (r.type) {
      case 'aws_lb':
      case 'aws_alb':
      case 'aws_elb': {
        const internal = boolArg(r.args.internal);
        return internal === 'yes' ? 'no' : internal === 'unknown' ? 'unknown' : 'yes';
      }
      case 'aws_instance':
        return instanceReach(r);
      case 'aws_db_instance':
        return both(boolArg(r.args.publicly_accessible) ?? 'no', dbRoute(r.args.db_subnet_group_name));
      case 'aws_rds_cluster_instance':
        return both(
          boolArg(r.args.publicly_accessible) ?? 'no',
          dbRoute(r.args.db_subnet_group_name ?? clusterOf(r)?.args.db_subnet_group_name),
        );
      case 'aws_rds_cluster':
        return anyOf(
          'no',
          ...ir.resources
            .filter((x) => x.type === 'aws_rds_cluster_instance' && clusterOf(x)?.id === r.id)
            .map((x) => reachOf(x)),
        );
      case 'aws_ecs_service': {
        const nc = blocksOf(r.args.network_configuration)[0];
        return both(boolArg(nc?.assign_public_ip) ?? 'no', routeOf(nc?.subnets, 'no'));
      }
      case 'aws_autoscaling_group': {
        const nic = primaryNic(launchTemplateOf(r));
        const zones = r.args.vpc_zone_identifier;
        const address =
          boolArg(nic?.associate_public_ip_address) ??
          boolArg(launchConfigOf(r)?.args.associate_public_ip_address) ??
          autoPublicIp(zones);
        return both(address, routeOf(zones));
      }
      case 'aws_network_interface':
        return eipEnis.has(r.id) ? routeOf(r.args.subnet_id, 'no') : 'no';
      case 'google_compute_instance':
        return blocksOf(r.args.network_interface).some((ni) => ni.access_config !== undefined) ? 'yes' : 'no';
      default:
        if (isAzureVm(r)) return nicsOf(r).some(nicPublic) ? 'yes' : 'no';
        return 'no';
    }
  };

  /** subnets a workload runs in — for the NACLs in front of it */
  const subnetsOf = (r: ResourceNode): string[] => {
    const own = [r.args.subnet_id, r.args.subnets, r.args.subnet_ids, r.args.vpc_zone_identifier];
    const nc = blocksOf(r.args.network_configuration)[0];
    const vpcConfig = blocksOf(r.args.vpc_config)[0];
    const enis = (enisOf.get(r.id) ?? []).map((e) => byId.get(e)?.args.subnet_id);
    const group = r.args.db_subnet_group_name ?? (r.type === 'aws_rds_cluster_instance' ? clusterOf(r)?.args.db_subnet_group_name : undefined);
    const dbGroup = byId.get(ofType(group, 'aws_db_subnet_group')[0] ?? '')?.args.subnet_ids;
    return [...new Set([...own, nc?.subnets, vpcConfig?.subnet_ids, ...enis, dbGroup].flatMap((e) => ofType(e, 'aws_subnet')))];
  };

  // ---------------------------------------------------------- evaluation
  interface ResourceEval {
    allowed: Traffic;
    perRule: Map<string, Traffic>;
    unverified: SecurityRule[];
    unknownSources: SecurityRule[];
  }
  const combine = (a: ResourceEval, b: ResourceEval): ResourceEval => {
    const perRule = new Map(a.perRule);
    for (const [id, t] of b.perRule) perRule.set(id, trafficUnion(perRule.get(id) ?? NO_TRAFFIC, t));
    return {
      allowed: trafficUnion(a.allowed, b.allowed),
      perRule,
      unverified: [...new Set([...a.unverified, ...b.unverified])],
      unknownSources: [...new Set([...a.unknownSources, ...b.unknownSources])],
    };
  };
  /** traffic that passes `first` and then a second, independent filter */
  const behind = (first: ResourceEval, second: Traffic): ResourceEval => ({
    ...first,
    allowed: trafficIntersect(first.allowed, second),
    perRule: new Map([...first.perRule].map(([id, t]) => [id, trafficIntersect(t, second)])),
  });
  const EMPTY: ResourceEval = { allowed: NO_TRAFFIC, perRule: new Map(), unverified: [], unknownSources: [] };

  const evaluateResource = (r: ResourceNode, owners: string[]): ResourceEval => {
    if (r.type.startsWith('aws_')) {
      const sg = evaluateInbound(rulesOf(owners), false);
      const withNacls = subnetsOf(r)
        .filter((s) => subnetNacls.has(s))
        .map((s) => evaluateInbound(rulesOf(subnetNacls.get(s)!), true).allowed);
      if (withNacls.length === 0 || withNacls.length < subnetsOf(r).length) return sg;
      return withNacls.map((nacl) => behind(sg, nacl)).reduce(combine, EMPTY);
    }
    if (isAzureVm(r)) {
      const nics = nicsOf(r);
      const facing = nics.some(nicPublic) ? nics.filter(nicPublic) : nics;
      return facing
        .map((nic) => {
          const nicNsgs = nsgOfNic.get(nic) ?? [];
          const subnetNsgs = [...new Set(nicSubnets(nic).flatMap((s) => nsgOfSubnet.get(s) ?? []))];
          // Azure: inbound traffic must pass the subnet NSG and then the NIC NSG
          const a = nicNsgs.length ? evaluateInbound(rulesOf(nicNsgs), true) : undefined;
          const b = subnetNsgs.length ? evaluateInbound(rulesOf(subnetNsgs), true) : undefined;
          const left = a ? behind(a, b?.allowed ?? ALL_TRAFFIC) : EMPTY;
          const right = b ? behind(b, a?.allowed ?? ALL_TRAFFIC) : EMPTY;
          return combine(left, right);
        })
        .reduce(combine, EMPTY);
    }
    return evaluateInbound(rulesOf(owners), true);
  };

  // ---------------------------------------------------------- exposure
  const exposure = new Map<string, Exposure>();
  const evals = new Map<string, ResourceEval>();
  const name = (id: string) => id.split('.').slice(1).join('.') || id;
  for (const [resource, owners] of attachments) {
    const r = byId.get(resource);
    if (!r || NOT_WORKLOADS.has(r.type) || (r.type === 'aws_network_interface' && usedEnis.has(r.id))) continue;
    const ev = evaluateResource(r, owners);
    evals.set(resource, ev);
    const reach = reachOf(r);
    const hiddenOwners = owners.filter((o) => (hidden.get(o) ?? []).some((h) => h.directions.includes('inbound')));
    const open = !trafficEmpty(ev.allowed) || ev.unverified.length > 0;
    if (reach === 'yes' && open) {
      const ports = [...new Set([...trafficLabels(ev.allowed), ...ev.unverified.map(portLabel)])];
      exposure.set(resource, { level: 'internet', ports, owners });
    } else if (reach === 'unknown' && open) {
      exposure.set(resource, {
        level: 'unknown',
        ports: [],
        owners,
        reason: 'Its rules let internet traffic in, but whether it has a public address depends on expressions.',
      });
    } else if (reach !== 'no' && (hiddenOwners.length > 0 || ev.unknownSources.length > 0)) {
      const detail = hiddenOwners.length
        ? `${name(hiddenOwners[0])} defines rules the audit can't read (${hidden.get(hiddenOwners[0])![0].reason})`
        : `a rule's sources are an expression (${ev.unknownSources[0].peers.find((p) => p.kind === 'expr')?.value})`;
      exposure.set(resource, { level: 'unknown', ports: [], owners, reason: `Can't tell whether it is reachable from the internet: ${detail}.` });
    } else {
      const inbound = rulesOf(owners).some((x) => x.direction === 'inbound' && x.action === 'allow' && !x.disabled);
      exposure.set(resource, { level: inbound || hiddenOwners.length ? 'restricted' : 'isolated', ports: [], owners });
    }
  }

  // ---------------------------------------------------------- per-rule effect (for the audit)
  const effective = new Map<string, Traffic>();
  const covers = (a: ResourceNode, b: ResourceNode) => {
    const ta = fwTargets(a);
    const tb = fwTargets(b);
    if (ta.accounts.length === 0 && ta.tags.length === 0) return true;
    if (tb.accounts.length > 0) return tb.accounts.every((s) => ta.accounts.includes(s));
    return tb.tags.length > 0 && ta.accounts.length === 0 && tb.tags.every((t) => ta.tags.includes(t));
  };
  for (const [owner, list] of rules) {
    const node = byId.get(owner)!;
    const kind = OWNER_TYPES[node.type];
    let context = list;
    if (kind === 'firewall') {
      // a higher-priority firewall that applies to every target of this one shadows it
      const competitors = firewalls.filter(
        (fw) => fw.id !== owner && !fwDisabled(fw) && netKey(fw.args.network) === netKey(node.args.network) && covers(fw, node),
      );
      context = [...list, ...rulesOf(competitors.map((c) => c.id))];
    }
    const ev = evaluateInbound(context, kind !== 'sg');
    for (const rule of list) {
      const t = ev.perRule.get(rule.id);
      if (t) effective.set(rule.id, t);
    }
  }

  // ---------------------------------------------------------- flows
  const flowMap = new Map<string, Flow>();
  const addFlow = (from: string, to: string, ruleId: string, ports: string[]) => {
    if (from === to) return;
    const id = `${from}->${to}`;
    const flow = flowMap.get(id) ?? { id, from, to, ports: [], rules: [] };
    for (const p of ports) if (!flow.ports.includes(p)) flow.ports.push(p);
    if (!flow.rules.includes(ruleId)) flow.rules.push(ruleId);
    flowMap.set(id, flow);
  };
  for (const [resource, e] of exposure) {
    if (e.level !== 'internet') continue;
    const ev = evals.get(resource)!;
    for (const [ruleId, t] of ev.perRule) if (!trafficEmpty(t)) addFlow('internet', resource, ruleId, trafficLabels(t));
    for (const rule of ev.unverified) addFlow('internet', resource, rule.id, [portLabel(rule)]);
  }
  const taggedInstances = (tag: string) =>
    ir.resources.filter((r) => r.type === 'google_compute_instance' && strings(r.args.tags).includes(tag)).map((r) => r.id);
  for (const [owner, ownerRules] of rules) {
    const targets = protects.get(owner) ?? [];
    for (const rule of ownerRules) {
      if (rule.direction !== 'inbound' || rule.action !== 'allow' || rule.disabled) continue;
      for (const peer of rule.peers) {
        const sources =
          peer.kind === 'group' ? (protects.get(peer.ref) ?? []) : peer.kind === 'tag' ? taggedInstances(peer.value) : [];
        for (const s of sources) for (const t of targets) addFlow(s, t, rule.id, [portLabel(rule)]);
      }
    }
  }

  return { rules, hidden, attachments, protects, subnets, subnetNacls, exposure, flows: [...flowMap.values()], effective };
}
