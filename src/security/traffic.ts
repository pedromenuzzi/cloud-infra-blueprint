/**
 * What the internet can actually send through a set of rules.
 *
 * Traffic is a set of TCP / UDP port intervals plus ICMP and "other
 * protocols" flags. Ordered owners (NACL rule numbers, NSG / GCP priorities)
 * are evaluated first-match; security groups are a plain union of allows.
 * IPv4 and IPv6 are evaluated separately — a deny on 0.0.0.0/0 does not stop
 * ::/0.
 */
import { internetFamilies, type SecurityRule } from './model';

export type Ports = ReadonlyArray<readonly [number, number]>;

const MAX_PORT = 65535;
export const ALL_PORTS: Ports = [[0, MAX_PORT]];

function normalize(list: Array<readonly [number, number]>): Ports {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const portsUnion = (a: Ports, b: Ports): Ports => normalize([...a, ...b]);

export function portsIntersect(a: Ports, b: Ports): Ports {
  const out: Array<[number, number]> = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (lo <= hi) out.push([lo, hi]);
    }
  }
  return normalize(out);
}

export function portsSubtract(a: Ports, b: Ports): Ports {
  let out: Array<[number, number]> = a.map(([x, y]) => [x, y]);
  for (const [b0, b1] of b) {
    out = out.flatMap(([x, y]): Array<[number, number]> => {
      if (b1 < x || b0 > y) return [[x, y]];
      const parts: Array<[number, number]> = [];
      if (b0 > x) parts.push([x, b0 - 1]);
      if (b1 < y) parts.push([b1 + 1, y]);
      return parts;
    });
  }
  return out;
}

export const portsHas = (p: Ports, port: number) => p.some(([a, b]) => port >= a && port <= b);
export const portsSize = (p: Ports) => p.reduce((n, [a, b]) => n + b - a + 1, 0);
export const portsFull = (p: Ports) => p.length === 1 && p[0][0] === 0 && p[0][1] === MAX_PORT;

export interface Traffic {
  tcp: Ports;
  udp: Ports;
  icmp: boolean;
  other: boolean;
}

export const NO_TRAFFIC: Traffic = { tcp: [], udp: [], icmp: false, other: false };
export const ALL_TRAFFIC: Traffic = { tcp: ALL_PORTS, udp: ALL_PORTS, icmp: true, other: true };

export const trafficUnion = (a: Traffic, b: Traffic): Traffic => ({
  tcp: portsUnion(a.tcp, b.tcp),
  udp: portsUnion(a.udp, b.udp),
  icmp: a.icmp || b.icmp,
  other: a.other || b.other,
});

export const trafficIntersect = (a: Traffic, b: Traffic): Traffic => ({
  tcp: portsIntersect(a.tcp, b.tcp),
  udp: portsIntersect(a.udp, b.udp),
  icmp: a.icmp && b.icmp,
  other: a.other && b.other,
});

export const trafficSubtract = (a: Traffic, b: Traffic): Traffic => ({
  tcp: portsSubtract(a.tcp, b.tcp),
  udp: portsSubtract(a.udp, b.udp),
  icmp: a.icmp && !b.icmp,
  other: a.other && !b.other,
});

export const trafficEmpty = (t: Traffic) => !t.tcp.length && !t.udp.length && !t.icmp && !t.other;
export const trafficAll = (t: Traffic) => portsFull(t.tcp) && portsFull(t.udp) && t.icmp && t.other;

/** What a rule matches, ignoring its peers. null when ports / protocol are expressions. */
export function ruleTraffic(rule: Pick<SecurityRule, 'protocol' | 'fromPort' | 'toPort' | 'portsExpr'>): Traffic | null {
  if (rule.portsExpr || rule.protocol === '?') return null;
  const ports: Ports = rule.fromPort === null || rule.toPort === null ? ALL_PORTS : [[rule.fromPort, Math.max(rule.fromPort, rule.toPort)]];
  switch (rule.protocol) {
    case 'all':
      // Azure `*` with explicit ports means TCP and UDP on those ports only
      return rule.fromPort === null ? ALL_TRAFFIC : { ...NO_TRAFFIC, tcp: ports, udp: ports };
    case 'tcp':
      return { ...NO_TRAFFIC, tcp: ports };
    case 'udp':
      return { ...NO_TRAFFIC, udp: ports };
    case 'icmp':
      return { ...NO_TRAFFIC, icmp: true };
    default:
      return { ...NO_TRAFFIC, other: true };
  }
}

export function trafficLabels(t: Traffic): string[] {
  if (trafficAll(t)) return ['all'];
  const fmt = ([a, b]: readonly [number, number]) => (a === b ? String(a) : `${a}-${b}`);
  const out: string[] = [];
  if (portsFull(t.tcp)) out.push('all TCP');
  else out.push(...t.tcp.map(fmt));
  if (portsFull(t.udp)) out.push('all UDP');
  else out.push(...t.udp.map((r) => `${fmt(r)}/udp`));
  if (t.icmp) out.push('icmp');
  if (t.other) out.push('other protocols');
  return out;
}

export interface Evaluation {
  /** everything the internet can send in */
  allowed: Traffic;
  /** per allow rule: the internet traffic it is the first match for */
  perRule: Map<string, Traffic>;
  /** allow rules from the internet whose ports / protocol are expressions */
  unverified: SecurityRule[];
  /** allow rules whose sources are expressions — they might be the internet */
  unknownSources: SecurityRule[];
}

const rank = (r: SecurityRule) => r.priority ?? Number.MAX_SAFE_INTEGER;

/**
 * Inbound internet traffic admitted by one group of rules. `ordered`: first
 * match by priority (deny wins ties, as on GCP); otherwise a union of allows.
 */
export function evaluateInbound(rules: SecurityRule[], ordered: boolean): Evaluation {
  const inbound = rules.filter((r) => r.direction === 'inbound' && !r.disabled);
  const sorted = ordered
    ? [...inbound].sort((a, b) => rank(a) - rank(b) || (a.action === b.action ? 0 : a.action === 'deny' ? -1 : 1))
    : inbound.filter((r) => r.action === 'allow');
  const result: Evaluation = { allowed: NO_TRAFFIC, perRule: new Map(), unverified: [], unknownSources: [] };
  for (const family of ['ipv4', 'ipv6'] as const) {
    let remaining = ALL_TRAFFIC;
    for (const rule of sorted) {
      if (!internetFamilies(rule).includes(family)) continue;
      const matched = ruleTraffic(rule);
      if (!matched) {
        if (rule.action === 'allow' && !result.unverified.includes(rule)) result.unverified.push(rule);
        continue;
      }
      const effective = ordered ? trafficIntersect(matched, remaining) : matched;
      if (rule.action === 'allow') {
        result.allowed = trafficUnion(result.allowed, effective);
        result.perRule.set(rule.id, trafficUnion(result.perRule.get(rule.id) ?? NO_TRAFFIC, effective));
      }
      if (ordered) remaining = trafficSubtract(remaining, effective);
    }
  }
  for (const rule of sorted) {
    if (rule.action === 'allow' && rule.peers.some((p) => p.kind === 'expr') && internetFamilies(rule).length === 0) {
      result.unknownSources.push(rule);
    }
  }
  return result;
}
