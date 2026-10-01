import { describe, expect, it } from 'vitest';
import { buildArchitecturePdf, type ArchDocInput } from '@/features/export/archDoc';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { expectWellFormed, pdfText } from '@/lib/pdf/testing';
import { getDef } from '@/resources/registry';
import { auditSecurity } from '@/security/audit';
import { estimateProject } from '@/cost/estimate';
import { PRICE_BOOK } from '@/cost/prices/prices';

const MAIN = `data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
}

data "aws_ssm_parameter" "db" {
  name = "/app/db_password"
}

data "aws_caller_identity" "current" {}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
}

locals {
  account = data.aws_caller_identity.current.account_id
}
`;

function input(files: Record<string, string>, locale: 'en' | 'pt-BR' = 'en'): ArchDocInput {
  const { ir } = parseProject(files);
  return {
    title: 'Lookups',
    ir,
    edges: deriveStructure(ir, getDef),
    files: Object.entries(files),
    audit: auditSecurity(ir),
    diagram: null,
    sections: { inventory: true, connections: true, security: true, code: false },
    paper: 'a4',
    generatedAt: new Date(2026, 9, 1),
    compress: false,
    locale,
  };
}

describe('the PDF lists data sources', () => {
  it('type, name, what it is looked up with and what reads it, in a section of its own', () => {
    const bytes = buildArchitecturePdf(input({ 'main.tf': MAIN }));
    expectWellFormed(bytes);
    const text = pdfText(bytes);
    expect(text).toContain('Data sources');
    expect(text).toContain('data.aws_ami.ubuntu');
    expect(text).toContain('AMI');
    expect(text).toContain('most_recent = true');
    expect(text).toContain('id: aws_instance.web');
    expect(text).toContain('account_id: locals (main.tf)');
    expect(text).toContain('nothing reads it');
  });

  it('in Portuguese', () => {
    const text = pdfText(buildArchitecturePdf(input({ 'main.tf': MAIN }, 'pt-BR')));
    expect(text).toContain('Fontes de dados');
    expect(text).toContain('LIDA POR');
    expect(text).toContain('Identidade da conta');
  });

  it('no section without data sources', () => {
    const text = pdfText(buildArchitecturePdf(input({ 'main.tf': 'resource "aws_vpc" "a" {}\n' })));
    expect(text).not.toContain('Listing the data sources');
    expect(text).not.toMatch(/\bData sources\b/);
  });
});

describe('the cost estimate', () => {
  it('has no line for a data source: it costs nothing', () => {
    const { ir } = parseProject({ 'main.tf': MAIN });
    const estimate = estimateProject(ir, PRICE_BOOK, 'en');
    const ids = JSON.stringify(estimate);
    expect(ids).toContain('aws_instance.web');
    expect(ids).not.toContain('data.aws_ami');
  });
});
