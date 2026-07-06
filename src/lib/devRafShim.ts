/**
 * DEV-ONLY: hidden tabs freeze requestAnimationFrame, which halts Monaco and
 * React Flow rendering in headless/preview verification environments. Fall
 * back to timers while the document is hidden so automated checks can see the
 * real DOM. Stripped from production builds.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const startedHidden = document.visibilityState === 'hidden';
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  const timerIds = new Set<number>();

  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    if (!startedHidden) return nativeRaf(cb);
    const id = window.setTimeout(() => {
      timerIds.delete(id);
      cb(performance.now());
    }, 16);
    timerIds.add(id);
    return id;
  };

  window.cancelAnimationFrame = (id: number) => {
    if (timerIds.has(id)) {
      clearTimeout(id);
      timerIds.delete(id);
    } else {
      nativeCaf(id);
    }
  };

  // ResizeObserver callbacks are delivered on the rendering steps, which are
  // also frozen for hidden tabs — React Flow never "measures" its nodes there.
  // Swap in a timer-based observer when the page loads hidden.
  if (startedHidden) {
    type Size = { w: number; h: number };
    class TimerResizeObserver {
      private cb: ResizeObserverCallback;
      private els = new Map<Element, Size>();
      private timer: number;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        this.timer = window.setInterval(() => this.check(), 120);
      }
      observe(el: Element) {
        if (!this.els.has(el)) this.els.set(el, { w: -1, h: -1 });
      }
      unobserve(el: Element) {
        this.els.delete(el);
      }
      disconnect() {
        this.els.clear();
        clearInterval(this.timer);
      }
      private check() {
        const entries: ResizeObserverEntry[] = [];
        for (const [el, prev] of this.els) {
          const r = el.getBoundingClientRect();
          if (r.width !== prev.w || r.height !== prev.h) {
            this.els.set(el, { w: r.width, h: r.height });
            const boxSize = [{ inlineSize: r.width, blockSize: r.height }];
            entries.push({
              target: el,
              contentRect: r,
              borderBoxSize: boxSize,
              contentBoxSize: boxSize,
              devicePixelContentBoxSize: boxSize,
            } as unknown as ResizeObserverEntry);
          }
        }
        if (entries.length > 0) this.cb(entries, this as unknown as ResizeObserver);
      }
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = TimerResizeObserver;

    // some libraries skip work entirely for hidden documents
    try {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true,
      });
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    } catch {
      /* ignore */
    }
  }
}

export {};
