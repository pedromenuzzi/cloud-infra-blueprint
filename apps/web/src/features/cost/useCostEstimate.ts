import { useEffect, useRef, useState } from 'react';

import { costEstimateSchema, type CostEstimate } from './costSchema';

import type { IR } from '@blueprint/ir';

import { ApiError, api } from '@/lib/api';

export type CostStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseCostEstimateOptions {
  /** Debounce window between IR changes and the API call. */
  debounceMs?: number;
  /** Disable the hook entirely (e.g. on routes that don't show costs). */
  enabled?: boolean;
  /**
   * Optional override for the fetch function — used by tests. Receives
   * the already-stringified IR payload and must resolve to the parsed
   * `CostEstimate`.
   */
  fetchImpl?: (ir: IR) => Promise<CostEstimate>;
}

export interface UseCostEstimateResult {
  status: CostStatus;
  estimate: CostEstimate | null;
  error: string | null;
  /** Whether at least one estimate has resolved since mount. */
  ready: boolean;
}

const DEFAULT_DEBOUNCE_MS = 800;

async function defaultFetcher(ir: IR): Promise<CostEstimate> {
  const raw = await api.post<unknown>('/cost-estimate', { ir });
  const parsed = costEstimateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid cost estimate response: ${parsed.error.message.slice(0, 200)}`);
  }
  return parsed.data;
}

/**
 * React hook that keeps a debounced cost estimate in sync with the IR.
 *
 * The hook is **safe to mount everywhere** — when the API isn't running
 * (`ApiError` with `code === 'network_unavailable'`) it transitions to
 * `error` *without* spamming the console, and the UI just hides the
 * cost overlay. Same for the explicit "disabled" provider response from
 * the backend: `ready` flips to `true` with `estimate.totalMonthlyCost`
 * at zero so callers can still render an "Enable cost" CTA.
 *
 * Lifecycle:
 *
 * 1. IR changes → debounce timer resets.
 * 2. Timer fires → `status` flips to `loading`, request goes out.
 * 3. On success → `status` flips to `ready`, `estimate` populated.
 * 4. On failure → `status` flips to `error`, `error` populated; the
 *    previous `estimate` stays so the UI doesn't blink to zero.
 */
export function useCostEstimate(
  ir: IR,
  options: UseCostEstimateOptions = {},
): UseCostEstimateResult {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, enabled = true, fetchImpl = defaultFetcher } = options;

  const [status, setStatus] = useState<CostStatus>('idle');
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inflight = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || ir.resources.length === 0) {
      setStatus('idle');
      setEstimate(null);
      return;
    }

    const myId = ++requestId.current;
    const controller = new AbortController();
    inflight.current?.abort();
    inflight.current = controller;

    const timer = setTimeout(() => {
      setStatus('loading');
      fetchImpl(ir)
        .then((next) => {
          if (myId !== requestId.current) return;
          setEstimate(next);
          setError(null);
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (myId !== requestId.current) return;
          const message =
            err instanceof ApiError
              ? err.code === 'network_unavailable'
                ? 'Cost API unavailable.'
                : err.message
              : (err as Error).message;
          setError(message);
          setStatus('error');
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ir, enabled, debounceMs, fetchImpl]);

  return {
    status,
    estimate,
    error,
    ready: estimate !== null,
  };
}
