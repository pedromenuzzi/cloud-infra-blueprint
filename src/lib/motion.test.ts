import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionMs, prefersReducedMotion, scrollBehavior } from './motion';

function stubMatchMedia(reduce: boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
  }));
  vi.stubGlobal('window', { matchMedia });
  return matchMedia;
}

describe('motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes durations through when motion is fine', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(motionMs(350)).toBe(350);
    expect(motionMs(0)).toBe(0);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('returns 0 and instant scrolling under prefers-reduced-motion', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(motionMs(350)).toBe(0);
    expect(motionMs(500)).toBe(0);
    expect(scrollBehavior()).toBe('auto');
  });

  it('reads the media query on every call (follows OS changes)', () => {
    const mm = stubMatchMedia(false);
    expect(motionMs(200)).toBe(200);
    stubMatchMedia(true);
    expect(motionMs(200)).toBe(0);
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('is safe without window or matchMedia (SSR, old browsers, tests)', () => {
    // vitest runs in node: no window at all
    expect(typeof window).toBe('undefined');
    expect(prefersReducedMotion()).toBe(false);
    expect(motionMs(300)).toBe(300);

    vi.stubGlobal('window', {});
    expect(motionMs(300)).toBe(300);

    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('blocked');
      },
    });
    expect(motionMs(300)).toBe(300);
  });
});
