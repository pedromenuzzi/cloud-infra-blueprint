/**
 * Security model: every firewall-ish construct across clouds, normalized.
 *
 *   AWS    aws_security_group (inline ingress/egress), aws_vpc_security_group_*_rule,
 *          aws_security_group_rule, aws_network_acl (inline), aws_network_acl_rule
 *   Azure  azurerm_network_security_group (inline security_rule), azurerm_network_security_rule
 *   GCP    google_compute_firewall (allow / deny blocks)
 *
 * Pure functions over the IR — the canvas lens, the rules editor and the
 * audit all read from here.
 */
import { refTargetAddress } from '@/ir/expr';
import type { Expression, IR, ResourceNode } from '@/ir/types';

export type Direction = 'inbound' | 'outbound';
export type OwnerKind = 'sg' | 'nacl' | 'nsg' | 'firewall';

export type RulePeer =
  | { kind: 'any' }
  | { kind: 'cidr'; value: string }
  | { kind: 'group'; ref: string }
  | { kind: 'self' }
  | { kind: 'tag'; value: string }
  | { kind: 'other'; value: string };

export interface SecurityRule {
  id: string;
  owner: string;
  ownerKind: OwnerKind;
  direction: Direction;
  action: 'allow' | 'deny';
  /** tcp | udp | icmp | all | <other> */
  protocol: string;
  /** inclusive port range; null = every port (or not applicable, e.g. icmp) */
  fromPort: number | null;
  toPort: number | null;
  /** set when ports are expressions we can't evaluate (var.port…) */
  portsExpr?: string;
  /** sources for inbound rules, destinations for outbound */
  peers: RulePeer[];
  priority?: number;
  description?: string;
  origin: { kind: 'inline'; field: string; index: number } | { kind: 'resource'; id: string };
}

export const OWNER_TYPES: Record<string, OwnerKind> = {
  aws_security_group: 'sg',
  aws_network_acl: 'nacl',
  azurerm_network_security_group: 'nsg',
  google_compute_firewall: 'firewall',
};

/** standalone rule resources → the owner arg that points at their SG / NACL / NSG */
const RULE_RESOURCES = new Set([
  'aws_vpc_security_group_ingress_rule',
  'aws_vpc_security_group_egress_rule',
  'aws_security_group_rule',
  'aws_network_acl_rule',
  'azurerm_network_security_rule',
]);

export function isRuleResource(type: string): boolean {
  return RULE_RESOURCES.has(type);
}

// ------------------------------------------------------------------ helpers

export function blocksOf(e: Expression | undefined): Array<Record<string, Expression>> {
  if (!e) return [];
  if (e.kind === 'block') return [e.body];
  if (e.kind === 'blocks') return e.items;
  return [];
}

function str(e: Expression | undefined): string | undefined {
  if (e?.kind === 'literal' && e.value !== null) return String(e.value);
  return undefined;
}

function num(e: Expression | undefined): number | undefined {
  if (e?.kind !== 'literal') return undefined;
  const n = typeof e.value === 'number' ? e.value : Number(e.value);
  return Number.isFinite(n) ? n : undefined;
}

function exprText(e: Expression | undefined): string | undefined {
  if (!e) return undefined;
  if (e.kind === 'literal') return String(e.value);
  if (e.kind === 'ref') return e.path;
  if (e.kind === 'raw') return e.hcl;
  return undefined;
}

function items(e: Expression | undefined): Expression[] {
  if (!e) return [];
  return e.kind === 'list' ? e.items : [e];
}

function refOf(e: Expression | undefined): string | undefined {
  return e?.kind === 'ref' ? (refTargetAddress(e.path) ?? undefined) : undefined;
}

const ANY = new Set(['0.0.0.0/0', '::/0', '*', 'internet', 'any', '0.0.0.0']);

export function peerFromText(value: string): RulePeer {
  return ANY.has(value.toLowerCase()) ? { kind: 'any' } : { kind: 'cidr', value };
}

function peersFromList(e: Expression | undefined): RulePeer[] {
  const out: RulePeer[] = [];
  for (const item of items(e)) {
    const text = str(item);
    if (text !== undefined) out.push(peerFromText(text));
    else if (item.kind === 'ref') {
      const target = refOf(item);
      out.push(target ? { kind: 'group', ref: target } : { kind: 'other', value: item.path });
    } else if (item.kind === 'raw') out.push({ kind: 'other', value: item.hcl });
  }
  return out;
}

export function normalizeProtocol(value: string | undefined): string {
  const v = (value ?? 'all').toLowerCase();
  if (v === '-1' || v === 'all' || v === '*' || v === 'asterisk') return 'all';
  if (v === '6') return 'tcp';
  if (v === '17') return 'udp';
  if (v === '1' || v === 'icmpv6' || v === '58') return 'icmp';
  return v;
}

/** "443", "8000-8080", "*" → range (null = all) */
export function parsePortRange(text: string): { from: number | null; to: number | null } | undefined {
  const t = text.trim();
  if (t === '*' || t === '') return { from: null, to: null };
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(t);
  if (!m) return undefined;
  const from = Number(m[1]);
  const to = m[2] !== undefined ? Number(m[2]) : from;
  return { from, to };
}

function awsPorts(body: Record<string, Expression>, protocol: string) {
  if (protocol === 'all') return { fromPort: null, toPort: null };
  const from = num(body.from_port);
  const to = num(body.to_port);
  if (from === undefined || to === undefined) {
    const fromText = exprText(body.from_port);
    const toText = exprText(body.to_port);
    if (fromText === undefined && toText === undefined) return { fromPort: null, toPort: null };
    return { fromPort: null, toPort: null, portsExpr: fromText === toText ? fromText : `${fromText}-${toText}` };
  }
  // AWS: icmp uses from/to as type/code; 0-65535 is "all ports"
  if (protocol === 'icmp' || (from <= 0 && to >= 65535) || (from === 0 && to === 0)) {
    return { fromPort: null, toPort: null };
  }
  return { fromPort: from, toPort: to };
}

// ------------------------------------------------------------------ rules

function awsSgInline(r: ResourceNode, out: SecurityRule[]) {
  for (const [field, direction] of [['ingress', 'inbound'], ['egress', 'outbound']] as const) {
    blocksOf(r.args[field]).forEach((body, index) => {
      const protocol = normalizeProtocol(str(body.protocol));
      const peers = [
        ...peersFromList(body.cidr_blocks),
        ...peersFromList(body.ipv6_cidr_blocks),
        ...peersFromList(body.security_groups),
        ...items(body.prefix_list_ids).map((e): RulePeer => ({ kind: 'other', value: exprText(e) ?? 'prefix list' })),
      ];
      if (body.self?.kind === 'literal' && body.self.value === true) peers.push({ kind: 'self' });
      out.push({
        id: `${r.id}:${field}:${index}`,
        owner: r.id,
        ownerKind: 'sg',
        direction,
        action: 'allow',
        protocol,
        ...awsPorts(body, protocol),
        peers,
        description: str(body.description),
        origin: { kind: 'inline', field, index },
      });
    });
  }
}

function awsNaclInline(r: ResourceNode, out: SecurityRule[]) {
  for (const [field, direction] of [['ingress', 'inbound'], ['egress', 'outbound']] as const) {
    blocksOf(r.args[field]).forEach((body, index) => {
      const protocol = normalizeProtocol(str(body.protocol));
      out.push({
        id: `${r.id}:${field}:${index}`,
        owner: r.id,
        ownerKind: 'nacl',
        direction,
        action: str(body.action)?.toLowerCase() === 'deny' ? 'deny' : 'allow',
        protocol,
        ...awsPorts(body, protocol),
        peers: [...peersFromList(body.cidr_block), ...peersFromList(body.ipv6_cidr_block)],
        priority: num(body.rule_no),
        origin: { kind: 'inline', field, index },
      });
    });
  }
}

function azureRule(
  body: Record<string, Expression>,
  owner: string,
  id: string,
  origin: SecurityRule['origin'],
): SecurityRule[] {
  const direction: Direction = str(body.direction)?.toLowerCase() === 'outbound' ? 'outbound' : 'inbound';
  const peerKey = direction === 'inbound' ? 'source_address_prefix' : 'destination_address_prefix';
  const peers = [...peersFromList(body[peerKey]), ...peersFromList(body[`${peerKey}es`])];
  const ranges = [str(body.destination_port_range), ...items(body.destination_port_ranges).map(str)].filter(
    (v): v is string => v !== undefined,
  );
  const base = {
    owner,
    ownerKind: 'nsg' as const,
    direction,
    action: str(body.access)?.toLowerCase() === 'deny' ? ('deny' as const) : ('allow' as const),
    protocol: normalizeProtocol(str(body.protocol)),
    peers,
    priority: num(body.priority),
    description: str(body.name) ?? str(body.description),
    origin,
  };
  if (ranges.length === 0) return [{ ...base, id, fromPort: null, toPort: null }];
  return ranges.map((text, i) => {
    const range = parsePortRange(text);
    return {
      ...base,
      id: ranges.length > 1 ? `${id}#${i}` : id,
      fromPort: range?.from ?? null,
      toPort: range?.to ?? null,
      ...(range ? {} : { portsExpr: text }),
    };
  });
}

function gcpFirewall(r: ResourceNode, out: SecurityRule[]) {
  const direction: Direction = str(r.args.direction)?.toUpperCase() === 'EGRESS' ? 'outbound' : 'inbound';
  const peers =
    direction === 'inbound'
      ? [
          ...peersFromList(r.args.source_ranges),
          ...items(r.args.source_tags).map((e): RulePeer => ({ kind: 'tag', value: str(e) ?? exprText(e) ?? '?' })),
        ]
      : peersFromList(r.args.destination_ranges);
  for (const action of ['allow', 'deny'] as const) {
    blocksOf(r.args[action]).forEach((body, index) => {
      const protocol = normalizeProtocol(str(body.protocol));
      const ports = items(body.ports).map((e) => str(e) ?? exprText(e) ?? '');
      const ranges = ports.length > 0 ? ports : ['*'];
      ranges.forEach((text, i) => {
        const range = parsePortRange(text);
        out.push({
          id: `${r.id}:${action}:${index}${ranges.length > 1 ? `#${i}` : ''}`,
          owner: r.id,
          ownerKind: 'firewall',
          direction,
          action,
          protocol,
          fromPort: protocol === 'all' ? null : (range?.from ?? null),
          toPort: protocol === 'all' ? null : (range?.to ?? null),
          ...(range ? {} : { portsExpr: text }),
          peers,
          priority: num(r.args.priority),
          description: str(r.args.description),
          origin: { kind: 'inline', field: action, index },
        });
      });
    });
  }
}

function standalone(r: ResourceNode, out: SecurityRule[]) {
  const a = r.args;
  const origin = { kind: 'resource' as const, id: r.id };
  switch (r.type) {
    case 'aws_vpc_security_group_ingress_rule':
    case 'aws_vpc_security_group_egress_rule': {
      const owner = refOf(a.security_group_id);
      if (!owner) return;
      const protocol = normalizeProtocol(str(a.ip_protocol));
      const peers = [...peersFromList(a.cidr_ipv4), ...peersFromList(a.cidr_ipv6)];
      const group = refOf(a.referenced_security_group_id);
      if (group) peers.push(group === owner ? { kind: 'self' } : { kind: 'group', ref: group });
      if (a.prefix_list_id) peers.push({ kind: 'other', value: exprText(a.prefix_list_id) ?? 'prefix list' });
      out.push({
        id: r.id,
        owner,
        ownerKind: 'sg',
        direction: r.type.endsWith('ingress_rule') ? 'inbound' : 'outbound',
        action: 'allow',
        protocol,
        ...awsPorts(a, protocol),
        peers,
        description: str(a.description),
        origin,
      });
      return;
    }
    case 'aws_security_group_rule': {
      const owner = refOf(a.security_group_id);
      if (!owner) return;
      const protocol = normalizeProtocol(str(a.protocol));
      const peers = [...peersFromList(a.cidr_blocks), ...peersFromList(a.ipv6_cidr_blocks)];
      const group = refOf(a.source_security_group_id);
      if (group) peers.push({ kind: 'group', ref: group });
      if (a.self?.kind === 'literal' && a.self.value === true) peers.push({ kind: 'self' });
      out.push({
        id: r.id,
        owner,
        ownerKind: 'sg',
        direction: str(a.type) === 'egress' ? 'outbound' : 'inbound',
        action: 'allow',
        protocol,
        ...awsPorts(a, protocol),
        peers,
        description: str(a.description),
        origin,
      });
      return;
    }
    case 'aws_network_acl_rule': {
      const owner = refOf(a.network_acl_id);
      if (!owner) return;
      const protocol = normalizeProtocol(str(a.protocol));
      out.push({
        id: r.id,
        owner,
        ownerKind: 'nacl',
        direction: a.egress?.kind === 'literal' && a.egress.value === true ? 'outbound' : 'inbound',
        action: str(a.rule_action)?.toLowerCase() === 'deny' ? 'deny' : 'allow',
        protocol,
        ...awsPorts(a, protocol),
        peers: [...peersFromList(a.cidr_block), ...peersFromList(a.ipv6_cidr_block)],
        priority: num(a.rule_number),
        origin,
      });
      return;
    }
    case 'azurerm_network_security_rule': {
      const owner = refOf(a.network_security_group_name);
      if (owner) out.push(...azureRule(a, owner, r.id, origin));
      return;
    }
  }
}

/** Every rule in the project, grouped by the SG / NACL / NSG / firewall that owns it. */
export function extractRules(ir: IR): Map<string, SecurityRule[]> {
  const all: SecurityRule[] = [];
  for (const r of ir.resources) {
    switch (r.type) {
      case 'aws_security_group':
        awsSgInline(r, all);
        break;
      case 'aws_network_acl':
        awsNaclInline(r, all);
        break;
      case 'azurerm_network_security_group':
        blocksOf(r.args.security_rule).forEach((body, index) =>
          all.push(
            ...azureRule(body, r.id, `${r.id}:security_rule:${index}`, {
              kind: 'inline',
              field: 'security_rule',
              index,
            }),
          ),
        );
        break;
      case 'google_compute_firewall':
        gcpFirewall(r, all);
        break;
      default:
        if (RULE_RESOURCES.has(r.type)) standalone(r, all);
    }
  }
  const byOwner = new Map<string, SecurityRule[]>();
  for (const r of ir.resources) if (OWNER_TYPES[r.type]) byOwner.set(r.id, []);
  for (const rule of all) byOwner.get(rule.owner)?.push(rule);
  return byOwner;
}

// ------------------------------------------------------------------ labels

const WELL_KNOWN: Record<number, string> = {
  20: 'FTP',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS',
  445: 'SMB',
  1433: 'SQL Server',
  1521: 'Oracle',
  2049: 'NFS',
  2375: 'Docker',
  3000: 'App',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5439: 'Redshift',
  5601: 'Kibana',
  5672: 'AMQP',
  6379: 'Redis',
  8080: 'HTTP alt',
  8443: 'HTTPS alt',
  9092: 'Kafka',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  27017: 'MongoDB',
};

export function serviceName(rule: Pick<SecurityRule, 'protocol' | 'fromPort' | 'toPort'>): string {
  if (rule.protocol === 'all') return 'All traffic';
  if (rule.protocol === 'icmp') return 'ICMP';
  if (rule.fromPort === null) return `All ${rule.protocol.toUpperCase()}`;
  if (rule.fromPort === rule.toPort) return WELL_KNOWN[rule.fromPort] ?? `${rule.protocol.toUpperCase()} ${rule.fromPort}`;
  return `${rule.protocol.toUpperCase()} ${rule.fromPort}–${rule.toPort}`;
}

export function portLabel(rule: Pick<SecurityRule, 'protocol' | 'fromPort' | 'toPort' | 'portsExpr'>): string {
  if (rule.portsExpr) return rule.portsExpr;
  if (rule.protocol === 'all') return 'all';
  if (rule.protocol === 'icmp') return 'icmp';
  if (rule.fromPort === null) return 'all';
  return rule.fromPort === rule.toPort ? String(rule.fromPort) : `${rule.fromPort}-${rule.toPort}`;
}

export function peerLabel(peer: RulePeer, nameOf: (id: string) => string = (id) => id): string {
  switch (peer.kind) {
    case 'any':
      return 'Internet';
    case 'cidr':
      return peer.value;
    case 'group':
      return nameOf(peer.ref);
    case 'self':
      return 'itself';
    case 'tag':
      return `tag:${peer.value}`;
    case 'other':
      return peer.value;
  }
}

export function coversPort(rule: Pick<SecurityRule, 'protocol' | 'fromPort' | 'toPort'>, port: number): boolean {
  if (rule.protocol === 'all') return true;
  if (rule.protocol !== 'tcp' && rule.protocol !== 'udp') return false;
  if (rule.fromPort === null || rule.toPort === null) return true;
  return port >= rule.fromPort && port <= rule.toPort;
}

export function fromInternet(rule: SecurityRule): boolean {
  return rule.peers.some((p) => p.kind === 'any');
}
