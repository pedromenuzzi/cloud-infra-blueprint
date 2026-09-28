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

describe('expressions the parser must not mangle', () => {
  it('a heredoc value ends at its terminator line (the next comment is not glued to it)', () => {
    const { ir, errors } = parse(
      'resource "aws_instance" "web" {\n  user_data = <<EOF\necho hi\nEOF\n  # size\n  instance_type = "t3.micro"\n}\n',
    );
    expect(errors).toEqual([]);
    const web = ir.resources[0];
    expect(web.args.user_data).toEqual({ kind: 'raw', hcl: '<<EOF\necho hi\nEOF' });
    expect(web.trivia.argTrailing).toBeUndefined();
    expect(web.trivia.argComments?.instance_type).toEqual(['# size']);
  });

  it('for-comprehensions and non-comma lists are kept verbatim', () => {
    const { ir, errors } = parse(
      'resource "aws_lb" "x" {\n  a = [for s in aws_subnet.public : s.id]\n  b = [[for s in xs : s]]\n  c = {for k, v in var.m : k => v}\n  d = [\n    "x"\n    "y"\n  ]\n}\n',
    );
    expect(errors).toEqual([]);
    const { args } = ir.resources[0];
    expect(args.a).toEqual({ kind: 'raw', hcl: '[for s in aws_subnet.public : s.id]' });
    expect(args.b).toEqual({ kind: 'list', items: [{ kind: 'raw', hcl: '[for s in xs : s]' }] });
    expect(args.c).toEqual({ kind: 'raw', hcl: '{for k, v in var.m : k => v}' });
    expect(args.d.kind).toBe('raw');
  });

  it('decodes every HCL string escape, and `$${` / `%%{` as literal text', () => {
    const { ir, errors } = parse(
      'resource "x" "a" {\n  s = "\\n\\t\\r\\"\\\\ \\u00e9 \\U0001F600 $${x} %%{y} 50$"\n  t = "${var.x}"\n  u = "bad \\q escape"\n}\n',
    );
    expect(errors).toEqual([]);
    const { args } = ir.resources[0];
    expect(args.s).toEqual({ kind: 'literal', value: '\n\t\r"\\ é 😀 ${x} %{y} 50$' });
    expect(args.t).toEqual({ kind: 'raw', hcl: '"${var.x}"' });
    expect(args.u).toEqual({ kind: 'raw', hcl: '"bad \\q escape"' });
  });

  it('keeps the spelling of numbers that would not re-emit the same', () => {
    const { ir } = parse('resource "x" "a" {\n  a = 9007199254740993\n  b = 1.50\n  c = 1e3\n  d = 42\n}\n');
    const { args } = ir.resources[0];
    expect(args.a).toEqual({ kind: 'literal', value: 9007199254740992, text: '9007199254740993' });
    expect(args.b).toEqual({ kind: 'literal', value: 1.5, text: '1.50' });
    expect(args.c).toEqual({ kind: 'literal', value: 1000, text: '1e3' });
    expect(args.d).toEqual({ kind: 'literal', value: 42 });
  });
});

describe('strings are scanned with their nesting', () => {
  it('quotes and braces inside ${…} do not end the string', () => {
    const { ir, errors } = parse(
      'resource "aws_s3_bucket" "a" {\n  bucket = "${replace(var.name, "{", "")}-logs"\n  x      = "${var.x == "}" ? "a" : "b"}"\n}\n\nresource "aws_s3_bucket" "b" {\n  bucket = "b"\n}\n',
    );
    expect(errors).toEqual([]);
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_s3_bucket.a', 'aws_s3_bucket.b']);
    expect(ir.resources[0].args.bucket).toEqual({ kind: 'raw', hcl: '"${replace(var.name, "{", "")}-logs"' });
  });

  it('an unterminated string is reported at its opening quote and the rest still parses', () => {
    const { ir, errors } = parse(
      'resource "aws_s3_bucket" "a" {\n  bucket = "abc\n  acl    = "private"\n}\n\nresource "aws_s3_bucket" "b" {\n  bucket = "b"\n}\n',
    );
    expect(errors).toEqual([expect.objectContaining({ message: 'Unterminated string', start: { line: 2, col: 12 } })]);
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_s3_bucket.a', 'aws_s3_bucket.b']);
    expect(ir.resources[0].args.acl).toEqual({ kind: 'literal', value: 'private' });
  });
});

describe('diagnostics Terraform would raise', () => {
  it('duplicate arguments, an argument and a block with one name, several arguments per line', () => {
    const { errors } = parse(
      'resource "x" "a" {\n  a = 1 b = 2\n  a = 3\n  tags = {}\n  tags {}\n}\nresource "aws_instance" "i" { ami = "x", instance_type = "y" }\n',
    );
    expect(errors.map((e) => [e.start?.line, e.message])).toEqual([
      [2, 'Missing newline after "a": each argument or block goes on its own line'],
      [3, 'Duplicate argument "a": each argument may be set only once'],
      [5, '"tags" is set both as an argument and as a block'],
      [7, 'Unexpected "," after "ami": arguments in a block go on separate lines'],
    ]);
  });

  it('a single argument on one line is fine, and so are repeated nested blocks', () => {
    expect(parse('resource "x" "a" { bucket = "b" }\n').errors).toEqual([]);
    expect(parse('resource "x" "a" {\n  ingress {}\n  ingress {}\n}\n').errors).toEqual([]);
  });

  it('bare identifier labels are valid HCL', () => {
    const { ir, errors } = parse('resource aws_vpc main {\n  cidr_block = "10.0.0.0/16"\n}\n');
    expect(errors).toEqual([]);
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_vpc.main']);
  });

  it('a leading BOM is ignored', () => {
    const { ir, errors } = parse('﻿resource "aws_s3_bucket" "a" {\n  bucket = "a"\n}\n');
    expect(errors).toEqual([]);
    expect(ir.resources.map((r) => r.id)).toEqual(['aws_s3_bucket.a']);
    expect(ir.resources[0].trivia.rawTextRange?.start).toBe(1);
  });
});

describe('source spans', () => {
  it('record the header, labels, pos comment and every argument', () => {
    const src =
      '# Networking\n# @blueprint:pos=1,2\nresource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16" # big\n\n  tags {\n    Name = "x"\n  }\n}\n';
    const node = parse(src).ir.resources[0];
    const spans = node.trivia.spans!;
    expect(node.trivia.sourceText).toBe(src);
    expect(src.slice(spans.header, spans.header + 8)).toBe('resource');
    expect(spans.labels.map((l) => src.slice(l.start, l.end))).toEqual(['"aws_vpc"', '"main"']);
    expect(src.slice(spans.pos!.start, spans.pos!.end)).toBe('# @blueprint:pos=1,2');
    const [cidr, tags] = spans.body.entries;
    expect(src.slice(cidr.valueStart, cidr.valueEnd)).toBe('"10.0.0.0/16"');
    expect(src.slice(cidr.start, cidr.end)).toBe('  cidr_block = "10.0.0.0/16" # big\n');
    expect([cidr.line, cidr.col]).toEqual([4, 3]);
    expect(src.slice(tags.start, tags.end)).toBe('  tags {\n    Name = "x"\n  }\n');
    expect(tags.body!.entries.map((e) => e.key)).toEqual(['Name']);
  });
});

describe('robustness and performance', () => {
  it('survives 5000 levels of nesting (lists, objects, blocks, parentheses, templates)', () => {
    const n = 5000;
    for (const value of [
      `${'['.repeat(n)}1${']'.repeat(n)}`,
      `${'{a = '.repeat(n)}1${'}'.repeat(n)}`,
      `${'('.repeat(n)}1${')'.repeat(n)}`,
      `${'"${'.repeat(n)}1${'}"'.repeat(n)}`,
    ]) {
      const { ir, errors } = parse(`resource "x" "a" {\n  v = ${value}\n}\n`);
      expect(errors).toEqual([]);
      expect(ir.resources).toHaveLength(1);
    }
    const nested = parse(`resource "x" "a" {\n${'b {\n'.repeat(n)}c = 1\n${'}\n'.repeat(n)}}\n`);
    expect(nested.errors).toEqual([]);
    expect(nested.ir.resources).toHaveLength(1);
  });

  it('pasting a large non-HCL document stays fast and caps its diagnostics', () => {
    const json = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `n${i}` })), null, 2);
    expect(json.split('\n').length).toBeGreaterThan(20000);
    const t = performance.now();
    const { diagnostics } = parseProject({ 'main.tf': json });
    expect(performance.now() - t).toBeLessThan(1500);
    expect(diagnostics.length).toBeLessThanOrEqual(100);
  });

  it('parses 20k lines of Terraform in < 1.5 s', () => {
    const src = Array.from(
      { length: 2000 },
      (_, i) =>
        `resource "aws_instance" "i${i}" {\n  ami           = "ami-${i}"\n  instance_type = "t3.micro"\n  subnet_id     = aws_subnet.s${i % 7}.id\n  tags = {\n    Name = "i${i}"\n  }\n\n  lifecycle {\n    create_before_destroy = true\n  }\n}\n`,
    ).join('\n');
    expect(src.split('\n').length).toBeGreaterThan(20000);
    const t = performance.now();
    const { ir, diagnostics } = parseProject({ 'main.tf': src });
    expect(performance.now() - t).toBeLessThan(1500);
    expect(diagnostics).toEqual([]);
    expect(ir.resources).toHaveLength(2000);
  });
});
