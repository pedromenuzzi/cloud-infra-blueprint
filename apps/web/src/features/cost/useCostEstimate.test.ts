import { applyOps, emptyIR, newResource, type IR } from '@blueprint/ir';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCostEstimate } from './useCostEstimate';

import type { CostEstimate } from './costSchema';

function buildIR(): IR {
  return applyOps(emptyIR(), [
    {
      kind: 'add_resource',
      node: newResource('aws_instance', 'web', { instance_type: 't3.micro' }),
    },
  ]);
}

const sampleEstimate: CostEstimate = {
  totalMonthlyCost: 8.42,
  currency: 'USD',
  byResource: {
    'aws_instance.web': { address: 'aws_instance.web', monthlyCost: 8.42 },
  },
  unsupported: [],
  provider: 'infracost',
  generatedAt: '2026-05-04T12:00:00Z',
};

/**
 * Drain pending microtasks. Vitest's fake timers do not auto-flush
 * resolved promises, so we yield to the event loop a few times so the
 * `then` chain inside the hook completes before we assert.
 */
async function flushMicrotasks(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('useCostEstimate', () => {
  it('stays idle for an empty IR', () => {
    const fetchImpl = vi.fn();
    const { result } = renderHook(() => useCostEstimate(emptyIR(), { fetchImpl, debounceMs: 100 }));
    expect(result.current.status).toBe('idle');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('debounces and calls the fetcher after the configured window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sampleEstimate);
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useCostEstimate(buildIR(), { fetchImpl, debounceMs: 200 }),
      );

      await act(async () => {
        vi.advanceTimersByTime(199);
        await flushMicrotasks();
      });
      expect(fetchImpl).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2);
        await flushMicrotasks();
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // Wait for the resolved promise chain to flush state updates.
      await act(async () => {
        await flushMicrotasks(10);
      });
      expect(result.current.status).toBe('ready');
      expect(result.current.estimate?.totalMonthlyCost).toBe(8.42);
      expect(result.current.ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes a friendly error when the fetcher rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useCostEstimate(buildIR(), { fetchImpl, debounceMs: 100 }),
      );
      await act(async () => {
        vi.advanceTimersByTime(101);
        await flushMicrotasks(10);
      });
      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('boom');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when disabled', () => {
    const fetchImpl = vi.fn();
    vi.useFakeTimers();
    try {
      renderHook(() => useCostEstimate(buildIR(), { fetchImpl, debounceMs: 100, enabled: false }));
      vi.advanceTimersByTime(500);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
