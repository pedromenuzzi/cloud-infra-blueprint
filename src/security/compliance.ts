/**
 * Compliance mapping: the benchmark controls an audit finding fails.
 *
 * Source note — control IDs and titles as published in:
 *   CIS Amazon Web Services Foundations Benchmark v3.0.0, section 5 (Networking)
 *   AWS Security Hub, AWS Foundational Security Best Practices (FSBP) control reference
 *   CIS Microsoft Azure Foundations Benchmark v2.0.0, section 6 (Networking)
 *   CIS Google Cloud Platform Foundation Benchmark v3.0.0, section 3 (Networking)
 * (Titles, in every UI language, are in compliance.messages.ts.)
 * Only controls the audit decides from the Terraform alone are mapped; a
 * finding the audit can't verify (ports written as expressions) maps to none.
 * "Remote server administration ports" are TCP 22 and 3389, as in the CIS
 * audit procedures; the EC2.19 high-risk ports are Security Hub's defaults.
 */
import { currentLocale, type Locale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { complianceMessages, type ControlRef } from './compliance.messages';
import type { IpFamily, OwnerKind } from './model';
import { portsHas, type Traffic } from './traffic';

export type FrameworkId = 'cis-aws' | 'aws-fsbp' | 'cis-azure' | 'cis-gcp';

export interface Framework {
  id: FrameworkId;
  name: string;
  /** badge prefix */
  short: string;
  version: string;
}

export const FRAMEWORKS: Framework[] = [
  { id: 'cis-aws', name: 'CIS AWS Foundations Benchmark', short: 'CIS AWS', version: 'v3.0.0' },
  { id: 'aws-fsbp', name: 'AWS Foundational Security Best Practices', short: 'FSBP', version: 'Security Hub' },
  { id: 'cis-azure', name: 'CIS Microsoft Azure Foundations Benchmark', short: 'CIS Azure', version: 'v2.0.0' },
  { id: 'cis-gcp', name: 'CIS Google Cloud Platform Foundation Benchmark', short: 'CIS GCP', version: 'v3.0.0' },
];

export const frameworkOf = (id: FrameworkId): Framework => FRAMEWORKS.find((f) => f.id === id)!;

export interface Control {
  framework: FrameworkId;
  id: string;
  title: string;
}

/** What the audit knows about a finding, to match it against the table. */
export interface FindingFacts {
  /** the finding's kind: its id up to the first ':' (rule, imdsv2, rds-public…) */
  kind: string;
  /** type of the resource the finding is about (for rule findings: the SG / NACL / NSG / firewall) */
  type: string;
  /** rule findings: the owner's kind, the internet traffic the rule admits, and from which families */
  owner?: OwnerKind;
  traffic?: Traffic;
  families?: IpFamily[];
}

const tcp = (f: FindingFacts, port: number) => !!f.traffic && portsHas(f.traffic.tcp, port);
const admin = (f: FindingFacts) => tcp(f, 22) || tcp(f, 3389);
const ruleOf = (f: FindingFacts, owner: OwnerKind) => f.kind === 'rule' && f.owner === owner && !!f.traffic;
const v4 = (f: FindingFacts) => f.families?.includes('ipv4') ?? false;
const v6 = (f: FindingFacts) => f.families?.includes('ipv6') ?? false;

const HIGH_RISK_PORTS = [20, 21, 22, 23, 25, 110, 135, 143, 445, 1433, 1434, 3000, 3306, 3389, 4333, 5000, 5432, 5500, 5601, 8080, 8088, 8888, 9200, 9300];
const highRisk = (f: FindingFacts) =>
  !!f.traffic && HIGH_RISK_PORTS.some((p) => portsHas(f.traffic!.tcp, p) || portsHas(f.traffic!.udp, p));
/** EC2.18's default authorized ports: TCP 80 and 443, nothing else */
const unauthorized = (f: FindingFacts) => {
  const t = f.traffic;
  if (!t) return false;
  return t.udp.length > 0 || t.icmp || t.other || t.tcp.some(([a, b]) => !(a === b && (a === 80 || a === 443)));
};
const naclAdmin = (f: FindingFacts) => (ruleOf(f, 'nacl') && v4(f) && admin(f)) || (f.kind === 'nacl-open' && v4(f));
const defaultSg = (f: FindingFacts) => f.kind === 'default-sg' || (ruleOf(f, 'sg') && f.type === 'aws_default_security_group');

/** The mapping table: each control, and when a finding fails it. */
const TABLE: Array<{ ref: ControlRef; applies(f: FindingFacts): boolean }> = [
  { ref: 'cis-aws 5.1', applies: naclAdmin },
  { ref: 'cis-aws 5.2', applies: (f) => ruleOf(f, 'sg') && v4(f) && admin(f) },
  { ref: 'cis-aws 5.3', applies: (f) => ruleOf(f, 'sg') && v6(f) && admin(f) },
  { ref: 'cis-aws 5.4', applies: defaultSg },
  { ref: 'aws-fsbp EC2.2', applies: defaultSg },
  { ref: 'aws-fsbp EC2.8', applies: (f) => f.kind === 'imdsv2' && f.type === 'aws_instance' },
  { ref: 'aws-fsbp EC2.13', applies: (f) => ruleOf(f, 'sg') && tcp(f, 22) },
  { ref: 'aws-fsbp EC2.14', applies: (f) => ruleOf(f, 'sg') && tcp(f, 3389) },
  { ref: 'aws-fsbp EC2.18', applies: (f) => ruleOf(f, 'sg') && unauthorized(f) },
  { ref: 'aws-fsbp EC2.19', applies: (f) => ruleOf(f, 'sg') && highRisk(f) },
  { ref: 'aws-fsbp EC2.21', applies: naclAdmin },
  { ref: 'aws-fsbp RDS.2', applies: (f) => f.kind === 'rds-public' },
  { ref: 'aws-fsbp RDS.3', applies: (f) => f.kind === 'rds-encryption' && f.type === 'aws_db_instance' },
  { ref: 'aws-fsbp S3.1', applies: (f) => f.kind === 's3-public' },
  { ref: 'aws-fsbp S3.8', applies: (f) => f.kind === 's3-public' },
  { ref: 'aws-fsbp ELB.1', applies: (f) => f.kind === 'lb-http' },
  { ref: 'cis-azure 6.1', applies: (f) => ruleOf(f, 'nsg') && tcp(f, 3389) },
  { ref: 'cis-azure 6.2', applies: (f) => ruleOf(f, 'nsg') && tcp(f, 22) },
  { ref: 'cis-gcp 3.6', applies: (f) => ruleOf(f, 'firewall') && tcp(f, 22) },
  { ref: 'cis-gcp 3.7', applies: (f) => ruleOf(f, 'firewall') && tcp(f, 3389) },
];

function controlOf(ref: ControlRef, locale: Locale): Control {
  const [framework, id] = ref.split(' ') as [FrameworkId, string];
  return { framework, id, title: messagesFor(complianceMessages, locale)[ref] };
}

/** Every control in the table, titles in `locale` (the PDF lists the failed ones). */
export function controlsIn(locale: Locale = currentLocale()): Control[] {
  return TABLE.map((row) => controlOf(row.ref, locale));
}

/** Every control in the table, with its published (English) title. */
export const CONTROLS: Control[] = controlsIn('en');

/** Controls a finding fails, in table order (CIS AWS, FSBP, CIS Azure, CIS GCP), titles in `locale`. */
export function controlsFor(facts: FindingFacts, locale: Locale = currentLocale()): Control[] {
  return TABLE.filter((row) => row.applies(facts)).map((row) => controlOf(row.ref, locale));
}

/** "CIS AWS 5.2", "FSBP EC2.13" */
export const controlLabel = (c: Control) => `${frameworkOf(c.framework).short} ${c.id}`;
