/**
 * Compliance mapping: the benchmark controls an audit finding fails.
 *
 * Source note — control IDs and titles as published in:
 *   CIS Amazon Web Services Foundations Benchmark v3.0.0, section 5 (Networking)
 *   AWS Security Hub, AWS Foundational Security Best Practices (FSBP) control reference
 *   CIS Microsoft Azure Foundations Benchmark v2.0.0, section 6 (Networking)
 *   CIS Google Cloud Platform Foundation Benchmark v3.0.0, section 3 (Networking)
 * Only controls the audit decides from the Terraform alone are mapped; a
 * finding the audit can't verify (ports written as expressions) maps to none.
 * "Remote server administration ports" are TCP 22 and 3389, as in the CIS
 * audit procedures; the EC2.19 high-risk ports are Security Hub's defaults.
 */
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

/** The mapping table. */
const TABLE: Array<Control & { applies(f: FindingFacts): boolean }> = [
  {
    framework: 'cis-aws',
    id: '5.1',
    title: 'Ensure no Network ACLs allow ingress from 0.0.0.0/0 to remote server administration ports',
    applies: naclAdmin,
  },
  {
    framework: 'cis-aws',
    id: '5.2',
    title: 'Ensure no security groups allow ingress from 0.0.0.0/0 to remote server administration ports',
    applies: (f) => ruleOf(f, 'sg') && v4(f) && admin(f),
  },
  {
    framework: 'cis-aws',
    id: '5.3',
    title: 'Ensure no security groups allow ingress from ::/0 to remote server administration ports',
    applies: (f) => ruleOf(f, 'sg') && v6(f) && admin(f),
  },
  {
    framework: 'cis-aws',
    id: '5.4',
    title: 'Ensure the default security group of every VPC restricts all traffic',
    applies: defaultSg,
  },
  {
    framework: 'aws-fsbp',
    id: 'EC2.2',
    title: 'VPC default security groups should not allow inbound or outbound traffic',
    applies: defaultSg,
  },
  {
    framework: 'aws-fsbp',
    id: 'EC2.8',
    title: 'EC2 instances should use Instance Metadata Service Version 2 (IMDSv2)',
    applies: (f) => f.kind === 'imdsv2' && f.type === 'aws_instance',
  },
  {
    framework: 'aws-fsbp',
    id: 'EC2.13',
    title: 'Security groups should not allow ingress from 0.0.0.0/0 or ::/0 to port 22',
    applies: (f) => ruleOf(f, 'sg') && tcp(f, 22),
  },
  {
    framework: 'aws-fsbp',
    id: 'EC2.14',
    title: 'Security groups should not allow ingress from 0.0.0.0/0 or ::/0 to port 3389',
    applies: (f) => ruleOf(f, 'sg') && tcp(f, 3389),
  },
  {
    framework: 'aws-fsbp',
    id: 'EC2.18',
    title: 'Security groups should only allow unrestricted incoming traffic for authorized ports',
    applies: (f) => ruleOf(f, 'sg') && unauthorized(f),
  },
  {
    framework: 'aws-fsbp',
    id: 'EC2.19',
    title: 'Security groups should not allow unrestricted access to ports with high risk',
    applies: (f) => ruleOf(f, 'sg') && highRisk(f),
  },
  {
    framework: 'aws-fsbp',
    id: 'EC2.21',
    title: 'Network ACLs should not allow ingress from 0.0.0.0/0 to port 22 or port 3389',
    applies: naclAdmin,
  },
  {
    framework: 'aws-fsbp',
    id: 'RDS.2',
    title: 'RDS DB instances should prohibit public access, as determined by the PubliclyAccessible configuration',
    applies: (f) => f.kind === 'rds-public',
  },
  {
    framework: 'aws-fsbp',
    id: 'RDS.3',
    title: 'RDS DB instances should have encryption at-rest enabled',
    applies: (f) => f.kind === 'rds-encryption' && f.type === 'aws_db_instance',
  },
  {
    framework: 'aws-fsbp',
    id: 'S3.1',
    title: 'S3 general purpose buckets should have block public access settings enabled',
    applies: (f) => f.kind === 's3-public',
  },
  {
    framework: 'aws-fsbp',
    id: 'S3.8',
    title: 'S3 general purpose buckets should block public access',
    applies: (f) => f.kind === 's3-public',
  },
  {
    framework: 'aws-fsbp',
    id: 'ELB.1',
    title: 'Application Load Balancer should be configured to redirect all HTTP requests to HTTPS',
    applies: (f) => f.kind === 'lb-http',
  },
  {
    framework: 'cis-azure',
    id: '6.1',
    title: 'Ensure that RDP access from the Internet is evaluated and restricted',
    applies: (f) => ruleOf(f, 'nsg') && tcp(f, 3389),
  },
  {
    framework: 'cis-azure',
    id: '6.2',
    title: 'Ensure that SSH access from the Internet is evaluated and restricted',
    applies: (f) => ruleOf(f, 'nsg') && tcp(f, 22),
  },
  {
    framework: 'cis-gcp',
    id: '3.6',
    title: 'Ensure that SSH access is restricted from the internet',
    applies: (f) => ruleOf(f, 'firewall') && tcp(f, 22),
  },
  {
    framework: 'cis-gcp',
    id: '3.7',
    title: 'Ensure that RDP access is restricted from the internet',
    applies: (f) => ruleOf(f, 'firewall') && tcp(f, 3389),
  },
];

/** Every control in the table (the PDF lists the failed ones). */
export const CONTROLS: Control[] = TABLE.map(({ framework, id, title }) => ({ framework, id, title }));

/** Controls a finding fails, in table order (CIS AWS, FSBP, CIS Azure, CIS GCP). */
export function controlsFor(facts: FindingFacts): Control[] {
  return TABLE.filter((c) => c.applies(facts)).map((c) => CONTROLS[TABLE.indexOf(c)]);
}

/** "CIS AWS 5.2", "FSBP EC2.13" */
export const controlLabel = (c: Control) => `${frameworkOf(c.framework).short} ${c.id}`;
