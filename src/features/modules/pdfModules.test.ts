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

  it('no section without modules', () => {
    const text = pdfText(buildArchitecturePdf(input({ 'main.tf': 'resource "aws_vpc" "a" {}\n' })));
    expect(text).not.toContain('Listing the modules');
    expect(text).not.toMatch(/\bModules\b/);
  });
});
