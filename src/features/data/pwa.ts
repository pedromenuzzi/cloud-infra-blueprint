/**
 * Offline app: service worker registration and the update flow (production
 * builds only — `vite dev` and the unit tests never register a worker).
 *
 * - First visit: the worker precaches the app shell and claims the page, so
 *   the lazy chunks the app loads next (Monaco, ELK…) go through it and land
 *   in its runtime cache. Once the dashboard or the editor has been shown,
 *   the rest of those chunks are fetched when the browser is idle
 *   (`warmOfflineCache`), so the whole editor opens offline afterwards.
 * - A new deploy: the new worker installs and WAITS. The open tab keeps the
 *   version it started with (every chunk it may still ask for stays cached).
 *   On a screen where nothing is in progress (landing, dashboard, tutorials
 *   list, 404: see autoUpdate.ts) it's applied right away, reloading once
 *   (`autoApplyUpdate`, under chunkReload.ts's loop guard); elsewhere (the
 *   editor, a lesson, the viewer) a small "Update available, Reload" prompt
 *   appears. Reload = the waiting worker skips waiting, then the page reloads
 *   once it's in control.
 * - A chunk that fails anyway: chunkReload.ts asks `activateForRecovery`
 *   first, which switches to the new version instead of reloading into the
 *   same stale one.
 */
import { create } from 'zustand';
import { canRecoveryReload, markRecoveryReload, recoveryReload, setUpdateActivator } from '@/lib/chunkReload';

interface PwaState {
  /** a new version is installed and waiting for the user to reload */
  updateReady: boolean;
  /** a service worker controls the page: it opens without a connection */
  offlineReady: boolean;
  /** the waiting version is being applied without asking (the prompt stays away) */
  autoApplying: boolean;
}

export const usePwa = create<PwaState>(() => ({ updateReady: false, offlineReady: false, autoApplying: false }));

const BASE = import.meta.env.BASE_URL;
const SKIP_WAITING = { type: 'SKIP_WAITING' };
/** don't hit the server for sw.js more often than this when the tab regains focus */
const CHECK_EVERY_MS = 5 * 60 * 1000;

let registration: ServiceWorkerRegistration | null = null;
/** we asked a new worker to take over: reload when it does */
let switching = false;
let reloaded = false;
let lastCheck = 0;

function container(): ServiceWorkerContainer | null {
  try {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  } catch {
    return null;
  }
}

function reloadOnce() {
  if (reloaded) return;
  reloaded = true;
  location.reload();
}

function checkForUpdate() {
  const now = Date.now();
  if (!registration || navigator.onLine === false || now - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = now;
  registration.update().catch(() => undefined);
}

function track(reg: ServiceWorkerRegistration, sw: ServiceWorkerContainer) {
  registration = reg;
  lastCheck = Date.now();
  if (sw.controller) usePwa.setState({ offlineReady: true });
  if (reg.waiting && sw.controller) usePwa.setState({ updateReady: true });
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', () => {
      // installed while an older worker is in control: that's an update, waiting
      if (next.state === 'installed' && sw.controller) usePwa.setState({ updateReady: true });
    });
  });
  sw.addEventListener('controllerchange', () => {
    if (switching) reloadOnce();
    // the first worker claimed the page: from now on it opens offline
    else usePwa.setState({ offlineReady: true });
  });
  // long-lived tabs: look for a new deploy hourly and whenever the tab comes back
  setInterval(checkForUpdate, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}

/** Registers the worker once the page has loaded (so it never competes with the first paint). */
export function registerServiceWorker() {
  const sw = container();
  if (!import.meta.env.PROD || !sw) return;
  setUpdateActivator(activateForRecovery);
  const start = () => {
    sw.register(`${BASE}sw.js`, { scope: BASE })
      .then((reg) => track(reg, sw))
      .catch(() => undefined); // blocked (privacy settings, automation): the app works without it
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** "Reload" on the update prompt. False when no new version is waiting. */
export function applyUpdate(): boolean {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  switching = true;
  markRecoveryReload(); // chunk errors until the reload are expected, not a new failure
  waiting.postMessage(SKIP_WAITING);
  // the new worker takes over → controllerchange → reload; never hang if it doesn't
  setTimeout(reloadOnce, 4000);
  return true;
}

/**
 * Apply the waiting version without asking, on a screen where nothing is in
 * progress (AutoUpdate.tsx), reloading once. It goes through chunkReload.ts's
 * recovery reload, so its loop guard applies: refused within 30 s of the last
 * such reload (the prompt stays, nothing reloads again). False when nothing is
 * waiting or the guard refuses.
 */
export function autoApplyUpdate(): boolean {
  if (!registration?.waiting || !container()?.controller || !canRecoveryReload()) return false;
  usePwa.setState({ autoApplying: true });
  if (recoveryReload()) return true;
  usePwa.setState({ autoApplying: false });
  return false;
}

/**
 * A lazy chunk is gone (see chunkReload.ts). Reloading under the old worker
 * would load the same old build, so: activate the waiting version, or fetch
 * the new one first. False when no worker controls the page (plain reload).
 */
function activateForRecovery(): boolean {
  const sw = container();
  const reg = registration;
  if (!reg || !sw?.controller) return false;
  if (applyUpdate()) return true;
  switching = true;
  const fallback = setTimeout(reloadOnce, 8000);
  const settle = () => {
    clearTimeout(fallback);
    reloadOnce();
  };
  reg
    .update()
    .then(() => {
      const next = reg.installing ?? reg.waiting;
      if (!next) return settle(); // nothing new: a plain reload it is
      const step = () => {
        if (next.state === 'installed') next.postMessage(SKIP_WAITING);
        else if (next.state === 'redundant') settle();
        // 'activated' → controllerchange → reload
      };
      next.addEventListener('statechange', step);
      step();
    })
    .catch(settle);
  return true;
}

let warming = false;

/**
 * Fetch the heavy lazy chunks (Monaco, its worker and styles, ELK) through the
 * worker while the browser is idle, so the editor — code pane, tidy layout —
 * works offline even if they were never opened online. The build lists them
 * in `lazy-assets.json` (see vite.config.ts). Skipped on data-saver.
 */
export function warmOfflineCache() {
  const sw = container();
  if (!import.meta.env.PROD || !sw || warming) return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  warming = true;
  const controlled = () =>
    sw.controller
      ? Promise.resolve()
      : new Promise<void>((resolve) => sw.addEventListener('controllerchange', () => resolve(), { once: true }));
  const idle = () =>
    new Promise<void>((resolve) => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 8000 });
      else setTimeout(resolve, 2000);
    });
  // offline there's nothing to fetch (and it's all cached if it worked before): wait for a connection
  const online = () =>
    navigator.onLine === false
      ? new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }))
      : Promise.resolve();
  sw.ready
    .then(controlled)
    .then(online)
    .then(idle)
    .then(async () => {
      const res = await fetch(`${BASE}lazy-assets.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const files: unknown = await res.json();
      if (!Array.isArray(files)) return;
      for (const file of files) {
        if (typeof file !== 'string' || navigator.onLine === false) continue;
        // read the body: the worker caches the response once it's complete
        await fetch(`${BASE}${file}`)
          .then((r) => r.blob())
          .catch(() => undefined);
      }
    })
    .catch(() => {
      warming = false; // try again next time
    });
}
