import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reload = vi.fn();
let session: Map<string, string>;

async function load() {
  vi.resetModules();
  return import('./chunkReload');
}

beforeEach(() => {
  reload.mockReset();
  session = new Map();
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => void session.set(k, v),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stale-chunk recovery with a service worker', () => {
  it('without a worker: one plain reload, never two', async () => {
    const m = await load();
    expect(m.recoveryReload()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    // another failure in the same page load: "already reloading"
    expect(m.recoveryReload()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('lets the worker switch to the new version instead of reloading into the old one', async () => {
    const m = await load();
    const activate = vi.fn(() => true);
    m.setUpdateActivator(activate);
    expect(m.recoveryReload()).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(m.isRecoveryReloading()).toBe(true);
  });

  it('falls back to a reload when the worker declines; the loop guard covers both paths', async () => {
    const m = await load();
    m.setUpdateActivator(() => false);
    expect(m.recoveryReload()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // the next page load within 30 s: no second automatic reload (the recovery screen shows)
    const again = await load();
    const activate = vi.fn(() => true);
    again.setUpdateActivator(activate);
    expect(again.canRecoveryReload()).toBe(false);
    expect(again.recoveryReload()).toBe(false);
    expect(activate).not.toHaveBeenCalled();
  });

  it('an update the user accepted swallows the chunk errors of the page it replaces', async () => {
    const m = await load();
    m.markRecoveryReload();
    expect(m.isRecoveryReloading()).toBe(true);
    expect(m.recoveryReload()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('offline: never reloads into the browser’s offline page', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const m = await load();
    m.setUpdateActivator(() => true);
    expect(m.recoveryReload()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
