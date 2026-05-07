import { lit } from '@blueprint/ir';
import { beforeAll, describe, expect, it } from 'vitest';

import { parse, type Hcl2JsonAdapter } from './parser.js';
import { patchResource, removeResource, shiftRanges } from './patch.js';
import { createNodeAdapter } from './workerClient.js';

describe('Minimal HCL patch', () => {
  let adapter: Hcl2JsonAdapter;
  beforeAll(async () => {
    adapter = await createNodeAdapter();
  });

  it('rewrites only the changed block, leaving surrounding text intact', async () => {
    const source = [
      `# top comment`,
      `resource "aws_vpc" "main" {`,
      `  cidr_block = "10.0.0.0/16"`,
      `}`,
      ``,
      `resource "aws_instance" "web" {`,
      `  instance_type = "t3.micro"`,
      `}`,
      ``,
      `# trailing comment`,
      ``,
    ].join('\n');

    const ir = await parse({ 'main.tf': source }, adapter);
    const ec2 = ir.resources.find((r) => r.type === 'aws_instance');
    expect(ec2).toBeDefined();
    expect(ec2?.trivia.rawTextRange).toBeDefined();

    const updated = {
      ...ec2!,
      args: { ...ec2!.args, instance_type: lit('t3.large') },
    };
    const { patch, next } = patchResource(source, updated);

    // The bytes before the EC2 block are untouched.
    expect(next.startsWith('# top comment\n')).toBe(true);
    // The trailing comment is preserved.
    expect(next).toContain('# trailing comment');
    // The new block has the updated value.
    expect(next).toContain('instance_type = "t3.large"');
    // The VPC block is byte-identical.
    expect(next).toContain('cidr_block = "10.0.0.0/16"');
    // Patch describes the actual change.
    expect(patch.start).toBe(ec2!.trivia.rawTextRange!.start);
    expect(patch.end).toBe(ec2!.trivia.rawTextRange!.end);
  });

  it('appends new block when node has no rawTextRange', async () => {
    const source = `resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }\n`;
    const ir = await parse({ 'main.tf': source }, adapter);

    const newNode = {
      ...ir.resources[0]!,
      id: 'fresh-id',
      type: 'aws_subnet',
      name: 'a',
      args: { vpc_id: lit('foo'), cidr_block: lit('10.0.1.0/24') },
      trivia: { leadingComments: [], trailingComments: [] },
    };
    const { next } = patchResource(source, newNode);
    expect(next).toContain('aws_vpc');
    expect(next).toContain('aws_subnet');
    expect(next).toContain('cidr_block = "10.0.1.0/24"');
  });

  it('removeResource excises the block and its trailing newline', async () => {
    const source = [
      `resource "aws_vpc" "a" { cidr_block = "10.0.0.0/16" }`,
      `resource "aws_vpc" "b" { cidr_block = "10.1.0.0/16" }`,
      ``,
    ].join('\n');
    const ir = await parse({ 'main.tf': source }, adapter);
    const a = ir.resources.find((r) => r.name === 'a');
    const { next } = removeResource(source, a!);
    expect(next).not.toContain('"a"');
    expect(next).toContain('"b"');
  });

  it('shiftRanges adjusts subsequent nodes after a patch', async () => {
    const source = [
      `resource "aws_vpc" "a" { cidr_block = "10.0.0.0/16" }`,
      `resource "aws_vpc" "b" { cidr_block = "10.1.0.0/16" }`,
    ].join('\n');
    const ir = await parse({ 'main.tf': source }, adapter);
    const a = ir.resources.find((r) => r.name === 'a')!;
    const b = ir.resources.find((r) => r.name === 'b')!;
    const bStartBefore = b.trivia.rawTextRange!.start;

    const updated = { ...a, args: { ...a.args, cidr_block: lit('10.99.0.0/16') } };
    const { patch } = patchResource(source, updated);
    shiftRanges([a, b], patch);

    const delta = patch.text.length - (patch.end - patch.start);
    expect(b.trivia.rawTextRange!.start).toBe(bStartBefore + delta);
  });
});
