import { describe, expect, it } from 'vitest';
import { buildArchitecturePdf, type ArchDocInput } from '@/features/export/archDoc';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { moduleEdges } from '@/ir/modules';
import { expectWellFormed, pdfText } from '@/lib/pdf/testing';
import { getDef } from '@/resources/registry';
import { auditSecurity } from '@/security/audit';

const MAIN = `module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"
  name    = "main"
  cidr    = "10.0.0.0/16"
}

module "network" {
  source      = "./modules/network"
  db_password = "hunter2-secret"
}

resource "aws_instance" "web" {
  ami       = "ami-1"
  subnet_id = module.vpc.private_subnets[0]
}
`;

function input(files: Record<string, string>, locale: 'en' | 'pt-BR' = 'en'): ArchDocInput {
  const { ir } = parseProject(files);
  return {
    title: 'Payments platform',
    ir,
    edges: [...deriveStructure(ir, getDef), ...moduleEdges(ir)],
    files: Object.entries(files),
    audit: auditSecurity(ir),
    diagram: null,
    sections: { inventory: true, connections: true, security: true, code: false },
    paper: 'a4',
    generatedAt: new Date(2026, 8, 30),
    compress: false,
    locale,
  };
}

describe('the PDF lists modules', () => {
  it('source, version, inputs — secrets masked — in a section of its own', () => {
    const bytes = buildArchitecturePdf(input({ 'main.tf': MAIN }));
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    expect(text).toContain('Modules');
    expect(text).toContain('module.vpc');
    expect(text).toContain('terraform-aws-modules/vpc');
    expect(text).toContain('v5.0.0');
    expect(text).toContain('cidr = 10.0.0.0/16');
    expect(text).toContain('./modules/network');
    expect(text).not.toContain('hunter2-secret');
  });

  it('in Portuguese', () => {
    const text = pdfText(buildArchitecturePdf(input({ 'main.tf': MAIN }, 'pt-BR')));
    expect(text).toContain('Módulos');
    expect(text).toContain('ENTRADAS');
  });

  it('what local modules hold: resources, findings and cost per call', () => {
    const files = {
      'main.tf': 'provider "aws" {\n  region = "us-east-1"\n}\n\nmodule "edge" {\n  source = "./modules/edge"\n  cidr   = "0.0.0.0/0"\n  count  = 2\n}\n',
      'modules/edge/main.tf': `resource "aws_security_group" "ssh" {
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.cidr]
  }
}

resource "aws_instance" "bastion" {
  ami                    = "ami-1"
  instance_type          = "t3.micro"
  vpc_security_group_ids = [aws_security_group.ssh.id]
}

variable "cidr" {}
`,
    };
    const doc = input(files);
    const text = pdfText(buildArchitecturePdf({ ...doc, sections: { ...doc.sections, cost: true } }));
    expect(text).toContain('Inside local modules');
    expect(text).toContain('module.edge');
    expect(text).toContain('modules/edge · 2 instances');
    expect(text).toContain('bastion');
    expect(text).toContain('instance_type: t3.micro');
    expect(text).toContain('SSH (port 22) is open to the internet: module.edge › aws_security_group.ssh');
    // the security review points there
    expect(text).toContain('2 findings inside local modules: see Inside local modules.');
    // the cost table groups them under the call, × its instances
    expect(text).toContain('module.edge × 2');
    expect(text).toMatch(/Inside it: ~\$[\d.]+\/mo per instance, × 2/);
    const pt = pdfText(buildArchitecturePdf({ ...input(files, 'pt-BR'), sections: { ...doc.sections, cost: true } }));
    expect(pt).toContain('Dentro de módulos locais');
    expect(pt).toContain('modules/edge · 2 instâncias');
  });

  it('no section without modules', () => {
    const text = pdfText(buildArchitecturePdf(input({ 'main.tf': 'resource "aws_vpc" "a" {}\n' })));
    expect(text).not.toContain('Listing the modules');
    expect(text).not.toMatch(/\bModules\b/);
  });
});
