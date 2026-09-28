/**
 * Reduced motion for JS-driven animation. CSS animations are handled by the
 * `prefers-reduced-motion` rule in global.css; viewport pans/zooms and smooth
 * scrolling go through these helpers:
 *
 *   rf.fitView({ duration: motionMs(350) })
 *   el.scrollIntoView({ behavior: scrollBehavior() })
 *
 * The media query is read on every call (it is cheap), so a change in the OS
 * setting applies at once, and nothing touches `window` at import time.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY).matches
      : false;
  } catch {
    return false;
  }
}

/** `ms`, or 0 when the user asked for reduced motion. */
export function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** 'smooth', or 'auto' (an instant jump) when the user asked for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
