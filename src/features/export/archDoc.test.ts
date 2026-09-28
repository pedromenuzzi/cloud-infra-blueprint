import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { expectWellFormed, pdfText } from '@/lib/pdf/testing';
import { getDef } from '@/resources/registry';
import { auditSecurity } from '@/security/audit';
import { TEMPLATES } from '@/templates';
import { buildArchitecturePdf, keySettings, providerSummary, type ArchDocInput, type DocSections } from './archDoc';

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

  it('never prints secrets from resource arguments or sensitive variables', () => {
    const files = {
      'main.tf': `
variable "db_password" {
  type      = string
  default   = "var-secret-123"
  sensitive = true
}
resource "aws_db_instance" "db" {
  engine         = "postgres"
  instance_class = "db.t3.micro"
  username       = "admin"
  password       = "hunter2-literal"
}
`,
    };
    const input = inputFor(files, { sections: { ...ALL, code: false } });
    const text = pdfText(buildArchitecturePdf(input));
    expect(text).toContain('engine: postgres');
    expect(text).toContain('password: ••••••');
    expect(text).not.toContain('hunter2-literal');
    expect(text).not.toContain('var-secret-123');
    expect(text).toContain('(sensitive)');
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
