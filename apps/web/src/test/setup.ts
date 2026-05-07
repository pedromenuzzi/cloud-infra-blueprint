import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

/**
 * Vitest setup for web app tests. Runs before every spec.
 *
 * - Cleans up the DOM after each test (RTL doesn't auto-cleanup with vitest).
 * - Stubs `matchMedia` (happy-dom doesn't ship one by default).
 * - Adds a no-op IntersectionObserver so component code can use it freely.
 */

beforeAll(() => {
  if (!('matchMedia' in window)) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  if (!('IntersectionObserver' in window)) {
    class IntersectionObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn().mockReturnValue([]);
      root = null;
      rootMargin = '';
      thresholds = [];
    }
    // @ts-expect-error - test-only stub
    window.IntersectionObserver = IntersectionObserverMock;
  }
});

afterEach(() => {
  cleanup();
});
