import { describe, expect, it } from 'vitest';

import { edge, emptyIR, lit, newResource } from './factory.js';
import { applyOp, applyOps, applyPatch, detectCycle, findResource } from './graph.js';

describe('IR graph operations', () => {
  it('add_resource appends to resources', () => {
    const ir = emptyIR();
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const next = applyOp(ir, { kind: 'add_resource', node: ec2 });
    expect(next.resources).toHaveLength(1);
    expect(findResource(next, ec2.id).type).toBe('aws_instance');
  });

  it('set_arg updates a single field functionally', () => {
    const ec2 = newResource('aws_instance', 'web', { instance_type: 't3.micro' });
    const ir = applyOp(emptyIR(), { kind: 'add_resource', node: ec2 });
    const next = applyOp(ir, {
      kind: 'set_arg',
      nodeId: ec2.id,
      field: 'instance_type',
      value: lit('t3.small'),
    });
    expect(findResource(next, ec2.id).args.instance_type).toEqual({
      kind: 'literal',
      value: 't3.small',
    });
    // Original IR is untouched.
    expect(findResource(ir, ec2.id).args.instance_type).toEqual({
      kind: 'literal',
      value: 't3.micro',
    });
  });

  it('remove_resource also drops dangling edges', () => {
    const a = newResource('aws_security_group', 'sg', {});
    const b = newResource('aws_instance', 'web', {});
    const ir = applyOps(emptyIR(), [
      { kind: 'add_resource', node: a },
      { kind: 'add_resource', node: b },
      { kind: 'add_edge', edge: edge(a, b, 'iam') },
    ]);
    expect(ir.edges).toHaveLength(1);
    const next = applyOp(ir, { kind: 'remove_resource', nodeId: a.id });
    expect(next.resources).toHaveLength(1);
    expect(next.edges).toHaveLength(0);
  });

  it('detectCycle finds simple A -> B -> A', () => {
    const a = newResource('aws_instance', 'a', {});
    const b = newResource('aws_instance', 'b', {});
    const ir = applyPatch(emptyIR(), {
      addResources: [a, b],
      addEdges: [edge(a, b, 'reference'), edge(b, a, 'reference')],
    });
    const cyc = detectCycle(ir);
    expect(cyc).toBeDefined();
    expect(cyc).toContain(a.id);
    expect(cyc).toContain(b.id);
  });

  it('detectCycle returns undefined for a DAG', () => {
    const a = newResource('aws_instance', 'a', {});
    const b = newResource('aws_instance', 'b', {});
    const c = newResource('aws_instance', 'c', {});
    const ir = applyPatch(emptyIR(), {
      addResources: [a, b, c],
      addEdges: [edge(a, b), edge(b, c)],
    });
    expect(detectCycle(ir)).toBeUndefined();
  });
});
