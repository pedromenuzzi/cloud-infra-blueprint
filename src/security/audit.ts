/**
 * Security audit: findings with severity, plain-language explanations and
 * one-click fixes (ops computed against the IR at click time), plus a score.
 */
import { block, collectRefs, lit, ref, refTargetAddress } from '@/ir/expr';
import { applyOps, type Op } from '@/ir/ops';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';
import { removeElementsOps, restrictRuleOps } from './edit';
import {
  blocksOf,
  extractRules,
  fromInternet,
  internetFamilies,
  internetSources,
  OWNER_TYPES,
  refOf,
  ruleBlockKey,
  serviceName,
  type SecurityRule,
} from './model';
import { analyzeSecurity, type SecurityTopology } from './topology';
import {
  NO_TRAFFIC,
  portsFull,
  portsHas,
  ruleTraffic,
  trafficAll,
  trafficEmpty,
  trafficUnion,
  type Traffic,
} from './traffic';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
const WEIGHT: Record<Severity, number> = { critical: 30, high: 15, medium: 3, low: 1 };
/** each further finding of the same kind counts this much less than the previous one */
const REPEAT_FACTOR = 0.4;

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** resource to select when the user clicks "Show" */
  resource: string;
  /** other resources involved (e.g. workloads reachable through an open rule) */
  related: string[];
  ruleId?: string;
  /** something the audit couldn't evaluate — an A can't be claimed */
  unverified?: boolean;
  fix?: { label: string; ops(ir: IR): Op[] };
}

export interface AuditResult {
  findings: Finding[];
  counts: Record<Severity, number>;
  /** 0–100, null when there is nothing to audit */
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  topology: SecurityTopology;
  /** rule id → why that rule is risky (rules editor rows, inspector) */
  risks: Map<string, RuleRisk>;
}

// ------------------------------------------------------------ rule risk

const ADMIN_PORTS: Array<[number, string, Severity]> = [
  [22, 'SSH', 'critical'],
  [3389, 'RDP', 'critical'],
  [2375, 'Docker API', 'critical'],
  [23, 'Telnet', 'high'],
  [21, 'FTP', 'high'],
  [445, 'SMB', 'high'],
  [5900, 'VNC', 'high'],
];

const DATA_PORTS: Array<[number, string]> = [
  [5432, 'PostgreSQL'],
  [3306, 'MySQL'],
  [1433, 'SQL Server'],
  [1521, 'Oracle'],
  [6379, 'Redis'],
  [11211, 'Memcached'],
  [27017, 'MongoDB'],
  [9200, 'Elasticsearch'],
  [9042, 'Cassandra'],
  [5439, 'Redshift'],
];

export interface RuleRisk {
  severity: Severity;
  title: string;
  unverified?: boolean;
}

const worst = (a: Severity, b: Severity) => (SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(b) ? a : b);

function joinNames(names: string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** How bad it is to let this internet traffic in. */
export function trafficRisk(t: Traffic): RuleRisk | null {
  if (trafficAll(t)) return { severity: 'critical', title: 'Every port is open to the internet' };
  if (portsFull(t.tcp)) return { severity: 'critical', title: 'All TCP ports are open to the internet' };
  if (portsFull(t.udp)) return { severity: 'critical', title: 'All UDP ports are open to the internet' };
  const hits: Array<[number, string, Severity]> = [
    ...ADMIN_PORTS.filter(([port]) => portsHas(t.tcp, port)),
    ...DATA_PORTS.filter(([port]) => portsHas(t.tcp, port)).map(([p, n]): [number, string, Severity] => [p, n, 'critical']),
  ];
  if (hits.length === 1) return { severity: hits[0][2], title: `${hits[0][1]} (port ${hits[0][0]}) is open to the internet` };
  if (hits.length > 1) {
    return {
      severity: hits.map((h) => h[2]).reduce(worst),
      title: `${joinNames(hits.map(([p, n]) => `${n} (${p})`))} are open to the internet`,
    };
  }
  const wide = [...t.tcp, ...t.udp].find(([a, b]) => b - a >= 99);
  if (wide) return { severity: 'medium', title: `Wide port range ${wide[0]}–${wide[1]} is open to the internet` };
  return null;
}

/**
 * NACLs are stateless: inbound ephemeral ports (1024–65535) from anywhere are
 * how return traffic gets back in, and "allow all" is the AWS default. Only
 * explicit SSH / RDP ranges are worth flagging (Security Hub EC2.21, medium).
 */
function naclRisk(rule: SecurityRule, t: Traffic): RuleRisk | null {
  if (rule.fromPort === null || rule.toPort === null || rule.toPort - rule.fromPort >= 1024) return null;
  const hits = ([[22, 'SSH'], [3389, 'RDP']] as const).filter(([port]) => portsHas(t.tcp, port));
  if (hits.length === 0) return null;
  return { severity: 'medium', title: `Network ACL allows ${joinNames(hits.map(([p, n]) => `${n} (port ${p})`))} from the internet` };
}

/**
 * Why an individual rule is dangerous (inbound, allowed, from anywhere).
 * `effective` is what it actually admits after higher-priority rules
 * (topology.effective); by default, everything it declares.
 */
export function ruleRisk(rule: SecurityRule, effective?: Traffic): RuleRisk | null {
  if (rule.direction !== 'inbound' || rule.action !== 'allow' || rule.disabled || !fromInternet(rule)) return null;
  const declared = ruleTraffic(rule);
  if (!declared) {
    return { severity: 'medium', title: `Port can't be verified (${rule.portsExpr}) — open to the internet`, unverified: true };
  }
  const t = effective ?? declared;
  if (trafficEmpty(t)) return null;
  return rule.ownerKind === 'nacl' ? naclRisk(rule, t) : trafficRisk(t);
}

// ------------------------------------------------------------ helpers

const lit_ = (r: ResourceNode | undefined, k: string) => (r?.args[k]?.kind === 'literal' ? r.args[k].value : undefined);
const isExpr = (e: Expression | undefined) => e !== undefined && e.kind !== 'literal';

function findRule(ir: IR, id: string): SecurityRule | undefined {
  for (const rules of extractRules(ir).values()) {
    const hit = rules.find((r) => r.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** a one-click fix, offered only when it actually produces ops for this IR */
function ruleFix(ir: IR, rule: SecurityRule): Finding['fix'] {
  const now = restrictRuleOps(ir, rule);
  if (!now || now.ops.length === 0) return undefined;
  return {
    label: now.label,
    ops: (current) => {
      const r = findRule(current, rule.id);
      return r ? (restrictRuleOps(current, r)?.ops ?? []) : [];
    },
  };
}

/**
 * Only some ports of a shared list are risky (GCP `ports = ["22", "80"]`): restricting
 * the sources would close the safe ones too, so drop just the risky ports.
 */
function elementFix(ir: IR, risky: SecurityRule[]): Finding['fix'] {
  const indices = risky.map((r) => r.origin.element!.index);
  if (!removeElementsOps(ir, risky[0], indices)?.length) return undefined;
  return {
    label: `Remove ${joinNames([...new Set(risky.map((r) => serviceName(r)))])} from this rule`,
    ops: (current) => {
      const r = findRule(current, risky[0].id);
      return r ? (removeElementsOps(current, r, indices) ?? []) : [];
    },
  };
}

/** outputs, modules, locals… that mention a resource by address */
function mentionedOutsideResources(ir: IR): Set<string> {
  const out = new Set<string>();
  const refs: Array<{ field: string; path: string }> = [];
  for (const o of ir.outputs) for (const e of Object.values(o.args)) collectRefs(e, '', refs);
  for (const r of refs) {
    const a = refTargetAddress(r.path);
    if (a) out.add(a.replace(/\[.*$/, ''));
  }
  for (const x of ir.extras) {
    for (const m of x.text.matchAll(/\b([a-z][a-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(`${m[1]}.${m[2]}`);
  }
  return out;
}

function imdsFinding(r: ResourceNode, what: string): Finding | null {
  const opts = blocksOf(r.args.metadata_options)[0];
  const tokens = opts?.http_tokens;
  const endpoint = opts?.http_endpoint;
  if (isExpr(tokens) || isExpr(endpoint)) return null;
  if (endpoint?.kind === 'literal' && endpoint.value === 'disabled') return null;
  if (tokens?.kind === 'literal' && tokens.value === 'required') return null;
  const name = r.id.split('.').slice(1).join('.');
  return {
    id: `imdsv2:${r.id}`,
    severity: 'medium',
    title: `${what} allows IMDSv1`,
    detail: `${name} accepts token-less metadata requests, the classic SSRF path to stealing instance credentials. Require IMDSv2.`,
    resource: r.id,
    related: [],
    fix: {
      label: 'Require IMDSv2',
      ops: (current) => {
        const node = current.resources.find((x) => x.id === r.id);
        const existing = blocksOf(node?.args.metadata_options)[0] ?? {};
        return [
          {
            kind: 'set_arg',
            nodeId: r.id,
            field: 'metadata_options',
            value: block({ ...existing, http_endpoint: lit('enabled'), http_tokens: lit('required') }),
          },
        ];
      },
    },
  };
}

function scoreOf(findings: Finding[]): number {
  const byType = new Map<string, number[]>();
  for (const f of findings) {
    const type = f.id.split(':')[0];
    byType.set(type, [...(byType.get(type) ?? []), WEIGHT[f.severity]]);
  }
  let penalty = 0;
  for (const weights of byType.values()) {
    weights.sort((a, b) => b - a).forEach((w, i) => (penalty += w * REPEAT_FACTOR ** i));
  }
  const score = Math.max(0, Math.round(100 - penalty));
  // what the audit can't see might be wide open
  return findings.some((f) => f.unverified) ? Math.min(score, 89) : score;
}

// ------------------------------------------------------------ audit

export function auditSecurity(ir: IR, topology: SecurityTopology = analyzeSecurity(ir)): AuditResult {
  const findings: Finding[] = [];
  const risks = new Map<string, RuleRisk>();
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const name = (id: string) => id.split('.').slice(1).join('.') || id;
  const internetFlows = topology.flows.filter((f) => f.from === 'internet');

  // 1. rules open to the internet — one finding per rule block (split port lists merge back)
  for (const [owner, rules] of topology.rules) {
    const blocks = new Map<string, SecurityRule[]>();
    for (const rule of rules) {
      const risk = ruleRisk(rule, topology.effective.get(rule.id) ?? NO_TRAFFIC);
      if (!risk) continue;
      risks.set(rule.id, risk);
      const key = ruleBlockKey(rule);
      blocks.set(key, [...(blocks.get(key) ?? []), rule]);
    }
    for (const [key, rows] of blocks) {
      const known = rows.filter((r) => !risks.get(r.id)!.unverified);
      const safe = rules.filter((r) => ruleBlockKey(r) === key && !risks.has(r.id));
      const merged =
        known.length > 1 && rows[0].ownerKind !== 'nacl'
          ? trafficRisk(known.map((r) => topology.effective.get(r.id) ?? NO_TRAFFIC).reduce(trafficUnion, NO_TRAFFIC))
          : null;
      const risk = merged ?? risks.get((known[0] ?? rows[0]).id)!;
      const shown = known.length ? known : rows;
      const first = shown[0];
      const via = first.origin.kind === 'resource' ? ` (${first.origin.id})` : '';
      const reachable = [...new Set(internetFlows.filter((f) => rows.some((r) => f.rules.includes(r.id))).map((f) => f.to))];
      const sources = first.peers.some((p) => p.kind === 'any' && p.implicit)
        ? 'no source ranges, so 0.0.0.0/0'
        : internetSources(first).join(', ');
      const what = risk.unverified
        ? `ports set by an expression (${first.portsExpr}) — the audit can't tell which are open —`
        : shown.map(serviceName).join(', ');
      // an IPv6 twin of an IPv4 rule must not read as the same finding twice
      const v6only = internetFamilies(first).every((f) => f === 'ipv6');
      findings.push({
        id: `rule:${key}`,
        severity: risk.severity,
        title: v6only && !risk.unverified ? `${risk.title} over IPv6` : risk.title,
        detail:
          `${name(owner)}${via} allows ${what} from anywhere (${sources}).` +
          (first.ownerKind === 'nacl'
            ? ' Security groups still apply, but the network ACL adds no protection for these ports.'
            : reachable.length
              ? ` Reachable right now on ${reachable.map(name).join(', ')}.`
              : ' Nothing public uses it yet — but the next resource that does will be exposed.'),
        resource: owner,
        related: reachable,
        ruleId: first.id,
        ...(risk.unverified ? { unverified: true } : {}),
        fix: safe.length > 0 && known.length > 0 && first.origin.element ? elementFix(ir, known) : ruleFix(ir, first),
      });
    }

    const ownerNode = byId.get(owner);
    // NACL that lets everything in (first match, so a deny above it counts)
    if (ownerNode && OWNER_TYPES[ownerNode.type] === 'nacl') {
      const allowed = rules.map((r) => topology.effective.get(r.id) ?? NO_TRAFFIC).reduce(trafficUnion, NO_TRAFFIC);
      if (trafficAll(allowed)) {
        findings.push({
          id: `nacl-open:${owner}`,
          severity: 'low',
          title: 'Network ACL allows all inbound traffic',
          detail: `${name(owner)} lets every protocol in from anywhere — it adds no protection beyond the security groups.`,
          resource: owner,
          related: [],
        });
      }
    }

    // rules the model can't read
    const hidden = (topology.hidden.get(owner) ?? []).filter((h) => h.directions.includes('inbound'));
    if (hidden.length > 0) {
      findings.push({
        id: `unverified:${owner}`,
        severity: 'low',
        title: "Some inbound rules can't be verified",
        detail: `${name(owner)} defines inbound rules with ${hidden.map((h) => h.reason).join(', ')} — the audit can't evaluate them. Check what they open in code.`,
        resource: owner,
        related: [],
        unverified: true,
      });
    }
  }

  // 2. resource hardening
  const setArg = (id: string, field: string, value: Expression): Op[] => [{ kind: 'set_arg', nodeId: id, field, value }];
  const bucketsBlocked = new Set(
    ir.resources.filter((r) => r.type === 'aws_s3_bucket_public_access_block').map((r) => refOf(r.args.bucket)),
  );
  const accountBlock = ir.resources.some(
    (r) =>
      r.type === 'aws_s3_account_public_access_block' &&
      ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'].every((k) => lit_(r, k) === true),
  );
  for (const r of ir.resources) {
    if ((r.type === 'aws_db_instance' || r.type === 'aws_rds_cluster_instance') && lit_(r, 'publicly_accessible') === true) {
      findings.push({
        id: `rds-public:${r.id}`,
        severity: 'high',
        title: 'Database is publicly accessible',
        detail: `${name(r.id)} gets a public endpoint. Keep databases private and reach them from inside the VPC.`,
        resource: r.id,
        related: [],
        fix: { label: 'Make it private', ops: () => setArg(r.id, 'publicly_accessible', lit(false)) },
      });
    }
    if ((r.type === 'aws_db_instance' || r.type === 'aws_rds_cluster') && !isExpr(r.args.storage_encrypted)) {
      if (lit_(r, 'storage_encrypted') !== true) {
        findings.push({
          id: `rds-encryption:${r.id}`,
          severity: 'medium',
          title: 'Database storage is not encrypted',
          detail: `${name(r.id)} doesn't set storage_encrypted = true. Encryption at rest is free and can't be enabled later without a restore.`,
          resource: r.id,
          related: [],
          fix: { label: 'Encrypt storage', ops: () => setArg(r.id, 'storage_encrypted', lit(true)) },
        });
      }
    }
    // instances launched from a template get their metadata options from it (checked below)
    if (r.type === 'aws_instance' && !(r.args.launch_template && !r.args.metadata_options)) {
      const f = imdsFinding(r, 'Instance metadata');
      if (f) findings.push(f);
    }
    if (r.type === 'aws_launch_template') {
      const f = imdsFinding(r, 'Launch template');
      if (f) findings.push(f);
    }
    if (r.type === 'aws_lb' && lit_(r, 'internal') !== true) {
      const type = lit_(r, 'load_balancer_type') ?? 'application';
      const listeners = ir.resources.filter((l) => l.type === 'aws_lb_listener' && refOf(l.args.load_balancer_arn) === r.id);
      const protocols = listeners.map((l) => (l.args.protocol === undefined ? 'HTTP' : lit_(l, 'protocol')));
      // NLB / gateway listeners are TCP / TLS / UDP — TCP may well carry TLS end to end
      if (type === 'application' && protocols.includes('HTTP') && !protocols.includes('HTTPS') && protocols.every((p) => typeof p === 'string')) {
        findings.push({
          id: `lb-http:${r.id}`,
          severity: 'low',
          title: 'Load balancer only serves plain HTTP',
          detail: `${name(r.id)} has no HTTPS listener — traffic from users travels unencrypted. Add an HTTPS listener with an ACM certificate.`,
          resource: r.id,
          related: listeners.map((l) => l.id),
        });
      }
    }
  }
  for (const b of ir.resources) {
    if (b.type !== 'aws_s3_bucket' || bucketsBlocked.has(b.id) || accountBlock) continue;
    findings.push({
      id: `s3-public:${b.id}`,
      severity: 'medium',
      title: 'Bucket has no public access block',
      detail: `${name(b.id)} relies on account defaults. A public access block makes "never public" explicit and prevents accidental exposure.`,
      resource: b.id,
      related: [],
      fix: {
        label: 'Block public access',
        ops: (current) => {
          const taken = new Set(current.resources.map((x) => x.id));
          let n = `${b.name}`;
          for (let i = 2; taken.has(resourceAddress('aws_s3_bucket_public_access_block', n)); i++) n = `${b.name}_${i}`;
          const pos = b.position ?? { x: 0, y: 0 };
          return [
            {
              kind: 'add_resource',
              node: {
                id: resourceAddress('aws_s3_bucket_public_access_block', n),
                provider: 'aws',
                type: 'aws_s3_bucket_public_access_block',
                name: n,
                args: {
                  bucket: ref(`${b.id}.id`),
                  block_public_acls: lit(true),
                  block_public_policy: lit(true),
                  ignore_public_acls: lit(true),
                  restrict_public_buckets: lit(true),
                },
                position: { x: pos.x + 240, y: pos.y },
                trivia: { leadingComments: [] },
              },
            },
          ];
        },
      },
    });
  }

  // 3. unused security groups (the default SG always exists; outputs / modules count as use)
  const referencedByRules = new Set(
    [...topology.rules.values()].flat().flatMap((r) => r.peers.flatMap((p) => (p.kind === 'group' ? [p.ref] : []))),
  );
  const mentioned = mentionedOutsideResources(ir);
  for (const r of ir.resources) {
    if (r.type !== 'aws_security_group' && r.type !== 'azurerm_network_security_group') continue;
    if ((topology.protects.get(r.id) ?? []).length > 0 || referencedByRules.has(r.id) || mentioned.has(r.id)) continue;
    findings.push({
      id: `unused:${r.id}`,
      severity: 'low',
      title: 'Security group is not attached to anything',
      detail: `${name(r.id)} protects no resource. Attach it (connect it to an instance, load balancer or database) or remove it.`,
      resource: r.id,
      related: [],
    });
  }

  const order = (s: Severity) => SEVERITY_ORDER.indexOf(s);
  findings.sort((a, b) => order(a.severity) - order(b.severity));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  const auditable = ir.resources.some(
    (r) =>
      topology.rules.has(r.id) ||
      ['aws_db_instance', 'aws_rds_cluster', 'aws_rds_cluster_instance', 'aws_instance', 'aws_launch_template', 'aws_s3_bucket', 'aws_lb'].includes(
        r.type,
      ),
  );
  if (!auditable) return { findings, counts, score: null, grade: null, topology, risks };
  const score = scoreOf(findings);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return { findings, counts, score, grade, topology, risks };
}

export interface FixAllResult {
  ops: Op[];
  /** how many findings are gone afterwards */
  fixed: number;
}

/**
 * Every available fix, chained: each one is computed against the result of the
 * previous ones (re-auditing in between, since removing a rule shifts the
 * others), so the ops apply as one undo step.
 */
export function planFixAll(ir: IR): FixAllResult {
  const before = auditSecurity(ir).findings.length;
  let scratch = ir;
  const ops: Op[] = [];
  // rule ids are positional — once a fix removes a block the next one takes its id, so key on what it says
  const key = (f: Finding) => `${f.id}|${f.title}|${f.detail}`;
  const tried = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    const next = auditSecurity(scratch).findings.find((f) => f.fix && !tried.has(key(f)));
    if (!next) break;
    tried.add(key(next));
    const step = next.fix!.ops(scratch);
    if (step.length === 0) continue;
    ops.push(...step);
    scratch = applyOps(scratch, step).ir;
  }
  const after = auditSecurity(scratch).findings.length;
  return { ops, fixed: Math.max(0, before - after) };
}
