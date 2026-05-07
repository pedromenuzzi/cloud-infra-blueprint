import { describe, expect, it } from 'vitest';

import { addressFor, bucketForMonthlyCost, costEstimateSchema } from './costSchema';

describe('bucketForMonthlyCost', () => {
  it('matches the server-side thresholds', () => {
    expect(bucketForMonthlyCost(0)).toBe('free');
    expect(bucketForMonthlyCost(-5)).toBe('free');
    expect(bucketForMonthlyCost(0.01)).toBe('low');
    expect(bucketForMonthlyCost(9.99)).toBe('low');
    expect(bucketForMonthlyCost(10)).toBe('medium');
    expect(bucketForMonthlyCost(99.99)).toBe('medium');
    expect(bucketForMonthlyCost(100)).toBe('high');
    expect(bucketForMonthlyCost(10_000)).toBe('high');
  });
});

describe('addressFor', () => {
  it('joins type and name with a single dot', () => {
    expect(addressFor({ type: 'aws_instance', name: 'web' })).toBe('aws_instance.web');
  });
});

describe('costEstimateSchema', () => {
  const valid = {
    totalMonthlyCost: 12.34,
    currency: 'USD',
    byResource: {
      'aws_instance.web': {
        address: 'aws_instance.web',
        monthlyCost: 12.34,
        hourlyCost: 0.017,
        components: [{ name: 'Linux on-demand', monthlyCost: 7.49, unit: 'hour' }],
      },
    },
    unsupported: ['aws_vpc.main'],
    provider: 'infracost',
    generatedAt: '2026-05-04T12:00:00Z',
  };

  it('accepts a fully-populated infracost response', () => {
    const parsed = costEstimateSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('accepts a minimal disabled response', () => {
    const minimal = {
      totalMonthlyCost: 0,
      currency: 'USD',
      byResource: {},
      unsupported: [],
      provider: 'disabled',
      generatedAt: '2026-05-04T12:00:00Z',
      warning: 'disabled by env',
    };
    expect(costEstimateSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects negative totalMonthlyCost', () => {
    expect(costEstimateSchema.safeParse({ ...valid, totalMonthlyCost: -1 }).success).toBe(false);
  });

  it('rejects unknown provider values', () => {
    expect(costEstimateSchema.safeParse({ ...valid, provider: 'aws-pricing' }).success).toBe(false);
  });
});
