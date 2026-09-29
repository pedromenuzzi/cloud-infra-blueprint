/**
 * "Why is this reachable?" — the evidence behind an exposure: the ordered
 * chain of controls that lets internet traffic reach a resource, per port,
 * and, for traffic a rule means to let in, the control that stops it.
 *
 * topology.ts builds these from the same first-match evaluation that decides
 * the exposure (so the two can never disagree); this file holds the shapes and
 * the wording.
 */
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
  /** "443", "8000-8080", "all TCP", "53/udp", "icmp", "all", or a port expression */
  ports: string;
  /** null when the ports are an expression the audit can't evaluate */
  traffic: Traffic | null;
  /** usually one; an IPv4 and an IPv6 rule for the same port are two */
  paths: AccessPath[];
}

export interface BlockedPort {
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

export function familiesLabel(families: readonly IpFamily[]): string {
  if (families.length > 1) return 'IPv4 and IPv6';
  return families[0] === 'ipv6' ? 'IPv6' : 'IPv4';
}

export function internetStep(families: readonly IpFamily[]): PathStep {
  return {
    kind: 'internet',
    title: 'Internet',
    detail:
      families.length > 1 ? 'any address, IPv4 and IPv6' : families[0] === 'ipv6' ? 'any IPv6 address (::/0)' : 'any IPv4 address (0.0.0.0/0)',
  };
}

function sourcesOf(rule: SecurityRule): string {
  const wide = internetSources(rule);
  return wide.length ? wide.join(', ') : rule.peers.map((p) => peerLabel(p, shortName)).join(', ') || 'anywhere';
}

export interface StepContext {
  /** the subnet (NACL, subnet NSG) or NIC the owner is applied at */
  at?: { kind: 'subnet' | 'NIC'; id: string };
  /** GCP: which instances the firewall applies to */
  targets?: string;
}

/** One rule as a step of a path. */
export function ruleStep(rule: SecurityRule, ctx: StepContext = {}): PathStep {
  const owner = shortName(rule.owner);
  const what = `${rule.action === 'deny' ? 'denies' : 'allows'} ${serviceName(rule)} from ${sourcesOf(rule)}`;
  const at = ctx.at ? ` · on the ${ctx.at.kind} ${shortName(ctx.at.id)}` : '';
  const base = { rule: { owner: rule.owner, id: rule.id }, verdict: rule.action } as const;
  switch (rule.ownerKind) {
    case 'sg': {
      const ref = rule.origin.kind === 'inline' ? `${rule.origin.field} #${rule.origin.index + 1}` : `rule ${shortName(rule.origin.id)}`;
      return { ...base, kind: 'sg', title: `Security group ${owner}`, detail: `${ref} ${what}` };
    }
    case 'nacl':
      return { ...base, kind: 'nacl', title: `Network ACL ${owner} · rule #${rule.priority ?? '?'}`, detail: `${what}${at}` };
    case 'nsg':
      return {
        ...base,
        kind: 'nsg',
        title: `NSG ${owner} · ${rule.description ?? 'rule'}`,
        detail: `priority ${rule.priority ?? '?'} · ${what}${at}`,
      };
    case 'firewall':
      return {
        ...base,
        kind: 'firewall',
        title: `Firewall ${owner}`,
        detail: `priority ${rule.priority ?? '?'} · ${what}${ctx.targets ? ` · targets ${ctx.targets}` : ''}`,
      };
  }
}

/** The implicit last rule of an ordered owner: deny whatever nothing matched. */
export function defaultStep(kind: OwnerKind, owner: string, ctx: StepContext = {}): PathStep {
  const at = ctx.at ? ` · on the ${ctx.at.kind} ${shortName(ctx.at.id)}` : '';
  const base = { kind, rule: { owner }, verdict: 'deny' } as const;
  if (kind === 'nacl') {
    return { ...base, title: `Network ACL ${shortName(owner)} · rule *`, detail: `default rule — denies what no numbered rule allows${at}` };
  }
  if (kind === 'nsg') {
    return { ...base, title: `NSG ${shortName(owner)} · DenyAllInBound`, detail: `default rule (priority 65500) — denies what no rule allows${at}` };
  }
  return { ...base, title: `Firewall ${shortName(owner)} · implied deny`, detail: 'denies ingress no rule allows' };
}

/** One line for what stops the traffic. */
export function blockReason(blocker: SecurityRule | { kind: OwnerKind; owner: string }): string {
  if ('id' in blocker) {
    const n = shortName(blocker.owner);
    if (blocker.ownerKind === 'nacl') return `blocked by NACL ${n} #${blocker.priority ?? '?'} (deny)`;
    if (blocker.ownerKind === 'nsg') {
      return `blocked by NSG ${n} rule ${blocker.description ?? ''} (priority ${blocker.priority ?? '?'}, deny)`.replace('rule  (', 'rule (');
    }
    return `blocked by firewall ${n} (priority ${blocker.priority ?? '?'}, deny)`;
  }
  const n = shortName(blocker.owner);
  if (blocker.kind === 'nacl') return `blocked by NACL ${n}: no rule allows it (rule *)`;
  if (blocker.kind === 'nsg') return `blocked by NSG ${n}: no rule allows it (DenyAllInBound)`;
  return `blocked by firewall ${n}: no rule allows it`;
}

/** "22", "22, 80" — or "other ports" once a remainder is too fragmented to list */
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
    .map((e) => ({ ...e, paths: e.paths.map((p) => ({ ...p, steps: [internetStep(p.families), ...p.steps] })) }))
    .sort(byPorts);
}
