import { describe, expect, it } from 'vitest';
import { parseProject } from '@/hcl/parser';
import type { IR } from '../types';
import { cidrsubnet, evaluateFor, instancesOf, stringFor } from './repeatValues';

const project = (hcl: string): IR => parseProject({ 'main.tf': hcl }).ir;
const node = (ir: IR, id: string) => ir.resources.find((r) => r.id === id)!;

describe('cidrsubnet', () => {
  it("computes Terraform's ranges, and refuses what Terraform refuses", () => {
    expect(cidrsubnet('10.0.0.0/16', 8, 0)).toBe('10.0.0.0/24');
    expect(cidrsubnet('10.0.0.0/16', 8, 10)).toBe('10.0.10.0/24');
    expect(cidrsubnet('10.0.0.0/16', 4, 15)).toBe('10.0.240.0/20');
    expect(cidrsubnet('172.16.0.0/12', 4, 2)).toBe('172.18.0.0/16');
    expect(cidrsubnet('2600:1f18:1000::/56', 8, 1)).toBe('2600:1f18:1000:1::/64');
    // netnum past what newbits can hold, a prefix past 32 bits, a range that doesn't parse
    expect(typeof cidrsubnet('10.0.0.0/16', 8, 256)).toBe('symbol');
    expect(typeof cidrsubnet('10.0.0.0/30', 4, 0)).toBe('symbol');
    expect(typeof cidrsubnet('10.0.0/16', 8, 0)).toBe('symbol');
  });
});

describe('instances and their values', () => {
  const HCL = `variable "azs" {
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
}
variable "region" {
  default = "us-east-1"
}
locals {
  base = "10.1.0.0/16"
}
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_subnet" "public" {
  count             = length(var.azs)
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = var.azs[count.index]
  tags = {
    Name = "public-\${count.index}"
  }
}
resource "aws_subnet" "spread" {
  count             = 4
  cidr_block        = cidrsubnet(local.base, 4, count.index * 2)
  availability_zone = element(var.azs, count.index)
}
resource "aws_subnet" "by_name" {
  for_each          = { app = { cidr = "10.0.1.0/24", zone = "a" }, db = { cidr = "10.0.2.0/24", zone = "b" } }
  cidr_block        = each.value.cidr
  availability_zone = "\${var.region}\${each.value.zone}"
}
resource "aws_subnet" "set" {
  for_each   = toset(["10.0.3.0/24", "10.0.4.0/24"])
  cidr_block = each.key
}
resource "aws_subnet" "unknown" {
  count      = var.n
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
}
`;

  it('count: cidrsubnet of another resource, list indexes, arithmetic, element(), interpolation', () => {
    const ir = project(HCL);
    const pub = node(ir, 'aws_subnet.public');
    const instances = instancesOf(pub, ir)!;
    expect(instances.map((i) => i.address)).toEqual(['aws_subnet.public[0]', 'aws_subnet.public[1]', 'aws_subnet.public[2]']);
    expect(instances.map((i) => stringFor(pub.args.cidr_block, ir, i))).toEqual(['10.0.10.0/24', '10.0.11.0/24', '10.0.12.0/24']);
    expect(instances.map((i) => stringFor(pub.args.availability_zone, ir, i))).toEqual(['us-east-1a', 'us-east-1b', 'us-east-1c']);
    expect(evaluateFor(pub.args.tags, ir, instances[2])).toEqual({ Name: 'public-2' });

    const spread = node(ir, 'aws_subnet.spread');
    const four = instancesOf(spread, ir)!;
    expect(four.map((i) => stringFor(spread.args.cidr_block, ir, i))).toEqual(['10.1.0.0/20', '10.1.32.0/20', '10.1.64.0/20', '10.1.96.0/20']);
    expect(four.map((i) => stringFor(spread.args.availability_zone, ir, i))).toEqual(['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1a']);
  });

  it('for_each: a literal map of objects, a set of strings', () => {
    const ir = project(HCL);
    const byName = node(ir, 'aws_subnet.by_name');
    const instances = instancesOf(byName, ir)!;
    expect(instances.map((i) => i.address)).toEqual(['aws_subnet.by_name["app"]', 'aws_subnet.by_name["db"]']);
    expect(instances.map((i) => stringFor(byName.args.cidr_block, ir, i))).toEqual(['10.0.1.0/24', '10.0.2.0/24']);
    expect(instances.map((i) => stringFor(byName.args.availability_zone, ir, i))).toEqual(['us-east-1a', 'us-east-1b']);
    const set = node(ir, 'aws_subnet.set');
    expect(instancesOf(set, ir)!.map((i) => stringFor(set.args.cidr_block, ir, i))).toEqual(['10.0.3.0/24', '10.0.4.0/24']);
  });

  it('nothing when the count is decided at plan time, the resource is plain, or a value is outside the subset', () => {
    const ir = project(HCL);
    expect(instancesOf(node(ir, 'aws_subnet.unknown'), ir)).toBeUndefined();
    expect(instancesOf(node(ir, 'aws_vpc.main'), ir)).toBeUndefined();
    const pub = node(ir, 'aws_subnet.public');
    const [first] = instancesOf(pub, ir)!;
    for (const text of ['data.aws_vpc.x.cidr_block', 'module.net.cidr', 'cidrsubnet(var.nope, 8, 1)', 'upper("x")', 'count.index ? 1 : 2']) {
      expect(evaluateFor({ kind: 'raw', hcl: text }, ir, first), text).toBeUndefined();
    }
    // outside an instance, count.index means nothing
    expect(stringFor(pub.args.cidr_block, ir)).toBeUndefined();
  });
});
