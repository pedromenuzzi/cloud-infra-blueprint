/**
 * Rule editing ops for AWS security groups & network ACLs, Azure NSGs and GCP
 * firewalls — inline blocks and standalone rule resources alike.
 *
 * Edits are patches: only the arguments behind the fields the user changed
 * are rewritten, so expressions, unknown keys and argument order survive.
 * Rows the model can't represent (`rule.unmodeled`) are never rewritten.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { lit, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';
import { cidrFamily, coversFamily, parseCidr } from './cidr';
import { editMessages, type PresetId } from './edit.messages';
import {
  blocksOf,
  extractRules,
  internetFamilies,
  isRuleResource,
  OWNER_TYPES,
  refOf,
  type Direction,
  type OwnerKind,
  type RulePeer,
  type SecurityRule,
} from './model';

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
  id: PresetId;
  /** English, written into the code as the rule's description; menus show presetLabel() */
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

/** a preset's name in the UI language */
export const presetLabel = (p: RulePreset, locale: Locale = currentLocale()): string => messagesFor(editMessages, locale).presets[p.id];

/** the only presets that may start open to the whole internet */
export const PUBLIC_PRESETS = new Set(['https', 'http']);
/** stand-in source for every other inbound preset when the network's range is unknown */
export const PLACEHOLDER_CIDR = '10.0.0.0/16';

/** the arg that holds inline rules for a direction */
export function inlineField(kind: OwnerKind, direction: Direction): string {
  if (kind === 'nsg') return 'security_rule';
  if (kind === 'firewall') return 'allow';
  return direction === 'inbound' ? 'ingress' : 'egress';
}

const OWNER_ARG: Record<string, string> = {
  aws_vpc_security_group_ingress_rule: 'security_group_id',
  aws_vpc_security_group_egress_rule: 'security_group_id',
  aws_security_group_rule: 'security_group_id',
  aws_network_acl_rule: 'network_acl_id',
  azurerm_network_security_rule: 'network_security_group_name',
};

function standaloneRules(ir: IR, owner: ResourceNode): ResourceNode[] {
  return ir.resources.filter((r) => isRuleResource(r.type) && refOf(r.args[OWNER_ARG[r.type]]) === owner.id);
}

const portText = (from: number, to: number) => (from === to ? String(from) : `${from}-${to}`);

/** Update keys in place (so argument order survives); undefined deletes, new keys go last. */
function assign(body: Record<string, Expression>, updates: Record<string, Expression | undefined>): Record<string, Expression> {
  const out: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in updates)) out[k] = v;
    else if (updates[k] !== undefined) out[k] = updates[k]!;
  }
  for (const [k, v] of Object.entries(updates)) if (!(k in body) && v !== undefined) out[k] = v;
  return out;
}

const list = (items: Expression[]): Expression | undefined => (items.length ? { kind: 'list', items } : undefined);

function hasDynamic(node: ResourceNode, field: string) {
  return Object.keys(node.args).some((k) => k.startsWith(`dynamic "${field}"`));
}

/** Inline rules as blocks. The last one goes as `field = []`: with attributes-as-blocks
 *  (ingress / egress / security_rule) a removed argument leaves the rules live in the cloud. */
function setBlocks(node: ResourceNode, field: string, bodies: Array<Record<string, Expression>>): Op {
  if (bodies.length === 0) {
    return hasDynamic(node, field) || field === 'allow' || field === 'deny'
      ? { kind: 'unset_arg', nodeId: node.id, field }
      : { kind: 'set_arg', nodeId: node.id, field, value: { kind: 'list', items: [] } };
  }
  return {
    kind: 'set_arg',
    nodeId: node.id,
    field,
    value: bodies.length === 1 ? { kind: 'block', body: bodies[0] } : { kind: 'blocks', items: bodies },
  };
}

/** set_arg / unset_arg for each argument that changed */
function argOps(node: ResourceNode, next: Record<string, Expression>): Op[] {
  const ops: Op[] = [];
  for (const k of Object.keys(node.args)) if (!(k in next)) ops.push({ kind: 'unset_arg', nodeId: node.id, field: k });
  for (const [k, v] of Object.entries(next)) if (node.args[k] !== v) ops.push({ kind: 'set_arg', nodeId: node.id, field: k, value: v });
  return ops;
}

// ------------------------------------------------------------ style

export type RuleStyle =
  | { mode: 'inline'; field: string }
  | { mode: 'resource'; type: string }
  | { mode: 'blocked'; reason: string };

/**
 * Where a new rule goes. Never mix styles within a direction: when its rules are
 * standalone resources, new ones are too (the providers say inline + standalone
 * fight). An owner that manages the direction inline (`ingress { }`, `= []`) keeps it.
 */
export function ruleStyle(ir: IR, owner: ResourceNode, direction: Direction, locale: Locale = currentLocale()): RuleStyle {
  const kind = OWNER_TYPES[owner.type];
  if (kind === 'firewall') return { mode: 'inline', field: owner.args.deny ? 'deny' : 'allow' };
  const field = inlineField(kind, direction);
  const e = owner.args[field];
  if (e && e.kind !== 'block' && e.kind !== 'blocks' && !(e.kind === 'list' && e.items.length === 0)) {
    return { mode: 'blocked', reason: messagesFor(editMessages, locale).writtenAs(field, e.kind === 'list') };
  }
  // the argument is there (blocks, or `= []`): the owner itself manages these rules
  if (e) return { mode: 'inline', field };
  const standalone = standaloneRules(ir, owner);
  const sameDirection = (extractRules(ir).get(owner.id) ?? []).some((r) => r.origin.kind === 'resource' && r.direction === direction);
  const inlineElsewhere = kind !== 'nsg' && !!owner.args[direction === 'inbound' ? 'egress' : 'ingress'];
  if (standalone.length === 0 || (inlineElsewhere && !sameDirection)) return { mode: 'inline', field };
  if (kind === 'nacl') return { mode: 'resource', type: 'aws_network_acl_rule' };
  if (kind === 'nsg') return { mode: 'resource', type: 'azurerm_network_security_rule' };
  return standalone.some((r) => r.type.startsWith('aws_vpc_security_group_'))
    ? { mode: 'resource', type: direction === 'inbound' ? 'aws_vpc_security_group_ingress_rule' : 'aws_vpc_security_group_egress_rule' }
    : { mode: 'resource', type: 'aws_security_group_rule' };
}

/**
 * The owner manages a direction inline (blocks, or `= []`) while standalone
 * rules target the same direction — Terraform keeps undoing one with the other.
 */
export function mixesStyles(ir: IR, owner: ResourceNode): boolean {
  const kind = OWNER_TYPES[owner.type];
  if (kind !== 'sg' && kind !== 'nacl' && kind !== 'nsg') return false;
  const standalone = (extractRules(ir).get(owner.id) ?? []).filter((r) => r.origin.kind === 'resource');
  if (kind === 'nsg') return !!owner.args.security_rule && standalone.length > 0;
  return standalone.some((r) => !!owner.args[r.direction === 'inbound' ? 'ingress' : 'egress']);
}

const PRIORITY_RANGE: Record<'nacl' | 'nsg', [number, number]> = { nacl: [1, 32766], nsg: [100, 4096] };

export function priorityRange(kind: OwnerKind): [number, number] | undefined {
  return kind === 'nacl' || kind === 'nsg' ? PRIORITY_RANGE[kind] : undefined;
}

/** priorities / rule numbers taken in a direction, inline and standalone */
export function usedPriorities(ir: IR, owner: ResourceNode, direction: Direction, except?: string): Set<number> {
  const rules = extractRules(ir).get(owner.id) ?? [];
  return new Set(
    rules.flatMap((r) => (r.direction === direction && r.priority !== undefined && r.id.split('#')[0] !== except ? [r.priority] : [])),
  );
}

/** next free NACL rule number / NSG priority (steps of 10, starting at 100) */
export function nextPriority(ir: IR, owner: ResourceNode, direction: Direction): number {
  const kind = OWNER_TYPES[owner.type];
  const [, max] = priorityRange(kind) ?? [1, 65535];
  const used = usedPriorities(ir, owner, direction);
  let next = used.size ? Math.max(...used) + 10 : 100;
  if (next > max) for (next = 100; used.has(next) && next < max; next++);
  return next;
}

/** Azure rule names: word characters, `.` and `-`; start with a word character, end with one */
function nsgName(base: string): string {
  const clean = base
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^\w]+|[^\w]+$/g, '')
    .slice(0, 76);
  return clean || 'rule';
}

function nsgNames(ir: IR, owner: ResourceNode, except?: string): Set<string> {
  const rules = extractRules(ir).get(owner.id) ?? [];
  return new Set(rules.flatMap((r) => (r.description && r.id.split('#')[0] !== except ? [r.description.toLowerCase()] : [])));
}

/** a name no other rule of the NSG uses (Azure requires unique names per NSG) */
export function uniqueNsgName(ir: IR, owner: ResourceNode, base: string, except?: string): string {
  const taken = nsgNames(ir, owner, except);
  const stem = nsgName(base);
  let name = stem;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${stem}-${i}`;
  return name;
}

// ------------------------------------------------------------ peers → arguments

type AwsFlavor = 'inline' | 'sg_rule' | 'vpc_rule';

function awsPeerArgs(peers: RulePeer[], flavor: AwsFlavor, ownerId: string): Record<string, Expression | undefined> {
  if (flavor === 'vpc_rule') {
    const keys = ['cidr_ipv4', 'cidr_ipv6', 'prefix_list_id', 'referenced_security_group_id'];
    const out: Record<string, Expression | undefined> = Object.fromEntries(keys.map((k) => [k, undefined]));
    const p = peers[0];
    if (!p) return out;
    if (p.src && keys.includes(p.src.field)) out[p.src.field] = p.src.expr;
    else if (p.kind === 'any' || p.kind === 'cidr') out[cidrFamily(p.value) === 'ipv6' ? 'cidr_ipv6' : 'cidr_ipv4'] = lit(p.value);
    else if (p.kind === 'group') out.referenced_security_group_id = ref(`${p.ref}.id`);
    else if (p.kind === 'self') out.referenced_security_group_id = ref(`${ownerId}.id`);
    else if (p.kind === 'other') out.prefix_list_id = lit(p.value);
    return out;
  }
  const groupKey = flavor === 'inline' ? 'security_groups' : 'source_security_group_id';
  const lists: Record<string, Expression[]> = { cidr_blocks: [], ipv6_cidr_blocks: [], prefix_list_ids: [], [groupKey]: [] };
  let self: Expression | undefined;
  for (const p of peers) {
    if (p.kind === 'self') self = p.src?.expr ?? lit(true);
    else if (p.src && p.src.field in lists) lists[p.src.field].push(p.src.expr);
    else if (p.kind === 'any' || p.kind === 'cidr') lists[cidrFamily(p.value) === 'ipv6' ? 'ipv6_cidr_blocks' : 'cidr_blocks'].push(lit(p.value));
    else if (p.kind === 'group') lists[groupKey].push(ref(`${p.ref}.id`));
    else if (p.kind === 'other') lists.prefix_list_ids.push(lit(p.value));
  }
  return {
    cidr_blocks: list(lists.cidr_blocks),
    ipv6_cidr_blocks: list(lists.ipv6_cidr_blocks),
    [groupKey]: flavor === 'inline' ? list(lists[groupKey]) : lists[groupKey][0],
    prefix_list_ids: list(lists.prefix_list_ids),
    self,
  };
}

function naclPeerArgs(peers: RulePeer[]): Record<string, Expression | undefined> {
  const out: Record<string, Expression | undefined> = { cidr_block: undefined, ipv6_cidr_block: undefined };
  const p = peers[0];
  if (p?.src && p.src.field in out) out[p.src.field] = p.src.expr;
  else if (p && (p.kind === 'any' || p.kind === 'cidr')) out[cidrFamily(p.value) === 'ipv6' ? 'ipv6_cidr_block' : 'cidr_block'] = lit(p.value);
  return out;
}

function nsgPeerArgs(peers: RulePeer[], direction: Direction): Record<string, Expression | undefined> {
  const side = direction === 'inbound' ? 'source' : 'destination';
  const asgKey = `${side}_application_security_group_ids`;
  const asgs = peers.filter((p) => p.src?.field === asgKey);
  const prefixes = peers.filter((p) => p.src?.field !== asgKey);
  const value = (p: RulePeer): Expression =>
    p.src && p.src.field.startsWith(`${side}_address_prefix`) && p.src.expr.kind !== 'list'
      ? p.src.expr
      : lit('value' in p ? p.value : '*');
  return {
    [`${side}_address_prefix`]: prefixes.length === 1 ? value(prefixes[0]) : undefined,
    [`${side}_address_prefixes`]: prefixes.length > 1 ? list(prefixes.map(value)) : undefined,
    [asgKey]: list(asgs.map((p) => p.src!.expr)),
  };
}

const AZURE_PROTOCOL = { tcp: 'Tcp', udp: 'Udp', icmp: 'Icmp', all: '*' } as const;

// ------------------------------------------------------------ new rules

function awsPortArgs(
  d: Pick<RuleDraft, 'protocol' | 'fromPort' | 'toPort'>,
  protoKey: string,
  vpcRule: boolean,
): Record<string, Expression | undefined> {
  if (d.protocol === 'all') {
    return vpcRule
      ? { [protoKey]: lit('-1'), from_port: undefined, to_port: undefined }
      : { from_port: lit(0), to_port: lit(0), [protoKey]: lit('-1') };
  }
  if (d.protocol === 'icmp') return { from_port: lit(-1), to_port: lit(-1), [protoKey]: lit('icmp') };
  return { from_port: lit(d.fromPort ?? 0), to_port: lit(d.toPort ?? 65535), [protoKey]: lit(d.protocol) };
}

function naclPortArgs(d: Pick<RuleDraft, 'protocol' | 'fromPort' | 'toPort'>) {
  const icmp = d.protocol === 'icmp';
  const ports = d.protocol === 'tcp' || d.protocol === 'udp';
  return {
    protocol: lit(d.protocol === 'all' ? '-1' : d.protocol),
    from_port: lit(ports ? (d.fromPort ?? 0) : 0),
    to_port: lit(ports ? (d.toPort ?? 65535) : 0),
    // type/code default to 0 (echo reply) — -1 lets every ICMP message through, ping included
    icmp_type: icmp ? lit(-1) : undefined,
    icmp_code: icmp ? lit(-1) : undefined,
  };
}

function azurePort(d: Pick<RuleDraft, 'protocol' | 'fromPort' | 'toPort'>) {
  if (d.protocol === 'icmp' || d.fromPort === null || d.toPort === null) return '*';
  return portText(d.fromPort, d.toPort);
}

function newBody(ir: IR, owner: ResourceNode, direction: Direction, d: RuleDraft): Record<string, Expression> {
  const kind = OWNER_TYPES[owner.type];
  const clean = (b: Record<string, Expression | undefined>) => assign({}, b);
  switch (kind) {
    case 'sg':
      return clean({
        description: d.description ? lit(d.description) : undefined,
        ...awsPortArgs(d, 'protocol', false),
        ...awsPeerArgs(d.peers, 'inline', owner.id),
      });
    case 'nacl':
      return clean({
        rule_no: lit(d.priority ?? nextPriority(ir, owner, direction)),
        action: lit(d.action ?? 'allow'),
        ...naclPortArgs(d),
        ...naclPeerArgs(d.peers),
      });
    case 'nsg': {
      const side = nsgPeerArgs(d.peers, direction);
      return clean({
        name: lit(uniqueNsgName(ir, owner, d.description ?? `rule-${d.priority ?? 100}`)),
        priority: lit(d.priority ?? nextPriority(ir, owner, direction)),
        direction: lit(direction === 'inbound' ? 'Inbound' : 'Outbound'),
        access: lit(d.action === 'deny' ? 'Deny' : 'Allow'),
        protocol: lit(AZURE_PROTOCOL[d.protocol]),
        source_port_range: lit('*'),
        destination_port_range: lit(azurePort(d)),
        source_address_prefix: direction === 'inbound' ? undefined : lit('*'),
        destination_address_prefix: direction === 'inbound' ? lit('*') : undefined,
        ...side,
      });
    }
    case 'firewall':
      return clean({
        protocol: lit(d.protocol),
        ports: (d.protocol === 'tcp' || d.protocol === 'udp') && d.fromPort !== null && d.toPort !== null ? list([lit(portText(d.fromPort, d.toPort))]) : undefined,
      });
  }
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'rule';
}

/** canvas position of a node, adding up its containers' offsets */
function absolutePosition(ir: IR, node: ResourceNode) {
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  let x = node.position?.x ?? 0;
  let y = node.position?.y ?? 0;
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  for (let depth = 0; parent && depth < 12; depth++) {
    x += parent.position?.x ?? 0;
    y += parent.position?.y ?? 0;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return { x, y };
}

function newRuleResource(ir: IR, owner: ResourceNode, type: string, direction: Direction, d: RuleDraft): ResourceNode {
  const inbound = direction === 'inbound';
  const ownerRef = (attr: string) => ref(`${owner.id}.${attr}`);
  let args: Record<string, Expression | undefined>;
  switch (type) {
    case 'aws_vpc_security_group_ingress_rule':
    case 'aws_vpc_security_group_egress_rule':
      args = {
        security_group_id: ownerRef('id'),
        description: d.description ? lit(d.description) : undefined,
        ...awsPortArgs(d, 'ip_protocol', true),
        ...awsPeerArgs(d.peers, 'vpc_rule', owner.id),
      };
      break;
    case 'aws_security_group_rule':
      args = {
        type: lit(inbound ? 'ingress' : 'egress'),
        security_group_id: ownerRef('id'),
        description: d.description ? lit(d.description) : undefined,
        ...awsPortArgs(d, 'protocol', false),
        ...awsPeerArgs(d.peers, 'sg_rule', owner.id),
      };
      break;
    case 'aws_network_acl_rule': {
      const { protocol, ...ports } = naclPortArgs(d);
      args = {
        network_acl_id: ownerRef('id'),
        rule_number: lit(d.priority ?? nextPriority(ir, owner, direction)),
        egress: lit(!inbound),
        protocol,
        rule_action: lit(d.action ?? 'allow'),
        ...naclPeerArgs(d.peers),
        ...ports,
      };
      break;
    }
    default: {
      const body = newBody(ir, owner, direction, d);
      args = {
        ...body,
        resource_group_name: owner.args.resource_group_name,
        network_security_group_name: ownerRef('name'),
      };
    }
  }
  const taken = new Set(ir.resources.map((r) => r.id));
  const stem = `${owner.name}_${slug(d.description ?? d.protocol)}${inbound ? '' : '_out'}`;
  let name = stem;
  for (let i = 2; taken.has(resourceAddress(type, name)); i++) name = `${stem}_${i}`;
  const pos = absolutePosition(ir, owner);
  const siblings = standaloneRules(ir, owner).length;
  return {
    id: resourceAddress(type, name),
    provider: owner.provider,
    type,
    name,
    args: assign({}, args),
    position: { x: pos.x + 260, y: pos.y + 90 * siblings },
    trivia: { leadingComments: [] },
  };
}

/**
 * A new rule from a preset, with a safe default source: only HTTP / HTTPS start
 * open to the internet; admin, database and "all" presets start on the
 * network's private range — or a placeholder private range when it is unknown.
 */
export function presetDraft(
  ir: IR,
  owner: ResourceNode,
  direction: Direction,
  presetId: string,
): { draft: RuleDraft; placeholder: boolean } {
  const p = PRESETS.find((x) => x.id === presetId) ?? PRESETS[0];
  const kind = OWNER_TYPES[owner.type];
  const range = privateRangeOf(ir, owner);
  let placeholder = false;
  let peer: RulePeer;
  if (direction === 'outbound' || PUBLIC_PRESETS.has(p.id)) peer = kind === 'nsg' ? { kind: 'any', value: '*' } : { kind: 'any', value: '0.0.0.0/0' };
  else if (range) peer = range[0] === 'VirtualNetwork' ? { kind: 'other', value: range[0] } : { kind: 'cidr', value: range[0] };
  else {
    peer = { kind: 'cidr', value: PLACEHOLDER_CIDR };
    placeholder = true;
  }
  return {
    draft: {
      protocol: p.protocol,
      fromPort: p.fromPort,
      toPort: p.toPort,
      peers: [peer],
      description: p.label,
      action: 'allow',
      priority: kind === 'nacl' || kind === 'nsg' ? nextPriority(ir, owner, direction) : undefined,
    },
    placeholder,
  };
}

/** Add a rule in the owner's existing style: an inline block, or a standalone rule resource. */
export function addRuleOps(ir: IR, owner: ResourceNode, direction: Direction, draft: RuleDraft): Op[] {
  const style = ruleStyle(ir, owner, direction);
  if (style.mode === 'blocked') return [];
  if (style.mode === 'resource') return [{ kind: 'add_resource', node: newRuleResource(ir, owner, style.type, direction, draft) }];
  const bodies = blocksOf(owner.args[style.field]);
  return [setBlocks(owner, style.field, [...bodies, newBody(ir, owner, direction, draft)])];
}

// ------------------------------------------------------------ edit / remove

type Flavor = 'sg' | 'sg_rule' | 'vpc_rule' | 'nacl' | 'nacl_rule' | 'nsg' | 'firewall';

function flavorOf(ir: IR, rule: SecurityRule): Flavor {
  if (rule.origin.kind === 'inline') return rule.ownerKind;
  const type = ir.resources.find((r) => r.id === (rule.origin as { id: string }).id)?.type ?? '';
  if (type.startsWith('aws_vpc_security_group_')) return 'vpc_rule';
  if (type === 'aws_security_group_rule') return 'sg_rule';
  if (type === 'aws_network_acl_rule') return 'nacl_rule';
  return 'nsg';
}

const changed = (patch: Partial<RuleDraft>, rule: SecurityRule, key: 'protocol' | 'fromPort' | 'toPort') =>
  key in patch && patch[key] !== rule[key];

function patchBody(
  ir: IR,
  owner: ResourceNode,
  rule: SecurityRule,
  body: Record<string, Expression>,
  patch: Partial<RuleDraft>,
  flavor: Flavor,
): Record<string, Expression> {
  const d = {
    protocol: (patch.protocol ?? rule.protocol) as RuleDraft['protocol'],
    fromPort: 'fromPort' in patch ? (patch.fromPort ?? null) : rule.fromPort,
    toPort: 'toPort' in patch ? (patch.toPort ?? null) : rule.toPort,
  };
  const protocolChanged = changed(patch, rule, 'protocol');
  const portsChanged = protocolChanged || changed(patch, rule, 'fromPort') || changed(patch, rule, 'toPort');
  const updates: Record<string, Expression | undefined> = {};
  const element = rule.origin.element;

  if (flavor === 'sg' || flavor === 'sg_rule' || flavor === 'vpc_rule') {
    const protoKey = flavor === 'vpc_rule' ? 'ip_protocol' : 'protocol';
    if (portsChanged) {
      const ports = awsPortArgs(d, protoKey, flavor === 'vpc_rule');
      if (!protocolChanged) delete ports[protoKey];
      Object.assign(updates, ports);
    }
    if (patch.peers) Object.assign(updates, awsPeerArgs(patch.peers, flavor === 'sg' ? 'inline' : flavor, owner.id));
    if ('description' in patch) updates.description = patch.description ? lit(patch.description) : undefined;
  } else if (flavor === 'nacl' || flavor === 'nacl_rule') {
    if (portsChanged) {
      const ports = naclPortArgs(d);
      Object.assign(updates, protocolChanged ? ports : { ...ports, protocol: body.protocol });
    }
    if (patch.peers) Object.assign(updates, naclPeerArgs(patch.peers));
    if (patch.action) updates[flavor === 'nacl' ? 'action' : 'rule_action'] = lit(patch.action);
    if (patch.priority !== undefined) updates[flavor === 'nacl' ? 'rule_no' : 'rule_number'] = lit(patch.priority);
  } else if (flavor === 'nsg') {
    if (protocolChanged) updates.protocol = lit(AZURE_PROTOCOL[d.protocol]);
    if (portsChanged) {
      const text = azurePort(d);
      const ranges = body.destination_port_ranges;
      if (element && ranges?.kind === 'list') {
        updates.destination_port_ranges = list(ranges.items.map((e, i) => (i === element.index ? lit(text === '*' ? '0-65535' : text) : e)));
      } else {
        updates.destination_port_range = lit(text);
        updates.destination_port_ranges = undefined;
      }
    }
    if (patch.peers) Object.assign(updates, nsgPeerArgs(patch.peers, rule.direction));
    if (patch.action) updates.access = lit(patch.action === 'deny' ? 'Deny' : 'Allow');
    if (patch.priority !== undefined) updates.priority = lit(patch.priority);
    if (patch.description) updates.name = lit(uniqueNsgName(ir, owner, patch.description, rule.id.split('#')[0]));
  } else {
    if (protocolChanged) updates.protocol = lit(d.protocol);
    if (portsChanged) {
      const ports = body.ports;
      const text = (d.protocol === 'tcp' || d.protocol === 'udp') && d.fromPort !== null && d.toPort !== null ? portText(d.fromPort, d.toPort) : undefined;
      if (element && ports?.kind === 'list' && text) updates.ports = list(ports.items.map((e, i) => (i === element.index ? lit(text) : e)));
      else updates.ports = text ? list([lit(text)]) : undefined;
    }
  }
  return assign(body, updates);
}

/** `ingress = [{ … }]` rules: rewriting them would turn the list into blocks */
const isObjectSyntax = (rule: SecurityRule) => rule.origin.kind === 'inline' && rule.origin.syntax === 'object';

function ownerOf(ir: IR, rule: SecurityRule) {
  return ir.resources.find((r) => r.id === rule.owner);
}

/** apply a patch without the read-only guard (fixes only touch peer arguments) */
function patchRule(ir: IR, rule: SecurityRule, patch: Partial<RuleDraft>): Op[] {
  const owner = ownerOf(ir, rule);
  if (!owner) return [];
  const flavor = flavorOf(ir, rule);
  if (rule.origin.kind === 'resource') {
    const node = ir.resources.find((r) => r.id === (rule.origin as { id: string }).id);
    return node ? argOps(node, patchBody(ir, owner, rule, node.args, patch, flavor)) : [];
  }
  const { field, index, element } = rule.origin;
  const bodies = [...blocksOf(owner.args[field])];
  const body = bodies[index];
  if (!body) return [];
  const protocolChanged = changed(patch, rule, 'protocol');
  const toAll = 'fromPort' in patch && patch.fromPort === null;
  if (flavor === 'firewall' && element && (protocolChanged || toAll)) {
    // one port of a shared block changes protocol (or opens up): move it to a block of its own
    const ports = body.ports?.kind === 'list' ? body.ports.items.filter((_, i) => i !== element.index) : [];
    bodies[index] = assign(body, { ports: list(ports) });
    bodies.push(newBody(ir, owner, rule.direction, { ...toDraft(rule), ...patch, peers: [] }));
    return [setBlocks(owner, field, bodies)];
  }
  bodies[index] = patchBody(ir, owner, rule, body, patch, flavor);
  return [setBlocks(owner, field, bodies)];
}

/** Rewrite only what `patch` changes. Rows with unmodeled expressions are left alone. */
export function updateRuleOps(ir: IR, rule: SecurityRule, patch: Partial<RuleDraft>): Op[] {
  if (rule.unmodeled?.length) return [];
  return patchRule(ir, rule, patch);
}

/**
 * Remove one rule row: just its element of a shared port list, its block, or its
 * resource. null when that would leave an invalid resource (a GCP firewall
 * needs at least one allow / deny block — delete the firewall instead).
 */
export function removeRuleOps(ir: IR, rule: SecurityRule): Op[] | null {
  const owner = ownerOf(ir, rule);
  if (!owner || isObjectSyntax(rule)) return null;
  const element = rule.origin.element;
  if (element && element.count > 1) return removeElementsOps(ir, rule, [element.index]);
  return removeBlockOps(ir, rule);
}

/**
 * Drop some elements of a shared port list (GCP `ports`, Azure
 * `destination_port_ranges`) and keep the rest as they are.
 */
export function removeElementsOps(ir: IR, rule: SecurityRule, indices: number[]): Op[] | null {
  const owner = ownerOf(ir, rule);
  const element = rule.origin.element;
  if (!owner || !element || isObjectSyntax(rule) || indices.length === 0 || indices.length >= element.count) return null;
  const target = rule.origin.kind === 'resource' ? ir.resources.find((r) => r.id === (rule.origin as { id: string }).id) : undefined;
  const origin = rule.origin as { field: string; index: number };
  const body = target ? target.args : blocksOf(owner.args[origin.field])[origin.index];
  const items = body?.[element.field];
  if (!body || items?.kind !== 'list') return null;
  const next = assign(body, { [element.field]: list(items.items.filter((_, i) => !indices.includes(i))) });
  if (target) return argOps(target, next);
  const bodies = [...blocksOf(owner.args[origin.field])];
  bodies[origin.index] = next;
  return [setBlocks(owner, origin.field, bodies)];
}

function removeBlockOps(ir: IR, rule: SecurityRule): Op[] | null {
  const owner = ownerOf(ir, rule);
  if (!owner) return null;
  if (rule.origin.kind === 'resource') return [{ kind: 'remove_resource', nodeId: rule.origin.id }];
  const { field, index } = rule.origin;
  const bodies = blocksOf(owner.args[field]).filter((_, i) => i !== index);
  if (rule.ownerKind === 'firewall' && bodies.length === 0 && blocksOf(owner.args[field === 'allow' ? 'deny' : 'allow']).length === 0) {
    return null;
  }
  return [setBlocks(owner, field, bodies)];
}

export function toDraft(rule: SecurityRule): RuleDraft {
  const protocol = (['tcp', 'udp', 'icmp', 'all'].includes(rule.protocol) ? rule.protocol : 'tcp') as RuleDraft['protocol'];
  return {
    protocol,
    fromPort: rule.fromPort,
    toPort: rule.toPort,
    peers: rule.peers,
    description: rule.description,
    action: rule.action,
    priority: rule.priority,
  };
}

// ------------------------------------------------------------ restrict (one-click fix)

const vpcCidr = (ir: IR, owner: ResourceNode) => {
  const vpc = ir.resources.find((r) => r.id === refOf(owner.args.vpc_id));
  const cidr = vpc?.args.cidr_block;
  return cidr?.kind === 'literal' && typeof cidr.value === 'string' && parseCidr(cidr.value) ? cidr.value : undefined;
};

/** the owner's private network range(s), when the config says what they are */
export function privateRangeOf(ir: IR, owner: ResourceNode): string[] | undefined {
  const kind = OWNER_TYPES[owner.type];
  if (kind === 'nsg') return ['VirtualNetwork'];
  if (kind === 'sg' || kind === 'nacl') {
    const cidr = vpcCidr(ir, owner);
    return cidr ? [cidr] : undefined;
  }
  const net = refOf(owner.args.network);
  const ranges = ir.resources.flatMap((r) => {
    const cidr = r.args.ip_cidr_range;
    return r.type === 'google_compute_subnetwork' && refOf(r.args.network) === net && cidr?.kind === 'literal' ? [String(cidr.value)] : [];
  });
  if (ranges.length) return ranges;
  const network = ir.resources.find((r) => r.id === net);
  const auto = network?.args.auto_create_subnetworks;
  // auto-mode VPCs carve every regional subnet out of 10.128.0.0/9
  if (network && (auto === undefined || (auto.kind === 'literal' && auto.value === true))) return ['10.128.0.0/9'];
  return undefined;
}

const PEER_FIELDS = /cidr|prefix|security_group|self|source_ranges|address/;

/**
 * Take the internet out of a rule's sources: IPv4 "anywhere" becomes the
 * network's private range, IPv6 "anywhere" is dropped (a rule left with no
 * source is removed). null when the private range is unknown or the result
 * would still be open.
 */
export function restrictRuleOps(ir: IR, rule: SecurityRule, locale: Locale = currentLocale()): { label: string; ops: Op[] } | null {
  const owner = ownerOf(ir, rule);
  if (!owner || isObjectSyntax(rule) || rule.unmodeled?.some((f) => PEER_FIELDS.test(f))) return null;
  const families = internetFamilies(rule);
  if (families.length === 0) return null;
  let keep = rule.peers.filter((p) => p.kind !== 'any' && !(p.kind === 'cidr' && (parseCidr(p.value)?.prefix ?? 99) < 8));
  for (const family of families) {
    // CIDRs that still add up to the whole internet: drop the widest until they don't
    while (coversFamily(keep.flatMap((p) => (p.kind === 'cidr' ? [p.value] : [])), family)) {
      const widest = keep
        .filter((p) => p.kind === 'cidr' && cidrFamily(p.value) === family)
        .sort((a, b) => (parseCidr((a as { value: string }).value)!.prefix - parseCidr((b as { value: string }).value)!.prefix))[0];
      keep = keep.filter((p) => p !== widest);
    }
  }
  const range = privateRangeOf(ir, owner);
  const needsRange = families.includes('ipv4') || rule.ownerKind === 'nsg' || rule.ownerKind === 'firewall';
  if (needsRange && !range) {
    // IPv4 (or a whole-network source) must go somewhere; nothing to restrict to
    if (keep.length === 0 || rule.ownerKind === 'nacl') return null;
  }
  const added: RulePeer[] =
    needsRange && range && !(rule.ownerKind === 'nsg' && keep.length > 0)
      ? range.map((value) => (value === 'VirtualNetwork' ? { kind: 'other', value } : { kind: 'cidr', value }))
      : [];
  const peers = [...keep, ...added.filter((a) => !keep.some((k) => 'value' in k && 'value' in a && k.value === a.value))];
  const m = messagesFor(editMessages, locale);
  const label = added.length
    ? range![0] === 'VirtualNetwork'
      ? m.restrictToVnet
      : m.restrictTo(range!.join(', '))
    : peers.length
      ? m.removeAccess(families.includes('ipv6') && !families.includes('ipv4'))
      : m.removeRule;


  if (rule.ownerKind === 'firewall') {
    if (peers.length === 0) return null;
    const ranges = peers.filter((p) => p.src?.field === 'source_ranges' || p.kind === 'cidr' || p.kind === 'expr' || p.kind === 'other');
    const onlyRanges = ranges.filter((p) => p.kind !== 'tag' && p.src?.field !== 'source_service_accounts');
    const value = list(onlyRanges.map((p) => p.src?.expr ?? lit((p as { value: string }).value)));
    const field = rule.direction === 'inbound' ? 'source_ranges' : 'destination_ranges';
    const hasOtherSources = rule.direction === 'inbound' && (owner.args.source_tags || owner.args.source_service_accounts);
    if (!value && !hasOtherSources) return null;
    return {
      label,
      ops: [value ? { kind: 'set_arg', nodeId: owner.id, field, value } : { kind: 'unset_arg', nodeId: owner.id, field }],
    };
  }
  if (peers.length === 0) {
    const ops = removeBlockOps(ir, rule);
    return ops ? { label, ops } : null;
  }
  return { label, ops: patchRule(ir, rule, { peers }) };
}
