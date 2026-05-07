import { applyOps, edge, emptyIR, newResource, type IR } from '@blueprint/ir';
import { describe, expect, it } from 'vitest';

import { applyAutoLayout } from './layout';

function buildIR(): IR {
  const vpc = newResource('aws_vpc', 'main', {});
  const subnet = newResource('aws_subnet', 'public', {});
  const ec2 = newResource('aws_instance', 'web', {});
  return applyOps(emptyIR(), [
    { kind: 'add_resource', node: vpc },
    { kind: 'add_resource', node: subnet },
    { kind: 'add_resource', node: ec2 },
    { kind: 'add_edge', edge: edge(vpc, subnet, 'network') },
    { kind: 'add_edge', edge: edge(subnet, ec2, 'network') },
  ]);
}

describe('applyAutoLayout', () => {
  it('returns the IR unchanged when there are no nodes', () => {
    const empty = emptyIR();
    expect(applyAutoLayout(empty)).toBe(empty);
  });

  it('assigns non-zero positions to every resource', () => {
    const ir = applyAutoLayout(buildIR());
    const positions = ir.resources.map((r) => `${r.position.x},${r.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions.every((p) => p !== '0,0')).toBe(true);
  });

  it('preserves all resources, edges, modules, providers, variables, outputs', () => {
    const before = buildIR();
    const after = applyAutoLayout(before);
    expect(after.resources).toHaveLength(before.resources.length);
    expect(after.edges).toHaveLength(before.edges.length);
    expect(after.modules).toEqual(before.modules);
    expect(after.providers).toEqual(before.providers);
    expect(after.variables).toEqual(before.variables);
    expect(after.outputs).toEqual(before.outputs);
  });

  it('lays nodes out from left to right by default (downstream nodes get larger x)', () => {
    const ir = applyAutoLayout(buildIR());
    const byName = new Map(ir.resources.map((r) => [r.name, r.position]));
    const vpc = byName.get('main');
    const subnet = byName.get('public');
    const ec2 = byName.get('web');
    expect(vpc && subnet && ec2).toBeTruthy();
    expect(subnet!.x).toBeGreaterThan(vpc!.x);
    expect(ec2!.x).toBeGreaterThan(subnet!.x);
  });
});
