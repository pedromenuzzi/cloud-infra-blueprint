import { useCallback, useEffect, useMemo, useState } from 'react';
import { localStorageUsage, subscribeProjects } from '@/lib/storage';
import { computeMeter, type Meter } from './meter';

type Estimate = { usage?: number; quota?: number } | null;

/** `navigator.storage`, when this browser has it (secure contexts only). */
function storageManager(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined;
}

export interface StorageMeterState {
  meter: Meter;
  /** true: the browser won't evict this site's data; null: unknown / unsupported */
  persisted: boolean | null;
  /** `navigator.storage.persist()` exists */
  canPersist: boolean;
  /** asks for persistent storage (call from a click); resolves to the browser's answer */
  requestPersist(): Promise<boolean>;
}

/**
 * Live storage numbers for the dashboard: re-measured when `version` changes
 * (the project list), when another tab writes, and when the tab regains focus.
 */
export function useStorageMeter(version: unknown): StorageMeterState {
  const [tick, setTick] = useState(0);
  const [estimate, setEstimate] = useState<Estimate>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const unsubscribe = subscribeProjects(bump);
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [bump]);

  useEffect(() => {
    let live = true;
    const manager = storageManager();
    manager
      ?.estimate?.()
      .then((e) => live && setEstimate({ usage: e.usage, quota: e.quota }))
      .catch(() => undefined);
    manager
      ?.persisted?.()
      .then((p) => live && setPersisted(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tick, version]);

  const meter = useMemo(() => {
    const { used, budget } = localStorageUsage();
    return computeMeter({ localUsed: used, localBudget: budget, estimate });
    // re-measure localStorage whenever the list changes or we're told to
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, tick, version]);

  const requestPersist = useCallback(async () => {
    const granted = (await storageManager()?.persist?.().catch(() => false)) ?? false;
    setPersisted(granted);
    return granted;
  }, []);

  return { meter, persisted, canPersist: typeof storageManager()?.persist === 'function', requestPersist };
}
