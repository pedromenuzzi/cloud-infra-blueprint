import { describe, expect, it } from 'vitest';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { autoLayout } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import { getDef, isContainerType } from '@/resources/registry';
import { alignBlocker, alignOps, distributeOps } from './align';
import { bulkConnectOps, bulkSetOps, bulkTagOps, commonFields, connectTargets, selectedNodes, sharedValue } from './bulk';

const THREE_INSTANCES = `# @blueprint:pos=40,60
resource "aws_instance" "a" {
  ami           = "ami-1"
  instance_type = "t3.micro"
}
# @blueprint:pos=300,100
resource "aws_instance" "b" {
  ami           = "ami-1"
  instance_type = "t3.small"
  tags = {
    team = "core"
  }
}
# @blueprint:pos=700,20
resource "aws_instance" "c" {
  ami           = "ami-1"
  instance_type = "t3.micro"
  tags          = var.common_tags
}
# @blueprint:pos=40,400
resource "aws_security_group" "web" {
  name = "web"
}
`;

const ids = ['aws_instance.a', 'aws_instance.b', 'aws_instance.c'];

function project(text = THREE_INSTANCES) {
  const files = { 'main.tf': text };
  const { ir } = parseProject(files);
  // what the store does: containment, then positions for anything unplaced
  deriveStructure(ir, getDef);
  autoLayout(ir, isContainerType);
  return { files, ir };
}

const positions = (ops: Op[]) =>
  Object.fromEntries(ops.map((op) => (op.kind === 'move_node' ? [op.nodeId, [op.position.x, op.position.y]] : [op.kind, null])));

describe('align and distribute', () => {
  it('aligns edges and centers of siblings', () => {
    const { ir } = project();
    expect(positions(alignOps(ir, ids, 'left'))).toEqual({ 'aws_instance.b': [40, 100], 'aws_instance.c': [40, 20] });
    expect(positions(alignOps(ir, ids, 'top'))).toEqual({ 'aws_instance.a': [40, 20], 'aws_instance.b': [300, 20] });
    // all three share one vertical center: the middle of the span 20 … 176
    const middle = positions(alignOps(ir, ids, 'middle'));
    expect(new Set(Object.values(middle).map((p) => p![1])).size).toBe(1);
    expect(alignOps(ir, ['aws_instance.a'], 'left')).toEqual([]);
  });

  it('distributes with equal gaps, keeping the outer two in place', () => {
    const { ir } = project();
    const ops = distributeOps(ir, ids, 'horizontal');
    // a at 40 and c at 700 stay; b sits halfway: gaps of (700 + 208 - 40 - 3 × 208) / 2
    expect(positions(ops)).toEqual({ 'aws_instance.b': [370, 100] });
    expect(distributeOps(ir, ids.slice(0, 2), 'horizontal')).toEqual([]);
  });

  it('only lines up resources that share a container', () => {
    const { ir } = project(`resource "aws_vpc" "v" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_subnet" "s" {
  vpc_id     = aws_vpc.v.id
  cidr_block = "10.0.1.0/24"
}
resource "aws_sqs_queue" "q" {
}
`);
    expect(alignBlocker(ir, ['aws_subnet.s', 'aws_sqs_queue.q'])).toBe('Select resources in the same container');
    expect(alignOps(ir, ['aws_subnet.s', 'aws_sqs_queue.q'], 'left')).toEqual([]);
  });

  it('produces ops the patcher applies as position-only edits', () => {
    const { files, ir } = project();
    const out = applyOpsWithPatches(files, ir, alignOps(ir, ids, 'top'));
    expect(out.refused).toBeUndefined();
    expect(out.files['main.tf'].replace(/# @blueprint:pos=.*\n/g, '')).toBe(files['main.tf'].replace(/# @blueprint:pos=.*\n/g, ''));
  });
});

describe('bulk edits', () => {
  it('offers the settings all selected resources share, never their names', () => {
    const { ir } = project();
    const nodes = selectedNodes(ir, ids);
    const names = commonFields(nodes).map((f) => f.name);
    expect(names).toContain('instance_type');
    expect(names).not.toContain('tags');
    expect(sharedValue(nodes, 'instance_type')).toBe('mixed');
    expect(sharedValue(nodes, 'ami')).toEqual({ kind: 'literal', value: 'ami-1' });
    expect(commonFields(selectedNodes(ir, ['aws_instance.a', 'aws_security_group.web']))).toEqual([]);
  });

  it('never offers values that must differ per resource, like a subnet CIDR', () => {
    const { ir } = project(`resource "aws_vpc" "v" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.v.id
  cidr_block = "10.0.1.0/24"
}
resource "aws_subnet" "b" {
  vpc_id     = aws_vpc.v.id
  cidr_block = "10.0.2.0/24"
}
`);
    const names = commonFields(selectedNodes(ir, ['aws_subnet.a', 'aws_subnet.b'])).map((f) => f.name);
    expect(names).not.toContain('cidr_block');
    expect(names).toContain('map_public_ip_on_launch');
  });

  it('sets a value only where it differs', () => {
    const { ir } = project();
    const ops = bulkSetOps(selectedNodes(ir, ids), 'instance_type', { kind: 'literal', value: 't3.micro' });
    expect(ops.map((op) => op.kind === 'set_arg' && op.nodeId)).toEqual(['aws_instance.b']);
  });

  it('tags every resource, skipping computed tags', () => {
    const { files, ir } = project();
    const { ops, skipped } = bulkTagOps(selectedNodes(ir, ids), 'env', 'prod');
    expect(skipped).toEqual(['aws_instance.c']);
    const text = applyOpsWithPatches(files, ir, ops).files['main.tf'];
    expect(text).toMatch(/resource "aws_instance" "a" \{[^}]*env\s*=\s*"prod"/);
    expect(text).toMatch(/team\s*=\s*"core"[\s\S]*env\s*=\s*"prod"/);
    expect(text).toContain('tags          = var.common_tags');
  });

  it('connects every resource to a shared target, once', () => {
    const { ir } = project();
    const nodes = selectedNodes(ir, ids);
    const targets = connectTargets(ir, nodes).map((t) => t.id);
    expect(targets).toEqual(['aws_security_group.web']);
    const sg = ir.resources.find((r) => r.id === 'aws_security_group.web')!;
    const first = bulkConnectOps(nodes, sg);
    expect(first.ops).toHaveLength(3);
    const { files } = project();
    const applied = applyOpsWithPatches(files, ir, first.ops);
    const again = bulkConnectOps(selectedNodes(applied.ir, ids), sg);
    expect(again).toEqual({ ops: [], already: 3 });
  });

  it("doesn't offer containers as bulk connections (that's a drag)", () => {
    const { ir } = project(`resource "aws_vpc" "v" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_subnet" "s" {
  vpc_id     = aws_vpc.v.id
  cidr_block = "10.0.1.0/24"
}
resource "aws_instance" "a" {
  ami = "ami-1"
}
resource "aws_instance" "b" {
  ami = "ami-1"
}
`);
    const targets = connectTargets(ir, selectedNodes(ir, ['aws_instance.a', 'aws_instance.b'])).map((t) => t.id);
    expect(targets).not.toContain('aws_subnet.s');
  });
});
