/**
 * Security audit: findings with severity, plain-language explanations and
 * one-click fixes (ops computed against the IR at click time), plus a score.
 *
 * The words are in the language of the topology the audit is built on (the
 * UI language unless analyzeSecurity was given another); `Finding.key` keeps
 * what a finding says in English, so comparing audits never depends on the
 * language they were written in.
 */
import type { Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { block, collectRefs, lit, refTargetAddress } from '@/ir/expr';
import { applyOps, type Op } from '@/ir/ops';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';
import { auditMessages, type AuditMessages, type RiskWhat, type RuleTail } from './audit.messages';
import { controlsFor, type Control, type FindingFacts } from './compliance';
import { removeElementsOps, restrictRuleOps } from './edit';
import { chainedTarget, perInstanceArgs, subjectName } from './instances';
import { wildcardStatements } from './iamDocuments';
import { formatList } from '@/i18n/format';
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

export type { RiskWhat } from './audit.messages';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
const WEIGHT: Record<Severity, number> = { critical: 30, high: 15, medium: 3, low: 1 };
/** each further finding of the same kind counts this much less than the previous one */
const REPEAT_FACTOR = 0.4;

const EN = messagesFor(auditMessages, 'en');

export interface Finding {
  id: string;
  severity: Severity;
  /** in the audit's language (AuditResult.locale) */
  title: string;
  detail: string;
  /** the title in English: what the finding says, whatever the UI language (security delta) */
  key: string;
  /** rule findings: the title as news, in the audit's language — "SSH (22) is now open to the internet" */
  alert?: string;
  /** resource to select when the user clicks "Show" */
  resource: string;
  /** other resources involved (e.g. workloads reachable through an open rule) */
  related: string[];
  ruleId?: string;
  /** something the audit couldn't evaluate — an A can't be claimed */
  unverified?: boolean;
  /** benchmark controls it fails (compliance.ts), titles in the audit's language */
  controls?: Control[];
  fix?: { label: string; ops(ir: IR): Op[] };
}

export interface AuditResult {
  /** the language of every text in it */
  locale: Locale;
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
  /** in the language asked for */
  title: string;
  /** what the rule lets in, whatever the language */
  what: RiskWhat;
  unverified?: boolean;
}

const worst = (a: Severity, b: Severity) => (SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(b) ? a : b);

const riskOf = (severity: Severity, what: RiskWhat, locale: Locale | undefined, unverified?: boolean): RuleRisk => ({
  severity,
  title: messagesFor(auditMessages, locale).risk(what),
  what,
  ...(unverified ? { unverified } : {}),
});

/** How bad it is to let this internet traffic in. */
export function trafficRisk(t: Traffic, locale?: Locale): RuleRisk | null {
  if (trafficAll(t)) return riskOf('critical', { kind: 'every-port' }, locale);
  if (portsFull(t.tcp)) return riskOf('critical', { kind: 'all-tcp' }, locale);
  if (portsFull(t.udp)) return riskOf('critical', { kind: 'all-udp' }, locale);
  const hits: Array<[number, string, Severity]> = [
    ...ADMIN_PORTS.filter(([port]) => portsHas(t.tcp, port)),
    ...DATA_PORTS.filter(([port]) => portsHas(t.tcp, port)).map(([p, n]): [number, string, Severity] => [p, n, 'critical']),
  ];
  if (hits.length) {
    return riskOf(hits.map((h) => h[2]).reduce(worst), { kind: 'ports', hits: hits.map(([p, n]) => [p, n]) }, locale);
  }
  const wide = [...t.tcp, ...t.udp].find(([a, b]) => b - a >= 99);
  if (wide) return riskOf('medium', { kind: 'wide', from: wide[0], to: wide[1] }, locale);
  return null;
}

/**
 * NACLs are stateless: inbound ephemeral ports (1024–65535) from anywhere are
 * how return traffic gets back in, and "allow all" is the AWS default. Only
 * explicit SSH / RDP ranges are worth flagging (Security Hub EC2.21, medium).
 */
function naclRisk(rule: SecurityRule, t: Traffic, locale: Locale | undefined): RuleRisk | null {
  if (rule.fromPort === null || rule.toPort === null || rule.toPort - rule.fromPort >= 1024) return null;
  const hits = ([[22, 'SSH'], [3389, 'RDP']] as const).filter(([port]) => portsHas(t.tcp, port));
  if (hits.length === 0) return null;
  return riskOf('medium', { kind: 'nacl', hits: hits.map(([p, n]) => [p, n]) }, locale);
}

/**
 * Why an individual rule is dangerous (inbound, allowed, from anywhere).
 * `effective` is what it actually admits after higher-priority rules
 * (topology.effective); by default, everything it declares.
 */
export function ruleRisk(rule: SecurityRule, effective?: Traffic, locale?: Locale): RuleRisk | null {
  if (rule.direction !== 'inbound' || rule.action !== 'allow' || rule.disabled || !fromInternet(rule)) return null;
  const declared = ruleTraffic(rule);
  if (!declared) return riskOf('medium', { kind: 'unverified', expr: rule.portsExpr }, locale, true);
  const t = effective ?? declared;
  if (trafficEmpty(t)) return null;
  return rule.ownerKind === 'nacl' ? naclRisk(rule, t, locale) : trafficRisk(t, locale);
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
function ruleFix(ir: IR, rule: SecurityRule, locale: Locale): Finding['fix'] {
  const now = restrictRuleOps(ir, rule, locale);
  if (!now || now.ops.length === 0) return undefined;
  return {
    label: now.label,
    ops: (current) => {
      const r = findRule(current, rule.id);
      return r ? (restrictRuleOps(current, r, locale)?.ops ?? []) : [];
    },
  };
}

/**
 * Only some ports of a shared list are risky (GCP `ports = ["22", "80"]`): restricting
 * the sources would close the safe ones too, so drop just the risky ports.
 */
function elementFix(ir: IR, risky: SecurityRule[], locale: Locale): Finding['fix'] {
  const indices = risky.map((r) => r.origin.element!.index);
  if (!removeElementsOps(ir, risky[0], indices)?.length) return undefined;
  const m = messagesFor(auditMessages, locale);
  return {
    label: m.removeFromRule(m.join([...new Set(risky.map((r) => serviceName(r, locale)))])),
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
  for (const m of ir.modules) for (const e of Object.values(m.args)) collectRefs(e, '', refs);
  for (const r of refs) {
    const a = refTargetAddress(r.path);
    if (a) out.add(a.replace(/\[.*$/, ''));
  }
  for (const x of ir.extras) {
    for (const m of x.text.matchAll(/\b([a-z][a-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(`${m[1]}.${m[2]}`);
  }
  return out;
}

function imdsFinding(r: ResourceNode, what: 'instance' | 'template', m: AuditMessages, label?: string): Finding | null {
  const opts = blocksOf(r.args.metadata_options)[0];
  const tokens = opts?.http_tokens;
  const endpoint = opts?.http_endpoint;
  if (isExpr(tokens) || isExpr(endpoint)) return null;
  if (endpoint?.kind === 'literal' && endpoint.value === 'disabled') return null;
  if (tokens?.kind === 'literal' && tokens.value === 'required') return null;
  const name = label ?? r.id.split('.').slice(1).join('.');
  return {
    id: `imdsv2:${r.id}`,
    severity: 'medium',
    title: m.imdsTitle(what),
    key: EN.imdsTitle(what),
    detail: m.imdsDetail(name),
    resource: r.id,
    related: [],
    fix: {
      label: m.imdsFix,
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

/** 0–100 for these findings (each further one of a kind counts less; anything unverified caps it at 89) */
export function scoreOf(findings: Finding[]): number {
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

/** The audit, worded in the topology's language (`topology.locale`). */
export function auditSecurity(ir: IR, topology: SecurityTopology = analyzeSecurity(ir)): AuditResult {
  const { locale } = topology;
  const m = messagesFor(auditMessages, locale);
  /** a title in the audit's language, and in English as the finding's key */
  const say = (title: (x: AuditMessages) => string) => ({ title: title(m), key: title(EN) });
  const findings: Finding[] = [];
  const risks = new Map<string, RuleRisk>();
  const byId = new Map(ir.resources.map((r) => [r.id, r] as const));
  const name = (id: string) => id.split('.').slice(1).join('.') || id;
  /** what a finding is about: a repeated resource is each of its instances (said once) */
  const subject = (id: string) => subjectName(name(id), byId.get(id), ir, locale);
  const internetFlows = topology.flows.filter((f) => f.from === 'internet');
  /** what the compliance table needs to know about rule findings, by finding id */
  const ruleFacts = new Map<string, Partial<FindingFacts>>();

  // 1. rules open to the internet — one finding per rule block (split port lists merge back)
  for (const [owner, rules] of topology.rules) {
    const blocks = new Map<string, SecurityRule[]>();
    for (const rule of rules) {
      const risk = ruleRisk(rule, topology.effective.get(rule.id) ?? NO_TRAFFIC, locale);
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
          ? trafficRisk(known.map((r) => topology.effective.get(r.id) ?? NO_TRAFFIC).reduce(trafficUnion, NO_TRAFFIC), locale)
          : null;
      const risk = merged ?? risks.get((known[0] ?? rows[0]).id)!;
      const shown = known.length ? known : rows;
      const first = shown[0];
      const via = first.origin.kind === 'resource' ? ` (${first.origin.id})` : '';
      const reachable = [...new Set(internetFlows.filter((f) => rows.some((r) => f.rules.includes(r.id))).map((f) => f.to))];
      const sources = first.peers.some((p) => p.kind === 'any' && p.implicit) ? m.implicitSources : internetSources(first).join(', ');
      const what = risk.unverified ? m.unverifiedWhat(first.portsExpr) : shown.map((r) => serviceName(r, locale)).join(', ');
      // an IPv6 twin of an IPv4 rule must not read as the same finding twice
      const v6only = !risk.unverified && internetFamilies(first).every((f) => f === 'ipv6');
      if (!risk.unverified) {
        ruleFacts.set(`rule:${key}`, {
          owner: first.ownerKind,
          traffic: known.map((r) => topology.effective.get(r.id) ?? NO_TRAFFIC).reduce(trafficUnion, NO_TRAFFIC),
          families: [...new Set(known.flatMap(internetFamilies))],
        });
      }
      const tail: RuleTail =
        first.ownerKind === 'nacl'
          ? { kind: 'nacl' }
          : reachable.length
            ? { kind: 'reachable', names: reachable.map(name).join(', ') }
            : { kind: 'unused' };
      findings.push({
        id: `rule:${key}`,
        severity: risk.severity,
        ...say((x) => x.ruleTitle(risk.what, v6only)),
        alert: m.ruleAlert(risk.what, v6only),
        detail: m.ruleDetail(`${subject(owner)}${via}`, what, sources, tail),
        resource: owner,
        related: reachable,
        ruleId: first.id,
        ...(risk.unverified ? { unverified: true } : {}),
        fix: safe.length > 0 && known.length > 0 && first.origin.element ? elementFix(ir, known, locale) : ruleFix(ir, first, locale),
      });
    }

    const ownerNode = byId.get(owner);
    // NACL that lets everything in (first match, so a deny above it counts)
    if (ownerNode && OWNER_TYPES[ownerNode.type] === 'nacl') {
      const allowed = rules.map((r) => topology.effective.get(r.id) ?? NO_TRAFFIC).reduce(trafficUnion, NO_TRAFFIC);
      if (trafficAll(allowed)) {
        ruleFacts.set(`nacl-open:${owner}`, {
          families: [...new Set(rules.filter((r) => topology.effective.has(r.id)).flatMap(internetFamilies))],
        });
        findings.push({
          id: `nacl-open:${owner}`,
          severity: 'low',
          ...say((x) => x.naclOpenTitle),
          detail: m.naclOpenDetail(subject(owner)),
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
        ...say((x) => x.unverifiedTitle),
        detail: m.unverifiedDetail(subject(owner), hidden.map((h) => h.reason).join(', ')),
        resource: owner,
        related: [],
        unverified: true,
      });
    }
  }

  // 2. resource hardening
  const setArg = (id: string, field: string, value: Expression): Op[] => [{ kind: 'set_arg', nodeId: id, field, value }];
  const bucketsBlocked = new Set(
    ir.resources.filter((r) => r.type === 'aws_s3_bucket_public_access_block').map((r) => chainedTarget(r, 'bucket') ?? refOf(r.args.bucket)),
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
        ...say((x) => x.rdsPublicTitle),
        detail: m.rdsPublicDetail(subject(r.id)),
        resource: r.id,
        related: [],
        fix: { label: m.rdsPublicFix, ops: () => setArg(r.id, 'publicly_accessible', lit(false)) },
      });
    }
    if ((r.type === 'aws_db_instance' || r.type === 'aws_rds_cluster') && !isExpr(r.args.storage_encrypted)) {
      if (lit_(r, 'storage_encrypted') !== true) {
        findings.push({
          id: `rds-encryption:${r.id}`,
          severity: 'medium',
          ...say((x) => x.rdsEncryptionTitle),
          detail: m.rdsEncryptionDetail(subject(r.id)),
          resource: r.id,
          related: [],
          fix: { label: m.rdsEncryptionFix, ops: () => setArg(r.id, 'storage_encrypted', lit(true)) },
        });
      }
    }
    // instances launched from a template get their metadata options from it (checked below)
    if (r.type === 'aws_instance' && !(r.args.launch_template && !r.args.metadata_options)) {
      const f = imdsFinding(r, 'instance', m, subject(r.id));
      if (f) findings.push(f);
    }
    if (r.type === 'aws_launch_template') {
      const f = imdsFinding(r, 'template', m, subject(r.id));
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
          ...say((x) => x.lbHttpTitle),
          detail: m.lbHttpDetail(subject(r.id)),
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
      ...say((x) => x.s3PublicTitle),
      detail: m.s3PublicDetail(subject(b.id)),
      resource: b.id,
      related: [],
      fix: {
        label: m.s3PublicFix,
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
                  // a repeated bucket gets a block per instance (for_each / count chained on it)
                  ...perInstanceArgs(b, 'bucket', 'id'),
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

  // IAM policy documents (data sources) that grant every action on every resource, and are used
  for (const w of wildcardStatements(ir)) {
    findings.push({
      id: `iam-admin:${w.document.id}#${w.index}`,
      severity: 'high',
      ...say((x) => x.iamAdminTitle),
      detail: m.iamAdminDetail(w.document.id, w.index + 1, formatList(w.readers, 'conjunction', locale)),
      resource: w.document.id,
      related: w.readers.filter((id) => byId.has(id)),
    });
  }

  // 3. the VPC's default security group should stay empty (CIS AWS 5.4, Security Hub EC2.2)
  for (const r of ir.resources) {
    if (r.type !== 'aws_default_security_group') continue;
    const count = (topology.rules.get(r.id) ?? []).length + (topology.hidden.get(r.id) ?? []).length;
    if (count === 0) continue;
    findings.push({
      id: `default-sg:${r.id}`,
      severity: 'low',
      ...say((x) => x.defaultSgTitle),
      detail: m.defaultSgDetail(subject(r.id), count),
      resource: r.id,
      related: [],
    });
  }

  // 4. unused security groups (the default SG always exists; outputs / modules count as use)
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
      ...say((x) => x.unusedTitle),
      detail: m.unusedDetail(subject(r.id)),
      resource: r.id,
      related: [],
    });
  }

  for (const f of findings) {
    const kind = f.id.split(':')[0];
    const controls = controlsFor({ kind, type: byId.get(f.resource)?.type ?? '', ...ruleFacts.get(f.id) }, locale);
    if (controls.length) f.controls = controls;
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
  // a project of IAM roles and policy documents is audited once a document grants too much
  if (!auditable && !findings.some((f) => f.id.startsWith('iam-admin:'))) {
    return { locale, findings, counts, score: null, grade: null, topology, risks };
  }
  const score = scoreOf(findings);
  return { locale, findings, counts, score, grade: gradeOf(score), topology, risks };
}

/** the letter for a score */
export const gradeOf = (score: number): NonNullable<AuditResult['grade']> =>
  score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

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
  const audit = (x: IR) => auditSecurity(x, analyzeSecurity(x, 'en'));
  const before = audit(ir).findings.length;
  let scratch = ir;
  const ops: Op[] = [];
  // rule ids are positional — once a fix removes a block the next one takes its id, so key on what it says
  const key = (f: Finding) => `${f.id}|${f.title}|${f.detail}`;
  const tried = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    const next = audit(scratch).findings.find((f) => f.fix && !tried.has(key(f)));
    if (!next) break;
    tried.add(key(next));
    const step = next.fix!.ops(scratch);
    if (step.length === 0) continue;
    ops.push(...step);
    scratch = applyOps(scratch, step).ir;
  }
  const after = audit(scratch).findings.length;
  return { ops, fixed: Math.max(0, before - after) };
}
