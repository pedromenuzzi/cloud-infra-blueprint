import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import { validateProject } from '@/ir/validate';
import { CATALOG_PROVIDERS, catalogProject } from '@/resources/catalogProject';
import { getDef } from '@/resources/registry';
import { TEMPLATES } from '@/templates';
import { loadSchema } from './store';
import { SCHEMA_PROVIDERS } from './types';
import { literalTypeProblem, schemaIssues } from './validate';
import { parseType } from './lookup';

beforeAll(async () => {
  await Promise.all(SCHEMA_PROVIDERS.map((p) => loadSchema(p)));
});

function warningsFor(hcl: string) {
  const { ir, diagnostics } = parseProject({ 'main.tf': hcl });
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return { ir, warnings: validateProject(ir, getDef) };
}

describe('schema validation: no false positives', () => {
  for (const t of TEMPLATES) {
    it(`template ${t.slug}`, () => {
      const { ir } = parseProject(t.build('My Demo App'));
      expect(validateProject(ir, getDef)).toEqual([]);
      for (const r of ir.resources) expect(schemaIssues(r, getDef(r.type))).toEqual([]);
    });
  }

  for (const provider of CATALOG_PROVIDERS) {
    it(`catalog project ${provider} (every palette resource as dropped and wired)`, () => {
      const { ir } = parseProject(catalogProject(provider));
      const issues = ir.resources.flatMap((r) => schemaIssues(r, getDef(r.type)).map((i) => `${r.id}: ${i.message}`));
      expect(issues).toEqual([]);
    });
  }

  it('meta-arguments, dynamic blocks, provisioners, lifecycle and timeouts', () => {
    const { warnings } = warningsFor(`
resource "aws_security_group" "web" {
  count       = 2
  name        = "web"
  description = "web"
  provider    = aws.west
  depends_on  = [aws_vpc.main]

  dynamic "ingress" {
    for_each = var.ports
    content {
      from_port = ingress.value
      to_port   = ingress.value
      protocol  = "tcp"
    }
  }

  lifecycle {
    create_before_destroy = true
  }

  timeouts {
    create = "5m"
  }
}

resource "aws_instance" "web" {
  for_each      = toset(["a", "b"])
  ami           = "ami-123"
  instance_type = "t3.micro"

  provisioner "local-exec" {
    command = "echo hi"
  }

  connection {
    type = "ssh"
  }
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
`);
    expect(warnings.filter((w) => !w.message.includes('unknown resource'))).toEqual([]);
  });

  it('attributes written as blocks (SDKv2 "attributes as blocks") are accepted', () => {
    const { warnings } = warningsFor(`
resource "aws_security_group" "web" {
  name = "web"
  ingress {
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
`);
    expect(warnings).toEqual([]);
  });

  it('expressions are never judged', () => {
    const { warnings } = warningsFor(`
resource "aws_instance" "web" {
  ami                         = var.ami
  instance_type               = local.size
  monitoring                  = var.monitoring
  associate_public_ip_address = length(var.x) > 0
  user_data                   = <<-EOT
    #!/bin/bash
  EOT
  tags = merge(local.tags, { Name = "web" })
}
`);
    expect(warnings).toEqual([]);
  });
});

describe('schema validation: findings', () => {
  it('unknown arguments get a did-you-mean, at the argument', () => {
    const { warnings } = warningsFor(`resource "aws_s3_bucket" "logs" {
  bucket        = "logs"
  force_destory = true
}
`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('aws_s3_bucket.logs: unknown argument "force_destory". Did you mean "force_destroy"?');
    expect(warnings[0].start).toEqual({ line: 3, col: 3 });
    expect(warnings[0].end).toEqual({ line: 3, col: 16 });
  });

  it('unknown keys inside nested blocks point at the nested key', () => {
    const { warnings } = warningsFor(`resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  root_block_device {
    volume_size = 20
    volum_type  = "gp3"
  }
}
`);
    expect(warnings.map((w) => w.message)).toEqual([
      'aws_instance.web: unknown argument "volum_type" in root_block_device. Did you mean "volume_type"?',
    ]);
    expect(warnings[0].start).toEqual({ line: 6, col: 5 });
  });

  it('unknown blocks and dynamic labels', () => {
    const { warnings } = warningsFor(`resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  root_block_devic {
    volume_size = 20
  }
  dynamic "ebs_block_devices" {
    for_each = []
    content {}
  }
}
`);
    expect(warnings.map((w) => w.message)).toEqual([
      'aws_instance.web: unknown block "root_block_devic". Did you mean "root_block_device"?',
      'aws_instance.web: unknown block type "ebs_block_devices". Did you mean "ebs_block_device"?',
    ]);
  });

  it('missing schema-required arguments the catalog does not flag, and required blocks', () => {
    const { warnings } = warningsFor(`resource "aws_lb_listener" "http" {
  load_balancer_arn = "arn"
}

resource "aws_iam_role_policy" "p" {
  role = "r"
}
`);
    expect(warnings.map((w) => w.message)).toEqual([
      'aws_lb_listener.http: required block "default_action" is missing',
      'aws_iam_role_policy.p: required argument "policy" is missing',
    ]);
  });

  it('missing required arguments inside nested blocks, pointing at the block', () => {
    const { warnings } = warningsFor(`resource "aws_lb_listener" "http" {
  load_balancer_arn = "arn"
  default_action {
    target_group_arn = "arn"
  }
}
`);
    expect(warnings.map((w) => w.message)).toEqual([
      'aws_lb_listener.http: required argument "type" in default_action is missing',
    ]);
    expect(warnings[0].start).toEqual({ line: 3, col: 3 });
  });

  it('deprecated, read-only, mistyped and misshapen arguments', () => {
    const { warnings } = warningsFor(`resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  arn           = "arn:aws:ec2:1"
  monitoring    = "yes"
  ipv6_address_count = true
  security_groups = "sg-1"
  network_interface {
    device_index         = 0
    network_interface_id = "eni-1"
  }
  credit_specification = {}
}
`);
    expect(warnings.map((w) => w.message.replace('aws_instance.web: ', ''))).toEqual([
      '"arn" is read-only: the provider computes it',
      '"monitoring" expects a bool, got "yes"',
      '"ipv6_address_count" expects a number, got true',
      '"security_groups" expects set(string), got "sg-1"',
      'block "network_interface" is deprecated',
      '"credit_specification" is a block: write credit_specification { … }, not credit_specification = …',
    ]);
  });

  it('too many single-item blocks', () => {
    const { warnings } = warningsFor(`resource "aws_instance" "web" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  root_block_device {
    volume_size = 20
  }
  root_block_device {
    volume_size = 30
  }
}
`);
    expect(warnings.map((w) => w.message)).toEqual([
      'aws_instance.web: block "root_block_device" may appear at most once, found 2',
    ]);
  });

  it('unknown resource types of a loaded provider', () => {
    const { warnings } = warningsFor(`resource "aws_s3_buckett" "x" {
  bucket = "x"
}
`);
    expect(warnings.map((w) => w.message)).toEqual([
      'aws_s3_buckett.x: resource type "aws_s3_buckett" is not in the aws provider 6.66.0. Did you mean "aws_s3_bucket"?',
    ]);
  });
});

describe('literal type checks', () => {
  const lit = (value: string | number | boolean | null) => ({ kind: 'literal' as const, value });
  it('only flags conversions Terraform refuses', () => {
    expect(literalTypeProblem(lit('true'), parseType('bool'))).toBeUndefined();
    expect(literalTypeProblem(lit('1'), parseType('bool'))).toBeUndefined();
    expect(literalTypeProblem(lit('yes'), parseType('bool'))).toBe('expects a bool, got "yes"');
    expect(literalTypeProblem(lit(3), parseType('bool'))).toBe('expects a bool, got 3');
    expect(literalTypeProblem(lit('42'), parseType('number'))).toBeUndefined();
    expect(literalTypeProblem(lit('1e3'), parseType('number'))).toBeUndefined();
    expect(literalTypeProblem(lit('abc'), parseType('number'))).toBe('expects a number, got "abc"');
    expect(literalTypeProblem(lit(1), parseType('string'))).toBeUndefined();
    expect(literalTypeProblem(lit(null), parseType('list(string)'))).toBeUndefined();
    expect(literalTypeProblem({ kind: 'list', items: [lit(1), lit('x')] }, parseType('list(number)'))).toBe(
      'expects list(number): an item should be a number, got "x"',
    );
    expect(literalTypeProblem({ kind: 'object', fields: { a: lit('x') } }, parseType('map(string)'))).toBeUndefined();
    expect(literalTypeProblem({ kind: 'ref', path: 'var.x' }, parseType('number'))).toBeUndefined();
    expect(literalTypeProblem({ kind: 'raw', hcl: 'f(x)' }, parseType('bool'))).toBeUndefined();
    expect(literalTypeProblem(lit('x'), parseType('any'))).toBeUndefined();
  });
});
