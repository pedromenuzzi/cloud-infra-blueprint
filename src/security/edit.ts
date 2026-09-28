/**
 * Rule editing: turn editor rows into inline HCL blocks (and back) for
 * AWS security groups, AWS network ACLs, Azure NSGs and GCP firewalls.
 * Keys the editor doesn't know about are preserved on update.
 */
import { lit, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, ResourceNode } from '@/ir/types';
import { blocksOf, type Direction, type OwnerKind, type RulePeer } from './model';

export interface RuleDraft {
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  fromPort: number | null;
  toPort: number | null;
  peers: RulePeer[];
  description?: string;
  action?: 'allow' | 'deny';
  /** NACL rule number / NSG priority */
  priority?: number;
}

export interface RulePreset {
  id: string;
  label: string;
  protocol: RuleDraft['protocol'];
  fromPort: number | null;
  toPort: number | null;
}

export const PRESETS: RulePreset[] = [
  { id: 'https', label: 'HTTPS', protocol: 'tcp', fromPort: 443, toPort: 443 },
  { id: 'http', label: 'HTTP', protocol: 'tcp', fromPort: 80, toPort: 80 },
  { id: 'ssh', label: 'SSH', protocol: 'tcp', fromPort: 22, toPort: 22 },
  { id: 'rdp', label: 'RDP', protocol: 'tcp', fromPort: 3389, toPort: 3389 },
  { id: 'postgres', label: 'PostgreSQL', protocol: 'tcp', fromPort: 5432, toPort: 5432 },
  { id: 'mysql', label: 'MySQL / Aurora', protocol: 'tcp', fromPort: 3306, toPort: 3306 },
  { id: 'mssql', label: 'SQL Server', protocol: 'tcp', fromPort: 1433, toPort: 1433 },
  { id: 'redis', label: 'Redis', protocol: 'tcp', fromPort: 6379, toPort: 6379 },
  { id: 'mongodb', label: 'MongoDB', protocol: 'tcp', fromPort: 27017, toPort: 27017 },
  { id: 'app', label: 'App (8080)', protocol: 'tcp', fromPort: 8080, toPort: 8080 },
  { id: 'all-tcp', label: 'All TCP', protocol: 'tcp', fromPort: null, toPort: null },
  { id: 'icmp', label: 'ICMP (ping)', protocol: 'icmp', fromPort: null, toPort: null },
  { id: 'all', label: 'All traffic', protocol: 'all', fromPort: null, toPort: null },
];

/** the arg that holds inline rules for a direction */
export function inlineField(kind: OwnerKind, direction: Direction): string {
  if (kind === 'nsg') return 'security_rule';
  if (kind === 'firewall') return 'allow';
  return direction === 'inbound' ? 'ingress' : 'egress';
}

function isV6(cidr: string) {
  return cidr.includes(':');
}

// ------------------------------------------------------------ body builders

function awsSgBody(d: RuleDraft, base: Record<string, Expression> = {}): Record<string, Expression> {
  const body: Record<string, Expression> = { ...base };
  for (const k of ['cidr_blocks', 'ipv6_cidr_blocks', 'security_groups', 'self']) delete body[k];
  if (d.description) body.description = lit(d.description);
  else delete body.description;
  if (d.protocol === 'all') {
    Object.assign(body, { from_port: lit(0), to_port: lit(0), protocol: lit('-1') });
  } else if (d.protocol === 'icmp') {
    Object.assign(body, { from_port: lit(-1), to_port: lit(-1), protocol: lit('icmp') });
  } else {
    Object.assign(body, {
      from_port: lit(d.fromPort ?? 0),
      to_port: lit(d.toPort ?? 65535),
      protocol: lit(d.protocol),
    });
  }
  const v4: Expression[] = [];
  const v6: Expression[] = [];
  const groups: Expression[] = [];
  for (const p of d.peers) {
    if (p.kind === 'any') v4.push(lit('0.0.0.0/0'));
    else if (p.kind === 'cidr') (isV6(p.value) ? v6 : v4).push(lit(p.value));
    else if (p.kind === 'group') groups.push(ref(`${p.ref}.id`));
    else if (p.kind === 'self') body.self = lit(true);
  }
  if (v4.length) body.cidr_blocks = { kind: 'list', items: v4 };
  if (v6.length) body.ipv6_cidr_blocks = { kind: 'list', items: v6 };
  if (groups.length) body.security_groups = { kind: 'list', items: groups };
  return body;
}

function awsNaclBody(d: RuleDraft, base: Record<string, Expression> = {}): Record<string, Expression> {
  const body: Record<string, Expression> = { ...base };
  delete body.cidr_block;
  delete body.ipv6_cidr_block;
  const peer = d.peers[0] ?? { kind: 'any' };
  const cidr = peer.kind === 'cidr' ? peer.value : '0.0.0.0/0';
  Object.assign(body, {
    rule_no: lit(d.priority ?? 100),
    action: lit(d.action ?? 'allow'),
    protocol: lit(d.protocol === 'all' ? '-1' : d.protocol),
    from_port: lit(d.protocol === 'all' || d.protocol === 'icmp' ? 0 : (d.fromPort ?? 0)),
    to_port: lit(d.protocol === 'all' || d.protocol === 'icmp' ? 0 : (d.toPort ?? 65535)),
    [isV6(cidr) ? 'ipv6_cidr_block' : 'cidr_block']: lit(cidr),
  });
  return body;
}

function azurePort(d: RuleDraft) {
  if (d.protocol === 'all' || d.protocol === 'icmp' || d.fromPort === null) return '*';
  return d.fromPort === d.toPort ? String(d.fromPort) : `${d.fromPort}-${d.toPort}`;
}

function azureBody(
  d: RuleDraft,
  direction: Direction,
  base: Record<string, Expression> = {},
): Record<string, Expression> {
  const body: Record<string, Expression> = { ...base };
  const peer = d.peers[0] ?? { kind: 'any' };
  const prefix = peer.kind === 'cidr' ? peer.value : peer.kind === 'other' ? peer.value : '*';
  const protocol = { tcp: 'Tcp', udp: 'Udp', icmp: 'Icmp', all: '*' }[d.protocol];
  delete body.source_address_prefixes;
  delete body.destination_address_prefixes;
  delete body.destination_port_ranges;
  Object.assign(body, {
    name: lit(d.description?.replace(/[^\w.-]+/g, '-') || `rule-${d.priority ?? 100}`),
    priority: lit(d.priority ?? 100),
    direction: lit(direction === 'inbound' ? 'Inbound' : 'Outbound'),
    access: lit(d.action === 'deny' ? 'Deny' : 'Allow'),
    protocol: lit(protocol),
    source_port_range: lit('*'),
    destination_port_range: lit(azurePort(d)),
    source_address_prefix: lit(direction === 'inbound' ? prefix : '*'),
    destination_address_prefix: lit(direction === 'inbound' ? '*' : prefix),
  });
  return body;
}

function gcpAllowBody(d: RuleDraft, base: Record<string, Expression> = {}): Record<string, Expression> {
  const body: Record<string, Expression> = { ...base, protocol: lit(d.protocol) };
  delete body.ports;
  if ((d.protocol === 'tcp' || d.protocol === 'udp') && d.fromPort !== null) {
    const port = d.fromPort === d.toPort ? String(d.fromPort) : `${d.fromPort}-${d.toPort}`;
    body.ports = { kind: 'list', items: [lit(port)] };
  }
  return body;
}

export function draftToBody(
  kind: OwnerKind,
  direction: Direction,
  draft: RuleDraft,
  base?: Record<string, Expression>,
): Record<string, Expression> {
  switch (kind) {
    case 'sg':
      return awsSgBody(draft, base);
    case 'nacl':
      return awsNaclBody(draft, base);
    case 'nsg':
      return azureBody(draft, direction, base);
    case 'firewall':
      return gcpAllowBody(draft, base);
  }
}

// ------------------------------------------------------------ ops

function setBlocks(node: ResourceNode, field: string, bodies: Array<Record<string, Expression>>): Op {
  if (bodies.length === 0) return { kind: 'unset_arg', nodeId: node.id, field };
  return {
    kind: 'set_arg',
    nodeId: node.id,
    field,
    value: bodies.length === 1 ? { kind: 'block', body: bodies[0] } : { kind: 'blocks', items: bodies },
  };
}

/** next free NACL rule number / NSG priority (steps of 10, starting at 100) */
export function nextPriority(node: ResourceNode, kind: OwnerKind, direction: Direction): number {
  const key = kind === 'nacl' ? 'rule_no' : 'priority';
  const wanted = direction === 'inbound' ? 'inbound' : 'outbound';
  const used = blocksOf(node.args[inlineField(kind, direction)])
    .filter(
      (b) =>
        kind !== 'nsg' ||
        (b.direction?.kind === 'literal' && String(b.direction.value).toLowerCase() === wanted),
    )
    .map((b) => (b[key]?.kind === 'literal' ? Number(b[key].value) : Number.NaN))
    .filter(Number.isFinite);
  return used.length ? Math.max(...used) + 10 : 100;
}

export function addRuleOp(
  node: ResourceNode,
  kind: OwnerKind,
  direction: Direction,
  draft: RuleDraft,
  field = inlineField(kind, direction),
): Op {
  const bodies = blocksOf(node.args[field]);
  return setBlocks(node, field, [...bodies, draftToBody(kind, direction, draft)]);
}

export function updateRuleOp(
  node: ResourceNode,
  kind: OwnerKind,
  direction: Direction,
  field: string,
  index: number,
  draft: RuleDraft,
): Op {
  const bodies = [...blocksOf(node.args[field])];
  bodies[index] = draftToBody(kind, direction, draft, bodies[index]);
  return setBlocks(node, field, bodies);
}

export function removeRuleOp(node: ResourceNode, field: string, index: number): Op {
  const bodies = blocksOf(node.args[field]).filter((_, i) => i !== index);
  return setBlocks(node, field, bodies);
}

/** Replace "anywhere" peers of one inline rule (e.g. restrict to the VPC CIDR). */
export function restrictRuleOp(
  node: ResourceNode,
  kind: OwnerKind,
  field: string,
  index: number,
  replacement: string,
): Op | null {
  const bodies = [...blocksOf(node.args[field])];
  const body = bodies[index];
  if (!body) return null;
  const next: Record<string, Expression> = { ...body };
  if (kind === 'sg') {
    const keep = (e: Expression | undefined) =>
      (e?.kind === 'list' ? e.items : e ? [e] : []).filter(
        (i) => !(i.kind === 'literal' && ['0.0.0.0/0', '::/0'].includes(String(i.value))),
      );
    const v4 = keep(body.cidr_blocks);
    next.cidr_blocks = { kind: 'list', items: [...v4, lit(replacement)] };
    const v6 = keep(body.ipv6_cidr_blocks);
    if (v6.length) next.ipv6_cidr_blocks = { kind: 'list', items: v6 };
    else delete next.ipv6_cidr_blocks;
  } else if (kind === 'nacl') {
    next.cidr_block = lit(replacement);
  } else if (kind === 'nsg') {
    const key = body.direction?.kind === 'literal' && String(body.direction.value).toLowerCase() === 'outbound'
      ? 'destination_address_prefix'
      : 'source_address_prefix';
    delete next[`${key}es`];
    next[key] = lit(replacement);
  } else {
    return { kind: 'set_arg', nodeId: node.id, field: 'source_ranges', value: { kind: 'list', items: [lit(replacement)] } };
  }
  bodies[index] = next;
  return setBlocks(node, field, bodies);
}
