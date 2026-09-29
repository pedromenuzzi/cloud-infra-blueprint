import { describe, expect, it } from 'vitest';
import { formatList } from '@/i18n/format';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import type { Op } from '@/ir/ops';
import type { IR } from '@/ir/types';
import { TEMPLATES } from '@/templates';
import type { AccessExplanation, PathStep } from './access';
import { auditSecurity, planFixAll, ruleRisk } from './audit';
import { coversFamily, isPrivateCidr, parseCidr } from './cidr';
import { controlLabel, CONTROLS, FRAMEWORKS } from './compliance';
import { securityDelta } from './delta';
import {
  addRuleOps,
  mixesStyles,
  nextPriority,
  PLACEHOLDER_CIDR,
  PRESETS,
  presetDraft,
  removeRuleOps,
  ruleStyle,
  updateRuleOps,
} from './edit';
import { extractRules, extractSecurity, peerLabel, serviceName, type SecurityRule } from './model';
import { analyzeSecurity } from './topology';
import { evaluateInbound, NO_TRAFFIC, trafficLabels, trafficUnion } from './traffic';

const AWS = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
}
resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
resource "aws_security_group" "alb" {
  vpc_id = aws_vpc.main.id
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "app" {
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "db" {
  vpc_id = aws_vpc.main.id
}
resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_lb" "web" {
  internal        = false
  subnets         = [aws_subnet.public.id]
  security_groups = [aws_security_group.alb.id]
}
resource "aws_instance" "app" {
  ami                    = "ami-1"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.app.id]
}
resource "aws_db_instance" "db" {
  engine                 = "postgres"
  instance_class         = "db.t3.micro"
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = true
}
resource "aws_network_acl" "private" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = [aws_subnet.private.id]
  ingress {
    rule_no    = 100
    action     = "allow"
    protocol   = "tcp"
    from_port  = 8080
    to_port    = 8080
    cidr_block = "10.0.0.0/16"
  }
}
`;

/** a VPC with one IGW-routed subnet that hands out public IPs */
const VPC = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
}
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
`;

const sshSg = (name: string, peers = 'cidr_blocks = ["0.0.0.0/0"]', vpc = 'aws_vpc.main.id') => `
resource "aws_security_group" "${name}" {
  vpc_id = ${vpc}
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    ${peers}
  }
}
`;

const instance = (name: string, sg: string, extra = 'subnet_id = aws_subnet.public.id') => `
resource "aws_instance" "${name}" {
  ami                    = "ami-1"
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.${sg}.id]
  ${extra}
  metadata_options {
    http_tokens = "required"
  }
}
`;

const AZURE_BASE = `
resource "azurerm_subnet" "app" {
  name                 = "app"
  resource_group_name  = "rg"
  virtual_network_name = "vnet"
  address_prefixes     = ["10.0.1.0/24"]
}
resource "azurerm_public_ip" "vm" {
  name                = "vm-ip"
  location            = "eastus"
  resource_group_name = "rg"
  allocation_method   = "Static"
}
resource "azurerm_network_interface" "vm" {
  name                = "vm-nic"
  location            = "eastus"
  resource_group_name = "rg"
  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.app.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.vm.id
  }
}
resource "azurerm_linux_virtual_machine" "vm" {
  name                  = "vm"
  size                  = "Standard_B1s"
  admin_username        = "azureuser"
  location              = "eastus"
  resource_group_name   = "rg"
  network_interface_ids = [azurerm_network_interface.vm.id]
}
`;

const nsgRule = (fields: string) => `
  security_rule {
    source_port_range          = "*"
    destination_address_prefix = "*"
    ${fields}
  }`;

const nsg = (name: string, rules: string, assoc: 'subnet' | 'nic' = 'subnet') => `
resource "azurerm_network_security_group" "${name}" {
  name                = "${name}"
  location            = "eastus"
  resource_group_name = "rg"
${rules}
}
${
  assoc === 'subnet'
    ? `resource "azurerm_subnet_network_security_group_association" "${name}" {
  subnet_id                 = azurerm_subnet.app.id
  network_security_group_id = azurerm_network_security_group.${name}.id
}`
    : `resource "azurerm_network_interface_security_group_association" "${name}" {
  network_interface_id      = azurerm_network_interface.vm.id
  network_security_group_id = azurerm_network_security_group.${name}.id
}`
}
`;

const GCP_BASE = `
resource "google_compute_network" "vpc" {
  name                    = "vpc"
  auto_create_subnetworks = false
}
resource "google_compute_subnetwork" "app" {
  name          = "app"
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/24"
}
resource "google_compute_instance" "web" {
  name         = "web"
  machine_type = "e2-micro"
  tags         = ["web"]
  network_interface {
    network = google_compute_network.vpc.id
    access_config {}
  }
}
`;

const load = (src: string) => parseProject({ 'main.tf': src });
const allRules = (ir: IR) => [...extractRules(ir).values()].flat();
const ruleById = (ir: IR, id: string) => {
  const r = allRules(ir).find((x) => x.id === id);
  expect(r, `rule ${id}`).toBeDefined();
  return r!;
};
const findingIds = (src: string) => auditSecurity(load(src).ir).findings.map((f) => f.id);

/** apply ops computed on the parsed source; the result must parse cleanly */
function run(src: string, make: (ir: IR) => Op[] | null) {
  const { ir } = load(src);
  const ops = make(ir);
  expect(ops).not.toBeNull();
  expect(ops!.length).toBeGreaterThan(0);
  const out = applyOpsWithPatches({ 'main.tf': src }, ir, ops!);
  expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return { text: out.files['main.tf'], ir: out.ir };
}

/** apply a finding's one-click fix, re-parse and re-audit: the finding is gone and the HCL is valid */
function applyFix(src: string, findingId: string) {
  const finding = auditSecurity(load(src).ir).findings.find((f) => f.id === findingId);
  expect(finding, `finding ${findingId}`).toBeDefined();
  expect(finding!.fix, `fix for ${findingId}`).toBeDefined();
  const result = run(src, (ir) => finding!.fix!.ops(ir));
  const audit = auditSecurity(result.ir);
  // ids are positional (a removed block shifts the next one into its place): compare what it says
  expect(audit.findings.filter((f) => f.title === finding!.title && f.detail === finding!.detail)).toEqual([]);
  return { ...result, audit, label: finding!.fix!.label };
}

// ============================================================ baseline

describe('security model (AWS)', () => {
  it('normalizes inline, standalone and NACL rules', () => {
    const rules = extractRules(load(AWS).ir);
    expect(rules.get('aws_security_group.alb')).toHaveLength(2);
    const app = rules.get('aws_security_group.app')!;
    expect(app.map((r) => serviceName(r))).toEqual(['HTTP alt', 'SSH']);
    expect(app[0].peers).toMatchObject([{ kind: 'group', ref: 'aws_security_group.alb' }]);
    const db = rules.get('aws_security_group.db')!;
    expect(db).toHaveLength(1);
    expect(db[0]).toMatchObject({ origin: { kind: 'resource' }, fromPort: 5432, peers: [{ kind: 'group', ref: 'aws_security_group.app' }] });
    expect(rules.get('aws_network_acl.private')![0]).toMatchObject({ ownerKind: 'nacl', priority: 100, action: 'allow' });
  });

  it('finds public subnets, exposure and the allowed traffic flows', () => {
    const t = analyzeSecurity(load(AWS).ir);
    expect(t.subnets.get('aws_subnet.public')).toBe('public');
    expect(t.subnets.get('aws_subnet.private')).toBe('private');
    expect(t.subnetNacls.get('aws_subnet.private')).toEqual(['aws_network_acl.private']);

    expect(t.exposure.get('aws_lb.web')).toMatchObject({ level: 'internet', ports: ['443'] });
    // SSH is open on the app SG, but the instance lives in a private subnet
    expect(t.exposure.get('aws_instance.app')?.level).toBe('restricted');
    // public endpoint, but its SG only admits the app tier
    expect(t.exposure.get('aws_db_instance.db')?.level).toBe('restricted');

    const flows = Object.fromEntries(t.flows.map((f) => [f.id, f.ports]));
    expect(flows).toEqual({
      'internet->aws_lb.web': ['443'],
      'aws_lb.web->aws_instance.app': ['8080'],
      'aws_instance.app->aws_db_instance.db': ['5432'],
    });
  });
});

describe('security audit', () => {
  it('reports what is wrong, worst first, with a grade', () => {
    const audit = auditSecurity(load(AWS).ir);
    expect(audit.findings.map((f) => [f.severity, f.title])).toEqual([
      ['critical', 'SSH (port 22) is open to the internet'],
      ['high', 'Database is publicly accessible'],
      ['medium', 'Instance metadata allows IMDSv1'],
      ['medium', 'Database storage is not encrypted'],
    ]);
    expect(audit.score).toBe(49);
    expect(audit.grade).toBe('D');
  });

  it('one-click fixes rewrite the Terraform and clear every finding', () => {
    let files: Record<string, string> = { 'main.tf': AWS };
    for (let guard = 0; guard < 6; guard++) {
      const { ir } = parseProject(files);
      const fixable = auditSecurity(ir).findings.find((f) => f.fix);
      if (!fixable) break;
      files = applyOpsWithPatches(files, ir, fixable.fix!.ops(ir)).files;
    }
    const after = parseProject(files);
    expect(after.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const audit = auditSecurity(after.ir);
    expect(audit.findings).toEqual([]);
    expect(audit.grade).toBe('A');
    expect(files['main.tf']).toContain('cidr_blocks = ["10.0.0.0/16"]');
    expect(files['main.tf']).toMatch(/publicly_accessible\s*=\s*false/);
    expect(files['main.tf']).toMatch(/metadata_options \{[^}]*http_tokens\s*=\s*"required"/);
  });

  it('rates rule risk by what is exposed', () => {
    const base: Omit<SecurityRule, 'protocol' | 'fromPort' | 'toPort'> = {
      id: 'r',
      owner: 'o',
      ownerKind: 'sg',
      direction: 'inbound',
      action: 'allow',
      peers: [{ kind: 'any', value: '0.0.0.0/0' }],
      origin: { kind: 'resource', id: 'r' },
    };
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 443, toPort: 443 })).toBeNull();
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 5432, toPort: 5432 })?.severity).toBe('critical');
    expect(ruleRisk({ ...base, protocol: 'all', fromPort: null, toPort: null })?.severity).toBe('critical');
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 8000, toPort: 8999 })?.severity).toBe('medium');
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 22, toPort: 22, peers: [{ kind: 'cidr', value: '10.0.0.0/8' }] })).toBeNull();
  });
});

describe('cidr math', () => {
  it('parses v4 / v6, covers families and spots private ranges', () => {
    expect(parseCidr('10.0.0.0/16')).toMatchObject({ family: 'ipv4', prefix: 16 });
    expect(parseCidr('2001:db8::/32')).toMatchObject({ family: 'ipv6', prefix: 32 });
    expect(parseCidr('10.0.0.0/33')).toBeUndefined();
    expect(coversFamily(['0.0.0.0/1', '128.0.0.0/1'], 'ipv4')).toBe(true);
    expect(coversFamily(['0.0.0.0/1', '10.0.0.0/8'], 'ipv4')).toBe(false);
    expect(coversFamily(['::/1', '8000::/1'], 'ipv6')).toBe(true);
    expect(isPrivateCidr('10.1.0.0/16')).toBe(true);
    expect(isPrivateCidr('0.0.0.0/1')).toBe(false);
  });
});

describe('Azure and GCP', () => {
  it('Azure: NSG rules protect VMs through NIC / subnet associations', () => {
    const src = AZURE_BASE + nsg('vm', nsgRule('name = "rdp"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "3389"\n    source_address_prefix = "*"'));
    const audit = auditSecurity(load(src).ir);
    expect(audit.topology.exposure.get('azurerm_linux_virtual_machine.vm')).toMatchObject({ level: 'internet', ports: ['3389'] });
    expect(audit.findings[0]).toMatchObject({ severity: 'critical', title: 'RDP (port 3389) is open to the internet' });
    expect(audit.findings[0].fix?.label).toBe('Restrict to the virtual network');
  });

  it('GCP: firewalls target instances by tag', () => {
    const src = `${GCP_BASE}
resource "google_compute_firewall" "ssh" {
  name          = "allow-ssh"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}
resource "google_compute_instance" "worker" {
  name         = "worker"
  machine_type = "e2-micro"
  network_interface {
    network = google_compute_network.vpc.id
  }
}`;
    const t = analyzeSecurity(load(src).ir);
    expect(t.exposure.get('google_compute_instance.web')).toMatchObject({ level: 'internet', ports: ['22'] });
    expect(t.attachments.get('google_compute_instance.worker')).toBeUndefined();
    expect(auditSecurity(load(src).ir).findings[0].title).toBe('SSH (port 22) is open to the internet');
  });
});

// ============================================================ 1. deleting the last inline rule

describe('deleting the last inline rule (finding 1)', () => {
  it('SG: writes `ingress = []` so Terraform removes the rule, and the model sees no rules', () => {
    const src = VPC + sshSg('web') + instance('web', 'web');
    const { text, ir } = run(src, (x) => removeRuleOps(x, ruleById(x, 'aws_security_group.web:ingress:0')));
    expect(text).toMatch(/ingress\s*=\s*\[\]/);
    expect(extractRules(ir).get('aws_security_group.web')).toEqual([]);
    const audit = auditSecurity(ir);
    expect(audit.findings).toEqual([]);
    expect(audit.topology.exposure.get('aws_instance.web')?.level).toBe('isolated');
  });

  it('NACL and NSG: the same, for ingress and security_rule', () => {
    const nacl = `${VPC}
resource "aws_network_acl" "main" {
  vpc_id = aws_vpc.main.id
  ingress {
    rule_no    = 100
    action     = "allow"
    protocol   = "tcp"
    from_port  = 443
    to_port    = 443
    cidr_block = "0.0.0.0/0"
  }
}`;
    expect(run(nacl, (x) => removeRuleOps(x, ruleById(x, 'aws_network_acl.main:ingress:0'))).text).toMatch(/ingress\s*=\s*\[\]/);
    const azure = AZURE_BASE + nsg('web', nsgRule('name = "https"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "443"\n    source_address_prefix = "*"'));
    const { text, ir } = run(azure, (x) => removeRuleOps(x, ruleById(x, 'azurerm_network_security_group.web:security_rule:0')));
    expect(text).toMatch(/security_rule\s*=\s*\[\]/);
    expect(extractRules(ir).get('azurerm_network_security_group.web')).toEqual([]);
  });

  it('keeps dynamic blocks in charge: the static block goes away without `= []`', () => {
    const src = `${VPC}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  dynamic "ingress" {
    for_each = var.extra
    content {
      from_port = ingress.value
    }
  }
}`;
    const { text } = run(src, (x) => removeRuleOps(x, ruleById(x, 'aws_security_group.web:ingress:0')));
    expect(text).not.toMatch(/ingress\s*=\s*\[\]/);
    expect(text).toContain('dynamic "ingress"');
  });

  it('GCP: refuses to remove the last allow block (the firewall would be invalid)', () => {
    const src = `${GCP_BASE}
resource "google_compute_firewall" "web" {
  name          = "web"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}`;
    const { ir } = load(src);
    expect(removeRuleOps(ir, ruleById(ir, 'google_compute_firewall.web:allow:0'))).toBeNull();
  });
});

// ============================================================ 2. rules it can't represent

describe('editing never rewrites what it cannot represent (finding 2)', () => {
  const src = `${VPC}
variable "port" {
  type = number
}
variable "allowed" {
  type = list(string)
}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  ingress {
    description      = "app"
    from_port        = 8443
    to_port          = 8443
    protocol         = "tcp"
    cidr_blocks      = [aws_vpc.main.cidr_block]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    from_port   = var.port
    to_port     = var.port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed
  }
}`;

  it('reads references as what they are: VPC CIDRs are CIDRs, only SGs are groups', () => {
    const [app, byVar, byList] = extractRules(load(src).ir).get('aws_security_group.web')!;
    expect(app.peers).toMatchObject([
      { kind: 'cidr', value: '10.0.0.0/16' },
      { kind: 'any', value: '::/0' },
    ]);
    expect(peerLabel(app.peers[0])).toBe('aws_vpc.main.cidr_block (10.0.0.0/16)');
    expect(peerLabel(app.peers[1])).toBe('Internet (IPv6)');
    expect(byVar).toMatchObject({ portsExpr: 'var.port', unmodeled: ['from_port', 'to_port'] });
    expect(byList).toMatchObject({ peers: [{ kind: 'expr', value: 'var.allowed' }], unmodeled: ['cidr_blocks'] });
  });

  it('a description edit only touches the description', () => {
    const { text } = run(src, (x) => updateRuleOps(x, ruleById(x, 'aws_security_group.web:ingress:0'), { description: 'renamed' }));
    expect(text).toMatch(/description\s*=\s*"renamed"/);
    expect(text).toMatch(/cidr_blocks\s*=\s*\[aws_vpc\.main\.cidr_block\]/);
    expect(text).toMatch(/ipv6_cidr_blocks\s*=\s*\["::\/0"\]/);
    expect(text).not.toContain('security_groups');
    expect(text).not.toMatch(/cidr_blocks\s*=\s*\["0\.0\.0\.0\/0"\],?\s*\n\s*ipv6/);
    expect(text).toMatch(/from_port\s*=\s*var\.port/);
    expect(text).toMatch(/cidr_blocks\s*=\s*var\.allowed/);
  });

  it('removing one source keeps the other family as written', () => {
    const { text, ir } = run(src, (x) => {
      const rule = ruleById(x, 'aws_security_group.web:ingress:0');
      return updateRuleOps(x, rule, { peers: rule.peers.slice(1) });
    });
    expect(text).toMatch(/ipv6_cidr_blocks\s*=\s*\["::\/0"\]/);
    expect(ruleById(ir, 'aws_security_group.web:ingress:0').peers).toMatchObject([{ kind: 'any', value: '::/0' }]);
  });

  it('rows written with expressions are read-only', () => {
    const { ir } = load(src);
    expect(updateRuleOps(ir, ruleById(ir, 'aws_security_group.web:ingress:1'), { description: 'x' })).toEqual([]);
    expect(updateRuleOps(ir, ruleById(ir, 'aws_security_group.web:ingress:2'), { fromPort: 23, toPort: 23 })).toEqual([]);
  });

  it('Azure: "Internet" and multi-prefix sources survive a rename', () => {
    const azure = AZURE_BASE + nsg(
      'web',
      nsgRule('name = "web"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "443"\n    source_address_prefix = "Internet"') +
        nsgRule('name = "office"\n    priority = 110\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "22"\n    source_address_prefixes = ["203.0.113.0/24", "198.51.100.0/24"]'),
    );
    const { text } = run(azure, (x) => [
      ...updateRuleOps(x, ruleById(x, 'azurerm_network_security_group.web:security_rule:0'), { description: 'public-web' }),
    ]);
    expect(text).toMatch(/source_address_prefix\s*=\s*"Internet"/);
    const second = run(text, (x) => updateRuleOps(x, ruleById(x, 'azurerm_network_security_group.web:security_rule:1'), { description: 'office-ssh' }));
    expect(second.text).toMatch(/source_address_prefixes\s*=\s*\["203\.0\.113\.0\/24", "198\.51\.100\.0\/24"\]/);
  });
});

// ============================================================ 3. split rows

describe('split rows edit only their element (finding 3)', () => {
  const gcp = `${GCP_BASE}
resource "google_compute_firewall" "web" {
  name          = "web"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
}`;

  it('GCP: editing the 80 row keeps 443; deleting the 443 row keeps 80', () => {
    const edited = run(gcp, (x) => updateRuleOps(x, ruleById(x, 'google_compute_firewall.web:allow:0#0'), { fromPort: 8080, toPort: 8080 }));
    expect(edited.text).toMatch(/ports\s*=\s*\["8080", "443"\]/);
    const removed = run(gcp, (x) => removeRuleOps(x, ruleById(x, 'google_compute_firewall.web:allow:0#1')));
    expect(removed.text).toMatch(/ports\s*=\s*\["80"\]/);
    expect(removed.text).toMatch(/allow \{/);
  });

  it('GCP: changing one element to another protocol splits it into its own block', () => {
    const { ir } = run(gcp, (x) => updateRuleOps(x, ruleById(x, 'google_compute_firewall.web:allow:0#0'), { protocol: 'udp' }));
    expect(extractRules(ir).get('google_compute_firewall.web')!.map((r) => [r.protocol, r.fromPort])).toEqual([
      ['tcp', 443],
      ['udp', 80],
    ]);
  });

  it('Azure: destination_port_ranges elements', () => {
    const azure = AZURE_BASE + nsg('web', nsgRule('name = "web"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_ranges = ["80", "443"]\n    source_address_prefix = "*"'));
    const edited = run(azure, (x) => updateRuleOps(x, ruleById(x, 'azurerm_network_security_group.web:security_rule:0#0'), { fromPort: 8080, toPort: 8080 }));
    expect(edited.text).toMatch(/destination_port_ranges\s*=\s*\["8080", "443"\]/);
    const removed = run(azure, (x) => removeRuleOps(x, ruleById(x, 'azurerm_network_security_group.web:security_rule:0#1')));
    expect(removed.text).toMatch(/destination_port_ranges\s*=\s*\["80"\]/);
    expect(extractRules(removed.ir).get('azurerm_network_security_group.web')).toHaveLength(1);
  });
});

// ============================================================ 12. inline vs standalone

describe('new rules follow the owner’s style (finding 12)', () => {
  it('SG with aws_vpc_security_group_ingress_rule rules gets another one, not an inline block', () => {
    const { ir } = load(AWS);
    const db = ir.resources.find((r) => r.id === 'aws_security_group.db')!;
    expect(ruleStyle(ir, db, 'inbound')).toEqual({ mode: 'resource', type: 'aws_vpc_security_group_ingress_rule' });
    const https = PRESETS.find((p) => p.id === 'https')!;
    const { text, ir: after } = run(AWS, (x) =>
      addRuleOps(x, x.resources.find((r) => r.id === 'aws_security_group.db')!, 'inbound', {
        ...https,
        peers: [{ kind: 'group', ref: 'aws_security_group.alb' }],
        description: 'HTTPS from ALB',
      }),
    );
    expect(text).not.toMatch(/resource "aws_security_group" "db" \{[^}]*ingress/);
    expect(text).toMatch(/resource "aws_vpc_security_group_ingress_rule" "db_https_from_alb" \{/);
    const rules = extractRules(after).get('aws_security_group.db')!;
    expect(rules.map((r) => [r.origin.kind, r.fromPort, r.description])).toEqual([
      ['resource', 5432, undefined],
      ['resource', 443, 'HTTPS from ALB'],
    ]);
    // and it is editable like any other row
    const edited = run(text, (x) => updateRuleOps(x, ruleById(x, 'aws_vpc_security_group_ingress_rule.db_https_from_alb'), { fromPort: 8443, toPort: 8443 }));
    expect(edited.text).toMatch(/from_port\s*=\s*8443/);
  });

  it('SG inline rules still get inline blocks', () => {
    const { text, ir } = run(AWS, (x) =>
      addRuleOps(x, x.resources.find((r) => r.id === 'aws_security_group.alb')!, 'inbound', {
        ...PRESETS[1],
        peers: [{ kind: 'any', value: '0.0.0.0/0' }],
        description: 'HTTP',
      }),
    );
    expect(text).toMatch(/resource "aws_security_group" "alb" \{[\s\S]*description\s*=\s*"HTTP"\n/);
    expect(extractRules(ir).get('aws_security_group.alb')!.filter((r) => r.direction === 'inbound')).toHaveLength(2);
  });

  it('Azure: standalone azurerm_network_security_rule, priorities counted across both', () => {
    const src = `${AZURE_BASE}
resource "azurerm_network_security_group" "web" {
  name                = "web"
  location            = "eastus"
  resource_group_name = "rg"
}
resource "azurerm_network_security_rule" "https" {
  name                        = "HTTPS"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "*"
  destination_address_prefix  = "*"
  resource_group_name         = "rg"
  network_security_group_name = azurerm_network_security_group.web.name
}`;
    const { ir } = load(src);
    const owner = ir.resources.find((r) => r.id === 'azurerm_network_security_group.web')!;
    expect(nextPriority(ir, owner, 'inbound')).toBe(110);
    const { draft } = presetDraft(ir, owner, 'inbound', 'https');
    const { text, ir: after } = run(src, (x) => addRuleOps(x, x.resources.find((r) => r.id === owner.id)!, 'inbound', draft));
    expect(text).not.toMatch(/security_rule \{/);
    const added = after.resources.find((r) => r.type === 'azurerm_network_security_rule' && r.id !== 'azurerm_network_security_rule.https')!;
    expect(added.args).toMatchObject({ priority: { value: 110 }, name: { value: 'HTTPS-2' } });
    expect(text).toMatch(/network_security_group_name\s*=\s*azurerm_network_security_group\.web\.name/);
  });

  it('decides per direction, and `ingress = []` keeps the SG in charge', () => {
    const src = `${VPC}
resource "aws_security_group" "web" {
  vpc_id  = aws_vpc.main.id
  ingress = []
}
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}`;
    const { ir } = load(src);
    const web = ir.resources.find((r) => r.id === 'aws_security_group.web')!;
    expect(ruleStyle(ir, web, 'inbound')).toEqual({ mode: 'inline', field: 'ingress' });
    expect(ruleStyle(ir, web, 'outbound')).toEqual({ mode: 'resource', type: 'aws_vpc_security_group_egress_rule' });
    expect(mixesStyles(ir, web)).toBe(false);
    const { text } = run(src, (x) => {
      const owner = x.resources.find((r) => r.id === 'aws_security_group.web')!;
      return addRuleOps(x, owner, 'inbound', presetDraft(x, owner, 'inbound', 'https').draft);
    });
    expect(text).not.toMatch(/ingress\s*=\s*\[\]/);
    expect(text).toMatch(/ingress \{/);
    // an inline egress next to the standalone egress rule is the conflicting mix the editor warns about
    const mixed = load(src.replace('ingress = []', 'egress = []')).ir;
    expect(mixesStyles(mixed, mixed.resources.find((r) => r.id === 'aws_security_group.web')!)).toBe(true);
  });

  it('NACL with aws_network_acl_rule rules gets another aws_network_acl_rule', () => {
    const src = `${VPC}
resource "aws_network_acl" "main" {
  vpc_id = aws_vpc.main.id
}
resource "aws_network_acl_rule" "https" {
  network_acl_id = aws_network_acl.main.id
  rule_number    = 100
  egress         = false
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 443
  to_port        = 443
}`;
    const { ir } = run(src, (x) => {
      const owner = x.resources.find((r) => r.id === 'aws_network_acl.main')!;
      return addRuleOps(x, owner, 'inbound', presetDraft(x, owner, 'inbound', 'ssh').draft);
    });
    const rules = extractRules(ir).get('aws_network_acl.main')!;
    expect(rules.map((r) => [r.origin.kind, r.priority, r.fromPort])).toEqual([
      ['resource', 100, 443],
      ['resource', 110, 22],
    ]);
  });
});

// ============================================================ 13. preset defaults

describe('presets start safe and valid (finding 13)', () => {
  it('admin and database presets never default to the internet', () => {
    const src = sshSg('web', 'cidr_blocks = ["10.0.0.0/8"]', 'var.vpc_id');
    const { ir } = load(src);
    const owner = ir.resources[0];
    for (const id of ['ssh', 'rdp', 'postgres', 'mysql', 'all']) {
      const { draft, placeholder } = presetDraft(ir, owner, 'inbound', id);
      expect(draft.peers).toEqual([{ kind: 'cidr', value: PLACEHOLDER_CIDR }]);
      expect(placeholder).toBe(true);
    }
    expect(presetDraft(ir, owner, 'inbound', 'https').draft.peers).toEqual([{ kind: 'any', value: '0.0.0.0/0' }]);
    // known VPC → its range, no placeholder
    const known = load(VPC + sshSg('web')).ir;
    const sg = known.resources.find((r) => r.id === 'aws_security_group.web')!;
    expect(presetDraft(known, sg, 'inbound', 'ssh')).toMatchObject({ draft: { peers: [{ value: '10.0.0.0/16' }] }, placeholder: false });
  });

  it('Azure: unique, valid names per NSG (both directions)', () => {
    const src = AZURE_BASE + nsg('web', '');
    let text = src;
    for (const [dir, preset] of [['inbound', 'https'], ['inbound', 'https'], ['inbound', 'app'], ['inbound', 'icmp'], ['outbound', 'https']] as const) {
      text = run(text, (x) => {
        const owner = x.resources.find((r) => r.id === 'azurerm_network_security_group.web')!;
        return addRuleOps(x, owner, dir, presetDraft(x, owner, dir, preset).draft);
      }).text;
    }
    const rules = extractRules(load(text).ir).get('azurerm_network_security_group.web')!;
    expect(rules.map((r) => r.description)).toEqual(['HTTPS', 'HTTPS-2', 'App-8080', 'ICMP-ping', 'HTTPS-3']);
    expect(rules.map((r) => r.priority)).toEqual([100, 110, 120, 130, 100]);
    expect(rules.find((r) => r.description === 'App-8080')!.peers).toEqual([expect.objectContaining({ kind: 'other', value: 'VirtualNetwork' })]);
  });

  it('NACL ICMP allows every ICMP type (type -1, code -1), ping included', () => {
    const src = `${VPC}
resource "aws_network_acl" "main" {
  vpc_id = aws_vpc.main.id
}`;
    const { text } = run(src, (x) => {
      const owner = x.resources.find((r) => r.id === 'aws_network_acl.main')!;
      return addRuleOps(x, owner, 'inbound', presetDraft(x, owner, 'inbound', 'icmp').draft);
    });
    expect(text).toMatch(/protocol\s*=\s*"icmp"/);
    expect(text).toMatch(/icmp_type\s*=\s*-1/);
    expect(text).toMatch(/icmp_code\s*=\s*-1/);
  });
});

// ============================================================ 4. one-click fixes

describe('one-click fixes (finding 4)', () => {
  const standalone = (body: string) => `${VPC}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
}
${body}
${instance('web', 'web')}`;

  it('aws_vpc_security_group_ingress_rule on ::/0: removes the rule (no conflicting cidr_ipv4)', () => {
    const src = standalone(`
resource "aws_vpc_security_group_ingress_rule" "ssh6" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv6         = "::/0"
}`);
    const { text, label } = applyFix(src, 'rule:aws_vpc_security_group_ingress_rule.ssh6');
    expect(label).toBe('Remove the rule');
    expect(text).not.toContain('aws_vpc_security_group_ingress_rule');
  });

  it('aws_vpc_security_group_ingress_rule on 0.0.0.0/0: restricts cidr_ipv4 to the VPC', () => {
    const src = standalone(`
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = "0.0.0.0/0"
}`);
    const { text } = applyFix(src, 'rule:aws_vpc_security_group_ingress_rule.ssh');
    expect(text).toMatch(/cidr_ipv4\s*=\s*"10\.0\.0\.0\/16"/);
    expect(text).not.toContain('cidr_ipv6');
  });

  it('aws_security_group_rule: both families closed, ::/0 removed', () => {
    const src = standalone(`
resource "aws_security_group_rule" "ssh" {
  type              = "ingress"
  security_group_id = aws_security_group.web.id
  protocol          = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_blocks       = ["0.0.0.0/0"]
  ipv6_cidr_blocks  = ["::/0"]
}`);
    const { text } = applyFix(src, 'rule:aws_security_group_rule.ssh');
    expect(text).toMatch(/cidr_blocks\s*=\s*\["10\.0\.0\.0\/16"\]/);
    expect(text).not.toContain('ipv6_cidr_blocks');
  });

  it('aws_security_group_rule on ::/0 only: removed, not turned into an IPv4 duplicate', () => {
    const src = standalone(`
resource "aws_security_group_rule" "ssh6" {
  type              = "ingress"
  security_group_id = aws_security_group.web.id
  protocol          = "tcp"
  from_port         = 22
  to_port           = 22
  ipv6_cidr_blocks  = ["::/0"]
}`);
    const { text } = applyFix(src, 'rule:aws_security_group_rule.ssh6');
    expect(text).not.toContain('aws_security_group_rule');
  });

  it('inline SG rule on ::/0 next to an IPv4 twin: the v6 rule goes, the v4 rule is restricted', () => {
    const src = `${VPC}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port        = 22
    to_port          = 22
    protocol         = "tcp"
    ipv6_cidr_blocks = ["::/0"]
  }
}
${instance('web', 'web')}`;
    const audit = auditSecurity(load(src).ir);
    // two distinguishable findings — one per family
    expect(audit.findings.map((f) => f.detail.match(/\(([^)]+)\)\./)?.[1])).toEqual(['0.0.0.0/0', '::/0']);
    const v6 = applyFix(src, 'rule:aws_security_group.web:ingress:1');
    expect(v6.text.match(/ingress \{/g)).toHaveLength(1);
    const both = planFixAll(load(src).ir);
    expect(both.fixed).toBe(2);
    const { text } = run(src, () => both.ops);
    expect(text.match(/ingress \{/g)).toHaveLength(1);
    expect(text).toMatch(/cidr_blocks\s*=\s*\["10\.0\.0\.0\/16"\]/);
  });

  it('azurerm_network_security_rule with source_address_prefixes: no conflicting singular prefix', () => {
    const src = `${AZURE_BASE}
resource "azurerm_network_security_group" "web" {
  name                = "web"
  location            = "eastus"
  resource_group_name = "rg"
}
resource "azurerm_subnet_network_security_group_association" "web" {
  subnet_id                 = azurerm_subnet.app.id
  network_security_group_id = azurerm_network_security_group.web.id
}
resource "azurerm_network_security_rule" "ssh" {
  name                        = "ssh"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefixes     = ["0.0.0.0/0"]
  destination_address_prefix  = "*"
  resource_group_name         = "rg"
  network_security_group_name = azurerm_network_security_group.web.name
}`;
    const { text, label } = applyFix(src, 'rule:azurerm_network_security_rule.ssh');
    expect(label).toBe('Restrict to the virtual network');
    expect(text).toMatch(/source_address_prefix\s*=\s*"VirtualNetwork"/);
    expect(text).not.toContain('source_address_prefixes');
    // other sources in the list are kept, without adding a tag to the list
    const mixed = applyFix(src.replace('["0.0.0.0/0"]', '["0.0.0.0/0", "203.0.113.0/24"]'), 'rule:azurerm_network_security_rule.ssh');
    expect(mixed.text).toMatch(/source_address_prefix\s*=\s*"203\.0\.113\.0\/24"/);
  });

  it('inline NACL on ::/0 and aws_network_acl_rule: fixed, not silently kept open', () => {
    const inline = `${VPC}
resource "aws_network_acl" "main" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = [aws_subnet.public.id]
  ingress {
    rule_no         = 100
    action          = "allow"
    protocol        = "tcp"
    from_port       = 22
    to_port         = 22
    ipv6_cidr_block = "::/0"
  }
  ingress {
    rule_no    = 110
    action     = "allow"
    protocol   = "tcp"
    from_port  = 22
    to_port    = 22
    cidr_block = "0.0.0.0/0"
  }
}`;
    const v6 = applyFix(inline, 'rule:aws_network_acl.main:ingress:0');
    expect(v6.text).not.toContain('ipv6_cidr_block');
    const v4 = applyFix(inline, 'rule:aws_network_acl.main:ingress:1');
    expect(v4.text).toMatch(/cidr_block\s*=\s*"10\.0\.0\.0\/16"/);

    const rule = `${VPC}
resource "aws_network_acl" "main" {
  vpc_id = aws_vpc.main.id
}
resource "aws_network_acl_rule" "ssh" {
  network_acl_id = aws_network_acl.main.id
  rule_number    = 100
  egress         = false
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 22
  to_port        = 22
}`;
    const fixed = applyFix(rule, 'rule:aws_network_acl_rule.ssh');
    expect(fixed.text).toMatch(/cidr_block\s*=\s*"10\.0\.0\.0\/16"/);
  });

  it('GCP: a firewall with no source ranges gets the subnetwork range', () => {
    const src = `${GCP_BASE}
resource "google_compute_firewall" "ssh" {
  name    = "ssh"
  network = google_compute_network.vpc.id
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}`;
    const { text, label } = applyFix(src, 'rule:google_compute_firewall.ssh:allow:0');
    expect(label).toBe('Restrict to 10.10.0.0/24');
    expect(text).toMatch(/source_ranges\s*=\s*\["10\.10\.0\.0\/24"\]/);
  });

  it('Azure inline "*", GCP explicit 0.0.0.0/0 and an expression-port rule are fixed the same way', () => {
    const azure = AZURE_BASE + nsg('vm', nsgRule('name = "rdp"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "3389"\n    source_address_prefix = "*"'));
    expect(applyFix(azure, 'rule:azurerm_network_security_group.vm:security_rule:0').text).toMatch(/source_address_prefix\s*=\s*"VirtualNetwork"/);
    const gcp = `${GCP_BASE}
resource "google_compute_firewall" "ssh" {
  name          = "ssh"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0", "35.235.240.0/20"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}`;
    expect(applyFix(gcp, 'rule:google_compute_firewall.ssh:allow:0').text).toMatch(/source_ranges\s*=\s*\["35\.235\.240\.0\/20", "10\.10\.0\.0\/24"\]/);
    const expr = VPC + sshSg('web').replace('from_port   = 22', 'from_port   = var.port').replace('to_port     = 22', 'to_port     = var.port') + instance('web', 'web');
    const { text } = applyFix(expr, 'rule:aws_security_group.web:ingress:0');
    expect(text).toMatch(/from_port\s*=\s*var\.port/);
    expect(text).toMatch(/cidr_blocks\s*=\s*\["10\.0\.0\.0\/16"\]/);
  });

  it('only some ports of a shared list are risky: those ports go, the safe ones stay public', () => {
    const src = `${GCP_BASE}
resource "google_compute_firewall" "web" {
  name          = "web"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["22", "80", "443"]
  }
}`;
    const { text, label, ir } = applyFix(src, 'rule:google_compute_firewall.web:allow:0');
    expect(label).toBe('Remove SSH from this rule');
    expect(text).toMatch(/ports\s*=\s*\["80", "443"\]/);
    expect(text).toMatch(/source_ranges\s*=\s*\["0\.0\.0\.0\/0"\]/);
    expect(analyzeSecurity(ir).exposure.get('google_compute_instance.web')).toMatchObject({ level: 'internet', ports: ['80', '443'] });
    const azure = AZURE_BASE + nsg('vm', nsgRule('name = "web"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_ranges = ["443", "3389"]\n    source_address_prefix = "*"'));
    expect(applyFix(azure, 'rule:azurerm_network_security_group.vm:security_rule:0').text).toMatch(/destination_port_ranges\s*=\s*\["443"\]/);
  });

  it('whole-internet CIDR pairs are restricted too', () => {
    const src = VPC + sshSg('web', 'cidr_blocks = ["0.0.0.0/1", "128.0.0.0/1"]') + instance('web', 'web');
    const { text } = applyFix(src, 'rule:aws_security_group.web:ingress:0');
    expect(text).toMatch(/cidr_blocks\s*=\s*\["10\.0\.0\.0\/16"\]/);
  });

  it('no fix when the VPC range is unknown (never guess 10.0.0.0/16)', () => {
    const src = sshSg('web', 'cidr_blocks = ["0.0.0.0/0"]', 'var.vpc_id');
    const finding = auditSecurity(load(src).ir).findings.find((f) => f.id === 'rule:aws_security_group.web:ingress:0');
    expect(finding).toBeDefined();
    expect(finding!.fix).toBeUndefined();
    const defaultVpc = `
resource "aws_vpc" "main" {
  cidr_block = "172.31.0.0/16"
}
${sshSg('web')}`;
    expect(auditSecurity(load(defaultVpc).ir).findings[0].fix?.label).toBe('Restrict to 172.31.0.0/16');
  });

  it('hardening fixes: public database, encryption, IMDSv2 (instance and launch template), S3', () => {
    const src = `
resource "aws_db_instance" "db" {
  engine              = "postgres"
  instance_class      = "db.t3.micro"
  publicly_accessible = true
}
resource "aws_rds_cluster" "aurora" {
  engine = "aurora-postgresql"
}
resource "aws_rds_cluster_instance" "aurora" {
  cluster_identifier  = aws_rds_cluster.aurora.id
  instance_class      = "db.r6g.large"
  publicly_accessible = true
}
resource "aws_instance" "vm" {
  ami           = "ami-1"
  instance_type = "t3.micro"
}
resource "aws_launch_template" "web" {
  image_id = "ami-1"
}
resource "aws_s3_bucket" "logs" {
  bucket = "logs"
}`;
    for (const id of [
      'rds-public:aws_db_instance.db',
      'rds-public:aws_rds_cluster_instance.aurora',
      'rds-encryption:aws_db_instance.db',
      'rds-encryption:aws_rds_cluster.aurora',
      'imdsv2:aws_instance.vm',
      'imdsv2:aws_launch_template.web',
      's3-public:aws_s3_bucket.logs',
    ]) {
      applyFix(src, id);
    }
  });

  it('fix-all reports only what it actually fixed', () => {
    const src = `${sshSg('open', 'cidr_blocks = ["0.0.0.0/0"]', 'var.vpc_id')}
resource "aws_db_instance" "db" {
  engine              = "postgres"
  instance_class      = "db.t3.micro"
  publicly_accessible = true
  storage_encrypted   = true
}`;
    const { ir } = load(src);
    expect(auditSecurity(ir).findings.map((f) => [f.id, !!f.fix])).toEqual([
      ['rule:aws_security_group.open:ingress:0', false],
      ['rds-public:aws_db_instance.db', true],
      ['unused:aws_security_group.open', false],
    ]);
    const plan = planFixAll(ir);
    expect(plan.fixed).toBe(1);
    const { ir: after } = run(src, () => plan.ops);
    expect(auditSecurity(after).findings.map((f) => f.id)).toEqual(['rule:aws_security_group.open:ingress:0', 'unused:aws_security_group.open']);
  });
});

// ============================================================ 5. NACLs

describe('NACLs are judged as stateless first-match lists (finding 5)', () => {
  const nacl = (rules: string) => `${VPC}
resource "aws_network_acl" "public" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = [aws_subnet.public.id]
${rules}
}`;
  const rule = (no: number, action: string, from: number, to: number, cidr = '0.0.0.0/0', protocol = 'tcp') => `
  ingress {
    rule_no    = ${no}
    action     = "${action}"
    protocol   = "${protocol}"
    from_port  = ${from}
    to_port    = ${to}
    cidr_block = "${cidr}"
  }`;

  it('ephemeral return ports from anywhere are normal — no finding, no fix', () => {
    expect(findingIds(nacl(rule(100, 'allow', 1024, 65535)))).toEqual([]);
  });

  it('the AWS default allow-all NACL is only a low note', () => {
    const src = `${VPC}
resource "aws_default_network_acl" "default" {
  default_network_acl_id = aws_vpc.main.default_network_acl_id
  ingress {
    protocol   = -1
    rule_no    = 100
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 0
    to_port    = 0
  }
}`;
    const audit = auditSecurity(load(src).ir);
    expect(audit.findings.map((f) => [f.severity, f.title])).toEqual([['low', 'Network ACL allows all inbound traffic']]);
    expect(audit.score).toBe(99);
    // the default NACL covers subnets nobody associates
    expect(audit.topology.subnetNacls.get('aws_subnet.public')).toEqual(['aws_default_network_acl.default']);
  });

  it('explicit SSH / RDP from anywhere is medium (Security Hub EC2.21)', () => {
    const audit = auditSecurity(load(nacl(rule(100, 'allow', 22, 22) + rule(110, 'allow', 3389, 3389))).ir);
    expect(audit.findings.map((f) => [f.severity, f.title])).toEqual([
      ['medium', 'Network ACL allows SSH (port 22) from the internet'],
      ['medium', 'Network ACL allows RDP (port 3389) from the internet'],
    ]);
  });

  it('rule_no order: a deny above wins', () => {
    const src = nacl(rule(90, 'deny', 22, 22) + rule(100, 'allow', 0, 1023));
    expect(findingIds(src)).toEqual([]);
    const t = analyzeSecurity(load(src + sshSg('web') + instance('web', 'web')).ir);
    // the SG allows SSH, the NACL in front of the subnet doesn't
    expect(t.exposure.get('aws_instance.web')?.level).toBe('restricted');
  });
});

// ============================================================ 6. deny, priorities, NSG levels

describe('deny rules and priorities (finding 6)', () => {
  const deny22 = nsgRule('name = "deny-ssh"\n    priority = 100\n    direction = "Inbound"\n    access = "Deny"\n    protocol = "Tcp"\n    destination_port_range = "22"\n    source_address_prefix = "Internet"');
  const allow22 = nsgRule('name = "ssh"\n    priority = 200\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "22"\n    source_address_prefix = "*"');

  it('Azure: a lower-priority deny blocks the later allow', () => {
    const audit = auditSecurity(load(AZURE_BASE + nsg('vm', deny22 + allow22)).ir);
    expect(audit.findings.filter((f) => f.severity === 'critical')).toEqual([]);
    expect(audit.topology.exposure.get('azurerm_linux_virtual_machine.vm')?.level).toBe('restricted');
    // the same rules the other way round are open
    const swapped = auditSecurity(load(AZURE_BASE + nsg('vm', allow22.replace('200', '90') + deny22)).ir);
    expect(swapped.findings[0]).toMatchObject({ severity: 'critical', title: 'SSH (port 22) is open to the internet' });
  });

  it('Azure: subnet NSG and NIC NSG must both allow', () => {
    const https = nsgRule('name = "https"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "443"\n    source_address_prefix = "*"');
    const src = AZURE_BASE + nsg('subnet', https, 'subnet') + nsg('nic', allow22, 'nic');
    const t = analyzeSecurity(load(src).ir);
    expect(t.exposure.get('azurerm_linux_virtual_machine.vm')?.level).toBe('restricted');
    const both = AZURE_BASE + nsg('subnet', https + allow22.replace('200', '110'), 'subnet') + nsg('nic', allow22, 'nic');
    expect(analyzeSecurity(load(both).ir).exposure.get('azurerm_linux_virtual_machine.vm')).toMatchObject({ level: 'internet', ports: ['22'] });
  });

  it('GCP: a priority-100 deny shadows a priority-1000 allow', () => {
    const src = `${GCP_BASE}
resource "google_compute_firewall" "deny_ssh" {
  name          = "deny-ssh"
  network       = google_compute_network.vpc.id
  priority      = 100
  source_ranges = ["0.0.0.0/0"]
  deny {
    protocol = "tcp"
    ports    = ["22"]
  }
}
resource "google_compute_firewall" "ssh" {
  name          = "ssh"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}`;
    const audit = auditSecurity(load(src).ir);
    expect(audit.findings).toEqual([]);
    expect(audit.topology.exposure.get('google_compute_instance.web')?.level).toBe('restricted');
  });
});

// ============================================================ 7 / 8. protocols and expressions

describe('Azure "*" protocol and ports written as expressions (findings 7, 8)', () => {
  it('protocol "*" with one port is TCP/UDP on that port, not every port', () => {
    const src = AZURE_BASE + nsg('vm', nsgRule('name = "https"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "*"\n    destination_port_range = "443"\n    source_address_prefix = "Internet"'));
    const audit = auditSecurity(load(src).ir);
    expect(audit.findings).toEqual([]);
    expect(audit.topology.exposure.get('azurerm_linux_virtual_machine.vm')).toMatchObject({ level: 'internet', ports: ['443', '443/udp'] });
  });

  it('expression ports are "can\'t be verified" (medium), never "all ports open"', () => {
    const aws = VPC + sshSg('web').replace('from_port   = 22', 'from_port   = var.port').replace('to_port     = 22', 'to_port     = var.port') + instance('web', 'web');
    const azure = AZURE_BASE + nsg('vm', nsgRule('name = "app"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = var.port\n    source_address_prefix = "*"'));
    const gcp = `${GCP_BASE}
resource "google_compute_firewall" "app" {
  name          = "app"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = [var.port]
  }
}`;
    for (const src of [aws, azure, gcp]) {
      const audit = auditSecurity(load(src).ir);
      expect(audit.findings.map((f) => [f.severity, f.title])).toEqual([['medium', "Port can't be verified (var.port) — open to the internet"]]);
      expect(audit.grade).toBe('B');
    }
    expect(analyzeSecurity(load(aws).ir).exposure.get('aws_instance.web')).toMatchObject({ level: 'internet', ports: ['var.port'] });
  });
});

// ============================================================ 9. exposure

describe('internet-facing = public address AND a route to an internet gateway (finding 9)', () => {
  const sg = sshSg('web');

  it('an instance in an IGW subnet without a public IP is not internet-facing', () => {
    const src = VPC.replace('  map_public_ip_on_launch = true\n', '') + sg + instance('web', 'web');
    expect(analyzeSecurity(load(src).ir).exposure.get('aws_instance.web')?.level).toBe('restricted');
    const withIp = VPC + sg + instance('web', 'web');
    expect(analyzeSecurity(load(withIp).ir).exposure.get('aws_instance.web')?.level).toBe('internet');
  });

  it('associate_public_ip_address in a NAT-only subnet is not internet-facing', () => {
    const src = `${VPC}
resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
}
resource "aws_nat_gateway" "nat" {
  subnet_id = aws_subnet.public.id
}
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat.id
  }
}
resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}
${sg}
${instance('web', 'web', 'subnet_id = aws_subnet.private.id\n  associate_public_ip_address = true')}`;
    expect(analyzeSecurity(load(src).ir).exposure.get('aws_instance.web')?.level).toBe('restricted');
  });

  it('follows an ENI with an EIP to the instance that uses it', () => {
    const src = `${VPC.replace('  map_public_ip_on_launch = true\n', '')}
${sg}
resource "aws_network_interface" "web" {
  subnet_id       = aws_subnet.public.id
  security_groups = [aws_security_group.web.id]
}
resource "aws_eip" "web" {
  network_interface = aws_network_interface.web.id
}
resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  network_interface {
    network_interface_id = aws_network_interface.web.id
    device_index         = 0
  }
  metadata_options {
    http_tokens = "required"
  }
}`;
    const t = analyzeSecurity(load(src).ir);
    expect(t.attachments.get('aws_instance.web')).toEqual(['aws_security_group.web']);
    expect(t.exposure.get('aws_instance.web')).toMatchObject({ level: 'internet', ports: ['22'] });
    expect(t.exposure.has('aws_network_interface.web')).toBe(false);
  });

  it('follows a launch template with a public IP to its ASG in a public subnet', () => {
    const src = `${VPC.replace('  map_public_ip_on_launch = true\n', '')}
${sg}
resource "aws_launch_template" "web" {
  image_id = "ami-1"
  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.web.id]
  }
  metadata_options {
    http_tokens = "required"
  }
}
resource "aws_autoscaling_group" "web" {
  min_size            = 1
  max_size            = 2
  vpc_zone_identifier = [aws_subnet.public.id]
  launch_template {
    id = aws_launch_template.web.id
  }
}`;
    const t = analyzeSecurity(load(src).ir);
    expect(t.exposure.get('aws_autoscaling_group.web')).toMatchObject({ level: 'internet', ports: ['22'] });
    expect(t.exposure.has('aws_launch_template.web')).toBe(false);
  });

  it('subnets on the main route table (aws_default_route_table with an IGW) are public', () => {
    const src = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
}
resource "aws_default_route_table" "main" {
  default_route_table_id = aws_vpc.main.default_route_table_id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}
resource "aws_subnet" "a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}
${sg}
${instance('web', 'web', 'subnet_id = aws_subnet.a.id')}`;
    const t = analyzeSecurity(load(src).ir);
    expect(t.subnets.get('aws_subnet.a')).toBe('public');
    expect(t.exposure.get('aws_instance.web')?.level).toBe('internet');
  });

  it('a publicly accessible cluster instance is reported', () => {
    const src = `
resource "aws_rds_cluster" "db" {
  engine            = "aurora-postgresql"
  storage_encrypted = true
}
resource "aws_rds_cluster_instance" "db" {
  cluster_identifier  = aws_rds_cluster.db.id
  instance_class      = "db.r6g.large"
  publicly_accessible = true
}`;
    expect(findingIds(src)).toEqual(['rds-public:aws_rds_cluster_instance.db']);
  });
});

// ============================================================ 10. GCP

describe('GCP firewall semantics (finding 10)', () => {
  const fw = (extra: string) => `${GCP_BASE}
resource "google_compute_firewall" "ssh" {
  name    = "ssh"
  network = google_compute_network.vpc.id
  ${extra}
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}`;

  it('no source ranges (and no source tags / accounts) means 0.0.0.0/0', () => {
    const audit = auditSecurity(load(fw('')).ir);
    expect(audit.findings[0]).toMatchObject({ severity: 'critical', title: 'SSH (port 22) is open to the internet' });
    expect(audit.findings[0].detail).toContain('no source ranges, so 0.0.0.0/0');
    expect(audit.topology.exposure.get('google_compute_instance.web')).toMatchObject({ level: 'internet', ports: ['22'] });
    expect(findingIds(fw('source_tags = ["bastion"]'))).toEqual([]);
  });

  it('a disabled firewall does nothing', () => {
    const audit = auditSecurity(load(fw('disabled = true')).ir);
    expect(audit.findings).toEqual([]);
    expect(audit.topology.attachments.get('google_compute_instance.web')).toBeUndefined();
  });

  it('target_service_accounts pick instances by service account, not every instance', () => {
    const src = `${fw('target_service_accounts = ["web@p.iam.gserviceaccount.com"]')}
resource "google_compute_instance" "other" {
  name         = "other"
  machine_type = "e2-micro"
  network_interface {
    network = google_compute_network.vpc.id
    access_config {}
  }
  service_account {
    email  = "other@p.iam.gserviceaccount.com"
    scopes = ["cloud-platform"]
  }
}
resource "google_compute_instance" "api" {
  name         = "api"
  machine_type = "e2-micro"
  network_interface {
    network = google_compute_network.vpc.id
  }
  service_account {
    email  = "web@p.iam.gserviceaccount.com"
    scopes = ["cloud-platform"]
  }
}`;
    const t = analyzeSecurity(load(src).ir);
    expect(t.attachments.get('google_compute_instance.api')).toEqual(['google_compute_firewall.ssh']);
    expect(t.attachments.get('google_compute_instance.other')).toBeUndefined();
    expect(t.attachments.get('google_compute_instance.web')).toBeUndefined();
  });
});

// ============================================================ 11. what the model can't see

describe('constructs the model cannot fully see (finding 11)', () => {
  it('dynamic blocks: exposure "unknown", a finding, and no A', () => {
    const src = `${VPC}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  dynamic "ingress" {
    for_each = var.ports
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
}
${instance('web', 'web')}`;
    const audit = auditSecurity(load(src).ir);
    expect(audit.topology.hidden.get('aws_security_group.web')).toEqual([{ directions: ['inbound'], reason: 'dynamic "ingress" blocks' }]);
    expect(audit.topology.exposure.get('aws_instance.web')?.level).toBe('unknown');
    expect(audit.findings.map((f) => f.id)).toEqual(['unverified:aws_security_group.web']);
    expect(audit.grade).toBe('B');
  });

  it('attribute syntax `ingress = [{ … }]` is read (and left to the code editor)', () => {
    const src = `${VPC}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  ingress = [{
    description      = "ssh"
    from_port        = 22
    to_port          = 22
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    security_groups  = []
    self             = false
  }]
}
${instance('web', 'web')}`;
    const { ir } = load(src);
    const audit = auditSecurity(ir);
    expect(audit.findings[0]).toMatchObject({ severity: 'critical', title: 'SSH (port 22) is open to the internet' });
    expect(audit.findings[0].fix).toBeUndefined();
    const rule = ruleById(ir, 'aws_security_group.web:ingress:0');
    expect(rule.unmodeled).toContain('ingress = [ … ]');
    expect(ruleStyle(ir, ir.resources.find((r) => r.id === 'aws_security_group.web')!, 'inbound').mode).toBe('blocked');
  });

  it('aws_default_security_group and aws_default_network_acl are owners too', () => {
    const src = `${VPC}
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 3389
    to_port     = 3389
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_instance" "bare" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public.id
  metadata_options {
    http_tokens = "required"
  }
}`;
    const audit = auditSecurity(load(src).ir);
    expect(audit.findings[0]).toMatchObject({ severity: 'critical', title: 'RDP (port 3389) is open to the internet' });
    // an instance that names no SG gets the VPC's default one
    expect(audit.topology.exposure.get('aws_instance.bare')).toMatchObject({ level: 'internet', ports: ['3389'] });
    expect(extractSecurity(load(`${VPC}
resource "aws_default_network_acl" "d" {
  default_network_acl_id = aws_vpc.main.default_network_acl_id
}`).ir).rules.get('aws_default_network_acl.d')).toEqual([]);
  });

  it('CIDR lists that add up to the whole internet are the internet', () => {
    const src = VPC + sshSg('web', 'cidr_blocks = ["0.0.0.0/1", "128.0.0.0/1"]') + instance('web', 'web');
    const audit = auditSecurity(load(src).ir);
    expect(audit.findings[0]).toMatchObject({ severity: 'critical', title: 'SSH (port 22) is open to the internet' });
    expect(audit.findings[0].detail).toContain('0.0.0.0/1, 128.0.0.0/1');
    expect(audit.topology.exposure.get('aws_instance.web')?.level).toBe('internet');
  });
});

// ============================================================ 15. low-severity false positives / negatives

describe('low-severity checks (finding 15)', () => {
  it('an NLB with a TLS listener is not "plain HTTP"; an ALB with only HTTP is', () => {
    const lb = (type: string, protocol: string) => `
resource "aws_lb" "web" {
  load_balancer_type = "${type}"
}
resource "aws_lb_listener" "web" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "${protocol}"
}`;
    expect(findingIds(lb('network', 'TLS'))).toEqual([]);
    expect(findingIds(lb('network', 'TCP'))).toEqual([]);
    expect(findingIds(lb('application', 'HTTP'))).toEqual(['lb-http:aws_lb.web']);
    expect(findingIds(lb('application', 'HTTPS'))).toEqual([]);
  });

  it('SGs used by outputs or module inputs are not "unused"', () => {
    const sg = `resource "aws_security_group" "shared" {
  vpc_id = var.vpc_id
}
`;
    expect(findingIds(sg)).toEqual(['unused:aws_security_group.shared']);
    expect(findingIds(`${sg}output "sg_id" {
  value = aws_security_group.shared.id
}`)).toEqual([]);
    expect(findingIds(`${sg}module "app" {
  source            = "./app"
  security_group_id = aws_security_group.shared.id
}`)).toEqual([]);
  });

  it('aws_network_interface_sg_attachment attaches the SG to the ENI, without an entry of its own', () => {
    const src = `${VPC}
${sshSg('web')}
resource "aws_network_interface" "web" {
  subnet_id = aws_subnet.public.id
}
resource "aws_network_interface_sg_attachment" "web" {
  security_group_id    = aws_security_group.web.id
  network_interface_id = aws_network_interface.web.id
}`;
    const t = analyzeSecurity(load(src).ir);
    expect(t.exposure.has('aws_network_interface_sg_attachment.web')).toBe(false);
    expect(t.attachments.get('aws_network_interface.web')).toEqual(['aws_security_group.web']);
  });

  it('an account-level public access block covers every bucket', () => {
    const buckets = `
resource "aws_s3_bucket" "a" {
  bucket = "a"
}
resource "aws_s3_bucket" "b" {
  bucket = "b"
}`;
    expect(findingIds(buckets)).toEqual(['s3-public:aws_s3_bucket.a', 's3-public:aws_s3_bucket.b']);
    expect(findingIds(`${buckets}
resource "aws_s3_account_public_access_block" "account" {
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}`)).toEqual([]);
  });

  it('launch templates are checked for IMDSv1; instances using them are not double-flagged', () => {
    const src = `
resource "aws_launch_template" "web" {
  image_id = "ami-1"
}
resource "aws_instance" "web" {
  instance_type = "t3.micro"
  launch_template {
    id = aws_launch_template.web.id
  }
}`;
    expect(findingIds(src)).toEqual(['imdsv2:aws_launch_template.web']);
  });
});

// ============================================================ 16. wording and score

describe('wording and score (finding 16)', () => {
  it('names the real source: ::/0, the Internet tag, "*"', () => {
    const v6 = VPC + sshSg('web', 'ipv6_cidr_blocks = ["::/0"]') + instance('web', 'web');
    expect(auditSecurity(load(v6).ir).findings[0]).toMatchObject({
      title: 'SSH (port 22) is open to the internet over IPv6',
      detail: expect.stringContaining('from anywhere (::/0)'),
    });
    const azure = AZURE_BASE + nsg('vm', nsgRule('name = "ssh"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "22"\n    source_address_prefix = "Internet"'));
    expect(auditSecurity(load(azure).ir).findings[0].detail).toContain('from anywhere (Internet)');
    expect(peerLabel({ kind: 'any', value: '0.0.0.0/0' })).not.toBe(peerLabel({ kind: 'any', value: '::/0' }));
  });

  it('one rule opening SSH and RDP is one finding, and the score is bounded per kind of finding', () => {
    const azure = AZURE_BASE + nsg('vm', nsgRule('name = "admin"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_ranges = ["22", "3389"]\n    source_address_prefix = "*"'));
    const audit = auditSecurity(load(azure).ir);
    expect(audit.findings.map((f) => f.title)).toEqual(['SSH (22) and RDP (3389) are open to the internet']);
    expect(audit.score).toBe(70);
  });

  it('hygiene-only findings do not drag a project down to B', () => {
    const src = [1, 2, 3]
      .map(
        (i) => `
resource "aws_s3_bucket" "b${i}" {
  bucket = "b${i}"
}
resource "aws_instance" "i${i}" {
  ami           = "ami-1"
  instance_type = "t3.micro"
}`,
      )
      .join('');
    const audit = auditSecurity(load(src).ir);
    expect(audit.findings).toHaveLength(6);
    expect(audit.grade).toBe('A');
  });
});

describe('traffic evaluation', () => {
  it('labels ports per protocol', () => {
    const { rules } = extractSecurity(load(AZURE_BASE + nsg('vm', nsgRule('name = "dns"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Udp"\n    destination_port_range = "53"\n    source_address_prefix = "*"'))).ir);
    const ev = evaluateInbound(rules.get('azurerm_network_security_group.vm')!, true);
    expect(trafficLabels(ev.allowed)).toEqual(['53/udp']);
  });
});

// ============================================================ access paths: why is it reachable?

const kinds = (steps: PathStep[]) => steps.map((s) => s.kind);
const accessOf = (src: string, id: string) => {
  const a = analyzeSecurity(load(src).ir).access.get(id);
  expect(a, `access for ${id}`).toBeDefined();
  return a!;
};
const portOf = (a: AccessExplanation, ports: string) => {
  const p = a.open.find((x) => x.ports === ports);
  expect(p, `open port ${ports} (have ${a.open.map((x) => x.ports).join(', ')})`).toBeDefined();
  return p!;
};
const blockedOf = (a: AccessExplanation, ports: string) => {
  const b = a.blocked.filter((x) => x.ports === ports);
  expect(b.length, `blocked ${ports} (have ${a.blocked.map((x) => `${x.ports}: ${x.reason}`).join('; ')})`).toBeGreaterThan(0);
  return b;
};
const httpsSg = (name: string, extra = '') => `
resource "aws_security_group" "${name}" {
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ${extra}
}
`;
const sshIngress = `ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }`;

describe('access paths: AWS', () => {
  it('Internet → IGW → route → public subnet → SG rule → instance, with its public IP source', () => {
    const a = accessOf(VPC + httpsSg('web') + instance('web', 'web'), 'aws_instance.web');
    const [path] = portOf(a, '443').paths;
    expect(path.families).toEqual(['ipv4']);
    expect(kinds(path.steps)).toEqual(['internet', 'gateway', 'route', 'subnet', 'sg', 'resource']);
    const [, igw, route, subnet, sg, target] = path.steps;
    expect(igw).toMatchObject({ title: 'Internet gateway igw', resource: 'aws_internet_gateway.igw' });
    expect(route).toMatchObject({ title: 'Route 0.0.0.0/0 → igw', resource: 'aws_route_table.public' });
    expect(route.detail).toBe('route table public, associated with subnet public');
    expect(subnet).toMatchObject({ resource: 'aws_subnet.public', detail: 'public · assigns public IPs on launch' });
    expect(sg).toMatchObject({
      title: 'Security group web',
      detail: 'ingress #1 allows HTTPS from 0.0.0.0/0',
      rule: { owner: 'aws_security_group.web', id: 'aws_security_group.web:ingress:0' },
    });
    expect(target).toMatchObject({ resource: 'aws_instance.web', detail: 'public address: map_public_ip_on_launch = true on subnet public' });
  });

  it('adds the NACL rule that admits each port, and explains the port a NACL deny stops', () => {
    const nacl = `
resource "aws_network_acl" "public" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = [aws_subnet.public.id]
  ingress {
    rule_no    = 90
    action     = "deny"
    protocol   = "tcp"
    from_port  = 22
    to_port    = 22
    cidr_block = "0.0.0.0/0"
  }
  ingress {
    rule_no    = 100
    action     = "allow"
    protocol   = "tcp"
    from_port  = 0
    to_port    = 1023
    cidr_block = "0.0.0.0/0"
  }
}`;
    const src = VPC + nacl + httpsSg('web', sshIngress) + instance('web', 'web');
    const t = analyzeSecurity(load(src).ir);
    expect(t.exposure.get('aws_instance.web')).toMatchObject({ level: 'internet', ports: ['443'] });
    const a = t.access.get('aws_instance.web')!;
    const [path] = portOf(a, '443').paths;
    expect(kinds(path.steps)).toEqual(['internet', 'gateway', 'route', 'subnet', 'nacl', 'sg', 'resource']);
    expect(path.steps[4]).toMatchObject({
      title: 'Network ACL public · rule #100',
      rule: { owner: 'aws_network_acl.public', id: 'aws_network_acl.public:ingress:1' },
      verdict: 'allow',
    });
    // "Port 22 from the internet: blocked by NACL #90 (deny)"
    const [ssh] = blockedOf(a, '22');
    expect(ssh.reason).toBe('blocked by NACL public #90 (deny)');
    const stop = ssh.steps.find((s) => s.verdict === 'deny')!;
    expect(stop).toMatchObject({ kind: 'nacl', rule: { owner: 'aws_network_acl.public', id: 'aws_network_acl.public:ingress:0' } });
    // past the NACL: the SG rule that would admit it, and the instance, for context
    expect(ssh.steps.slice(-2).map((s) => [s.kind, s.unreached])).toEqual([
      ['sg', true],
      ['resource', true],
    ]);
  });

  it('a port no NACL rule allows stops at the default rule', () => {
    const nacl = `
resource "aws_network_acl" "public" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = [aws_subnet.public.id]
  ingress {
    rule_no    = 100
    action     = "allow"
    protocol   = "tcp"
    from_port  = 443
    to_port    = 443
    cidr_block = "0.0.0.0/0"
  }
}`;
    const a = accessOf(VPC + nacl + httpsSg('web', sshIngress) + instance('web', 'web'), 'aws_instance.web');
    const [ssh] = blockedOf(a, '22');
    expect(ssh.reason).toBe('blocked by NACL public: no rule allows it (rule *)');
    expect(ssh.steps.find((s) => s.verdict === 'deny')).toMatchObject({ title: 'Network ACL public · rule *', rule: { owner: 'aws_network_acl.public' } });
  });

  it('standalone rules, Elastic IPs and the main route table are named as such', () => {
    const src = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
}
resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
resource "aws_default_route_table" "main" {
  default_route_table_id = aws_vpc.main.default_route_table_id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
}
resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_instance" "web" {
  ami                    = "ami-1"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.a.id
  vpc_security_group_ids = [aws_security_group.web.id]
  metadata_options {
    http_tokens = "required"
  }
}
resource "aws_eip" "web" {
  instance = aws_instance.web.id
}`;
    const [path] = portOf(accessOf(src, 'aws_instance.web'), '443').paths;
    expect(kinds(path.steps)).toEqual(['internet', 'gateway', 'route', 'subnet', 'sg', 'address', 'resource']);
    expect(path.steps[2]).toMatchObject({ resource: 'aws_default_route_table.main' });
    expect(path.steps[2].detail).toMatch(/the VPC's main route table — subnet a has no association of its own/);
    expect(path.steps[4]).toMatchObject({
      detail: 'rule https allows HTTPS from 0.0.0.0/0',
      rule: { owner: 'aws_security_group.web', id: 'aws_vpc_security_group_ingress_rule.https' },
    });
    expect(path.steps[5]).toMatchObject({ kind: 'address', title: 'Elastic IP web', resource: 'aws_eip.web' });
    expect(path.steps[6].detail).toBe('public address: Elastic IP web');
  });

  it('associate_public_ip_address, internet-facing load balancers and databases in the default VPC', () => {
    const inst = accessOf(
      VPC.replace('map_public_ip_on_launch = true', 'map_public_ip_on_launch = false') +
        httpsSg('web') +
        instance('web', 'web', 'subnet_id = aws_subnet.public.id\n  associate_public_ip_address = true'),
      'aws_instance.web',
    );
    expect(portOf(inst, '443').paths[0].steps.at(-1)!.detail).toBe('public address: associate_public_ip_address = true');

    const lb = portOf(accessOf(AWS, 'aws_lb.web'), '443').paths[0].steps;
    expect(kinds(lb)).toEqual(['internet', 'gateway', 'route', 'subnet', 'sg', 'resource']);
    expect(lb.at(-1)!.detail).toBe('public address: internet-facing (internal = false)');

    const db = `${httpsSg('db').replace(/443/g, '5432')}
resource "aws_db_instance" "db" {
  engine                 = "postgres"
  instance_class         = "db.t3.micro"
  publicly_accessible    = true
  storage_encrypted      = true
  vpc_security_group_ids = [aws_security_group.db.id]
}`;
    const steps = portOf(accessOf(VPC + db, 'aws_db_instance.db'), '5432').paths[0].steps;
    expect(steps.map((s) => s.title).slice(0, 2)).toEqual(['Internet', 'Default VPC']);
    expect(steps.at(-1)!.detail).toBe('public address: publicly_accessible = true');
  });

  it('explains what keeps a resource off the internet: no public IP, no route to an internet gateway', () => {
    // the AWS fixture: SSH is open on the app SG, but the instance lives in a private subnet
    const a = accessOf(AWS, 'aws_instance.app');
    expect(a.open).toEqual([]);
    const [ssh] = blockedOf(a, '22');
    expect(ssh.reason).toBe('no public IP address and no route to an internet gateway');
    const stops = ssh.steps.filter((s) => s.verdict === 'deny');
    expect(stops.map((s) => s.kind)).toEqual(['address', 'route']);
    expect(stops[1]).toMatchObject({ resource: 'aws_subnet.private' });
    expect(stops[1].detail).toMatch(/subnet private has no route table association/);

    // an IGW subnet, but nothing gives the instance a public IP
    const noIp = accessOf(
      VPC.replace('map_public_ip_on_launch = true', 'map_public_ip_on_launch = false') + sshSg('web') + instance('web', 'web'),
      'aws_instance.web',
    );
    const [only] = blockedOf(noIp, '22');
    expect(only.reason).toBe('no public IP address');
    expect(only.steps.find((s) => s.verdict === 'deny')!.detail).toMatch(/subnet public doesn't assign public IPs/);
  });

  it('an IPv4 and an IPv6 rule for the same port are two ways in; one rule for both families is one', () => {
    const src = VPC + sshSg('web', 'cidr_blocks = ["0.0.0.0/0"]\n    ipv6_cidr_blocks = ["::/0"]') + instance('web', 'web');
    const one = portOf(accessOf(src, 'aws_instance.web'), '22');
    expect(one.paths).toHaveLength(1);
    expect(one.paths[0].families).toEqual(['ipv4', 'ipv6']);
    expect(one.paths[0].steps[0].detail).toBe('any address, IPv4 and IPv6');

    const twin = VPC + httpsSg('web', 'ingress {\n    from_port = 443\n    to_port = 443\n    protocol = "tcp"\n    ipv6_cidr_blocks = ["::/0"]\n  }') + instance('web', 'web');
    const two = portOf(accessOf(twin, 'aws_instance.web'), '443');
    expect(two.paths.map((p) => p.families)).toEqual([['ipv4'], ['ipv6']]);
  });

  it('ports written as expressions get a path marked unverifiable', () => {
    const src = VPC + sshSg('web').replace('from_port   = 22', 'from_port   = var.port').replace('to_port     = 22', 'to_port     = var.port') + instance('web', 'web');
    const p = portOf(accessOf(src, 'aws_instance.web'), 'var.port');
    expect(p.traffic).toBeNull();
    expect(p.paths[0].steps.find((s) => s.kind === 'sg')!.detail).toMatch(/can't be verified/);
  });

  it('every template: the open paths add up to exactly the exposed ports', () => {
    for (const t of TEMPLATES) {
      const topo = analyzeSecurity(parseProject(t.build('demo')).ir);
      for (const [id, e] of topo.exposure) {
        const a = topo.access.get(id);
        if (e.level !== 'internet') {
          expect(a?.open ?? [], `${t.slug} ${id}`).toEqual([]);
          continue;
        }
        const verified = a!.open.filter((p) => p.traffic);
        const union = verified.map((p) => p.traffic!).reduce(trafficUnion, NO_TRAFFIC);
        const unverified = new Set(a!.open.filter((p) => !p.traffic).map((p) => p.ports));
        expect(trafficLabels(union), `${t.slug} ${id}`).toEqual(e.ports.filter((p) => !unverified.has(p)));
        for (const p of a!.open) for (const path of p.paths) expect(path.steps[0].kind).toBe('internet');
      }
    }
  });
});

describe('access paths: Azure and GCP', () => {
  const allow = (name: string, priority: number, port: number, source = '*') =>
    nsgRule(`name = "${name}"\n    priority = ${priority}\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "${port}"\n    source_address_prefix = "${source}"`);
  const deny = (name: string, priority: number, port: number) =>
    nsgRule(`name = "${name}"\n    priority = ${priority}\n    direction = "Inbound"\n    access = "Deny"\n    protocol = "Tcp"\n    destination_port_range = "${port}"\n    source_address_prefix = "Internet"`);

  it('Azure: Internet → subnet NSG rule → NIC NSG rule → public IP → VM', () => {
    const src = AZURE_BASE + nsg('subnet', allow('ssh', 100, 22)) + nsg('nic', allow('ssh-nic', 110, 22), 'nic');
    const [path] = portOf(accessOf(src, 'azurerm_linux_virtual_machine.vm'), '22').paths;
    expect(kinds(path.steps)).toEqual(['internet', 'nsg', 'nsg', 'address', 'resource']);
    expect(path.steps[1]).toMatchObject({
      title: 'NSG subnet · ssh',
      detail: 'priority 100 · allows SSH from * · on the subnet app',
      rule: { owner: 'azurerm_network_security_group.subnet', id: 'azurerm_network_security_group.subnet:security_rule:0' },
    });
    expect(path.steps[2]).toMatchObject({ title: 'NSG nic · ssh-nic', detail: 'priority 110 · allows SSH from * · on the NIC vm' });
    expect(path.steps[3]).toMatchObject({ title: 'Public IP vm', detail: 'on NIC vm', resource: 'azurerm_public_ip.vm' });
  });

  it('Azure: what the NIC NSG does not allow stops at its DenyAllInBound; a deny above an allow stops it too', () => {
    const src = AZURE_BASE + nsg('subnet', allow('ssh', 100, 22)) + nsg('nic', allow('https', 110, 443), 'nic');
    const [ssh] = blockedOf(accessOf(src, 'azurerm_linux_virtual_machine.vm'), '22');
    expect(ssh.reason).toBe('blocked by NSG nic: no rule allows it (DenyAllInBound)');
    expect(ssh.steps.map((s) => s.kind)).toEqual(['internet', 'nsg', 'nsg', 'nsg', 'address', 'resource']);
    expect(ssh.steps[1].verdict).toBe('allow');
    expect(ssh.steps[2]).toMatchObject({ title: 'NSG nic · DenyAllInBound', verdict: 'deny' });
    expect(ssh.steps[3]).toMatchObject({ title: 'NSG subnet · ssh', unreached: true });

    const shadowed = AZURE_BASE + nsg('vm', deny('deny-ssh', 100, 22) + allow('ssh', 200, 22));
    const [b] = blockedOf(accessOf(shadowed, 'azurerm_linux_virtual_machine.vm'), '22');
    expect(b.reason).toBe('blocked by NSG vm rule deny-ssh (priority 100, deny)');
  });

  it('GCP: Internet → firewall (priority, targets) → instance with its external IP; a higher-priority deny blocks', () => {
    const fw = (name: string, body: string, extra = '') => `
resource "google_compute_firewall" "${name}" {
  name          = "${name}"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  ${extra}
  ${body}
}`;
    const src = GCP_BASE + fw('ssh', 'allow {\n    protocol = "tcp"\n    ports    = ["22"]\n  }', 'target_tags = ["web"]');
    const [path] = portOf(accessOf(src, 'google_compute_instance.web'), '22').paths;
    expect(kinds(path.steps)).toEqual(['internet', 'firewall', 'resource']);
    expect(path.steps[1]).toMatchObject({
      title: 'Firewall ssh',
      detail: 'priority 1000 · allows SSH from 0.0.0.0/0 · targets tag web',
      rule: { owner: 'google_compute_firewall.ssh', id: 'google_compute_firewall.ssh:allow:0' },
    });
    expect(path.steps[2].detail).toBe('public address: external IP (access_config on network_interface #1)');

    const denied = src + fw('deny_ssh', 'deny {\n    protocol = "tcp"\n    ports    = ["22"]\n  }', 'priority = 100');
    const [b] = blockedOf(accessOf(denied, 'google_compute_instance.web'), '22');
    expect(b.reason).toBe('blocked by firewall deny_ssh (priority 100, deny)');
    expect(b.steps.find((s) => s.verdict === 'deny')!.detail).toMatch(/every instance in the network/);
  });

  it('GCP: an instance without access_config has no external IP', () => {
    const src = GCP_BASE.replace('    access_config {}\n', '') + `
resource "google_compute_firewall" "ssh" {
  name          = "ssh"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}`;
    const [b] = blockedOf(accessOf(src, 'google_compute_instance.web'), '22');
    expect(b.reason).toBe('no external IP');
  });
});

// ============================================================ compliance mapping

describe('compliance mapping', () => {
  const controlsOf = (src: string, title: RegExp | string) => {
    const f = auditSecurity(load(src).ir).findings.find((x) => (typeof title === 'string' ? x.title === title : title.test(x.title)));
    expect(f, `finding ${title}`).toBeDefined();
    return (f!.controls ?? []).map(controlLabel);
  };

  it('AWS security groups: SSH / RDP by address family, unauthorized and high-risk ports', () => {
    expect(controlsOf(VPC + sshSg('web') + instance('web', 'web'), 'SSH (port 22) is open to the internet')).toEqual([
      'CIS AWS 5.2',
      'FSBP EC2.13',
      'FSBP EC2.18',
      'FSBP EC2.19',
    ]);
    expect(controlsOf(VPC + sshSg('web', 'ipv6_cidr_blocks = ["::/0"]') + instance('web', 'web'), /over IPv6/)).toEqual([
      'CIS AWS 5.3',
      'FSBP EC2.13',
      'FSBP EC2.18',
      'FSBP EC2.19',
    ]);
    const rdp = sshSg('web').replace(/= 22/g, '= 3389');
    expect(controlsOf(VPC + rdp + instance('web', 'web'), 'RDP (port 3389) is open to the internet')).toEqual([
      'CIS AWS 5.2',
      'FSBP EC2.14',
      'FSBP EC2.18',
      'FSBP EC2.19',
    ]);
    const wide = sshSg('web').replace('from_port   = 22', 'from_port   = 10000').replace('to_port     = 22', 'to_port     = 10100');
    expect(controlsOf(VPC + wide + instance('web', 'web'), /Wide port range/)).toEqual(['FSBP EC2.18']);
  });

  it('NACLs, the default security group and hardening checks', () => {
    const naclSsh = `${VPC}
resource "aws_network_acl" "public" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = [aws_subnet.public.id]
  ingress {
    rule_no    = 100
    action     = "allow"
    protocol   = "tcp"
    from_port  = 22
    to_port    = 22
    cidr_block = "0.0.0.0/0"
  }
}`;
    expect(controlsOf(naclSsh, /Network ACL allows SSH/)).toEqual(['CIS AWS 5.1', 'FSBP EC2.21']);
    const allowAll = naclSsh.replace('protocol   = "tcp"', 'protocol   = "-1"').replace('from_port  = 22', 'from_port  = 0').replace('to_port    = 22', 'to_port    = 0');
    expect(controlsOf(allowAll, 'Network ACL allows all inbound traffic')).toEqual(['CIS AWS 5.1', 'FSBP EC2.21']);

    const defaultSg = `${VPC}
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
  ingress {
    protocol  = -1
    self      = true
    from_port = 0
    to_port   = 0
  }
}`;
    const audit = auditSecurity(load(defaultSg).ir);
    expect(audit.findings.map((f) => [f.severity, f.title])).toEqual([['low', 'Default security group allows traffic']]);
    expect(audit.findings[0].controls!.map(controlLabel)).toEqual(['CIS AWS 5.4', 'FSBP EC2.2']);
    // an empty default group is what the benchmarks ask for
    expect(findingIds(`${VPC}\nresource "aws_default_security_group" "default" {\n  vpc_id = aws_vpc.main.id\n}`)).toEqual([]);

    const hardening = auditSecurity(load(AWS).ir).findings;
    const byTitle = (t: string) => (hardening.find((f) => f.title === t)?.controls ?? []).map(controlLabel);
    expect(byTitle('Database is publicly accessible')).toEqual(['FSBP RDS.2']);
    expect(byTitle('Database storage is not encrypted')).toEqual(['FSBP RDS.3']);
    expect(byTitle('Instance metadata allows IMDSv1')).toEqual(['FSBP EC2.8']);

    expect(controlsOf('resource "aws_s3_bucket" "logs" {\n  bucket = "logs"\n}', 'Bucket has no public access block')).toEqual(['FSBP S3.1', 'FSBP S3.8']);
    const alb = `
resource "aws_lb" "web" {
  load_balancer_type = "application"
}
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"
}`;
    expect(controlsOf(alb, 'Load balancer only serves plain HTTP')).toEqual(['FSBP ELB.1']);
    // launch templates and Aurora clusters aren't what EC2.8 / RDS.3 evaluate
    const lt = 'resource "aws_launch_template" "web" {\n  image_id = "ami-1"\n}';
    expect(controlsOf(lt, 'Launch template allows IMDSv1')).toEqual([]);
    expect(controlsOf('resource "aws_rds_cluster" "db" {\n  engine = "aurora-postgresql"\n}', 'Database storage is not encrypted')).toEqual([]);
  });

  it('Azure NSGs and GCP firewalls: SSH and RDP from the internet', () => {
    const rule = (port: number) =>
      nsgRule(`name = "r${port}"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "${port}"\n    source_address_prefix = "Internet"`);
    expect(controlsOf(AZURE_BASE + nsg('vm', rule(22)), 'SSH (port 22) is open to the internet')).toEqual(['CIS Azure 6.2']);
    expect(controlsOf(AZURE_BASE + nsg('vm', rule(3389)), 'RDP (port 3389) is open to the internet')).toEqual(['CIS Azure 6.1']);
    const fw = (port: number) => `${GCP_BASE}
resource "google_compute_firewall" "admin" {
  name          = "admin"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["${port}"]
  }
}`;
    expect(controlsOf(fw(22), 'SSH (port 22) is open to the internet')).toEqual(['CIS GCP 3.6']);
    expect(controlsOf(fw(3389), 'RDP (port 3389) is open to the internet')).toEqual(['CIS GCP 3.7']);
  });

  it("what the audit can't verify maps to nothing; every control is a known framework's", () => {
    const expr = sshSg('web').replace('from_port   = 22', 'from_port   = var.port').replace('to_port     = 22', 'to_port     = var.port');
    expect(controlsOf(VPC + expr + instance('web', 'web'), /can't be verified/)).toEqual([]);
    expect(new Set(CONTROLS.map((c) => `${c.framework}:${c.id}`)).size).toBe(CONTROLS.length);
    for (const c of CONTROLS) expect(FRAMEWORKS.map((f) => f.id)).toContain(c.framework);
  });
});

// ============================================================ security delta

describe('security delta', () => {
  const audit = (src: string) => auditSecurity(load(src).ir);
  const base = VPC + httpsSg('web') + instance('web', 'web');

  it('a new SSH-from-anywhere rule drops the grade: named, with the workload it reaches', () => {
    const before = audit(base);
    const after = audit(VPC + httpsSg('web', sshIngress) + instance('web', 'web'));
    const delta = securityDelta(before, after)!;
    expect(delta).toMatchObject({ before: 'A', after: 'C', gradeDropped: true, target: 'aws_instance.web' });
    expect(delta.message).toBe('Security grade A → C: SSH (22) is now open to the internet on aws_instance.web');
    expect(delta.added.map((f) => f.severity)).toEqual(['critical']);
  });

  it('improvements, renames and rules shifting position are not worse', () => {
    const risky = VPC + httpsSg('web', sshIngress) + instance('web', 'web');
    expect(securityDelta(audit(risky), audit(base))).toBeNull();
    expect(securityDelta(audit(base), audit(base))).toBeNull();
    // same risk under another name
    expect(securityDelta(audit(risky), audit(risky.replace(/"web"/g, '"api"').replace(/\.web\./g, '.api.')))).toBeNull();
    // deleting the safe rule in front of the risky one moves it to index 0
    const shifted = VPC + sshSg('web') + instance('web', 'web');
    expect(securityDelta(audit(risky), audit(shifted))).toBeNull();
  });

  it('a new high finding counts even when the grade holds', () => {
    const before = audit(AWS); // D already
    const db2 = AWS + `
resource "aws_db_instance" "db2" {
  engine                 = "postgres"
  instance_class         = "db.t3.micro"
  publicly_accessible    = true
  storage_encrypted      = true
  vpc_security_group_ids = [aws_security_group.db.id]
}`;
    const after = audit(db2);
    expect(after.grade).toBe(before.grade);
    const delta = securityDelta(before, after)!;
    expect(delta.gradeDropped).toBe(false);
    expect(delta.message).toBe('New high security risk: Database is publicly accessible — aws_db_instance.db2');
    expect(delta.target).toBe('aws_db_instance.db2');
  });

  it('an existing risk that becomes reachable is new', () => {
    const before = audit(VPC + sshSg('web'));
    const after = audit(VPC + sshSg('web') + instance('web', 'web'));
    expect(securityDelta(before, after)?.message).toMatch(/SSH \(22\) is now open to the internet on aws_instance\.web$/);
  });
});

describe('in Portuguese', () => {
  const pt = (src: string) => {
    const { ir } = load(src);
    return auditSecurity(ir, analyzeSecurity(ir, 'pt-BR'));
  };
  const en = (src: string) => {
    const { ir } = load(src);
    return auditSecurity(ir, analyzeSecurity(ir, 'en'));
  };

  it('AWS: findings, explanations, fixes and control titles', () => {
    const audit = pt(AWS);
    expect(audit.locale).toBe('pt-BR');
    const ssh = audit.findings.find((f) => f.id === 'rule:aws_security_group.app:ingress:1')!;
    expect(ssh.title).toBe('SSH (porta 22) aberto para a internet');
    expect(ssh.key).toBe('SSH (port 22) is open to the internet');
    expect(ssh.detail).toBe(
      'app permite SSH de qualquer lugar (0.0.0.0/0). Nada público usa esta regra ainda — mas o próximo recurso que usar ficará exposto.',
    );
    expect(ssh.fix?.label).toBe('Restringir a 10.0.0.0/16');
    expect(ssh.controls?.find((c) => c.id === '5.2')?.title).toBe(
      'Garantir que nenhum grupo de segurança permita entrada de 0.0.0.0/0 nas portas de administração remota de servidores',
    );
    const db = audit.findings.find((f) => f.id === 'rds-public:aws_db_instance.db')!;
    expect(db).toMatchObject({ title: 'Banco de dados com acesso público', fix: { label: 'Tornar privado' } });
    expect(db.detail).toBe('db recebe um endpoint público. Mantenha os bancos de dados privados e acesse-os de dentro da VPC.');
    const imds = audit.findings.find((f) => f.id === 'imdsv2:aws_instance.app')!;
    expect(imds.title).toBe('Metadados da instância aceitam IMDSv1');
    expect(imds.fix?.label).toBe('Exigir IMDSv2');
    // same findings, same order, same scores: only the words differ
    const english = en(AWS);
    expect(audit.findings.map((f) => [f.id, f.severity, f.key])).toEqual(english.findings.map((f) => [f.id, f.severity, f.title]));
    expect([audit.score, audit.grade]).toEqual([english.score, english.grade]);
  });

  it('Azure and GCP: the rule, where it is open, and what restricting it does', () => {
    const azure = pt(AZURE_BASE + nsg('vm', nsgRule('name = "rdp"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "3389"\n    source_address_prefix = "*"')));
    expect(azure.findings[0]).toMatchObject({ severity: 'critical', title: 'RDP (porta 3389) aberto para a internet' });
    expect(azure.findings[0].detail).toBe('vm permite RDP de qualquer lugar (*). Acessível agora em vm.');
    expect(azure.findings[0].fix?.label).toBe('Restringir à rede virtual');
    expect(azure.findings[0].controls?.map((c) => c.title)).toContain('Garantir que o acesso RDP pela internet seja avaliado e restrito');

    const gcp = pt(`${GCP_BASE}
resource "google_compute_firewall" "ssh" {
  name    = "allow-ssh"
  network = google_compute_network.vpc.id
  allow {
    protocol = "tcp"
    ports    = ["22", "3389"]
  }
}`);
    expect(gcp.findings[0].title).toBe('SSH (22) e RDP (3389) abertos para a internet');
    expect(gcp.findings[0].detail).toContain('ssh permite SSH, RDP de qualquer lugar (sem intervalos de origem, então 0.0.0.0/0).');
    expect(gcp.findings[0].alert).toBe('SSH (22) e RDP (3389) agora estão abertos para a internet');
  });

  it('a wider risk, a gendered service, IPv6 only and ports written as expressions', () => {
    const wide = pt(VPC + sshSg('web', 'cidr_blocks = ["0.0.0.0/0"]').replace('from_port   = 22', 'from_port   = 0').replace('to_port     = 22', 'to_port     = 65535'));
    expect(wide.findings[0].title).toBe('Todas as portas TCP abertas para a internet');
    const docker = pt(VPC + sshSg('web').replace(/= 22/g, '= 2375'));
    expect(docker.findings[0].title).toBe('API do Docker (porta 2375) aberta para a internet');
    expect(docker.findings[0].alert).toBe('API do Docker (2375) agora está aberta para a internet');
    const v6 = pt(VPC + sshSg('web', 'ipv6_cidr_blocks = ["::/0"]'));
    expect(v6.findings[0].title).toBe('SSH (porta 22) aberto para a internet via IPv6');
    const expr = pt(VPC + sshSg('web').replace(/= 22/g, '= var.port'));
    expect(expr.findings[0].title).toBe('Porta não verificável (var.port) — aberta para a internet');
  });

  it('access paths: every step of the way in, and what stops the rest', () => {
    const { ir } = load(VPC + httpsSg('web') + instance('web', 'web'));
    const a = analyzeSecurity(ir, 'pt-BR').access.get('aws_instance.web')!;
    const [path] = a.open.find((p) => p.ports === '443')!.paths;
    expect(path.steps.map((s) => [s.title, s.detail])).toEqual([
      ['Internet', 'qualquer endereço IPv4 (0.0.0.0/0)'],
      ['Internet gateway igw', undefined],
      ['Rota 0.0.0.0/0 → igw', 'tabela de rotas public, associada à sub-rede public'],
      ['Sub-rede public', 'pública · atribui IPs públicos na inicialização'],
      ['Grupo de segurança web', 'ingress #1 permite HTTPS de 0.0.0.0/0'],
      ['aws_instance.web', 'endereço público: map_public_ip_on_launch = true na sub-rede public'],
    ]);
    expect(path.steps[4].ref).toBe('ingress #1');

    const blocked = analyzeSecurity(load(AWS).ir, 'pt-BR').access.get('aws_instance.app')!.blocked.find((b) => b.ports === '22')!;
    expect(blocked.reason).toBe('sem endereço IP público e sem rota para um internet gateway');
    expect(blocked.steps.find((s) => s.kind === 'route')!.detail).toBe(
      'a sub-rede private não está associada a uma tabela de rotas, e a tabela de rotas principal da VPC não tem essa rota',
    );
  });

  it('the words behind the rules editor and the inspector', () => {
    expect(serviceName({ protocol: 'all', fromPort: null, toPort: null }, 'pt-BR')).toBe('Todo o tráfego');
    expect(serviceName({ protocol: 'tcp', fromPort: null, toPort: null }, 'pt-BR')).toBe('Todas as portas TCP');
    expect(serviceName({ protocol: 'tcp', fromPort: 8080, toPort: 8080 }, 'pt-BR')).toBe('HTTP alternativo');
    expect(peerLabel({ kind: 'self' }, undefined, 'pt-BR')).toBe('o próprio grupo');
    expect(peerLabel({ kind: 'any', value: '0.0.0.0/0', implicit: true }, undefined, 'pt-BR')).toBe('Internet (padrão 0.0.0.0/0)');
    expect(formatList(['a', 'b'], 'conjunction', 'pt-BR')).toBe('a e b');
    const hidden = extractSecurity(
      load(`resource "aws_security_group" "web" {\n  dynamic "ingress" {\n    for_each = var.rules\n    content {}\n  }\n}\n`).ir,
      'pt-BR',
    ).hidden.get('aws_security_group.web');
    expect(hidden).toEqual([{ directions: ['inbound'], reason: 'blocos dynamic "ingress"' }]);
  });

  it('switching the language is not a security change', () => {
    for (const src of [AWS, VPC + httpsSg('web', sshIngress) + instance('web', 'web'), AZURE_BASE + nsg('vm', nsgRule('name = "rdp"\n    priority = 100\n    direction = "Inbound"\n    access = "Allow"\n    protocol = "Tcp"\n    destination_port_range = "3389"\n    source_address_prefix = "*"'))]) {
      expect(securityDelta(en(src), pt(src))).toBeNull();
      expect(securityDelta(pt(src), en(src))).toBeNull();
    }
    // a real change still shows, worded in the later audit's language
    const delta = securityDelta(en(VPC + httpsSg('web') + instance('web', 'web')), pt(VPC + httpsSg('web', sshIngress) + instance('web', 'web')))!;
    expect(delta.message).toBe('Nota de segurança A → C: SSH (22) agora está aberto para a internet em aws_instance.web');
    const high = securityDelta(pt(AWS), pt(`${AWS}
resource "aws_db_instance" "db2" {
  engine                 = "postgres"
  instance_class         = "db.t3.micro"
  publicly_accessible    = true
  storage_encrypted      = true
  vpc_security_group_ids = [aws_security_group.db.id]
}`))!;
    expect(high.message).toBe('Novo risco de segurança alto: Banco de dados com acesso público — aws_db_instance.db2');
  });
});

