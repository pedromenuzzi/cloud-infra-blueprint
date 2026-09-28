import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { expectWellFormed, pdfText } from '@/lib/pdf/testing';
import { getDef } from '@/resources/registry';
import { auditSecurity } from '@/security/audit';
import { TEMPLATES } from '@/templates';
import { buildArchitecturePdf, keySettings, providerSummary, redactSecrets, type ArchDocInput, type DocSections } from './archDoc';

const ALL: DocSections = { inventory: true, connections: true, security: true, code: true };
const WHEN = new Date(2026, 8, 28, 9, 5);

function inputFor(files: Record<string, string>, overrides: Partial<ArchDocInput> = {}): ArchDocInput {
  const { ir } = parseProject(files);
  const edges = deriveStructure(ir, getDef);
  return {
    title: 'Payments platform',
    ir,
    edges,
    files: Object.entries(files),
    audit: auditSecurity(ir),
    diagram: {
      width: 4,
      height: 2,
      scale: 2,
      data: zlibSync(new Uint8Array(4 * 2 * 3).fill(200)),
      background: '#eef4fb',
      lens: false,
    },
    sections: ALL,
    paper: 'a4',
    generatedAt: WHEN,
    compress: false,
    ...overrides,
  };
}

describe('architecture document', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug}: a well-formed PDF that names every resource`, () => {
      const input = inputFor(t.build('demo'));
      const bytes = buildArchitecturePdf(input);
      expectWellFormed(bytes);
      const text = pdfText(bytes);
      expect(text).toContain('Payments platform');
      for (const heading of ['Overview', 'Resource inventory', 'Connections & traffic', 'Security review', 'Terraform source']) {
        expect(text, heading).toContain(heading);
      }
      for (const r of input.ir.resources) expect(text, r.id).toContain(r.name);
      expect(text).toMatch(/Page 1 of \d+/);
    });
  }

  it('leaves out the sections that are switched off', () => {
    const input = inputFor(TEMPLATES[0].build('demo'), {
      sections: { inventory: false, connections: false, security: false, code: false },
    });
    const text = pdfText(buildArchitecturePdf(input));
    expect(text).toContain('Overview');
    for (const heading of ['Resource inventory', 'Connections & traffic', 'Security review', 'Terraform source']) {
      expect(text).not.toContain(heading);
    }
    expect(text).toContain('Page 2 of 2');
  });

  it('renders without a diagram and with notes from the author', () => {
    const input = inputFor(TEMPLATES[0].build('demo'), { diagram: null, notes: 'Proposta para revisão — versão 2.' });
    const bytes = buildArchitecturePdf(input);
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    expect(text).toContain('The diagram could not be rendered.');
    expect(text).toContain('Proposta para revisão — versão 2.');
  });

  describe('secrets', () => {
    const planted = `
variable "db_password" {
  default = "S3cret-var-default"
}
variable "api_token" {
  type    = string
  default = "S3cret-token-default"
}
variable "settings" {
  default = { admin_password = "S3cret-nested", region = "us-east-1" }
}
variable "dsn" {
  default = "postgres://admin:S3cret-url-default@db:5432/app"
}
variable "env" {
  default = "prod"
}
resource "aws_db_instance" "db" {
  engine          = "postgres"
  instance_class  = "db.t3.micro"
  username        = "admin"
  password        = "p-\${var.env}-S3cret-interpolated"
  master_password = ["S3cret-list"]
  manage_master_user_password = true
}
resource "aws_db_instance" "replica" {
  engine   = "postgres"
  password = var.db_password
}
resource "aws_ssm_parameter" "plain" {
  name  = "/app/db"
  type  = "String"
  value = "S3cret-ssm-string"
}
resource "aws_ssm_parameter" "secure" {
  name  = "/app/key"
  type  = "SecureString"
  value = "S3cret-ssm-secure"
}
resource "azurerm_key_vault_secret" "kv" {
  name         = "db"
  value        = "S3cret-key-vault"
  key_vault_id = "vault"
}
resource "google_secret_manager_secret_version" "v" {
  secret      = "projects/p/secrets/db"
  secret_data = "S3cret-gsm"
}
resource "aws_secretsmanager_secret_version" "sm" {
  secret_id     = "db"
  secret_string = "S3cret-sm"
}
resource "aws_instance" "web" {
  ami           = "ami-123"
  instance_type = "t3.micro"
  user_data     = <<-EOT
    #!/bin/bash
    export DB_PASS=S3cret-user-data
  EOT
}
resource "azurerm_linux_virtual_machine" "vm" {
  name           = "vm"
  custom_data    = "S3cret-custom-data"
  admin_password = "S3cret-admin"
}
resource "google_compute_instance" "gce" {
  name                    = "gce"
  metadata_startup_script = "echo S3cret-startup"
}
resource "aws_elasticache_replication_group" "cache" {
  description = "cache"
  auth_token  = "S3cret-auth-token"
}
resource "aws_mq_broker" "mq" {
  broker_name = "mq"
  endpoint    = "amqp://guest:S3cret-amqp@mq.internal:5671"
}
resource "aws_glue_connection" "glue" {
  name       = "glue"
  jdbc       = "Server=db;User Id=app;Password=S3cret-conn;"
  query      = "https://api.example.com/v1?token=S3cret-query&x=1"
}
output "db_url" {
  value = "postgres://admin:S3cret-output-url@db/app"
}
output "admin_password" {
  value = aws_db_instance.db.password
}
output "conn" {
  value = "Server=x;Password=S3cret-output-inline"
}
`;

    it('never prints a planted secret, whatever the expression looks like', () => {
      const input = inputFor({ 'main.tf': planted }, { sections: { ...ALL, code: false } });
      const text = pdfText(buildArchitecturePdf(input));
      const leaks = text.split('\n').filter((line) => /S3cret/i.test(line));
      expect(leaks).toEqual([]);
      // what is still shown
      expect(text).toContain('engine: postgres');
      expect(text).toContain('password: ••••••');
      expect(text).toContain('master_password: ••••••');
      expect(text).toContain('value: ••••••');
      expect(text).toContain('user_data: (script hidden)');
      expect(text).toContain('manage_master_user_password: true');
      expect(text).toContain('postgres://admin:••••••@db/app');
      expect(text).toContain('(sensitive)');
      expect(text).toContain('us-east-1');
    });

    it('masks secrets inside values', () => {
      expect(redactSecrets('https://bob:hunter2@example.com/x')).toBe('https://bob:••••••@example.com/x');
      expect(redactSecrets('Server=db;Password=abc;Timeout=3')).toBe('Server=db;Password=••••••;Timeout=3');
      expect(redactSecrets('export DB_PASS=abc && run')).toBe('export DB_PASS=•••••• && run');
      expect(redactSecrets('size: t3.micro')).toBe('size: t3.micro');
      // prose keeps its words
      expect(redactSecrets('The admin password: at least 16 characters', false)).toBe('The admin password: at least 16 characters');
    });
  });

  it('summarizes key settings without references to other resources', () => {
    const { ir } = parseProject({
      'main.tf': `
resource "aws_instance" "web" {
  ami           = "ami-123"
  instance_type = var.size
  subnet_id     = aws_subnet.a.id
  tags = { Name = "web" }
}
`,
    });
    const settings = keySettings(ir.resources[0]);
    expect(settings).toContain('ami: ami-123');
    expect(settings).toContain('instance_type: var.size');
    expect(settings.some((s) => s.startsWith('subnet_id'))).toBe(false);
    expect(settings.some((s) => s.startsWith('tags'))).toBe(false);
  });

  it('resolves provider regions through variable defaults', () => {
    const { ir } = parseProject(TEMPLATES.find((t) => t.slug === 'aws-web-app')!.build('demo'));
    const aws = providerSummary(ir).find((p) => p.provider === 'aws');
    expect(aws?.regions).toEqual(['us-east-1']);
  });
});
