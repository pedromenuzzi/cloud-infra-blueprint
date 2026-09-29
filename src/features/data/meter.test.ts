import { describe, expect, it } from 'vitest';
import { computeMeter, formatBytes, NUDGE_AT } from './meter';

const MiB = 1024 * 1024;

describe('storage meter', () => {
  it('measures project storage against the localStorage budget', () => {
    const meter = computeMeter({ localUsed: 1.25 * MiB, localBudget: 5 * MiB });
    expect(meter).toMatchObject({ binding: 'local', percent: 25, level: 'ok', origin: null });
    expect(meter.local).toEqual({ used: 1.25 * MiB, total: 5 * MiB, free: 3.75 * MiB, ratio: 0.25 });
  });

  it('nudges from 70%, and warns when saving is about to fail', () => {
    expect(computeMeter({ localUsed: 0.69 * 5 * MiB, localBudget: 5 * MiB }).level).toBe('ok');
    expect(computeMeter({ localUsed: NUDGE_AT * 5 * MiB, localBudget: 5 * MiB }).level).toBe('nudge');
    expect(computeMeter({ localUsed: 0.96 * 5 * MiB, localBudget: 5 * MiB }).level).toBe('full');
  });

  it('shows whichever limit is tighter: a small origin quota wins over free localStorage', () => {
    const roomy = computeMeter({ localUsed: MiB, localBudget: 5 * MiB, estimate: { usage: 30 * MiB, quota: 60 * 1024 * MiB } });
    expect(roomy).toMatchObject({ binding: 'local', percent: 20 });
    expect(roomy.origin).toMatchObject({ used: 30 * MiB, free: 60 * 1024 * MiB - 30 * MiB });

    // low disk space: the browser grants the origin very little
    const tight = computeMeter({ localUsed: MiB, localBudget: 5 * MiB, estimate: { usage: 45 * MiB, quota: 50 * MiB } });
    expect(tight).toMatchObject({ binding: 'origin', percent: 90, level: 'nudge' });
  });

  it('ignores an estimate without numbers, and never overflows', () => {
    expect(computeMeter({ localUsed: MiB, localBudget: 5 * MiB, estimate: {} }).origin).toBeNull();
    expect(computeMeter({ localUsed: MiB, localBudget: 5 * MiB, estimate: { usage: 5, quota: 0 } }).origin).toBeNull();
    const over = computeMeter({ localUsed: 9 * MiB, localBudget: 5 * MiB });
    expect(over).toMatchObject({ ratio: 1, percent: 100, level: 'full' });
    expect(over.local.free).toBe(0);
    // 99.6% reads 99, not 100: "100%" means writes are failing
    expect(computeMeter({ localUsed: 0.996 * MiB, localBudget: MiB }).percent).toBe(99);
    expect(computeMeter({ localUsed: Number.NaN, localBudget: 0 })).toMatchObject({ ratio: 0, percent: 0 });
  });
});

describe('formatBytes', () => {
  it('reads like the OS does', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(1.25 * MiB)).toBe('1.3 MB');
    expect(formatBytes(5 * MiB)).toBe('5 MB');
    expect(formatBytes(1023.7 * 1024)).toBe('1 MB');
    expect(formatBytes(38 * 1024 * MiB)).toBe('38 GB');
  });
});
