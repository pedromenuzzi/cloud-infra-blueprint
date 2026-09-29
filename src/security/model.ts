/**
 * Security model: every firewall-ish construct across clouds, normalized.
 *
 *   AWS    aws_security_group / aws_default_security_group (inline ingress/egress),
 *          aws_vpc_security_group_*_rule, aws_security_group_rule,
 *          aws_network_acl / aws_default_network_acl (inline), aws_network_acl_rule
 *   Azure  azurerm_network_security_group (inline security_rule), azurerm_network_security_rule
 *   GCP    google_compute_firewall (allow / deny blocks)
 *
 * Pure functions over the IR — the canvas lens, the rules editor and the
 * audit all read from here. What can't be evaluated (expressions, dynamic
 * blocks) is kept visible instead of guessed: `portsExpr` / `unmodeled` on a
 * rule, `hidden` on its owner.
 */
import { exprPreview, refTargetAddress } from '@/ir/expr';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { coversFamily, parseCidr, type IpFamily } from './cidr';

export type { IpFamily } from './cidr';
export type Direction = 'inbound' | 'outbound';
export type OwnerKind = 'sg' | 'nacl' | 'nsg' | 'firewall';

/** where a peer was read from, so an edit can write the exact expression back */
export interface PeerSource {
  field: string;
  expr: Expression;
}

export type RulePeer = (
  | { kind: 'any'; value: string; implicit?: boolean }
  | { kind: 'cidr'; value: string }
  | { kind: 'group'; ref: string }
  | { kind: 'self' }
  | { kind: 'tag'; value: string }
  /** service tags, prefix lists, service accounts, literal ids */
  | { kind: 'other'; value: string }
  /** an expression we can't resolve (var.allowed_cidrs…) — could be anything */
  | { kind: 'expr'; value: string }
) & { src?: PeerSource };

/** one element of a list that the model splits into rows (GCP ports, Azure port ranges) */
export interface RuleElement {
  field: string;
  index: number;
  count: number;
}

export type RuleOrigin =
  | { kind: 'inline'; field: string; index: number; element?: RuleElement; syntax?: 'object' }
  | { kind: 'resource'; id: string; element?: RuleElement };

export interface SecurityRule {
  id: string;
  owner: string;
  ownerKind: OwnerKind;
  direction: Direction;
  action: 'allow' | 'deny';
  /** tcp | udp | icmp | all | <other>; '?' when written as an expression */
  protocol: string;
  /** inclusive port range; null = every port (or not applicable, e.g. icmp) */
  fromPort: number | null;
  toPort: number | null;
  /** set when ports / protocol are expressions we can't evaluate (var.port…) */
  portsExpr?: string;
  /** sources for inbound rules, destinations for outbound */
  peers: RulePeer[];
  priority?: number;
  description?: string;
  /** has no effect (disabled GCP firewall) */
  disabled?: boolean;
  /** arguments the editor can't rewrite faithfully — the row is edit-in-code only */
  unmodeled?: string[];
  origin: RuleOrigin;
}

/** rules an owner defines in a way the model can't read */
export interface HiddenRules {
  directions: Direction[];
  reason: string;
}

export const OWNER_TYPES: Record<string, OwnerKind> = {
  aws_security_group: 'sg',
  aws_default_security_group: 'sg',
  aws_network_acl: 'nacl',
  aws_default_network_acl: 'nacl',
  azurerm_network_security_group: 'nsg',
  google_compute_firewall: 'firewall',
};

export const SG_TYPES = new Set(['aws_security_group', 'aws_default_security_group']);

/** standalone rule resources (they point at their SG / NACL / NSG) */
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

/** nested-block bodies of an argument — `x { }` blocks and `x = [{ … }]` objects */
export function blocksOf(e: Expression | undefined): Array<Record<string, Expression>> {
  if (!e) return [];
  if (e.kind === 'block') return [e.body];
  if (e.kind === 'blocks') return e.items;
  if (e.kind === 'list') return e.items.flatMap((i) => (i.kind === 'object' ? [i.fields] : []));
  return [];
}

function str(e: Expression | undefined): string | undefined {
  if (e?.kind === 'literal' && e.value !== null) return String(e.value);
  return undefined;
}

function num(e: Expression | undefined): number | undefined {
  if (e?.kind !== 'literal' || e.value === null || e.value === '') return undefined;
  const n = typeof e.value === 'number' ? e.value : Number(e.value);
  return Number.isFinite(n) ? n : undefined;
}

const isLit = (e: Expression | undefined) => e?.kind === 'literal';

/** `aws_security_group.web.id`, `aws_security_group.web[0].id` → `aws_security_group.web` */
export function refOf(e: Expression | undefined): string | undefined {
  if (e?.kind !== 'ref') return undefined;
  return refTargetAddress(e.path)?.replace(/\[.*$/, '') ?? undefined;
}

const ANY = new Set(['0.0.0.0/0', '::/0', '*', 'internet', 'any', '0.0.0.0']);

export function peerFromText(value: string): RulePeer {
  if (ANY.has(value.toLowerCase())) return { kind: 'any', value };
  return parseCidr(value) ? { kind: 'cidr', value } : { kind: 'other', value };
}

/** address families an "anywhere" peer stands for */
export function peerFamilies(p: RulePeer): IpFamily[] {
  if (p.kind !== 'any') return [];
  if (p.value === '0.0.0.0/0' || p.value === '0.0.0.0') return ['ipv4'];
  if (p.value === '::/0') return ['ipv6'];
  return ['ipv4', 'ipv6'];
}

/** families of the whole internet a rule admits: "anywhere" peers, or CIDRs that add up to it */
export function internetFamilies(rule: Pick<SecurityRule, 'peers'>): IpFamily[] {
  const out = new Set(rule.peers.flatMap(peerFamilies));
  const cidrs = rule.peers.flatMap((p) => (p.kind === 'cidr' ? [p.value] : []));
  for (const family of ['ipv4', 'ipv6'] as const) if (!out.has(family) && coversFamily(cidrs, family)) out.add(family);
  return [...out];
}

export function fromInternet(rule: Pick<SecurityRule, 'peers'>): boolean {
  return internetFamilies(rule).length > 0;
}

/** the peers that make a rule internet-wide, as written ("0.0.0.0/0", "Internet"…) */
export function internetSources(rule: Pick<SecurityRule, 'peers'>): string[] {
  const any = rule.peers.flatMap((p) => (p.kind === 'any' ? [p.value] : []));
  const cidrs = rule.peers.flatMap((p) => (p.kind === 'cidr' ? [p.value] : []));
  const wide = (['ipv4', 'ipv6'] as const).some((f) => coversFamily(cidrs, f)) ? cidrs : [];
  return [...any, ...wide];
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
  if (from <= 0 && to >= 65535) return { from: null, to: null };
  return { from, to };
}

interface Ctx {
  byId: Map<string, ResourceNode>;
}

/** CIDR behind `aws_vpc.main.cidr_block` / `aws_subnet.x.cidr_block` when it is a literal */
function resolveCidrRef(ctx: Ctx, e: Expression): string | undefined {
  if (e.kind !== 'ref') return undefined;
  const target = refOf(e);
  const attr = e.path.split('.').pop();
  if (!target || (attr !== 'cidr_block' && attr !== 'ip_cidr_range')) return undefined;
  const node = ctx.byId.get(target);
  return str(node?.args[attr]);
}

type PeerMode = 'cidr' | 'group' | 'label';

function peerOf(ctx: Ctx, item: Expression, field: string, mode: PeerMode, owner: string): RulePeer {
  const src = { field, expr: item };
  const text = str(item);
  if (text !== undefined) {
    if (mode === 'cidr') return { ...peerFromText(text), src };
    return { kind: 'other', value: text, src };
  }
  if (item.kind === 'ref') {
    const target = refOf(item);
    if (mode === 'group' && target && SG_TYPES.has(ctx.byId.get(target)?.type ?? '')) {
      return target === owner ? { kind: 'self', src } : { kind: 'group', ref: target, src };
    }
    if (mode === 'cidr') {
      const cidr = resolveCidrRef(ctx, item);
      if (cidr) return { ...peerFromText(cidr), src };
    }
    if (mode === 'label') return { kind: 'other', value: item.path, src };
  }
  return { kind: 'expr', value: exprPreview(item), src };
}

/** peers from a list argument; a whole-list expression is kept as one unresolved peer */
function listPeers(
  ctx: Ctx,
  body: Record<string, Expression>,
  field: string,
  mode: PeerMode,
  owner: string,
  unmodeled: string[],
): RulePeer[] {
  const e = body[field];
  if (!e) return [];
  if (e.kind === 'list') return e.items.map((i) => peerOf(ctx, i, field, mode, owner));
  if (e.kind === 'literal') return e.value === null ? [] : [peerOf(ctx, e, field, mode, owner)];
  unmodeled.push(field);
  return [{ kind: 'expr', value: exprPreview(e), src: { field, expr: e } }];
}

function singlePeer(ctx: Ctx, body: Record<string, Expression>, field: string, mode: PeerMode, owner: string): RulePeer[] {
  const e = body[field];
  if (!e || (e.kind === 'literal' && e.value === null)) return [];
  return [peerOf(ctx, e, field, mode, owner)];
}

function noteExpr(body: Record<string, Expression>, keys: string[], unmodeled: string[]) {
  for (const k of keys) if (body[k] !== undefined && !isLit(body[k])) unmodeled.push(k);
}

function protocolOf(e: Expression | undefined, unmodeled: string[], key: string): { protocol: string; expr?: string } {
  if (e === undefined || isLit(e)) return { protocol: normalizeProtocol(str(e)) };
  unmodeled.push(key);
  return { protocol: '?', expr: exprPreview(e) };
}

/** AWS from_port / to_port (ICMP type / code for icmp; ignored for "-1") */
function awsPorts(
  body: Record<string, Expression>,
  protocol: string,
  unmodeled: string[],
): { fromPort: number | null; toPort: number | null; portsExpr?: string } {
  if (protocol === 'all' || protocol === 'icmp') return { fromPort: null, toPort: null };
  const fromE = body.from_port;
  const toE = body.to_port;
  const from = num(fromE);
  const to = num(toE);
  if ((fromE && from === undefined) || (toE && to === undefined)) {
    if (fromE && from === undefined) unmodeled.push('from_port');
    if (toE && to === undefined) unmodeled.push('to_port');
    const fromText = exprPreview(fromE);
    const toText = exprPreview(toE);
    return { fromPort: null, toPort: null, portsExpr: fromText === toText || !toE ? fromText : `${fromText}-${toText}` };
  }
  if (from === undefined || to === undefined) return { fromPort: null, toPort: null };
  if (from === -1 || (from <= 0 && to >= 65535)) return { fromPort: null, toPort: null };
  return { fromPort: from, toPort: to };
}

/** where an owner's inline rules live: static blocks, `x = [{…}]` objects, or something unreadable */
function inlineBodies(
  r: ResourceNode,
  field: string,
): { bodies: Array<Record<string, Expression>>; syntax?: 'object'; hidden: string[] } {
  const hidden: string[] = [];
  if (Object.keys(r.args).some((k) => k.startsWith(`dynamic "${field}"`))) hidden.push(`dynamic "${field}" blocks`);
  const e = r.args[field];
  if (!e) return { bodies: [], hidden };
  if (e.kind === 'block' || e.kind === 'blocks') return { bodies: blocksOf(e), hidden };
  if (e.kind === 'list') {
    if (e.items.some((i) => i.kind !== 'object')) hidden.push(`${field} = ${exprPreview(e)}`);
    return { bodies: blocksOf(e), syntax: 'object', hidden };
  }
  if (e.kind === 'literal' && e.value === null) return { bodies: [], hidden };
  hidden.push(`${field} = ${exprPreview(e)}`);
  return { bodies: [], hidden };
}

// ------------------------------------------------------------------ rules

interface Out {
  rules: SecurityRule[];
  hidden: Map<string, HiddenRules[]>;
}

function hide(out: Out, owner: string, directions: Direction[], reason: string) {
  out.hidden.set(owner, [...(out.hidden.get(owner) ?? []), { directions, reason }]);
}

function withUnmodeled(rule: SecurityRule, unmodeled: string[]): SecurityRule {
  const list = [...new Set(unmodeled)];
  return list.length ? { ...rule, unmodeled: list } : rule;
}

function awsSgRule(
  ctx: Ctx,
  body: Record<string, Expression>,
  owner: string,
  base: Pick<SecurityRule, 'id' | 'direction' | 'origin'>,
  flavor: 'inline' | 'sg_rule' | 'vpc_rule',
): SecurityRule {
  const unmodeled: string[] = [];
  const { protocol, expr } = protocolOf(body[flavor === 'vpc_rule' ? 'ip_protocol' : 'protocol'], unmodeled, 'protocol');
  const ports = awsPorts(body, protocol, unmodeled);
  const peers =
    flavor === 'vpc_rule'
      ? [
          ...singlePeer(ctx, body, 'cidr_ipv4', 'cidr', owner),
          ...singlePeer(ctx, body, 'cidr_ipv6', 'cidr', owner),
          ...singlePeer(ctx, body, 'prefix_list_id', 'label', owner),
          ...singlePeer(ctx, body, 'referenced_security_group_id', 'group', owner),
        ]
      : [
          ...listPeers(ctx, body, 'cidr_blocks', 'cidr', owner, unmodeled),
          ...listPeers(ctx, body, 'ipv6_cidr_blocks', 'cidr', owner, unmodeled),
          ...(flavor === 'inline'
            ? listPeers(ctx, body, 'security_groups', 'group', owner, unmodeled)
            : singlePeer(ctx, body, 'source_security_group_id', 'group', owner)),
          ...listPeers(ctx, body, 'prefix_list_ids', 'label', owner, unmodeled),
        ];
  if (body.self?.kind === 'literal' && body.self.value === true) peers.push({ kind: 'self', src: { field: 'self', expr: body.self } });
  noteExpr(body, ['self', 'description'], unmodeled);
  return withUnmodeled(
    {
      ...base,
      owner,
      ownerKind: 'sg',
      action: 'allow',
      protocol,
      ...ports,
      ...(expr ? { portsExpr: expr } : {}),
      peers,
      description: str(body.description),
    },
    unmodeled,
  );
}

function awsNaclRule(
  ctx: Ctx,
  body: Record<string, Expression>,
  owner: string,
  base: Pick<SecurityRule, 'id' | 'direction' | 'origin'>,
  keys: { number: string; action: string },
): SecurityRule {
  const unmodeled: string[] = [];
  const { protocol, expr } = protocolOf(body.protocol, unmodeled, 'protocol');
  noteExpr(body, [keys.number, keys.action], unmodeled);
  return withUnmodeled(
    {
      ...base,
      owner,
      ownerKind: 'nacl',
      action: str(body[keys.action])?.toLowerCase() === 'deny' ? 'deny' : 'allow',
      protocol,
      ...awsPorts(body, protocol, unmodeled),
      ...(expr ? { portsExpr: expr } : {}),
      peers: [...singlePeer(ctx, body, 'cidr_block', 'cidr', owner), ...singlePeer(ctx, body, 'ipv6_cidr_block', 'cidr', owner)],
      priority: num(body[keys.number]),
    },
    unmodeled,
  );
}

function awsInline(ctx: Ctx, r: ResourceNode, kind: 'sg' | 'nacl', out: Out) {
  for (const [field, direction] of [['ingress', 'inbound'], ['egress', 'outbound']] as const) {
    const { bodies, syntax, hidden } = inlineBodies(r, field);
    for (const reason of hidden) hide(out, r.id, [direction], reason);
    bodies.forEach((body, index) => {
      const base = {
        id: `${r.id}:${field}:${index}`,
        direction,
        origin: { kind: 'inline' as const, field, index, ...(syntax ? { syntax } : {}) },
      };
      const rule =
        kind === 'sg'
          ? awsSgRule(ctx, body, r.id, base, 'inline')
          : awsNaclRule(ctx, body, r.id, base, { number: 'rule_no', action: 'action' });
      out.rules.push(syntax ? { ...rule, unmodeled: [...(rule.unmodeled ?? []), `${field} = [ … ]`] } : rule);
    });
  }
}

function azureRules(ctx: Ctx, body: Record<string, Expression>, owner: string, id: string, origin: RuleOrigin): SecurityRule[] {
  const unmodeled: string[] = [];
  noteExpr(body, ['direction', 'access', 'priority', 'name'], unmodeled);
  const direction: Direction = str(body.direction)?.toLowerCase() === 'outbound' ? 'outbound' : 'inbound';
  const side = direction === 'inbound' ? 'source' : 'destination';
  const peers = [
    ...singlePeer(ctx, body, `${side}_address_prefix`, 'cidr', owner),
    ...listPeers(ctx, body, `${side}_address_prefixes`, 'cidr', owner, unmodeled),
    ...listPeers(ctx, body, `${side}_application_security_group_ids`, 'label', owner, unmodeled),
  ];
  const { protocol, expr } = protocolOf(body.protocol, unmodeled, 'protocol');
  const base: SecurityRule = {
    id,
    owner,
    ownerKind: 'nsg',
    direction,
    action: str(body.access)?.toLowerCase() === 'deny' ? 'deny' : 'allow',
    protocol,
    fromPort: null,
    toPort: null,
    ...(expr ? { portsExpr: expr } : {}),
    peers,
    priority: num(body.priority),
    description: str(body.name) ?? str(body.description),
    origin,
  };
  const row = (e: Expression, element?: RuleElement): SecurityRule => {
    const text = str(e);
    const range = text !== undefined ? parsePortRange(text) : undefined;
    const rowUnmodeled = range ? unmodeled : [...unmodeled, element?.field ?? 'destination_port_range'];
    return withUnmodeled(
      {
        ...base,
        id: element ? `${id}#${element.index}` : id,
        fromPort: range?.from ?? null,
        toPort: range?.to ?? null,
        ...(range ? {} : { portsExpr: base.portsExpr ?? text ?? exprPreview(e) }),
        origin: element ? { ...origin, element } : origin,
      },
      rowUnmodeled,
    );
  };
  const rows: SecurityRule[] = [];
  if (body.destination_port_range) rows.push(row(body.destination_port_range));
  const ranges = body.destination_port_ranges;
  if (ranges?.kind === 'list') {
    const field = 'destination_port_ranges';
    const count = ranges.items.length;
    ranges.items.forEach((e, index) => rows.push(row(e, count > 1 ? { field, index, count } : undefined)));
  } else if (ranges) rows.push(row(ranges));
  return rows.length ? rows : [withUnmodeled(base, unmodeled)];
}

const IMPLICIT_ANY: RulePeer = { kind: 'any', value: '0.0.0.0/0', implicit: true };

function gcpFirewall(ctx: Ctx, r: ResourceNode, out: Out) {
  const a = r.args;
  const has = (k: string) => a[k] !== undefined && !(a[k].kind === 'list' && a[k].items.length === 0);
  const unmodeled: string[] = [];
  noteExpr(a, ['direction', 'priority', 'disabled'], unmodeled);
  const direction: Direction = str(a.direction)?.toUpperCase() === 'EGRESS' ? 'outbound' : 'inbound';
  let peers: RulePeer[];
  if (direction === 'inbound') {
    peers = [
      ...listPeers(ctx, a, 'source_ranges', 'cidr', r.id, unmodeled),
      ...listPeers(ctx, a, 'source_tags', 'label', r.id, unmodeled).map((p): RulePeer =>
        p.kind === 'other' ? { kind: 'tag', value: p.value, src: p.src } : p,
      ),
      ...listPeers(ctx, a, 'source_service_accounts', 'label', r.id, unmodeled),
    ];
    // GCP: an ingress rule with no source at all applies to 0.0.0.0/0
    if (!has('source_ranges') && !has('source_tags') && !has('source_service_accounts')) peers = [IMPLICIT_ANY];
  } else {
    peers = listPeers(ctx, a, 'destination_ranges', 'cidr', r.id, unmodeled);
    if (!has('destination_ranges')) peers = [IMPLICIT_ANY];
  }
  const disabled = a.disabled?.kind === 'literal' && a.disabled.value === true;
  const priority = a.priority === undefined ? 1000 : num(a.priority);
  for (const action of ['allow', 'deny'] as const) {
    const { bodies, hidden } = inlineBodies(r, action);
    for (const reason of hidden) hide(out, r.id, [direction], reason);
    bodies.forEach((body, index) => {
      const rowUnmodeled = [...unmodeled];
      const { protocol, expr } = protocolOf(body.protocol, rowUnmodeled, 'protocol');
      const base: SecurityRule = {
        id: `${r.id}:${action}:${index}`,
        owner: r.id,
        ownerKind: 'firewall',
        direction,
        action,
        protocol,
        fromPort: null,
        toPort: null,
        ...(expr ? { portsExpr: expr } : {}),
        peers,
        priority,
        description: str(a.description),
        ...(disabled ? { disabled } : {}),
        origin: { kind: 'inline', field: action, index },
      };
      const ports = body.ports;
      if (!ports || protocol === 'all') {
        out.rules.push(withUnmodeled(base, rowUnmodeled));
        return;
      }
      if (ports.kind !== 'list') {
        out.rules.push(withUnmodeled({ ...base, portsExpr: base.portsExpr ?? exprPreview(ports) }, [...rowUnmodeled, 'ports']));
        return;
      }
      const count = ports.items.length;
      ports.items.forEach((e, i) => {
        const text = str(e);
        const range = text !== undefined ? parsePortRange(text) : undefined;
        const element = count > 1 ? { field: 'ports', index: i, count } : undefined;
        out.rules.push(
          withUnmodeled(
            {
              ...base,
              id: element ? `${base.id}#${i}` : base.id,
              fromPort: range?.from ?? null,
              toPort: range?.to ?? null,
              ...(range ? {} : { portsExpr: base.portsExpr ?? text ?? exprPreview(e) }),
              origin: { kind: 'inline', field: action, index, ...(element ? { element } : {}) },
            },
            range ? rowUnmodeled : [...rowUnmodeled, 'ports'],
          ),
        );
      });
    });
  }
}

function standalone(ctx: Ctx, r: ResourceNode, out: Out) {
  const a = r.args;
  const origin = { kind: 'resource' as const, id: r.id };
  const ownerOf = (key: string) => {
    const owner = refOf(a[key]);
    return owner && OWNER_TYPES[ctx.byId.get(owner)?.type ?? ''] ? owner : undefined;
  };
  switch (r.type) {
    case 'aws_vpc_security_group_ingress_rule':
    case 'aws_vpc_security_group_egress_rule': {
      const owner = ownerOf('security_group_id');
      const direction = r.type.endsWith('ingress_rule') ? 'inbound' : 'outbound';
      if (owner) out.rules.push(awsSgRule(ctx, a, owner, { id: r.id, direction, origin }, 'vpc_rule'));
      return;
    }
    case 'aws_security_group_rule': {
      const owner = ownerOf('security_group_id');
      const rule = owner
        ? awsSgRule(ctx, a, owner, { id: r.id, direction: str(a.type) === 'egress' ? 'outbound' : 'inbound', origin }, 'sg_rule')
        : undefined;
      if (rule) out.rules.push(isLit(a.type) ? rule : { ...rule, unmodeled: [...(rule.unmodeled ?? []), 'type'] });
      return;
    }
    case 'aws_network_acl_rule': {
      const owner = ownerOf('network_acl_id');
      const direction = a.egress?.kind === 'literal' && a.egress.value === true ? 'outbound' : 'inbound';
      if (owner) {
        const rule = awsNaclRule(ctx, a, owner, { id: r.id, direction, origin }, { number: 'rule_number', action: 'rule_action' });
        out.rules.push(a.egress && !isLit(a.egress) ? { ...rule, unmodeled: [...(rule.unmodeled ?? []), 'egress'] } : rule);
      }
      return;
    }
    case 'azurerm_network_security_rule': {
      const owner = ownerOf('network_security_group_name');
      if (owner) out.rules.push(...azureRules(ctx, a, owner, r.id, origin));
      return;
    }
  }
}

export interface SecurityRules {
  /** owner (SG / NACL / NSG / firewall) → its rules, inline and standalone */
  rules: Map<string, SecurityRule[]>;
  /** owner → rules it defines in ways the model can't read (dynamic blocks, expressions) */
  hidden: Map<string, HiddenRules[]>;
}

export function extractSecurity(ir: IR): SecurityRules {
  const ctx: Ctx = { byId: new Map(ir.resources.map((r) => [r.id, r] as const)) };
  const out: Out = { rules: [], hidden: new Map() };
  for (const r of ir.resources) {
    const kind = OWNER_TYPES[r.type];
    if (kind === 'sg' || kind === 'nacl') awsInline(ctx, r, kind, out);
    else if (kind === 'nsg') {
      const { bodies, syntax, hidden } = inlineBodies(r, 'security_rule');
      for (const reason of hidden) hide(out, r.id, ['inbound', 'outbound'], reason);
      bodies.forEach((body, index) => {
        const origin: RuleOrigin = { kind: 'inline', field: 'security_rule', index, ...(syntax ? { syntax } : {}) };
        const rows = azureRules(ctx, body, r.id, `${r.id}:security_rule:${index}`, origin);
        out.rules.push(...(syntax ? rows.map((x) => ({ ...x, unmodeled: [...(x.unmodeled ?? []), 'security_rule = [ … ]'] })) : rows));
      });
    } else if (kind === 'firewall') gcpFirewall(ctx, r, out);
    else if (RULE_RESOURCES.has(r.type)) standalone(ctx, r, out);
  }
  const rules = new Map<string, SecurityRule[]>();
  for (const r of ir.resources) if (OWNER_TYPES[r.type]) rules.set(r.id, []);
  for (const rule of out.rules) rules.get(rule.owner)?.push(rule);
  return { rules, hidden: out.hidden };
}

/** Every rule in the project, grouped by the SG / NACL / NSG / firewall that owns it. */
export function extractRules(ir: IR): Map<string, SecurityRule[]> {
  return extractSecurity(ir).rules;
}

/** rows that come from the same block / resource (split port lists share one) */
export function ruleBlockKey(rule: SecurityRule): string {
  return rule.origin.kind === 'inline'
    ? `${rule.owner}:${rule.origin.field}:${rule.origin.index}`
    : rule.origin.id;
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

export function serviceName(rule: Pick<SecurityRule, 'protocol' | 'fromPort' | 'toPort'> & { portsExpr?: string }): string {
  if (rule.portsExpr) return rule.protocol === '?' ? `Protocol ${rule.portsExpr}` : `${rule.protocol.toUpperCase()} ${rule.portsExpr}`;
  if (rule.protocol === 'all' && rule.fromPort === null) return 'All traffic';
  if (rule.protocol === 'icmp') return 'ICMP';
  const proto = rule.protocol === 'all' ? 'TCP/UDP' : rule.protocol.toUpperCase();
  if (rule.fromPort === null) return `All ${proto}`;
  if (rule.fromPort === rule.toPort) return WELL_KNOWN[rule.fromPort] ?? `${proto} ${rule.fromPort}`;
  return `${proto} ${rule.fromPort}–${rule.toPort}`;
}

export function portLabel(rule: Pick<SecurityRule, 'protocol' | 'fromPort' | 'toPort' | 'portsExpr'>): string {
  if (rule.portsExpr) return rule.portsExpr;
  if (rule.protocol === 'icmp') return 'icmp';
  if (rule.fromPort === null) return 'all';
  return rule.fromPort === rule.toPort ? String(rule.fromPort) : `${rule.fromPort}-${rule.toPort}`;
}

export function peerLabel(peer: RulePeer, nameOf: (id: string) => string = (id) => id): string {
  switch (peer.kind) {
    case 'any':
      if (peer.implicit) return 'Internet (default 0.0.0.0/0)';
      if (peer.value === '0.0.0.0/0' || peer.value === '0.0.0.0') return 'Internet (IPv4)';
      if (peer.value === '::/0') return 'Internet (IPv6)';
      if (peer.value === '*') return 'Any source (*)';
      return 'Internet';
    case 'cidr':
      return peer.src?.expr.kind === 'ref' ? `${peer.src.expr.path} (${peer.value})` : peer.value;
    case 'group':
      return nameOf(peer.ref);
    case 'self':
      return 'itself';
    case 'tag':
      return `tag:${peer.value}`;
    case 'other':
    case 'expr':
      return peer.value;
  }
}
