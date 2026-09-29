/**
 * "Why is this reachable?" — the evidence behind an exposure: the ordered
 * chain of controls that lets internet traffic reach a resource, per port,
 * and, for traffic a rule means to let in, the control that stops it.
 *
 * topology.ts builds these from the same first-match evaluation that decides
 * the exposure (so the two can never disagree); this file holds the shapes,
 * and access.messages.ts the wording (in the language asked for).
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { accessMessages, type AtKind } from './access.messages';
import { internetSources, peerLabel, serviceName, type IpFamily, type OwnerKind, type SecurityRule } from './model';
import { trafficParts, trafficUnion, type Traffic } from './traffic';

export type StepKind =
  | 'internet'
  | 'gateway'
  | 'route'
  | 'subnet'
  | 'nacl'
  | 'sg'
  | 'nsg'
  | 'firewall'
  | 'address'
  | 'resource';

export interface PathStep {
  kind: StepKind;
  title: string;
  detail?: string;
  /** a security group rule: which one of the group's ("ingress #2", "rule web_https") */
  ref?: string;
  /** resource to select on the canvas */
  resource?: string;
  /** rule to open in the rules editor: its owner, and the row unless it is a default rule */
  rule?: { owner: string; id?: string };
  /** 'deny' marks the control where the traffic stops */
  verdict?: 'allow' | 'deny';
  /** beyond the point where the traffic stops — shown for context */
  unreached?: boolean;
}

/** one way in: the controls from the internet to the resource, outermost first */
export interface AccessPath {
  families: IpFamily[];
  steps: PathStep[];
}

export interface PortAccess {
  /** "443", "8000-8080", "all TCP", "53/udp", "icmp", "all", or a port expression (a key: see portText) */
  ports: string;
  /** null when the ports are an expression the audit can't evaluate */
  traffic: Traffic | null;
  /** usually one; an IPv4 and an IPv6 rule for the same port are two */
  paths: AccessPath[];
}

export interface BlockedPort {
  /** a port label: "22", "all", "other ports"… (a key: see portText) */
  ports: string;
  traffic: Traffic | null;
  families: IpFamily[];
  /** "blocked by NACL public #90 (deny)", "no route to an internet gateway" */
  reason: string;
  /** up to the control that stops it (verdict 'deny'), then what it would have reached */
  steps: PathStep[];
}

export interface AccessExplanation {
  /** internet traffic that gets in, per port */
  open: PortAccess[];
  /** internet traffic a rule allows but something in front of it stops */
  blocked: BlockedPort[];
}

export const shortName = (id: string) => id.split('.').slice(1).join('.') || id;

export function familiesLabel(families: readonly IpFamily[], locale: Locale = currentLocale()): string {
  if (families.length > 1) return messagesFor(accessMessages, locale).ipv4AndIpv6;
  return families[0] === 'ipv6' ? 'IPv6' : 'IPv4';
}

export function internetStep(families: readonly IpFamily[], locale: Locale = currentLocale()): PathStep {
  const m = messagesFor(accessMessages, locale);
  return {
    kind: 'internet',
    title: 'Internet',
    detail: families.length > 1 ? m.anyAddress : families[0] === 'ipv6' ? m.anyIpv6 : m.anyIpv4,
  };
}

function sourcesOf(rule: SecurityRule, locale: Locale): string {
  const wide = internetSources(rule);
  if (wide.length) return wide.join(', ');
  return rule.peers.map((p) => peerLabel(p, shortName, locale)).join(', ') || messagesFor(accessMessages, locale).anywhere;
}

export interface StepContext {
  /** the subnet (NACL, subnet NSG) or NIC the owner is applied at */
  at?: { kind: AtKind; id: string };
  /** GCP: which instances the firewall applies to */
  targets?: string;
}

const atText = (ctx: StepContext, locale: Locale) =>
  ctx.at ? messagesFor(accessMessages, locale).at(ctx.at.kind, shortName(ctx.at.id)) : '';

/** One rule as a step of a path. */
export function ruleStep(rule: SecurityRule, ctx: StepContext = {}, locale: Locale = currentLocale()): PathStep {
  const m = messagesFor(accessMessages, locale);
  const owner = shortName(rule.owner);
  const what = m.ruleDoes(rule.action === 'deny', serviceName(rule, locale), sourcesOf(rule, locale));
  const at = atText(ctx, locale);
  const priority = String(rule.priority ?? '?');
  const base = { rule: { owner: rule.owner, id: rule.id }, verdict: rule.action } as const;
  switch (rule.ownerKind) {
    case 'sg': {
      const ref =
        rule.origin.kind === 'inline' ? `${rule.origin.field} #${rule.origin.index + 1}` : m.sgRuleRef(shortName(rule.origin.id));
      return { ...base, kind: 'sg', title: m.sgTitle(owner), detail: `${ref} ${what}`, ref };
    }
    case 'nacl':
      return { ...base, kind: 'nacl', title: m.naclTitle(owner, priority), detail: `${what}${at}` };
    case 'nsg':
      return { ...base, kind: 'nsg', title: m.nsgTitle(owner, rule.description), detail: m.priority(priority, `${what}${at}`) };
    case 'firewall':
      return {
        ...base,
        kind: 'firewall',
        title: m.firewallTitle(owner),
        detail: m.priority(priority, `${what}${ctx.targets ? m.targets(ctx.targets) : ''}`),
      };
  }
}

/** The implicit last rule of an ordered owner: deny whatever nothing matched. */
export function defaultStep(kind: OwnerKind, owner: string, ctx: StepContext = {}, locale: Locale = currentLocale()): PathStep {
  const m = messagesFor(accessMessages, locale);
  const at = atText(ctx, locale);
  const base = { kind, rule: { owner }, verdict: 'deny' } as const;
  if (kind === 'nacl') return { ...base, title: m.naclDefaultTitle(shortName(owner)), detail: m.naclDefault(at) };
  if (kind === 'nsg') return { ...base, title: m.nsgDefaultTitle(shortName(owner)), detail: m.nsgDefault(at) };
  return { ...base, title: m.firewallDefaultTitle(shortName(owner)), detail: m.firewallDefault };
}

/** One line for what stops the traffic. */
export function blockReason(blocker: SecurityRule | { kind: OwnerKind; owner: string }, locale: Locale = currentLocale()): string {
  const m = messagesFor(accessMessages, locale);
  const n = shortName(blocker.owner);
  if ('id' in blocker) {
    const priority = String(blocker.priority ?? '?');
    if (blocker.ownerKind === 'nacl') return m.blockedByNacl(n, priority);
    if (blocker.ownerKind === 'nsg') return m.blockedByNsg(n, blocker.description ?? '', priority);
    return m.blockedByFirewall(n, priority);
  }
  if (blocker.kind === 'nacl') return m.blockedByNaclDefault(n);
  if (blocker.kind === 'nsg') return m.blockedByNsgDefault(n);
  return m.blockedByFirewallDefault(n);
}

/** "22", "22, 80" — or "other ports" (a key: see portText) once a remainder is too fragmented to list */
export function portsLabel(t: Traffic): string {
  const parts = trafficParts(t);
  return parts.length <= 3 ? parts.map((p) => p.label).join(', ') : 'other ports';
}

const PROTO_ORDER = ['all', 'all TCP', 'all UDP'];

/** widest first, then TCP by port, UDP by port, ICMP, other protocols, expressions */
function labelRank(label: string): [number, number] {
  const wide = PROTO_ORDER.indexOf(label);
  if (wide !== -1) return [0, wide];
  const m = /^(\d+)(?:-\d+)?(\/udp)?$/.exec(label);
  if (m) return [m[2] ? 2 : 1, Number(m[1])];
  if (label === 'icmp') return [3, 0];
  if (label === 'other protocols') return [4, 0];
  return [5, 0];
}

export const byPorts = (a: { ports: string }, b: { ports: string }) => {
  const [x0, x1] = labelRank(a.ports);
  const [y0, y1] = labelRank(b.ports);
  return x0 - y0 || x1 - y1 || a.ports.localeCompare(b.ports);
};

const stepsKey = (steps: PathStep[]) => steps.map((s) => `${s.kind}|${s.title}|${s.detail ?? ''}|${s.unreached ? 1 : 0}`).join('>');

/**
 * Chains of controls → one entry per port. `traffic` null (an expression) keeps
 * its `label`; identical chains for IPv4 and IPv6 fold into one, and each path
 * then starts at the Internet (for the families it carries).
 */
export function groupByPort(
  chains: Array<{ traffic: Traffic | null; label?: string; family: IpFamily; steps: PathStep[] }>,
  locale: Locale = currentLocale(),
): PortAccess[] {
  const byLabel = new Map<string, PortAccess>();
  for (const chain of chains) {
    const parts = chain.traffic ? trafficParts(chain.traffic) : [{ label: chain.label ?? '?', traffic: null }];
    for (const part of parts) {
      const entry = byLabel.get(part.label) ?? { ports: part.label, traffic: part.traffic, paths: [] };
      byLabel.set(part.label, entry);
      if (part.traffic && entry.traffic) entry.traffic = trafficUnion(entry.traffic, part.traffic);
      const key = stepsKey(chain.steps);
      const same = entry.paths.find((p) => stepsKey(p.steps) === key);
      if (same) {
        if (!same.families.includes(chain.family)) same.families = [...same.families, chain.family].sort();
      } else {
        entry.paths.push({ families: [chain.family], steps: chain.steps });
      }
    }
  }
  return [...byLabel.values()]
    .map((e) => ({ ...e, paths: e.paths.map((p) => ({ ...p, steps: [internetStep(p.families, locale), ...p.steps] })) }))
    .sort(byPorts);
}
