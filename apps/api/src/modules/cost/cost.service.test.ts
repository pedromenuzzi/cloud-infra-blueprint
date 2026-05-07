import { applyOps, edge, emptyIR, newResource, type IR } from '@blueprint/ir';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CostService } from './cost.service';
import { bucketForMonthlyCost } from './cost.types';

function buildIR(): IR {
  const vpc = newResource('aws_vpc', 'main', { cidr_block: '10.0.0.0/16' });
  const ec2 = newResource('aws_instance', 'web', {
    instance_type: 't3.micro',
    ami: 'ami-0123',
  });
  return applyOps(emptyIR(), [
    { kind: 'add_resource', node: vpc },
    { kind: 'add_resource', node: ec2 },
    { kind: 'add_edge', edge: edge(vpc, ec2, 'network') },
  ]);
}

describe('CostService — disabled mode', () => {
  beforeEach(() => {
    delete process.env.BLUEPRINT_COST_ENABLED;
  });

  it('returns a structured zero-cost response with a warning when disabled', async () => {
    const svc = new CostService();
    const result = await svc.estimate(buildIR());
    expect(result.provider).toBe('disabled');
    expect(result.totalMonthlyCost).toBe(0);
    expect(result.byResource).toEqual({});
    expect(result.warning).toMatch(/BLUEPRINT_COST_ENABLED/);
  });

  it('returns an empty estimate (still disabled) when given an empty IR', async () => {
    const svc = new CostService();
    const result = await svc.estimate(emptyIR());
    expect(result.totalMonthlyCost).toBe(0);
    expect(result.byResource).toEqual({});
  });
});

describe('CostService — local-binary mode', () => {
  let svc: CostService;
  const fakeBinary = 'echo'; // safe stand-in: never matches the protocol.

  beforeEach(() => {
    process.env.BLUEPRINT_COST_ENABLED = '1';
    process.env.BLUEPRINT_COST_BINARY = fakeBinary;
    svc = new CostService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BLUEPRINT_COST_ENABLED;
    delete process.env.BLUEPRINT_COST_BINARY;
  });

  it('returns an empty (but enabled-shaped) response for an IR with no resources', async () => {
    const result = await svc.estimate(emptyIR());
    expect(result.provider).toBe('infracost');
    expect(result.totalMonthlyCost).toBe(0);
  });

  it('falls back to a warning response when the binary cannot be executed', async () => {
    process.env.BLUEPRINT_COST_BINARY = '/path/that/definitely/does/not/exist/infracost';
    svc = new CostService();
    const result = await svc.estimate(buildIR());
    expect(result.provider).toBe('disabled');
    expect(result.warning).toMatch(/Infracost unavailable/);
  });

  it('parses Infracost JSON output into the wire response shape', async () => {
    const fakeReport = {
      projects: [
        {
          breakdown: {
            resources: [
              {
                name: 'aws_instance.web',
                monthlyCost: '12.34',
                hourlyCost: '0.017',
                costComponents: [
                  { name: 'Linux on-demand', monthlyCost: '7.49', unit: 'hour' },
                  { name: 'EBS', monthlyCost: '4.85', unit: 'gb-month' },
                ],
              },
              { name: 'aws_vpc.main', monthlyCost: null },
              { name: 'aws_subnet.public', monthlyCost: 0 },
            ],
          },
        },
      ],
    };

    type Run = (workdir: string) => Promise<unknown>;
    const runner = vi
      .spyOn(svc as unknown as { runInfracost: Run }, 'runInfracost')
      .mockResolvedValue(fakeReport);

    const result = await svc.estimate(buildIR());
    expect(runner).toHaveBeenCalled();
    expect(result.provider).toBe('infracost');
    expect(result.totalMonthlyCost).toBeCloseTo(12.34, 2);
    expect(result.byResource['aws_instance.web']).toMatchObject({
      address: 'aws_instance.web',
      monthlyCost: 12.34,
      hourlyCost: 0.017,
    });
    expect(result.byResource['aws_instance.web']?.components).toHaveLength(2);
    expect(result.byResource['aws_subnet.public']).toBeDefined();
    expect(result.unsupported).toContain('aws_vpc.main');
  });
});

describe('bucketForMonthlyCost', () => {
  it('classifies costs into the four UI buckets', () => {
    expect(bucketForMonthlyCost(0)).toBe('free');
    expect(bucketForMonthlyCost(-1)).toBe('free');
    expect(bucketForMonthlyCost(0.5)).toBe('low');
    expect(bucketForMonthlyCost(9.99)).toBe('low');
    expect(bucketForMonthlyCost(10)).toBe('medium');
    expect(bucketForMonthlyCost(99.99)).toBe('medium');
    expect(bucketForMonthlyCost(100)).toBe('high');
    expect(bucketForMonthlyCost(10_000)).toBe('high');
  });
});
