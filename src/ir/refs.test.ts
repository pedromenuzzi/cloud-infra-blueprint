import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { applyOpsWithPatches } from '@/hcl/patch';
import { getDef } from '@/resources/registry';
import { collectRefs, exprMentions, raw, ref, refTargetAddress, renameInHcl, scanTraversals } from './expr';
import { deriveStructure } from './graph';
import { applyOps } from './ops';
import { validateProject } from './validate';

describe('indexed references', () => {
  it('resolve to the resource address', () => {
    expect(refTargetAddress('aws_subnet.private[0].id')).toBe('aws_subnet.private');
    expect(refTargetAddress('aws_security_group.sg["web"].id')).toBe('aws_security_group.sg');
    expect(refTargetAddress('aws_subnet.private[*].id')).toBe('aws_subnet.private');
    expect(refTargetAddress('aws_subnet.private.*.id')).toBe('aws_subnet.private');
    expect(refTargetAddress('aws_subnet.private')).toBe('aws_subnet.private');
    expect(refTargetAddress('data.aws_ami.x.id')).toBeNull();
    expect(refTargetAddress('var.list[0]')).toBeNull();
  });

  const src = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private" {
  count      = 2
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
}

resource "aws_security_group" "sg" {
  for_each = toset(["web"])
  vpc_id   = aws_vpc.main.id
}

resource "aws_instance" "app" {
  ami                    = "ami-123"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.sg["web"].id]
}

output "subnets" {
  value = aws_subnet.private[*].id
}
`;

  it('draw edges / containment and raise no false warnings', () => {
    const { ir } = parseProject({ 'main.tf': src });
    const edges = deriveStructure(ir, getDef);
    const app = ir.resources.find((r) => r.id === 'aws_instance.app')!;
    expect(app.parentId).toBe('aws_subnet.private');
    expect(edges.some((e) => e.source === 'aws_instance.app' && e.target === 'aws_security_group.sg')).toBe(true);
    expect(validateProject(ir, getDef).filter((w) => /unknown resource/.test(w.message))).toEqual([]);
  });

  it('follow a rename', () => {
    const files = { 'main.tf': src };
    const { ir } = parseProject(files);
    const out = applyOpsWithPatches(files, ir, [
      { kind: 'rename_resource', nodeId: 'aws_subnet.private', newName: 'priv' },
      { kind: 'rename_resource', nodeId: 'aws_security_group.sg', newName: 'web' },
    ]);
    expect(out.files['main.tf']).toContain('subnet_id              = aws_subnet.priv[0].id');
    expect(out.files['main.tf']).toContain('[aws_security_group.web["web"].id]');
    expect(out.files['main.tf']).toContain('value = aws_subnet.priv[*].id');
    expect(out.files['main.tf']).not.toMatch(/aws_subnet\.private|aws_security_group\.sg\b/);
  });
});

describe('traversals inside raw HCL', () => {
  it('are found in code and interpolations, never in string text, comments or heredoc text', () => {
    const hcl = `merge(aws_vpc.a.tags, { x = "aws_vpc.b.id \${aws_vpc.c.id}" }) # aws_vpc.d
<<EOF
aws_vpc.e \${aws_vpc.f.arn}
EOF`;
    expect(scanTraversals(hcl).map((t) => t.path)).toEqual(['aws_vpc.a.tags', 'aws_vpc.c.id', 'aws_vpc.f.arn']);
  });

  it('match whole identifiers only', () => {
    expect(scanTraversals('aws_vpc.main2.id + data.aws_vpc.main.id + xaws_vpc.main').map((t) => t.path)).toEqual([
      'aws_vpc.main2.id',
      'data.aws_vpc.main.id',
      'xaws_vpc.main',
    ]);
    const hcl = 'concat([aws_vpc.main.id], aws_vpc.main2.ids, [data.aws_vpc.main.id], "${aws_vpc.main[0].arn}")';
    expect(renameInHcl(hcl, 'aws_vpc.main', 'aws_vpc.core')).toBe(
      'concat([aws_vpc.core.id], aws_vpc.main2.ids, [data.aws_vpc.main.id], "${aws_vpc.core[0].arn}")',
    );
    expect(exprMentions(raw(hcl), 'aws_vpc.main')).toBe(true);
    expect(exprMentions(raw('aws_vpc.main2.id'), 'aws_vpc.main')).toBe(false);
    expect(exprMentions(ref('aws_vpc.main[0].id'), 'aws_vpc.main')).toBe(true);
  });

  it('feed edges for references buried in functions and templates', () => {
    const refs: Array<{ field: string; path: string }> = [];
    collectRefs(raw('cidrsubnet(aws_vpc.main.cidr_block, 8, 1)'), 'cidr_block', refs);
    collectRefs(raw('"literal aws_vpc.nope.id"'), 'name', refs);
    expect(refs).toEqual([{ field: 'cidr_block', path: 'aws_vpc.main.cidr_block' }]);
  });
});

describe('rename rewrites every reference', () => {
  const files = {
    'main.tf': `locals {
  cidr = cidrsubnet(aws_vpc.main.cidr_block, 8, 1)
  name = "\${aws_vpc.main.id}-a"
  text = "aws_vpc.main stays: it is text"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_iam_policy" "p" {
  policy = jsonencode({ Resource = "\${aws_vpc.main.arn}/*" })
}

module "net" {
  vpc_id = aws_vpc.main.id
}

data "aws_subnets" "all" {
  filter {
    values = [aws_vpc.main.id]
  }
}
`,
    'outputs.tf': 'output "vpc" {\n  value = "${aws_vpc.main.id}"\n}\n',
  };

  it('in resources, locals, modules, data sources and outputs — and nowhere else', () => {
    const { ir } = parseProject(files);
    const out = applyOpsWithPatches(files, ir, [{ kind: 'rename_resource', nodeId: 'aws_vpc.main', newName: 'core' }]);
    expect(out.refused).toBeUndefined();
    expect(out.files['main.tf']).toBe(
      files['main.tf'].replace(/aws_vpc\.main\.(cidr_block|id|arn)/g, 'aws_vpc.core.$1').replace('"aws_vpc" "main"', '"aws_vpc" "core"'),
    );
    expect(out.files['outputs.tf']).toBe('output "vpc" {\n  value = "${aws_vpc.core.id}"\n}\n');
    expect(out.files['main.tf']).not.toContain('moved');
  });

  it('keeps untouched blocks as the same objects', () => {
    const { ir } = parseProject(files);
    const { ir: next, touched } = applyOps(ir, [{ kind: 'rename_resource', nodeId: 'aws_vpc.main', newName: 'core' }]);
    // `module "net"` and `data "aws_subnets" "all"` are nodes of their own (not verbatim blocks)
    expect([...touched].sort()).toEqual(['aws_iam_policy.p', 'aws_vpc.core', 'data.aws_subnets.all', 'module.net', 'output.vpc', 'raw.main.tf#0']);
    expect(next.resources.find((r) => r.id === 'aws_iam_policy.p')).not.toBe(ir.resources.find((r) => r.id === 'aws_iam_policy.p'));
  });
});

describe('validation warnings point at the offending code', () => {
  it('at the argument (not the # @blueprint:pos line above the block)', () => {
    const src = `# @blueprint:pos=10,10
resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.missing.id
}
`;
    const { ir } = parseProject({ 'main.tf': src });
    const warning = validateProject(ir, getDef).find((w) => /unknown resource/.test(w.message))!;
    expect(warning.start).toEqual({ line: 5, col: 3 });
    expect(warning.end).toEqual({ line: 5, col: 12 });
  });

  it('at the block header for a missing required argument', () => {
    const { ir } = parseProject({ 'main.tf': '# @blueprint:pos=1,1\nresource "aws_subnet" "a" {\n}\n' });
    const warning = validateProject(ir, getDef).find((w) => /required argument/.test(w.message));
    expect(warning?.start).toEqual({ line: 2, col: 1 });
  });
});
