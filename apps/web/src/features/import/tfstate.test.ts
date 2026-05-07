import { describe, expect, it } from 'vitest';

import { looksLikeTerraformState, tfstateToIR, type TerraformStateFile } from './tfstate';

describe('looksLikeTerraformState', () => {
  it('accepts a minimal modern state file', () => {
    expect(
      looksLikeTerraformState({
        version: 4,
        terraform_version: '1.5.0',
        resources: [],
      }),
    ).toBe(true);
  });

  it('rejects payloads without a resources array', () => {
    expect(looksLikeTerraformState({ version: 4 })).toBe(false);
    expect(looksLikeTerraformState({ resources: 'not-an-array' })).toBe(false);
  });

  it('rejects payloads missing both version markers', () => {
    expect(looksLikeTerraformState({ resources: [] })).toBe(false);
  });

  it('rejects null / non-objects', () => {
    expect(looksLikeTerraformState(null)).toBe(false);
    expect(looksLikeTerraformState('hello')).toBe(false);
  });
});

describe('tfstateToIR', () => {
  const baseState: TerraformStateFile = {
    version: 4,
    terraform_version: '1.5.0',
    resources: [
      {
        mode: 'managed',
        type: 'aws_vpc',
        name: 'main',
        instances: [{ attributes: { cidr_block: '10.0.0.0/16', arn: 'arn:noise' } }],
      },
      {
        mode: 'managed',
        type: 'aws_subnet',
        name: 'public',
        instances: [
          {
            attributes: { cidr_block: '10.0.1.0/24', vpc_id: 'vpc-xyz' },
            dependencies: ['aws_vpc.main'],
          },
        ],
      },
      {
        mode: 'data',
        type: 'aws_ami',
        name: 'al2',
        instances: [{ attributes: { id: 'ami-0' } }],
      },
    ],
  };

  it('emits a managed resource per state entry, dropping data sources', () => {
    const ir = tfstateToIR(baseState);
    const types = ir.resources.map((r) => r.type).sort();
    expect(types).toEqual(['aws_subnet', 'aws_vpc']);
  });

  it('keeps only whitelisted attributes (drops ARNs and other computed noise)', () => {
    const ir = tfstateToIR(baseState);
    const vpc = ir.resources.find((r) => r.type === 'aws_vpc');
    expect(vpc).toBeDefined();
    expect(Object.keys(vpc!.args)).toEqual(['cidr_block']);
  });

  it('reconstructs a reference edge from the dependencies array', () => {
    const ir = tfstateToIR(baseState);
    expect(ir.edges).toHaveLength(1);
    const e = ir.edges[0]!;
    const fromNode = ir.resources.find((r) => r.id === e.fromNodeId);
    const toNode = ir.resources.find((r) => r.id === e.toNodeId);
    expect(fromNode?.type).toBe('aws_vpc');
    expect(toNode?.type).toBe('aws_subnet');
    expect(e.kind).toBe('reference');
  });

  it('returns an empty IR when the state has no managed resources', () => {
    const ir = tfstateToIR({ version: 4, resources: [] });
    expect(ir.resources).toHaveLength(0);
    expect(ir.edges).toHaveLength(0);
  });
});
