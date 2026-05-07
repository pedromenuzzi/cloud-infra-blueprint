import { describe, expect, it } from 'vitest';

import { edge, emptyIR, lit, newResource } from './factory.js';
import { applyOp, applyOps } from './graph.js';
import { invertOp, invertOps } from './invert.js';

import type { IR, Op } from './types.js';

/**
 * Property-style assertion: applying `op` then its inverse yields the
 * original IR (compared by JSON value, not reference).
 */
function expectRoundTrip(ir: IR, op: Op): void {
  const next = applyOp(ir, op);
  const inv = invertOp(ir, op);
  expect(inv, `op ${op.kind} should produce a defined inverse here`).toBeDefined();
  const undone = applyOp(next, inv!);
  expect(JSON.parse(JSON.stringify(undone))).toEqual(JSON.parse(JSON.stringify(ir)));
}

describe('invertOp', () => {
  it('add_resource inverts to remove_resource', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    expectRoundTrip(emptyIR(), { kind: 'add_resource', node: ec2 });
  });

  it('remove_resource inverts back to add_resource (preserving args)', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const ir = applyOp(emptyIR(), { kind: 'add_resource', node: ec2 });
    expectRoundTrip(ir, { kind: 'remove_resource', nodeId: ec2.id });
  });

  it('set_arg inverts to set_arg with the previous value', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const ir = applyOp(emptyIR(), { kind: 'add_resource', node: ec2 });
    expectRoundTrip(ir, {
      kind: 'set_arg',
      nodeId: ec2.id,
      field: 'instance_type',
      value: lit('t3.large'),
    });
  });

  it('set_arg of a previously-unset field inverts to unset_arg', () => {
    const ec2 = newResource('aws_instance', 'web', {});
    const ir = applyOp(emptyIR(), { kind: 'add_resource', node: ec2 });
    const op: Op = { kind: 'set_arg', nodeId: ec2.id, field: 'ami', value: lit('ami-123') };
    const inv = invertOp(ir, op);
    expect(inv).toEqual({ kind: 'unset_arg', nodeId: ec2.id, field: 'ami' });
    const undone = applyOp(applyOp(ir, op), inv!);
    expect(undone.resources[0]!.args.ami).toBeUndefined();
  });

  it('rename_resource is symmetric', () => {
    const ec2 = newResource('aws_instance', 'old', {});
    const ir = applyOp(emptyIR(), { kind: 'add_resource', node: ec2 });
    expectRoundTrip(ir, { kind: 'rename_resource', nodeId: ec2.id, newName: 'new' });
  });

  it('move_node restores the previous position', () => {
    const ec2 = newResource('aws_instance', 'web', {}, { position: { x: 10, y: 20 } });
    const ir = applyOp(emptyIR(), { kind: 'add_resource', node: ec2 });
    expectRoundTrip(ir, { kind: 'move_node', nodeId: ec2.id, position: { x: 50, y: 80 } });
  });

  it('add_edge and remove_edge round-trip preserving the edge id', () => {
    const a = newResource('aws_security_group', 'sg', {});
    const b = newResource('aws_instance', 'web', {});
    const e = edge(a, b, 'iam');
    const ir = applyOps(emptyIR(), [
      { kind: 'add_resource', node: a },
      { kind: 'add_resource', node: b },
    ]);
    expectRoundTrip(ir, { kind: 'add_edge', edge: e });
    const irWithEdge = applyOp(ir, { kind: 'add_edge', edge: e });
    expectRoundTrip(irWithEdge, { kind: 'remove_edge', edgeId: e.id });
  });

  it('returns undefined for no-op rename and no-op move', () => {
    const ec2 = newResource('aws_instance', 'web', {}, { position: { x: 5, y: 5 } });
    const ir = applyOp(emptyIR(), { kind: 'add_resource', node: ec2 });
    expect(
      invertOp(ir, { kind: 'rename_resource', nodeId: ec2.id, newName: 'web' }),
    ).toBeUndefined();
    expect(
      invertOp(ir, { kind: 'move_node', nodeId: ec2.id, position: { x: 5, y: 5 } }),
    ).toBeUndefined();
  });
});

describe('invertOps batch', () => {
  it('reverts a batch as a single transactional undo', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const sg = newResource('aws_security_group', 'sg', {});
    const e = edge(sg, ec2, 'iam');

    const start = emptyIR();
    const ops: Op[] = [
      { kind: 'add_resource', node: ec2 },
      { kind: 'add_resource', node: sg },
      { kind: 'add_edge', edge: e },
      { kind: 'set_arg', nodeId: ec2.id, field: 'instance_type', value: lit('t3.large') },
    ];
    const after = applyOps(start, ops);
    const inverses = invertOps(start, ops);
    const undone = applyOps(after, inverses);
    expect(JSON.parse(JSON.stringify(undone))).toEqual(JSON.parse(JSON.stringify(start)));
  });
});
