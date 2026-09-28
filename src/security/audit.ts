/**
 * Security audit: findings with severity, plain-language explanations and
 * one-click fixes (ops computed against the IR at click time), plus a score.
 */
import { block, lit, ref } from '@/ir/expr';
import type { Op } from '@/ir/ops';
import type { Expression, IR, ResourceNode } from '@/ir/types';
import { resourceAddress } from '@/ir/types';
import { restrictRuleOp } from './edit';
import { blocksOf, coversPort, fromInternet, serviceName, type SecurityRule } from './model';
import { analyzeSecurity, type SecurityTopology } from './topology';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
const WEIGHT: Record<Severity, number> = { critical: 20, high: 10, medium: 4, low: 1 };

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
  fix?: { label: string; ops(ir: IR): Op[] };
}

export interface AuditResult {
  findings: Finding[];
  counts: Record<Severity, number>;
  /** 0–100, null when there is nothing to audit */
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  topology: SecurityTopology;
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
}

/** Why an individual rule is dangerous (inbound, allowed, from anywhere). */
export function ruleRisk(rule: SecurityRule): RuleRisk | null {
  if (rule.direction !== 'inbound' || rule.action !== 'allow' || !fromInternet(rule)) return null;
  if (rule.protocol === 'all') return { severity: 'critical', title: 'Every port is open to the internet' };
  if ((rule.protocol === 'tcp' || rule.protocol === 'udp') && rule.fromPort === null) {
    return { severity: 'critical', title: `All ${rule.protocol.toUpperCase()} ports are open to the internet` };
  }
  for (const [port, name, severity] of ADMIN_PORTS) {
    if (coversPort(rule, port)) return { severity, title: `${name} (port ${port}) is open to the internet` };
  }
  for (const [port, name] of DATA_PORTS) {
    if (coversPort(rule, port)) return { severity: 'critical', title: `${name} (port ${port}) is open to the internet` };
  }
  if (rule.fromPort !== null && rule.toPort !== null && rule.toPort - rule.fromPort >= 100) {
    return { severity: 'medium', title: `Wide port range ${rule.fromPort}–${rule.toPort} is open to the internet` };
  }
  return null;
}

// ------------------------------------------------------------ helpers

const lit_ = (r: ResourceNode, k: string) => (r.args[k]?.kind === 'literal' ? r.args[k].value : undefined);

function refTarget(r: ResourceNode | undefined, key: string): string | undefined {
  const e = r?.args[key];
  if (e?.kind !== 'ref') return undefined;
  const [type, name] = e.path.split('.');
  return type && name ? `${type}.${name}` : undefined;
}

/** a private range to narrow an "anywhere" rule to */
function restrictTarget(ir: IR, owner: ResourceNode): string {
  const byId = (id?: string) => (id ? ir.resources.find((r) => r.id === id) : undefined);
  if (owner.type === 'aws_security_group' || owner.type === 'aws_network_acl') {
    const vpc = byId(refTarget(owner, 'vpc_id'));
    const cidr = vpc ? lit_(vpc, 'cidr_block') : undefined;
    return typeof cidr === 'string' ? cidr : '10.0.0.0/16';
  }
  if (owner.type === 'azurerm_network_security_group') return 'VirtualNetwork';
  if (owner.type === 'google_compute_firewall') {
    const net = refTarget(owner, 'network');
    const sub = ir.resources.find((r) => r.type === 'google_compute_subnetwork' && refTarget(r, 'network') === net);
    const cidr = sub ? lit_(sub, 'ip_cidr_range') : undefined;
    return typeof cidr === 'string' ? cidr : '10.0.0.0/8';
  }
  return '10.0.0.0/8';
}

function fixForRule(ir: IR, rule: SecurityRule): Finding['fix'] {
  const owner = ir.resources.find((r) => r.id === rule.owner);
  if (!owner) return undefined;
  const target = restrictTarget(ir, owner);
  const label =
    target === 'VirtualNetwork' ? 'Restrict to the virtual network' : `Restrict to ${target}`;
  if (rule.origin.kind === 'inline') {
    const { field, index } = rule.origin;
    return {
      label,
      ops: (current) => {
        const node = current.resources.find((r) => r.id === rule.owner);
        const op = node ? restrictRuleOp(node, rule.ownerKind, field, index, target) : null;
        return op ? [op] : [];
      },
    };
  }
  const ruleId = rule.origin.id;
  return {
    label,
    ops: (current) => {
      const r = current.resources.find((x) => x.id === ruleId);
      if (!r) return [];
      switch (r.type) {
        case 'aws_vpc_security_group_ingress_rule':
          return [{ kind: 'set_arg', nodeId: r.id, field: 'cidr_ipv4', value: lit(target) }];
        case 'aws_security_group_rule':
          return [{ kind: 'set_arg', nodeId: r.id, field: 'cidr_blocks', value: { kind: 'list', items: [lit(target)] } }];
        case 'azurerm_network_security_rule':
          return [{ kind: 'set_arg', nodeId: r.id, field: 'source_address_prefix', value: lit(target) }];
        default:
          return [];
      }
    },
  };
}

// ------------------------------------------------------------ audit

export function auditSecurity(ir: IR, topology: SecurityTopology = analyzeSecurity(ir)): AuditResult {
  const findings: Finding[] = [];
  const name = (id: string) => id.split('.').slice(1).join('.') || id;

  // 1. rules open to the internet
  for (const [owner, rules] of topology.rules) {
    const reachable = (topology.protects.get(owner) ?? []).filter(
      (id) => topology.exposure.get(id)?.level === 'internet',
    );
    for (const rule of rules) {
      const risk = ruleRisk(rule);
      if (!risk) continue;
      const via = rule.origin.kind === 'resource' ? ` (${rule.origin.id})` : '';
      findings.push({
        id: `rule:${rule.id}`,
        severity: risk.severity,
        title: risk.title,
        detail:
          `${name(owner)}${via} allows ${serviceName(rule)} from anywhere (0.0.0.0/0).` +
          (reachable.length
            ? ` Reachable right now on ${reachable.map(name).join(', ')}.`
            : ' Nothing public uses it yet — but the next resource that does will be exposed.'),
        resource: owner,
        related: reachable,
        ruleId: rule.id,
        fix: fixForRule(ir, rule),
      });
    }
    // NACL that lets everything in
    const ownerNode = ir.resources.find((r) => r.id === owner);
    if (ownerNode?.type === 'aws_network_acl') {
      const allowAll = rules.find(
        (r) => r.direction === 'inbound' && r.action === 'allow' && r.protocol === 'all' && fromInternet(r),
      );
      if (allowAll && !rules.some((r) => r.direction === 'inbound' && r.action === 'deny')) {
        findings.push({
          id: `nacl-open:${owner}`,
          severity: 'low',
          title: 'Network ACL allows all inbound traffic',
          detail: `${name(owner)} has no deny rules and allows every protocol from anywhere — it adds no protection beyond the security groups.`,
          resource: owner,
          related: [],
        });
      }
    }
  }

  // 2. resource hardening
  const setArg = (id: string, field: string, value: Expression): Op[] => [
    { kind: 'set_arg', nodeId: id, field, value },
  ];
  const buckets = ir.resources.filter((r) => r.type === 'aws_s3_bucket');
  const blocked = new Set(
    ir.resources.filter((r) => r.type === 'aws_s3_bucket_public_access_block').map((r) => refTarget(r, 'bucket')),
  );
  for (const r of ir.resources) {
    if (r.type === 'aws_db_instance' || r.type === 'aws_rds_cluster') {
      if (lit_(r, 'publicly_accessible') === true) {
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
    if (r.type === 'aws_instance') {
      const tokens = blocksOf(r.args.metadata_options)[0]?.http_tokens;
      if (!(tokens?.kind === 'literal' && tokens.value === 'required')) {
        findings.push({
          id: `imdsv2:${r.id}`,
          severity: 'medium',
          title: 'Instance metadata allows IMDSv1',
          detail: `${name(r.id)} accepts token-less metadata requests, the classic SSRF path to stealing instance credentials. Require IMDSv2.`,
          resource: r.id,
          related: [],
          fix: {
            label: 'Require IMDSv2',
            ops: (current) => {
              const node = current.resources.find((x) => x.id === r.id);
              const existing = blocksOf(node?.args.metadata_options)[0] ?? {};
              return setArg(
                r.id,
                'metadata_options',
                block({ ...existing, http_endpoint: lit('enabled'), http_tokens: lit('required') }),
              );
            },
          },
        });
      }
    }
    if (r.type === 'aws_lb' && lit_(r, 'internal') !== true) {
      const listeners = ir.resources.filter((l) => l.type === 'aws_lb_listener' && refTarget(l, 'load_balancer_arn') === r.id);
      if (listeners.length > 0 && !listeners.some((l) => lit_(l, 'protocol') === 'HTTPS')) {
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
  for (const b of buckets) {
    if (blocked.has(b.id)) continue;
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

  // 3. unused security groups
  const referencedByRules = new Set(
    [...topology.rules.values()].flat().flatMap((r) => r.peers.flatMap((p) => (p.kind === 'group' ? [p.ref] : []))),
  );
  for (const r of ir.resources) {
    if (r.type !== 'aws_security_group' && r.type !== 'azurerm_network_security_group') continue;
    if ((topology.protects.get(r.id) ?? []).length > 0 || referencedByRules.has(r.id)) continue;
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
      ['aws_db_instance', 'aws_rds_cluster', 'aws_instance', 'aws_s3_bucket', 'aws_lb'].includes(r.type),
  );
  if (!auditable) return { findings, counts, score: null, grade: null, topology };
  const score = Math.max(0, 100 - findings.reduce((sum, f) => sum + WEIGHT[f.severity], 0));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return { findings, counts, score, grade, topology };
}
