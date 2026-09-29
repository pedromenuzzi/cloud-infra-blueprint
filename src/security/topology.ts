/**
 * Who is protected by what, what is reachable from the internet, and which
 * traffic the rules allow between resources.
 *
 * Internet-facing means both halves are true: the resource has a public
 * address (public IP / EIP, internet-facing LB, public endpoint) AND its
 * subnet routes to an internet gateway — and the rules in front of it (SG ∧
 * NACL on AWS, subnet NSG ∧ NIC NSG on Azure, firewalls by priority on GCP)
 * let internet traffic through.
 *
 * The same evaluation keeps its evidence (`access`): per port, the ordered
 * chain of controls that lets the traffic in, and for traffic a rule means to
 * admit, the control that stops it (access.ts has the shapes and wording).
 */
import { collectRefs, exprPreview, refTargetAddress } from '@/ir/expr';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import {
  blockReason,
  byPorts,
  defaultStep,
  groupByPort,
  internetStep,
  portsLabel,
  ruleStep,
  shortName,
  type AccessExplanation,
  type BlockedPort,
  type PathStep,
  type StepContext,
} from './access';
import {
  blocksOf,
  extractSecurity,
  internetFamilies,
  isRuleResource,
  OWNER_TYPES,
  portLabel,
  SG_TYPES,
  type HiddenRules,
  type IpFamily,
  type OwnerKind,
  type SecurityRule,
} from './model';
import {
  ALL_TRAFFIC,
  evaluateInbound,
  NO_TRAFFIC,
  ruleTraffic,
  trafficEmpty,
  trafficIntersect,
  trafficLabels,
  trafficSubtract,
  trafficUnion,
  type Evaluation,
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
  /** resource id → why internet traffic gets in (per port), and what stops the rest */
  access: Map<string, AccessExplanation>;
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

// ------------------------------------------------------------ reachability, with its evidence

/** where a public address comes from */
interface AddressSource {
  resource: string;
  /** "map_public_ip_on_launch = true on subnet a", "Elastic IP web"… */
  label: string;
  /** set when another resource gives it (an EIP, a launch template): that resource as a step */
  step?: { title: string; detail: string };
}

/** Reach, and why: the address and public subnet when yes, the missing halves when no. */
interface Reachability {
  reach: Reach;
  address?: AddressSource;
  /** the public subnet that routes it to an internet gateway */
  subnet?: string;
  /** no subnet given: the default VPC, whose subnets route to an internet gateway */
  defaultVpc?: boolean;
  /** reach = no: what is missing, as steps (verdict deny) */
  blockers: PathStep[];
}

const NO: Reachability = { reach: 'no', blockers: [] };
const UNKNOWN: Reachability = { reach: 'unknown', blockers: [] };
const yes = (x: Omit<Reachability, 'reach' | 'blockers'> = {}): Reachability => ({ reach: 'yes', blockers: [], ...x });
const no = (step: PathStep): Reachability => ({ reach: 'no', blockers: [{ ...step, verdict: 'deny' }] });

/** yes if any is yes, else unknown if any is unknown, else no (with the first reason given) */
const anyOf = (...xs: Reachability[]): Reachability =>
  xs.find((x) => x.reach === 'yes') ?? xs.find((x) => x.reach === 'unknown') ?? xs.find((x) => x.blockers.length > 0) ?? NO;

/** a public address AND a route to an internet gateway */
function both(address: Reachability, route: Reachability): Reachability {
  if (address.reach === 'no' || route.reach === 'no') {
    return {
      reach: 'no',
      blockers: [...(address.reach === 'no' ? address.blockers : []), ...(route.reach === 'no' ? route.blockers : [])],
    };
  }
  if (address.reach === 'yes' && route.reach === 'yes') {
    return yes({ address: address.address, subnet: route.subnet ?? address.subnet, defaultVpc: route.defaultVpc });
  }
  return UNKNOWN;
}

const noAddress = (resource: string, detail: string, title = 'No public IP address'): Reachability =>
  no({ kind: 'address', title, detail, resource });

/** config, not a running thing: its exposure shows on whatever uses it */
const NOT_WORKLOADS = new Set([
  'aws_subnet',
  'azurerm_subnet',
  'aws_launch_template',
  'aws_launch_configuration',
  'aws_network_interface_sg_attachment',
]);

// ------------------------------------------------------------ evaluation lanes

/** one owner (or owners of one kind) traffic has to pass */
interface Layer {
  kind: OwnerKind;
  owners: string[];
  rules: SecurityRule[];
  ev: Evaluation;
  /** its allow rules say what should get in (SGs, NSGs, firewalls — a NACL is only a coarse filter) */
  intent: boolean;
  ctx: StepContext;
}

/** one way in (through a subnet, a NIC), outermost layer first */
interface Lane {
  layers: Layer[];
  subnet?: string;
}

/** internet traffic that passes every layer of a lane, and the rules that let it */
interface Piece {
  family: IpFamily;
  traffic: Traffic;
  hops: Array<{ rule: SecurityRule; layer: Layer }>;
  lane: Lane;
}

/** traffic an intent rule admits, stopped by a deny rule or a default rule */
interface Barrier {
  family: IpFamily;
  traffic: Traffic;
  intent: { rule: SecurityRule; layer: Layer };
  passed: Array<{ rule: SecurityRule; layer: Layer }>;
  blocker: { rule: SecurityRule; layer: Layer } | { layer: Layer };
  lane: Lane;
}

interface ResourceEval {
  allowed: Traffic;
  perRule: Map<string, Traffic>;
  unverified: SecurityRule[];
  unknownSources: SecurityRule[];
  pieces: Piece[];
  barriers: Barrier[];
  /** allow rules from the internet in the layers that state intent */
  intents: Array<{ rule: SecurityRule; layer: Layer }>;
}

const FAMILIES: IpFamily[] = ['ipv4', 'ipv6'];

/** Walk the lanes: what gets through (pieces), what an intent rule admits but a layer stops (barriers). */
function evaluateLanes(lanes: Lane[]): ResourceEval {
  const pieces: Piece[] = [];
  for (const lane of lanes) {
    if (lane.layers.length === 0) continue;
    for (const family of FAMILIES) {
      let partial: Array<{ traffic: Traffic; hops: Piece['hops'] }> = [{ traffic: ALL_TRAFFIC, hops: [] }];
      for (const layer of lane.layers) {
        const next: typeof partial = [];
        for (const p of partial) {
          for (const m of layer.ev.matches) {
            if (m.family !== family || m.rule.action !== 'allow') continue;
            const traffic = trafficIntersect(p.traffic, m.traffic);
            if (!trafficEmpty(traffic)) next.push({ traffic, hops: [...p.hops, { rule: m.rule, layer }] });
          }
        }
        partial = next;
      }
      pieces.push(...partial.map((p) => ({ family, ...p, lane })));
    }
  }

  const allowedBy: Record<IpFamily, Traffic> = { ipv4: NO_TRAFFIC, ipv6: NO_TRAFFIC };
  const perRule = new Map<string, Traffic>();
  for (const p of pieces) {
    allowedBy[p.family] = trafficUnion(allowedBy[p.family], p.traffic);
    for (const { rule, layer } of p.hops) {
      if (layer.intent) perRule.set(rule.id, trafficUnion(perRule.get(rule.id) ?? NO_TRAFFIC, p.traffic));
    }
  }

  const intentLayers = lanes.flatMap((l) => l.layers.filter((x) => x.intent));
  const unique = <T,>(xs: T[]) => [...new Set(xs)];
  const intents: ResourceEval['intents'] = [];
  const seen = new Set<string>();
  for (const layer of intentLayers) {
    for (const rule of layer.rules) {
      if (rule.direction !== 'inbound' || rule.action !== 'allow' || rule.disabled || internetFamilies(rule).length === 0) continue;
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      intents.push({ rule, layer });
    }
  }

  // what an intent rule admits, walked outermost first: the first deny (or default) that takes it stops it
  const barriers: Barrier[] = [];
  for (const lane of lanes) {
    lane.layers.forEach((own, index) => {
      if (!own.intent) return;
      for (const rule of own.rules) {
        if (rule.direction !== 'inbound' || rule.action !== 'allow' || rule.disabled) continue;
        const declared = ruleTraffic(rule);
        if (!declared) continue;
        for (const family of internetFamilies(rule)) {
          let remaining = declared;
          for (const [j, layer] of lane.layers.entries()) {
            const passedBefore = (t: Traffic) =>
              lane.layers.slice(0, j).flatMap((outer) => {
                const m = outer.ev.matches.find(
                  (x) => x.family === family && x.rule.action === 'allow' && !trafficEmpty(trafficIntersect(x.traffic, t)),
                );
                return m ? [{ rule: m.rule, layer: outer }] : [];
              });
            for (const m of layer.ev.matches) {
              if (m.family !== family || m.rule.action !== 'deny') continue;
              const hit = trafficIntersect(remaining, m.traffic);
              if (trafficEmpty(hit)) continue;
              barriers.push({ family, traffic: hit, intent: { rule, layer: own }, passed: passedBefore(hit), blocker: { rule: m.rule, layer }, lane });
              remaining = trafficSubtract(remaining, hit);
            }
            if (layer.kind !== 'sg' && j !== index) {
              const rest = trafficIntersect(remaining, layer.ev.unmatched[family]);
              if (!trafficEmpty(rest)) {
                barriers.push({ family, traffic: rest, intent: { rule, layer: own }, passed: passedBefore(rest), blocker: { layer }, lane });
                remaining = trafficSubtract(remaining, rest);
              }
            }
          }
        }
      }
    });
  }
  // only what no other way lets in is really blocked
  const blocked = barriers
    .map((b) => ({ ...b, traffic: trafficSubtract(b.traffic, allowedBy[b.family]) }))
    .filter((b) => !trafficEmpty(b.traffic));

  return {
    allowed: trafficUnion(allowedBy.ipv4, allowedBy.ipv6),
    perRule,
    unverified: unique(intentLayers.flatMap((l) => l.ev.unverified)),
    unknownSources: unique(intentLayers.flatMap((l) => l.ev.unknownSources)),
    pieces,
    barriers: blocked,
    intents,
  };
}

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
  const name = shortName;

  // ---------------------------------------------------------- AWS links
  const enisOf = new Map<string, string[]>(); // instance → ENIs
  /** instance / ENI → the aws_eip (or aws_eip_association) that gives it a public address */
  const eipOf = new Map<string, string>();
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
      const eip = r.type === 'aws_eip' ? r.id : (ofType(r.args.allocation_id, 'aws_eip')[0] ?? r.id);
      const set = (id: string) => eipOf.has(id) || eipOf.set(id, eip);
      ofType(r.type === 'aws_eip' ? r.args.instance : r.args.instance_id, 'aws_instance').forEach(set);
      ofType(r.type === 'aws_eip' ? r.args.network_interface : r.args.network_interface_id, 'aws_network_interface').forEach(set);
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
  const nicPublicIp = (nic: string) =>
    blocksOf(byId.get(nic)?.args.ip_configuration).find(
      (b) => b.public_ip_address_id !== undefined && !(b.public_ip_address_id.kind === 'literal' && b.public_ip_address_id.value === null),
    )?.public_ip_address_id;
  const nicPublic = (nic: string) => nicPublicIp(nic) !== undefined;
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
  interface IgwRoute {
    /** the route table (inline `route` block) or the aws_route resource */
    resource: string;
    destination: string;
    gateway: string;
  }
  const viaIgw = (b: Record<string, Expression>) => ofType(b.gateway_id, 'aws_internet_gateway')[0];
  const destination = (b: Record<string, Expression>, v4: string, v6: string) => {
    const e = b[v4] ?? b[v6];
    return e?.kind === 'literal' && e.value !== null ? String(e.value) : e ? exprPreview(e) : '0.0.0.0/0';
  };
  const igwTables = new Map<string, IgwRoute>();
  const mainTableOfVpc = new Map<string, { table: string; association?: string }>();
  const igwMainVpcs = new Map<string, IgwRoute>();
  for (const r of ir.resources) {
    if (r.type === 'aws_route_table' || r.type === 'aws_default_route_table') {
      const route = blocksOf(r.args.route).find(viaIgw);
      if (route) igwTables.set(r.id, { resource: r.id, destination: destination(route, 'cidr_block', 'ipv6_cidr_block'), gateway: viaIgw(route)! });
    }
    if (r.type === 'aws_default_route_table') {
      for (const vpc of ofType(r.args.default_route_table_id, 'aws_vpc')) mainTableOfVpc.set(vpc, { table: r.id });
    }
    if (r.type === 'aws_main_route_table_association') {
      const [vpc] = ofType(r.args.vpc_id, 'aws_vpc');
      const [table] = refsIn(r.args.route_table_id);
      if (vpc && table) mainTableOfVpc.set(vpc, { table, association: r.id });
    }
  }
  for (const r of ir.resources) {
    const gateway = r.type === 'aws_route' ? viaIgw(r.args) : undefined;
    if (!gateway) continue;
    const route = { resource: r.id, destination: destination(r.args, 'destination_cidr_block', 'destination_ipv6_cidr_block'), gateway };
    for (const t of refsIn(r.args.route_table_id)) {
      if (typeOf(t) === 'aws_vpc') {
        if (!igwMainVpcs.has(t)) igwMainVpcs.set(t, route);
      } else if (!igwTables.has(t)) igwTables.set(t, route);
    }
  }
  const explicitTable = new Map<string, { table: string; association: string }>();
  for (const r of ir.resources) {
    if (r.type !== 'aws_route_table_association') continue;
    const [s] = ofType(r.args.subnet_id, 'aws_subnet');
    const [t] = refsIn(r.args.route_table_id);
    if (s && t) explicitTable.set(s, { table: t, association: r.id });
  }
  /** subnet → the route table it uses and, when public, the route to the internet gateway */
  const routing = new Map<string, { table?: string; main: boolean; route?: IgwRoute }>();
  const subnets = new Map<string, 'public' | 'private'>();
  for (const r of ir.resources) {
    if (r.type !== 'aws_subnet') continue;
    const explicit = explicitTable.get(r.id);
    const vpc = ofType(r.args.vpc_id, 'aws_vpc')[0];
    const main = vpc ? mainTableOfVpc.get(vpc) : undefined;
    const route = explicit
      ? igwTables.get(explicit.table)
      : vpc
        ? (igwMainVpcs.get(vpc) ?? (main ? igwTables.get(main.table) : undefined))
        : undefined;
    routing.set(r.id, { table: explicit?.table ?? main?.table, main: !explicit, route });
    subnets.set(r.id, route ? 'public' : 'private');
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
  const noRoute = (s: string): Reachability => {
    const rt = routing.get(s);
    const detail = rt?.table
      ? rt.main
        ? `subnet ${name(s)} uses the VPC's main route table ${name(rt.table)}, which has none`
        : `subnet ${name(s)} uses route table ${name(rt.table)}, which has none`
      : `subnet ${name(s)} has no route table association, and the VPC's main route table has none`;
    return no({ kind: 'route', title: 'No route to an internet gateway', detail, resource: rt?.table ?? s });
  };
  /** absent = the default VPC, whose subnets route to an IGW and hand out public IPs */
  const routeOf = (e: Expression | undefined, absent: Reach = 'yes'): Reachability => {
    if (!e) {
      if (absent === 'yes') return yes({ defaultVpc: true });
      return absent === 'no'
        ? no({ kind: 'route', title: 'No route to an internet gateway', detail: 'it is not placed in a subnet that routes to one' })
        : UNKNOWN;
    }
    const { ids, unknown } = subnetRefs(e);
    return anyOf(...ids.map((s) => (subnets.get(s) === 'public' ? yes({ subnet: s }) : noRoute(s))), unknown ? UNKNOWN : NO);
  };
  const autoPublicIp = (e: Expression | undefined, owner: string): Reachability => {
    if (!e) return yes({ address: { resource: owner, label: 'the default VPC assigns one on launch' } });
    const { ids, unknown } = subnetRefs(e);
    return anyOf(
      ...ids.map((s) => {
        const b = boolArg(byId.get(s)?.args.map_public_ip_on_launch) ?? 'no';
        if (b === 'yes') return yes({ address: { resource: s, label: `map_public_ip_on_launch = true on subnet ${name(s)}` } });
        if (b === 'unknown') return UNKNOWN;
        return noAddress(owner, `subnet ${name(s)} doesn't assign public IPs (map_public_ip_on_launch) and nothing else gives it one`);
      }),
      unknown ? UNKNOWN : NO,
    );
  };
  /** an explicit true / false on `holder`: the resource itself, or its launch template / configuration */
  const flag = (e: Expression | undefined, holder: string, field: string, via?: string): Reachability | undefined => {
    const b = boolArg(e);
    if (b === undefined) return undefined;
    if (b === 'unknown') return UNKNOWN;
    const where = via ? ` in ${via} ${name(holder)}` : '';
    const step = via ? { title: `${via.charAt(0).toUpperCase()}${via.slice(1)} ${name(holder)}`, detail: `${field} = true` } : undefined;
    return b === 'yes'
      ? yes({ address: { resource: holder, label: `${field} = true${where}`, step } })
      : noAddress(holder, `${field} = false${where}`);
  };
  const elasticIp = (eip: string): Reachability =>
    yes({ address: { resource: eip, label: `Elastic IP ${name(eip)}`, step: { title: `Elastic IP ${name(eip)}`, detail: 'gives it a public address' } } });
  const dbRoute = (group: Expression | undefined): Reachability => {
    if (!group) return yes({ defaultVpc: true });
    const [id] = ofType(group, 'aws_db_subnet_group');
    return id ? routeOf(byId.get(id)?.args.subnet_ids, 'no') : UNKNOWN;
  };
  const publiclyAccessible = (r: ResourceNode): Reachability =>
    flag(r.args.publicly_accessible, r.id, 'publicly_accessible') ??
    noAddress(r.id, "publicly_accessible isn't set (it defaults to false)", 'Not publicly accessible');
  const instanceReach = (r: ResourceNode): Reachability => {
    const enis = enisOf.get(r.id) ?? [];
    const eip = eipOf.get(r.id) ?? enis.map((e) => eipOf.get(e)).find(Boolean);
    const eipAddress = eip ? elasticIp(eip) : undefined;
    const eniSubnets = enis.map((e) => byId.get(e)?.args.subnet_id);
    if (blocksOf(r.args.network_interface).length > 0) {
      // an existing ENI as the primary interface never gets an auto-assigned public IP
      return eipAddress
        ? both(eipAddress, anyOf(...eniSubnets.map((s) => routeOf(s, 'no'))))
        : noAddress(r.id, 'its primary network interface is an existing ENI with no Elastic IP');
    }
    const lt = launchTemplateOf(r);
    const nic = primaryNic(lt);
    const subnet = r.args.subnet_id ?? nic?.subnet_id;
    const address =
      eipAddress ??
      flag(r.args.associate_public_ip_address, r.id, 'associate_public_ip_address') ??
      (lt ? flag(nic?.associate_public_ip_address, lt.id, 'associate_public_ip_address', 'launch template') : undefined) ??
      autoPublicIp(subnet, r.id);
    return both(address, anyOf(routeOf(subnet), ...eniSubnets.map((s) => routeOf(s, 'no'))));
  };
  const reachOf = (r: ResourceNode): Reachability => {
    switch (r.type) {
      case 'aws_lb':
      case 'aws_alb':
      case 'aws_elb': {
        const internal = boolArg(r.args.internal);
        if (internal === 'yes') return noAddress(r.id, 'internal = true — it gets no public address', 'Internal load balancer');
        if (internal === 'unknown') return UNKNOWN;
        return yes({ address: { resource: r.id, label: internal === 'no' ? 'internet-facing (internal = false)' : "internet-facing (internal isn't set)" } });
      }
      case 'aws_instance':
        return instanceReach(r);
      case 'aws_db_instance':
        return both(publiclyAccessible(r), dbRoute(r.args.db_subnet_group_name));
      case 'aws_rds_cluster_instance':
        return both(publiclyAccessible(r), dbRoute(r.args.db_subnet_group_name ?? clusterOf(r)?.args.db_subnet_group_name));
      case 'aws_rds_cluster':
        return anyOf(
          ...ir.resources.filter((x) => x.type === 'aws_rds_cluster_instance' && clusterOf(x)?.id === r.id).map((x) => reachOf(x)),
          noAddress(r.id, 'none of its cluster instances is publicly accessible', 'Not publicly accessible'),
        );
      case 'aws_ecs_service': {
        const nc = blocksOf(r.args.network_configuration)[0];
        return both(
          flag(nc?.assign_public_ip, r.id, 'assign_public_ip') ?? noAddress(r.id, "assign_public_ip isn't set (it defaults to false)"),
          routeOf(nc?.subnets, 'no'),
        );
      }
      case 'aws_autoscaling_group': {
        const lt = launchTemplateOf(r);
        const lc = launchConfigOf(r);
        const zones = r.args.vpc_zone_identifier;
        const address =
          (lt ? flag(primaryNic(lt)?.associate_public_ip_address, lt.id, 'associate_public_ip_address', 'launch template') : undefined) ??
          (lc ? flag(lc.args.associate_public_ip_address, lc.id, 'associate_public_ip_address', 'launch configuration') : undefined) ??
          autoPublicIp(zones, r.id);
        return both(address, routeOf(zones));
      }
      case 'aws_network_interface': {
        const eip = eipOf.get(r.id);
        return eip ? both(elasticIp(eip), routeOf(r.args.subnet_id, 'no')) : noAddress(r.id, 'no Elastic IP is associated with it');
      }
      case 'google_compute_instance': {
        const index = blocksOf(r.args.network_interface).findIndex((ni) => ni.access_config !== undefined);
        return index === -1
          ? noAddress(r.id, 'no access_config on its network interfaces — it has no external IP', 'No external IP')
          : yes({ address: { resource: r.id, label: `external IP (access_config on network_interface #${index + 1})` } });
      }
      default: {
        if (isAzureVm(r)) {
          const nic = nicsOf(r).find(nicPublic);
          if (!nic) return noAddress(r.id, 'none of its network interfaces has a public IP');
          const [ip] = refsIn(nicPublicIp(nic));
          return yes({
            address: ip
              ? { resource: ip, label: `public IP ${name(ip)} on NIC ${name(nic)}`, step: { title: `Public IP ${name(ip)}`, detail: `on NIC ${name(nic)}` } }
              : { resource: nic, label: `a public IP on NIC ${name(nic)}`, step: { title: `NIC ${name(nic)}`, detail: 'has a public IP' } },
          });
        }
        return noAddress(r.id, 'this kind of resource gets no public address', 'No public address');
      }
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
  const targetsLabel = (fw: ResourceNode | undefined) => {
    if (!fw) return undefined;
    const t = fwTargets(fw);
    if (t.accounts.length) return `service account ${t.accounts.join(', ')}`;
    return t.tags.length ? `tag ${t.tags.join(', ')}` : 'every instance in the network';
  };
  const layerOf = (owners: string[], ctx: StepContext = {}): Layer => {
    const kind = OWNER_TYPES[typeOf(owners[0]) ?? ''] ?? 'sg';
    const list = rulesOf(owners);
    return { kind, owners, rules: list, ev: evaluateInbound(list, kind !== 'sg'), intent: kind !== 'nacl', ctx };
  };

  const lanesOf = (r: ResourceNode, owners: string[]): Lane[] => {
    if (r.type.startsWith('aws_')) {
      const sg = layerOf(owners);
      // internet traffic arrives through the public subnets (all of them, when none is known public)
      const all = subnetsOf(r);
      const pub = all.filter((s) => subnets.get(s) === 'public');
      const entry = pub.length ? pub : all;
      const withNacls = entry.filter((s) => subnetNacls.has(s));
      if (withNacls.length === 0 || withNacls.length < entry.length) {
        return [{ layers: [sg], subnet: entry.find((s) => !subnetNacls.has(s)) }];
      }
      return withNacls.map((s) => ({ layers: [layerOf(subnetNacls.get(s)!, { at: { kind: 'subnet', id: s } }), sg], subnet: s }));
    }
    if (isAzureVm(r)) {
      const nics = nicsOf(r);
      const facing = nics.some(nicPublic) ? nics.filter(nicPublic) : nics;
      // Azure: inbound traffic must pass the subnet NSG and then the NIC NSG
      return facing.map((nic) => {
        const nicNsgs = nsgOfNic.get(nic) ?? [];
        const subnetNsgs = [...new Set(nicSubnets(nic).flatMap((s) => nsgOfSubnet.get(s) ?? []))];
        const subnet = nicSubnets(nic).find((s) => (nsgOfSubnet.get(s) ?? []).length > 0);
        return {
          layers: [
            ...(subnetNsgs.length && subnet ? [layerOf(subnetNsgs, { at: { kind: 'subnet', id: subnet } })] : []),
            ...(nicNsgs.length ? [layerOf(nicNsgs, { at: { kind: 'NIC', id: nic } })] : []),
          ],
        };
      });
    }
    // GCP: every firewall that targets the instance, one list by priority
    return [{ layers: [layerOf(owners)] }];
  };

  // ---------------------------------------------------------- evidence → steps
  const routeSteps = (s: string, address?: AddressSource): PathStep[] => {
    const rt = routing.get(s);
    if (!rt?.route) return [];
    const { route } = rt;
    const table = rt.table ? name(rt.table) : undefined;
    return [
      { kind: 'gateway', title: `Internet gateway ${name(route.gateway)}`, resource: route.gateway, verdict: 'allow' },
      {
        kind: 'route',
        title: `Route ${route.destination} → ${name(route.gateway)}`,
        detail: rt.main
          ? `${table ? `route table ${table}, ` : ''}the VPC's main route table — subnet ${name(s)} has no association of its own`
          : `route table ${table}, associated with subnet ${name(s)}`,
        resource: route.resource,
        verdict: 'allow',
      },
      {
        kind: 'subnet',
        title: `Subnet ${name(s)}`,
        detail: address?.resource === s ? 'public · assigns public IPs on launch' : 'public — routes to the internet gateway',
        resource: s,
        verdict: 'allow',
      },
    ];
  };
  /** Internet (added later) → gateway → route → subnet: how the traffic gets to the network */
  const networkSteps = (r: ResourceNode, reach: Reachability, lane?: Lane): PathStep[] => {
    if (!r.type.startsWith('aws_')) return [];
    const via = lane?.subnet && subnets.get(lane.subnet) === 'public' ? lane.subnet : reach.subnet;
    const pub = via ?? subnetsOf(r).find((s) => subnets.get(s) === 'public');
    if (pub) return routeSteps(pub, reach.address);
    if (reach.defaultVpc) {
      return [{ kind: 'route', title: 'Default VPC', detail: 'its default subnets route to an internet gateway', verdict: 'allow' }];
    }
    return [];
  };
  const hopStep = (hop: { rule: SecurityRule; layer: Layer }, extra: Partial<PathStep> = {}): PathStep => ({
    ...ruleStep(hop.rule, { ...hop.layer.ctx, targets: hop.rule.ownerKind === 'firewall' ? targetsLabel(byId.get(hop.rule.owner)) : undefined }),
    ...extra,
  });
  /** the resource, after whatever gives it its public address (an EIP, a launch template, a public IP) */
  const targetSteps = (r: ResourceNode, reach: Reachability, extra: Partial<PathStep> = {}): PathStep[] => {
    const address = reach.address;
    return [
      ...(address?.step && address.resource !== r.id
        ? [{ kind: 'address' as const, ...address.step, resource: address.resource, verdict: 'allow' as const, ...extra }]
        : []),
      {
        kind: 'resource',
        title: r.id,
        detail: address ? `public address: ${address.label}` : undefined,
        resource: r.id,
        ...extra,
      },
    ];
  };

  const explain = (r: ResourceNode, ev: ResourceEval, reach: Reachability): AccessExplanation => {
    const unreached = { unreached: true, verdict: undefined } as const;
    // reach = no: every port a rule opens stops at the missing address / route
    if (reach.reach === 'no') {
      const blockers = reach.blockers.length
        ? reach.blockers
        : [{ kind: 'address' as const, title: 'No public address', detail: 'it gets no public address', resource: r.id, verdict: 'deny' as const }];
      const reason = blockers.map((b) => b.title.charAt(0).toLowerCase() + b.title.slice(1)).join(' and ');
      const blocked: BlockedPort[] = ev.intents.map(({ rule, layer }) => {
        const traffic = ruleTraffic(rule);
        const families = internetFamilies(rule);
        return {
          ports: traffic ? portsLabel(traffic) : portLabel(rule),
          traffic,
          families,
          reason,
          steps: [internetStep(families), ...blockers, hopStep({ rule, layer }, unreached), ...targetSteps(r, reach, unreached)],
        };
      });
      return { open: [], blocked: blocked.sort(byPorts) };
    }
    if (reach.reach !== 'yes') return { open: [], blocked: [] };

    const open = groupByPort([
      ...ev.pieces.map((p) => ({
        traffic: p.traffic,
        family: p.family,
        steps: [...networkSteps(r, reach, p.lane), ...p.hops.map((h) => hopStep(h)), ...targetSteps(r, reach)],
      })),
      ...ev.unverified.flatMap((rule) =>
        internetFamilies(rule).map((family) => ({
          traffic: null,
          label: portLabel(rule),
          family,
          steps: [
            ...networkSteps(r, reach),
            hopStep(
              { rule, layer: ev.intents.find((i) => i.rule.id === rule.id)?.layer ?? layerOf([rule.owner]) },
              { detail: `${ruleStep(rule).detail} — the ports are an expression, so this can't be verified` },
            ),
            ...targetSteps(r, reach),
          ],
        })),
      ),
    ]);

    // one entry per intent rule + blocker; IPv4 / IPv6 fold together when they read the same
    const merged = new Map<string, Barrier & { families: IpFamily[] }>();
    for (const b of ev.barriers) {
      const blockerKey = 'rule' in b.blocker ? b.blocker.rule.id : `default:${b.blocker.layer.owners.join(',')}`;
      const key = `${b.intent.rule.id}|${blockerKey}`;
      const prev = merged.get(key);
      if (!prev) merged.set(key, { ...b, families: [b.family] });
      else {
        prev.traffic = trafficUnion(prev.traffic, b.traffic);
        if (!prev.families.includes(b.family)) prev.families.push(b.family);
      }
    }
    const blocked: BlockedPort[] = [...merged.values()].map((b) => {
      const blocker = b.blocker;
      const stop: PathStep =
        'rule' in blocker
          ? hopStep(blocker)
          : defaultStep(blocker.layer.kind, blocker.layer.owners[0], blocker.layer.ctx);
      const families = [...b.families].sort();
      return {
        ports: portsLabel(b.traffic),
        traffic: b.traffic,
        families,
        reason: blockReason('rule' in blocker ? blocker.rule : { kind: blocker.layer.kind, owner: blocker.layer.owners[0] }),
        steps: [
          internetStep(families),
          ...networkSteps(r, reach, b.lane),
          ...b.passed.map((h) => hopStep(h)),
          stop,
          hopStep(b.intent, unreached),
          ...targetSteps(r, reach, unreached),
        ],
      };
    });
    return { open, blocked: blocked.sort(byPorts) };
  };

  // ---------------------------------------------------------- exposure
  const exposure = new Map<string, Exposure>();
  const access = new Map<string, AccessExplanation>();
  const evals = new Map<string, ResourceEval>();
  for (const [resource, owners] of attachments) {
    const r = byId.get(resource);
    if (!r || NOT_WORKLOADS.has(r.type) || (r.type === 'aws_network_interface' && usedEnis.has(r.id))) continue;
    const ev = evaluateLanes(lanesOf(r, owners));
    evals.set(resource, ev);
    const reachability = reachOf(r);
    const reach = reachability.reach;
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
    const why = explain(r, ev, reachability);
    if (why.open.length || why.blocked.length) access.set(resource, why);
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

  return { rules, hidden, attachments, protects, subnets, subnetNacls, exposure, access, flows: [...flowMap.values()], effective };
}
