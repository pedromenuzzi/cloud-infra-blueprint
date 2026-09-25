import { describe, expect, it } from 'vitest';
import { parseProject } from './parser';

function parse(src: string) {
  const { ir, diagnostics } = parseProject({ 'main.tf': src });
  return { ir, errors: diagnostics.filter((d) => d.severity === 'error') };
}

describe('parser diagnostics for half-typed code', () => {
  it('flags a block that is never closed (instead of silently dropping it)', () => {
    const { ir, errors } = parse(
      'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n\n' +
        'resource "aws_s3_bucket" "logs" {\n  bucket = "x"\n',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Missing "}"/);
    expect(errors[0].start).toEqual({ line: 5, col: 1 });
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_vpc.main']);
  });

  it('flags an unclosed nested block', () => {
    const { errors } = parse('resource "aws_security_group" "web" {\n  ingress {\n    from_port = 80\n');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Missing "}"/);
  });

  // These used to spin forever: parseExpression made no progress on the stray `}`/`)`.
  it('terminates on a list cut off by the closing brace of its block', () => {
    const { ir, errors } = parse('resource "aws_instance" "web" {\n  vpc_security_group_ids = [\n}\n');
    expect(errors.map((e) => e.message)).toEqual(['Expected "]" to close this list']);
    expect(errors[0].start).toEqual({ line: 2, col: 28 });
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_instance.web']);
  });

  it('terminates on a list with a mismatched bracket', () => {
    const { errors } = parse('resource "aws_instance" "web" {\n  ids = [)]\n}\n');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('flags an attribute with no value', () => {
    const { ir, errors } = parse('resource "aws_s3_bucket" "logs" {\n  bucket = \n}\n');
    expect(errors.map((e) => e.message)).toEqual(['Expected a value after "bucket ="']);
    expect(errors[0].start).toEqual({ line: 2, col: 3 });
    expect(ir.resources).toHaveLength(1);
  });

  it('flags blocks with the wrong number of labels', () => {
    expect(parse('resource "aws_s3_bucket" {\n}\n').errors[0].message).toBe(
      'Expected resource "TYPE" "NAME" { … }',
    );
    expect(parse('variable {\n}\n').errors[0].message).toBe('Expected variable "NAME" { … }');
    expect(parse('terraform "x" {\n}\n').errors[0].message).toBe('Expected terraform { … }');
  });

  it('accepts well-formed top-level blocks of every kind', () => {
    const { errors } = parse(
      [
        'terraform {\n  required_version = ">= 1.5"\n}',
        'provider "aws" {\n  region = var.region\n}',
        'variable "region" {\n  default = "us-east-1"\n}',
        'locals {\n  tags = { team = "platform" }\n}',
        'data "aws_ami" "ubuntu" {\n  most_recent = true\n}',
        'module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}',
        'resource "aws_instance" "web" {\n  ami  = data.aws_ami.ubuntu.id\n  tags = local.tags\n}',
        'output "ip" {\n  value = aws_instance.web.public_ip\n}',
      ].join('\n\n') + '\n',
    );
    expect(errors).toEqual([]);
  });
});
