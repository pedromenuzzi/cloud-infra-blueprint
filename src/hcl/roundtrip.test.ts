import { describe, expect, it } from 'vitest';
import { exprEquals } from '@/ir/expr';
import type { IR } from '@/ir/types';
import { emitProject } from './emitter';
import { parseProject } from './parser';
import { applyOpsWithPatches } from './patch';
import { lit } from '@/ir/expr';
import { TEMPLATES } from '@/templates';

function expectSameResources(a: IR, b: IR) {
  const aIds = a.resources.map((r) => r.id).sort();
  const bIds = b.resources.map((r) => r.id).sort();
  expect(bIds).toEqual(aIds);
  for (const ra of a.resources) {
    const rb = b.resources.find((r) => r.id === ra.id)!;
    const aKeys = Object.keys(ra.args).sort();
    const bKeys = Object.keys(rb.args).sort();
    expect(bKeys, `arg keys of ${ra.id}`).toEqual(aKeys);
    for (const k of aKeys) {
      expect(exprEquals(ra.args[k], rb.args[k]), `${ra.id}.${k} round-trips`).toBe(true);
    }
    expect(rb.position, `position of ${ra.id}`).toEqual(ra.position);
  }
  expect(b.variables.map((v) => v.id).sort()).toEqual(a.variables.map((v) => v.id).sort());
  expect(b.outputs.map((v) => v.id).sort()).toEqual(a.outputs.map((v) => v.id).sort());
}

describe('HCL round-trip', () => {
  for (const t of TEMPLATES) {
    it(`template ${t.slug}: parse → emit → parse is stable`, () => {
      const files = t.build('demo-app');
      const first = parseProject(files);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.ir.resources.length).toBeGreaterThanOrEqual(t.resourceCount - 1);

      const emitted = emitProject(first.ir);
      const second = parseProject(emitted);
      expect(second.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expectSameResources(first.ir, second.ir);

      // fixpoint: emitting again produces identical text
      const emittedAgain = emitProject(second.ir);
      expect(emittedAgain).toEqual(emitted);
    });
  }

  it('preserves exotic user HCL verbatim (heredocs, functions, conditionals, comments)', () => {
    const source = `# Global settings
locals {
  common_tags = {
    Team = "platform"
  }
}

# The web server — hand-tuned, do not touch
resource "aws_instance" "web" {
  # @blueprint:pos=120,240
  ami           = "ami-123456"
  instance_type = var.env == "prod" ? "m5.large" : "t3.micro"
  user_data     = <<-EOF
    #!/bin/bash
    echo "hello \${var.env}"
  EOF
  subnet_id     = aws_subnet.a.id # keep in subnet A

  tags = merge(local.common_tags, { Name = "web" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`;
    const { ir, diagnostics } = parseProject({ 'main.tf': source });
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    const web = ir.resources.find((r) => r.id === 'aws_instance.web')!;
    expect(web.position).toEqual({ x: 120, y: 240 });
    expect(web.trivia.leadingComments).toEqual(['# The web server — hand-tuned, do not touch']);
    expect(web.args.instance_type.kind).toBe('raw');
    expect(web.args.user_data.kind).toBe('raw');
    expect(web.args.tags.kind).toBe('raw');
    expect(web.args.lifecycle.kind).toBe('block');
    expect(web.trivia.argTrailing?.subnet_id).toBe('# keep in subnet A');

    // locals block preserved verbatim as an extra
    expect(ir.extras).toHaveLength(1);
    expect(ir.extras[0].text).toContain('common_tags');

    // patch a different resource: everything about "web" must stay identical
    const before = source.slice(
      web.trivia.rawTextRange!.start,
      web.trivia.rawTextRange!.end,
    );
    const result = applyOpsWithPatches({ 'main.tf': source }, ir, [
      { kind: 'set_arg', nodeId: 'aws_vpc.main', field: 'enable_dns_support', value: lit(true) },
    ]);
    expect(result.files['main.tf']).toContain(before);
    expect(result.files['main.tf']).toContain('enable_dns_support');
    expect(result.files['main.tf']).toContain('# Global settings');

    const reparsed = parseProject(result.files);
    const web2 = reparsed.ir.resources.find((r) => r.id === 'aws_instance.web')!;
    expect(web2.args.user_data.kind).toBe('raw');
  });

  it('patches only the touched block', () => {
    const files = {
      'main.tf': `# comment above A
resource "aws_s3_bucket" "a" {
  bucket = "bucket-a"
}

# comment above B
resource "aws_s3_bucket" "b" {
  bucket = "bucket-b"
}
`,
    };
    const { ir } = parseProject(files);
    const result = applyOpsWithPatches(files, ir, [
      { kind: 'set_arg', nodeId: 'aws_s3_bucket.a', field: 'bucket', value: lit('renamed-a') },
    ]);
    expect(result.files['main.tf']).toContain('renamed-a');
    expect(result.files['main.tf']).toContain('# comment above A');
    // block B is byte-for-byte identical
    expect(result.files['main.tf']).toContain(
      '# comment above B\nresource "aws_s3_bucket" "b" {\n  bucket = "bucket-b"\n}',
    );
  });

  it('removes a block together with its attached comments', () => {
    const files = {
      'main.tf': `resource "aws_s3_bucket" "keep" {
  bucket = "keep"
}

# goes away with the block
resource "aws_s3_bucket" "gone" {
  bucket = "gone"
}
`,
    };
    const { ir } = parseProject(files);
    const result = applyOpsWithPatches(files, ir, [
      { kind: 'remove_resource', nodeId: 'aws_s3_bucket.gone' },
    ]);
    expect(result.files['main.tf']).not.toContain('gone');
    expect(result.files['main.tf']).toContain('"keep"');
    expect(result.ir.resources).toHaveLength(1);
  });

  it('rename rewrites references across blocks and files', () => {
    const files = {
      'main.tf': `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`,
      'outputs.tf': `output "vpc_id" {
  value = aws_vpc.main.id
}
`,
    };
    const { ir } = parseProject(files);
    const result = applyOpsWithPatches(files, ir, [
      { kind: 'rename_resource', nodeId: 'aws_vpc.main', newName: 'core' },
    ]);
    expect(result.files['main.tf']).toContain('resource "aws_vpc" "core"');
    expect(result.files['main.tf']).toContain('aws_vpc.core.id');
    expect(result.files['outputs.tf']).toContain('aws_vpc.core.id');
    expect(result.files['main.tf']).not.toContain('aws_vpc.main');
  });

  it('add appends to main.tf with a position comment', () => {
    const files = { 'main.tf': '' };
    const { ir } = parseProject(files);
    const result = applyOpsWithPatches(files, ir, [
      {
        kind: 'add_resource',
        node: {
          id: 'aws_s3_bucket.new',
          provider: 'aws',
          type: 'aws_s3_bucket',
          name: 'new',
          args: { bucket: lit('my-new-bucket') },
          position: { x: 100, y: 60 },
          trivia: { leadingComments: [] },
        },
      },
    ]);
    expect(result.files['main.tf']).toContain('# @blueprint:pos=100,60');
    expect(result.files['main.tf']).toContain('resource "aws_s3_bucket" "new"');
    const node = result.ir.resources.find((r) => r.id === 'aws_s3_bucket.new')!;
    expect(node.position).toEqual({ x: 100, y: 60 });
  });
});
