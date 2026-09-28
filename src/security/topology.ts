/**
 * Who is protected by what, what is reachable from the internet, and which
 * traffic the rules allow between resources.
 */
import { collectRefs, refTargetAddress } from '@/ir/expr';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import {
  blocksOf,
  extractRules,
  fromInternet,
  isRuleResource,
  OWNER_TYPES,
  portLabel,
  type SecurityRule,
} from './model';

export type ExposureLevel = 'internet' | 'restricted' | 'isolated';

export interface Exposure {
  level: ExposureLevel;
  /** ports reachable from the internet (level = internet) */
  ports: string[];
  /** SGs / NSGs / firewalls protecting the resource */
  owners: string[];
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
  /** resource id → protecting owners */
  attachments: Map<string, string[]>;
  /** owner id → resources it protects */
  protects: Map<string, string[]>;
  /** subnet id → public (internet-routed) or private */
  subnets: Map<string, 'public' | 'private'>;
  /** subnet id → NACLs on it */
  subnetNacls: Map<string, string[]>;
  exposure: Map<string, Exposure>;
  flows: Flow[];
}

function refsIn(e: Expression | undefined): string[] {
  if (!e) return [];
  const out: Array<{ field: string; path: string }> = [];
  collectRefs(e, '', out);
  return out.map((r) => refTargetAddress(r.path)).filter((a): a is string => a !== null);
}

function lit(e: Expression | undefined): unknown {
  return e?.kind === 'literal' ? e.value : undefined;
}

function strings(e: Expression | undefined): string[] {
  if (!e) return [];
  const list = e.kind === 'list' ? e.items : [e];
  return list.flatMap((i) => (i.kind === 'literal' && i.value !== null ? [String(i.value)] : []));
}

export function analyzeSecurity(ir: IR): SecurityTopology {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const typeOf = (id: string) => byId.get(id)?.type;
  const rules = extractRules(ir);

  // ---------------------------------------------------------- attachments
  const attachments = new Map<string, string[]>();
  const attach = (resource: string, owner: string) => {
    const list = attachments.get(resource) ?? [];
    if (!list.includes(owner)) list.push(owner);
    attachments.set(resource, list);
  };

  // AWS: any reference from a workload to a security group (vpc_security_group_ids,
  // security_groups, network_configuration.security_groups, vpc_config.security_group_ids…)
  for (const r of ir.resources) {
    if (OWNER_TYPES[r.type] || isRuleResource(r.type) || !r.type.startsWith('aws_')) continue;
    for (const target of Object.values(r.args).flatMap(refsIn)) {
      if (typeOf(target) === 'aws_security_group') attach(r.id, target);
    }
  }

  // AWS NACLs live on subnets
  const subnetNacls = new Map<string, string[]>();
  const addNacl = (subnet: string, nacl: string) => {
    const list = subnetNacls.get(subnet) ?? [];
    if (!list.includes(nacl)) list.push(nacl);
    subnetNacls.set(subnet, list);
  };
  for (const r of ir.resources) {
    if (r.type === 'aws_network_acl') {
      for (const s of refsIn(r.args.subnet_ids)) if (typeOf(s) === 'aws_subnet') addNacl(s, r.id);
    }
    if (r.type === 'aws_network_acl_association') {
      const [s] = refsIn(r.args.subnet_id);
      const [n] = refsIn(r.args.network_acl_id);
      if (s && n) addNacl(s, n);
    }
  }

  // Azure: NSG ↔ subnet / NIC associations; VMs inherit through their NICs
  const nsgOfSubnet = new Map<string, string[]>();
  const nsgOfNic = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
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
  const nicSubnets = (nic: ResourceNode) =>
    blocksOf(nic.args.ip_configuration).flatMap((b) => refsIn(b.subnet_id));
  for (const r of ir.resources) {
    if (!r.type.startsWith('azurerm_') || !r.type.endsWith('virtual_machine')) continue;
    for (const nicId of refsIn(r.args.network_interface_ids)) {
      const nic = byId.get(nicId);
      (nsgOfNic.get(nicId) ?? []).forEach((n) => attach(r.id, n));
      if (nic) for (const s of nicSubnets(nic)) (nsgOfSubnet.get(s) ?? []).forEach((n) => attach(r.id, n));
    }
  }

  // GCP: firewalls target instances by network + target_tags
  const networkOfSubnetwork = (id: string) => refsIn(byId.get(id)?.args.network)[0];
  for (const fw of ir.resources) {
    if (fw.type !== 'google_compute_firewall') continue;
    const [fwNet] = refsIn(fw.args.network);
    const targets = strings(fw.args.target_tags);
    for (const r of ir.resources) {
      if (r.type !== 'google_compute_instance') continue;
      const nets = blocksOf(r.args.network_interface).flatMap((ni) => [
        ...refsIn(ni.network),
        ...refsIn(ni.subnetwork).map(networkOfSubnetwork),
      ]);
      if (fwNet && !nets.includes(fwNet)) continue;
      const tags = strings(r.args.tags);
      if (targets.length === 0 || targets.some((t) => tags.includes(t))) attach(r.id, fw.id);
    }
  }

  const protects = new Map<string, string[]>();
  for (const [resource, owners] of attachments) for (const o of owners) push(protects, o, resource);

  // ---------------------------------------------------------- subnets
  const subnets = new Map<string, 'public' | 'private'>();
  const igwRouteTables = new Set<string>();
  for (const r of ir.resources) {
    if (r.type === 'aws_route_table') {
      const viaIgw = blocksOf(r.args.route).some((b) =>
        refsIn(b.gateway_id).some((g) => typeOf(g) === 'aws_internet_gateway'),
      );
      if (viaIgw) igwRouteTables.add(r.id);
    }
    if (r.type === 'aws_route' && refsIn(r.args.gateway_id).some((g) => typeOf(g) === 'aws_internet_gateway')) {
      refsIn(r.args.route_table_id).forEach((t) => igwRouteTables.add(t));
    }
  }
  const publicSubnets = new Set<string>();
  for (const r of ir.resources) {
    if (r.type === 'aws_route_table_association') {
      const [s] = refsIn(r.args.subnet_id);
      const [t] = refsIn(r.args.route_table_id);
      if (s && t && igwRouteTables.has(t)) publicSubnets.add(s);
    }
  }
  for (const r of ir.resources) {
    if (r.type !== 'aws_subnet') continue;
    const pub = publicSubnets.has(r.id) || lit(r.args.map_public_ip_on_launch) === true;
    subnets.set(r.id, pub ? 'public' : 'private');
  }

  // ---------------------------------------------------------- reachability
  const inPublicSubnet = (r: ResourceNode) =>
    [...refsIn(r.args.subnet_id), ...refsIn(r.args.subnets), ...refsIn(r.args.subnet_ids)].some(
      (s) => subnets.get(s) === 'public',
    );
  const eipFor = new Set(
    ir.resources.filter((r) => r.type === 'aws_eip').flatMap((r) => refsIn(r.args.instance)),
  );
  const publiclyReachable = (r: ResourceNode): boolean => {
    switch (r.type) {
      case 'aws_lb':
        return lit(r.args.internal) !== true;
      case 'aws_instance':
        if (lit(r.args.associate_public_ip_address) === false) return eipFor.has(r.id);
        return lit(r.args.associate_public_ip_address) === true || eipFor.has(r.id) || inPublicSubnet(r);
      case 'aws_db_instance':
      case 'aws_rds_cluster_instance':
        return lit(r.args.publicly_accessible) === true;
      case 'aws_ecs_service':
        return blocksOf(r.args.network_configuration).some((b) => lit(b.assign_public_ip) === true);
      case 'google_compute_instance':
        return blocksOf(r.args.network_interface).some((ni) => ni.access_config !== undefined);
      default:
        if (r.type.startsWith('azurerm_') && r.type.endsWith('virtual_machine')) {
          return refsIn(r.args.network_interface_ids).some((nicId) =>
            blocksOf(byId.get(nicId)?.args.ip_configuration).some((b) => b.public_ip_address_id !== undefined),
          );
        }
        return false;
    }
  };

  // ---------------------------------------------------------- exposure
  const rulesOf = (owners: string[]) => owners.flatMap((o) => rules.get(o) ?? []);
  const exposure = new Map<string, Exposure>();
  for (const [resource, owners] of attachments) {
    const r = byId.get(resource);
    if (!r || r.type === 'aws_subnet' || r.type === 'azurerm_subnet') continue;
    const inbound = rulesOf(owners).filter((x) => x.direction === 'inbound' && x.action === 'allow');
    const open = inbound.filter(fromInternet);
    if (open.length > 0 && publiclyReachable(r)) {
      exposure.set(resource, { level: 'internet', ports: [...new Set(open.map(portLabel))], owners });
    } else {
      exposure.set(resource, { level: inbound.length > 0 ? 'restricted' : 'isolated', ports: [], owners });
    }
  }

  // ---------------------------------------------------------- flows
  const flowMap = new Map<string, Flow>();
  const addFlow = (from: string, to: string, rule: SecurityRule) => {
    if (from === to) return;
    const id = `${from}->${to}`;
    const flow = flowMap.get(id) ?? { id, from, to, ports: [], rules: [] };
    const port = portLabel(rule);
    if (!flow.ports.includes(port)) flow.ports.push(port);
    if (!flow.rules.includes(rule.id)) flow.rules.push(rule.id);
    flowMap.set(id, flow);
  };
  for (const [resource, e] of exposure) {
    if (e.level !== 'internet') continue;
    for (const rule of rulesOf(e.owners)) {
      if (rule.direction === 'inbound' && rule.action === 'allow' && fromInternet(rule)) addFlow('internet', resource, rule);
    }
  }
  const taggedInstances = (tag: string) =>
    ir.resources.filter((r) => r.type === 'google_compute_instance' && strings(r.args.tags).includes(tag)).map((r) => r.id);
  for (const [owner, ownerRules] of rules) {
    const targets = protects.get(owner) ?? [];
    for (const rule of ownerRules) {
      if (rule.direction !== 'inbound' || rule.action !== 'allow') continue;
      for (const peer of rule.peers) {
        const sources =
          peer.kind === 'group' ? (protects.get(peer.ref) ?? []) : peer.kind === 'tag' ? taggedInstances(peer.value) : [];
        for (const s of sources) for (const t of targets) addFlow(s, t, rule);
      }
    }
  }

  return { rules, attachments, protects, subnets, subnetNacls, exposure, flows: [...flowMap.values()] };
}
