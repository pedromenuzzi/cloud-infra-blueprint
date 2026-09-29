/**
 * Stale-deploy recovery. After a deploy, a tab that was already open asks for
 * chunk names that no longer exist (Pages answers with 404.html as text/html),
 * and a lazy import fails. One reload picks up the new build; a sessionStorage
 * stamp makes sure we never loop — the second failure shows the recovery
 * screen instead.
 */
import { lazy, type ComponentType } from 'react';

const STAMP_KEY = 'cb-chunk-reload-at';
/** A second chunk failure within this window means reloading didn't help. */
const LOOP_WINDOW_MS = 30_000;

let reloading = false;

export function isChunkLoadError(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : '';
  return /dynamically imported module|Importing a module script failed|module script|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|valid JavaScript MIME type/i.test(
    text,
  );
}

/** True while a recovery reload is under way. */
export function isRecoveryReloading(): boolean {
  return reloading;
}

/** Whether a recovery reload is allowed right now (online, no reload just happened). */
export function canRecoveryReload(): boolean {
  if (reloading) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false; // would show the browser's offline page
  try {
    return Date.now() - Number(sessionStorage.getItem(STAMP_KEY) ?? 0) > LOOP_WINDOW_MS;
  } catch {
    return false; // can't remember we reloaded → never auto-reload
  }
}

/** Reload once to fetch the new build. False when that isn't allowed (see canRecoveryReload). */
export function recoveryReload(): boolean {
  if (reloading) return true;
  if (!canRecoveryReload()) return false;
  try {
    sessionStorage.setItem(STAMP_KEY, String(Date.now()));
  } catch {
    return false;
  }
  reloading = true;
  location.reload();
  return true;
}

/** React.lazy that reloads once when the chunk is gone instead of crashing the route. */
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().then(
      (module) => {
        // Vite resolves `undefined` when a vite:preloadError was handled (we're reloading)
        if (!module && reloading) return new Promise<never>(() => undefined);
        return module;
      },
      (error: unknown) => {
        if (isChunkLoadError(error) && recoveryReload()) return new Promise<never>(() => undefined);
        throw error;
      },
    ),
  );
}

/** Global hooks: Vite's preload failures and dynamic imports outside React.lazy. */
export function installChunkRecovery() {
  window.addEventListener('vite:preloadError', (event) => {
    if (recoveryReload()) event.preventDefault();
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason) && recoveryReload()) event.preventDefault();
  });
}
