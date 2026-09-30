import { describe, expect, it } from 'vitest';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { auditSecurity } from './audit';
import { analyzeSecurity } from './topology';

const audit = (files: Record<string, string>, locale: 'en' | 'pt-BR' = 'en') => {
  const { ir } = parseProject(files);
  return { ir, result: auditSecurity(ir, analyzeSecurity(ir, locale)) };
};

describe('a repeated resource is audited as its instances', () => {
  const db = (meta: string) => ({
    'main.tf': `resource "aws_db_instance" "db" {\n  ${meta}\n  engine              = "postgres"\n  publicly_accessible = true\n  storage_encrypted   = true\n}\n`,
  });

  it('one finding, saying each of the instances once', () => {
    const { result } = audit(db('count = 3'));
    const findings = result.findings.filter((f) => f.id.startsWith('rds-public:'));
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toBe(
      'db (each of its 3 instances) gets a public endpoint. Keep databases private and reach them from inside the VPC.',
    );
    expect(findings[0].detail.match(/instances/g)).toHaveLength(1);
  });

  it('in Portuguese too, and when how many is decided at plan time', () => {
    const pt = audit(db('count = 3'), 'pt-BR').result.findings.find((f) => f.id.startsWith('rds-public:'))!;
    expect(pt.detail).toContain('db (cada uma das 3 instâncias)');
    const unknown = audit(db('for_each = var.names')).result.findings.find((f) => f.id.startsWith('rds-public:'))!;
    expect(unknown.detail).toContain('db (each of its instances)');
  });

  it('a single or optional instance reads as before', () => {
    for (const meta of ['count = 1', 'count = var.enabled ? 1 : 0', 'identifier = "db"']) {
      const f = audit(db(meta)).result.findings.find((x) => x.id.startsWith('rds-public:'))!;
      expect(f.detail.startsWith('db gets a public endpoint')).toBe(true);
    }
  });

  it("fixes every instance: a public access block per bucket, and the finding goes away", () => {
    for (const [meta, expected] of [
      ['for_each = toset(["logs", "raw"])', [/for_each += aws_s3_bucket\.data\n/, /bucket += each\.value\.id\n/]],
      ['count = 2', [/count += 2\n {2}bucket += aws_s3_bucket\.data\[count\.index\]\.id\n/]],
    ] as const) {
      const files = { 'main.tf': `resource "aws_s3_bucket" "data" {\n  ${meta}\n}\n` };
      const { ir, result } = audit(files);
      const finding = result.findings.find((f) => f.id === 's3-public:aws_s3_bucket.data')!;
      expect(finding.detail).toContain('data (each of its 2 instances)');
      const out = applyOpsWithPatches(files, ir, finding.fix!.ops(ir));
      expect(out.refused).toBeUndefined();
      for (const line of expected) expect(out.files['main.tf']).toMatch(line);
      const after = auditSecurity(out.ir, analyzeSecurity(out.ir, 'en'));
      expect(after.findings.some((f) => f.id === 's3-public:aws_s3_bucket.data')).toBe(false);
    }
  });

  it('security groups attached through an instance key still protect', () => {
    const files = {
      'main.tf': `resource "aws_security_group" "web" {\n  count = 2\n  ingress {\n    from_port   = 22\n    to_port     = 22\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n\nresource "aws_instance" "app" {\n  count                  = 2\n  ami                    = "ami-1"\n  vpc_security_group_ids = [aws_security_group.web[count.index].id]\n}\n`,
    };
    const { result } = audit(files);
    expect(result.topology.protects.get('aws_security_group.web')).toEqual(['aws_instance.app']);
    expect(result.findings.some((f) => f.id === 'unused:aws_security_group.web')).toBe(false);
    const rule = result.findings.find((f) => f.id.startsWith('rule:'))!;
    expect(rule.detail.startsWith('web (each of its 2 instances) allows SSH')).toBe(true);
  });
});
