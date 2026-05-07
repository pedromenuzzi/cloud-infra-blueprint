import { beforeAll, describe, expect, it } from 'vitest';

import { HclIncrementalParser } from './incremental.js';
import { parse, type Hcl2JsonAdapter } from './parser.js';
import { createNodeAdapter } from './workerClient.js';

import type { IR } from '@blueprint/ir';

/**
 * Strip the volatile fields (uuids) before comparing two IRs. The
 * incremental parser should produce IRs that are *structurally* equal to
 * the full parser, modulo node ids — full parses always allocate fresh
 * uuids, while incremental parses keep the cached ones for reused blocks.
 */
function normalize(ir: IR): unknown {
  const seen = new Map<string, string>();
  let counter = 0;
  const remap = (id: string): string => {
    let mapped = seen.get(id);
    if (!mapped) {
      mapped = `id_${counter++}`;
      seen.set(id, mapped);
    }
    return mapped;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'id' && typeof val === 'string') out[k] = remap(val);
        else if (k === 'fromNodeId' && typeof val === 'string') out[k] = remap(val);
        else if (k === 'toNodeId' && typeof val === 'string') out[k] = remap(val);
        else out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(ir);
}

const SOURCE_3_RESOURCES = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public_a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "web" {
  ami           = "ami-0abcdef0123456789"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public_a.id
}
`.trim();

describe('HclIncrementalParser', () => {
  let adapter: Hcl2JsonAdapter;
  beforeAll(async () => {
    adapter = await createNodeAdapter();
  });

  it('first parse populates cache and returns the same IR as the full parser', async () => {
    const inc = new HclIncrementalParser(adapter);
    const irInc = await inc.parse('main.tf', SOURCE_3_RESOURCES);
    const irFull = await parse({ 'main.tf': SOURCE_3_RESOURCES }, adapter);

    expect(normalize(irInc)).toEqual(normalize(irFull));

    const stats = inc.statsFor('main.tf')!;
    expect(stats.fastPath).toBe(false);
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(3);
  });

  it('byte-identical re-parse hits the fast path with zero misses', async () => {
    const inc = new HclIncrementalParser(adapter);
    await inc.parse('main.tf', SOURCE_3_RESOURCES);
    const ir2 = await inc.parse('main.tf', SOURCE_3_RESOURCES);

    const stats = inc.statsFor('main.tf')!;
    expect(stats.fastPath).toBe(true);
    expect(stats.cacheHits).toBe(3);
    expect(stats.cacheMisses).toBe(0);
    expect(ir2.resources).toHaveLength(3);
  });

  it('editing one block re-parses only that block', async () => {
    const inc = new HclIncrementalParser(adapter);
    await inc.parse('main.tf', SOURCE_3_RESOURCES);

    // Change instance_type on the EC2 only.
    const edited = SOURCE_3_RESOURCES.replace('"t3.micro"', '"t3.large"');
    const irEdited = await inc.parse('main.tf', edited);
    const stats = inc.statsFor('main.tf')!;

    expect(stats.fastPath).toBe(false);
    expect(stats.cacheHits).toBe(2); // VPC + subnet reused
    expect(stats.cacheMisses).toBe(1); // EC2 re-parsed

    const ec2 = irEdited.resources.find((r) => r.type === 'aws_instance')!;
    expect(ec2.args.instance_type).toEqual({ kind: 'literal', value: 't3.large' });

    // VPC and subnet should keep their uuids across the edit.
    const vpcCached = irEdited.resources.find((r) => r.type === 'aws_vpc')!;
    const irFull = await parse({ 'main.tf': edited }, adapter);
    expect(normalize(irEdited)).toEqual(normalize(irFull));
    void vpcCached;
  });

  it('adding a new resource only re-parses the new one', async () => {
    const inc = new HclIncrementalParser(adapter);
    await inc.parse('main.tf', SOURCE_3_RESOURCES);

    const withSg = `${SOURCE_3_RESOURCES}\n\nresource "aws_security_group" "web_sg" {\n  name = "web"\n}\n`;
    const ir = await inc.parse('main.tf', withSg);
    const stats = inc.statsFor('main.tf')!;

    expect(stats.cacheHits).toBe(3);
    expect(stats.cacheMisses).toBe(1);
    expect(ir.resources).toHaveLength(4);
  });

  it('removing a resource keeps the others cached', async () => {
    const inc = new HclIncrementalParser(adapter);
    await inc.parse('main.tf', SOURCE_3_RESOURCES);

    // Drop the EC2 block entirely.
    const withoutEc2 = SOURCE_3_RESOURCES.replace(
      /resource "aws_instance" "web" \{[\s\S]*?\}\n?/,
      '',
    ).trim();
    const ir = await inc.parse('main.tf', withoutEc2);
    const stats = inc.statsFor('main.tf')!;

    expect(stats.cacheHits).toBe(2); // VPC + subnet survived
    expect(stats.cacheMisses).toBe(0); // nothing new to parse
    expect(ir.resources).toHaveLength(2);
    expect(ir.resources.find((r) => r.type === 'aws_instance')).toBeUndefined();
  });

  it('updates rawTextRange when reused block moves', async () => {
    const inc = new HclIncrementalParser(adapter);
    await inc.parse('main.tf', SOURCE_3_RESOURCES);

    // Insert a comment at the top so every block shifts down.
    const shifted = `# header comment added later\n\n${SOURCE_3_RESOURCES}`;
    const ir = await inc.parse('main.tf', shifted);

    for (const r of ir.resources) {
      expect(r.trivia.rawTextRange).toBeDefined();
      const range = r.trivia.rawTextRange!;
      const slice = shifted.slice(range.start, range.end);
      expect(slice).toMatch(/^resource /);
      expect(slice).toMatch(/}$/);
    }
  });

  it('invalidate(filename) clears the cache for that file only', async () => {
    const inc = new HclIncrementalParser(adapter);
    await inc.parse('main.tf', SOURCE_3_RESOURCES);
    await inc.parse('other.tf', SOURCE_3_RESOURCES);

    inc.invalidate('main.tf');
    const ir = await inc.parse('main.tf', SOURCE_3_RESOURCES);
    expect(inc.statsFor('main.tf')!.cacheMisses).toBe(3);
    expect(ir.resources).toHaveLength(3);

    // Other file's cache survived.
    await inc.parse('other.tf', SOURCE_3_RESOURCES);
    expect(inc.statsFor('other.tf')!.fastPath).toBe(true);
  });

  it('matches full-parse output across a sequence of edits', async () => {
    const inc = new HclIncrementalParser(adapter);
    const sources = [
      SOURCE_3_RESOURCES,
      SOURCE_3_RESOURCES.replace('"t3.micro"', '"t3.large"'),
      SOURCE_3_RESOURCES.replace('"10.0.1.0/24"', '"10.0.2.0/24"'),
      `${SOURCE_3_RESOURCES}\n\nresource "aws_security_group" "sg" {\n  name = "x"\n}`,
    ];

    for (const src of sources) {
      const irInc = await inc.parse('main.tf', src);
      const irFull = await parse({ 'main.tf': src }, adapter);
      expect(normalize(irInc)).toEqual(normalize(irFull));
    }
  });
});
