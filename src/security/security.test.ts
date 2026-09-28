import { describe, expect, it } from 'vitest';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { auditSecurity, ruleRisk } from './audit';
import { addRuleOp, PRESETS, removeRuleOp, updateRuleOp } from './edit';
import { extractRules, serviceName } from './model';
import { analyzeSecurity } from './topology';

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

const load = (src: string) => parseProject({ 'main.tf': src });

describe('security model (AWS)', () => {
  it('normalizes inline, standalone and NACL rules', () => {
    const rules = extractRules(load(AWS).ir);
    expect(rules.get('aws_security_group.alb')).toHaveLength(2);
    const app = rules.get('aws_security_group.app')!;
    expect(app.map((r) => serviceName(r))).toEqual(['HTTP alt', 'SSH']);
    expect(app[0].peers).toEqual([{ kind: 'group', ref: 'aws_security_group.alb' }]);
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
    expect(audit.score).toBe(62);
    expect(audit.grade).toBe('C');
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
    const base = { id: 'r', owner: 'o', ownerKind: 'sg' as const, direction: 'inbound' as const, action: 'allow' as const, peers: [{ kind: 'any' as const }], origin: { kind: 'resource' as const, id: 'r' } };
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 443, toPort: 443 })).toBeNull();
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 5432, toPort: 5432 })?.severity).toBe('critical');
    expect(ruleRisk({ ...base, protocol: 'all', fromPort: null, toPort: null })?.severity).toBe('critical');
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 8000, toPort: 8999 })?.severity).toBe('medium');
    expect(ruleRisk({ ...base, protocol: 'tcp', fromPort: 22, toPort: 22, peers: [{ kind: 'cidr', value: '10.0.0.0/8' }] })).toBeNull();
  });
});

describe('rule editing', () => {
  it('adds, updates and removes inline rules that round-trip through HCL', () => {
    const { ir } = load(AWS);
    const db = ir.resources.find((r) => r.id === 'aws_security_group.db')!;
    const https = PRESETS.find((p) => p.id === 'https')!;
    const add = addRuleOp(db, 'sg', 'inbound', { ...https, peers: [{ kind: 'group', ref: 'aws_security_group.alb' }], description: 'HTTPS from ALB' });
    let files = applyOpsWithPatches({ 'main.tf': AWS }, ir, [add]).files;
    let rules = extractRules(parseProject(files).ir).get('aws_security_group.db')!;
    expect(rules.map((r) => [r.origin.kind, r.fromPort, r.description])).toEqual([
      ['inline', 443, 'HTTPS from ALB'],
      ['resource', 5432, undefined],
    ]);

    let parsed = parseProject(files).ir;
    const node = parsed.resources.find((r) => r.id === 'aws_security_group.db')!;
    files = applyOpsWithPatches(files, parsed, [
      updateRuleOp(node, 'sg', 'inbound', 'ingress', 0, { protocol: 'tcp', fromPort: 8443, toPort: 8443, peers: [{ kind: 'cidr', value: '10.0.0.0/16' }] }),
    ]).files;
    rules = extractRules(parseProject(files).ir).get('aws_security_group.db')!;
    expect(rules[0]).toMatchObject({ fromPort: 8443, peers: [{ kind: 'cidr', value: '10.0.0.0/16' }] });
    expect(rules[0].description).toBeUndefined();

    parsed = parseProject(files).ir;
    files = applyOpsWithPatches(files, parsed, [removeRuleOp(parsed.resources.find((r) => r.id === 'aws_security_group.db')!, 'ingress', 0)]).files;
    expect(extractRules(parseProject(files).ir).get('aws_security_group.db')).toHaveLength(1);
    expect(files['main.tf']).not.toMatch(/resource "aws_security_group" "db" \{[^}]*ingress/);
  });
});

describe('Azure and GCP', () => {
  it('Azure: NSG rules protect VMs through NIC / subnet associations', () => {
    const { ir } = load(`
resource "azurerm_network_security_group" "vm" {
  name                = "vm-nsg"
  location            = "eastus"
  resource_group_name = "rg"
  security_rule {
    name                       = "rdp"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}
resource "azurerm_subnet" "app" {
  name                 = "app"
  resource_group_name  = "rg"
  virtual_network_name = "vnet"
  address_prefixes     = ["10.0.1.0/24"]
}
resource "azurerm_subnet_network_security_group_association" "app" {
  subnet_id                 = azurerm_subnet.app.id
  network_security_group_id = azurerm_network_security_group.vm.id
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
`);
    const audit = auditSecurity(ir);
    expect(audit.topology.exposure.get('azurerm_linux_virtual_machine.vm')).toMatchObject({ level: 'internet', ports: ['3389'] });
    expect(audit.findings[0]).toMatchObject({ severity: 'critical', title: 'RDP (port 3389) is open to the internet' });
    expect(audit.findings[0].fix?.label).toBe('Restrict to the virtual network');
  });

  it('GCP: firewalls target instances by tag', () => {
    const { ir } = load(`
resource "google_compute_network" "vpc" {
  name = "vpc"
}
resource "google_compute_firewall" "ssh" {
  name          = "allow-ssh"
  network       = google_compute_network.vpc.id
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["ssh"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}
resource "google_compute_instance" "bastion" {
  name         = "bastion"
  machine_type = "e2-micro"
  tags         = ["ssh"]
  network_interface {
    network = google_compute_network.vpc.id
    access_config {}
  }
}
resource "google_compute_instance" "worker" {
  name         = "worker"
  machine_type = "e2-micro"
  network_interface {
    network = google_compute_network.vpc.id
  }
}
`);
    const t = analyzeSecurity(ir);
    expect(t.exposure.get('google_compute_instance.bastion')).toMatchObject({ level: 'internet', ports: ['22'] });
    expect(t.attachments.get('google_compute_instance.worker')).toBeUndefined();
    expect(auditSecurity(ir).findings[0].title).toBe('SSH (port 22) is open to the internet');
  });
});
