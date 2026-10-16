/**
 * The pages' lazy chunks, shared by the router (which renders them) and the
 * pages that lead to them: a page warms the next likely chunk while the
 * browser is idle, and again when a pointer or the focus reaches a link to it,
 * so the click lands on a page that is already loaded. A module import runs
 * once: warming twice, or warming and then rendering, costs one request.
 */
import { quietLoad } from './chunkReload';

const CHUNKS = {
  landing: () => import('@/routes/LandingPage'),
  dashboard: () => import('@/routes/DashboardPage'),
  editor: () => import('@/routes/EditorPage'),
  learn: () => import('@/routes/LearnPage'),
  lesson: () => import('@/routes/LessonPage'),
};

export type RouteChunk = keyof typeof CHUNKS;

export const routeChunk = CHUNKS;

/** Fetch a page's chunk now; a failure is left to the real navigation (chunkReload.ts), never a reload. */
export function prefetchRoute(name: RouteChunk) {
  void quietLoad(CHUNKS[name]);
}

/** On a data saver or a 2G connection only what is opened gets fetched. */
function frugal(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!connection && (connection.saveData === true || /2g/.test(connection.effectiveType ?? ''));
}

/**
 * Warm these chunks once the current page has loaded (its fonts and images
 * come first) and the browser is idle. Returns a cancel.
 */
export function prefetchWhenIdle(...names: RouteChunk[]): () => void {
  if (typeof window === 'undefined' || frugal()) return () => undefined;
  let cancel = () => undefined as void;
  const run = () => names.forEach(prefetchRoute);
  const schedule = () => {
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      cancel = () => window.cancelIdleCallback(id);
    } else {
      const id = setTimeout(run, 1500);
      cancel = () => clearTimeout(id);
    }
  };
  if (document.readyState === 'complete') schedule();
  else {
    window.addEventListener('load', schedule, { once: true });
    cancel = () => window.removeEventListener('load', schedule);
  }
  return () => cancel();
}

/** Props for a link or button that leads to `name`: hovering or focusing it warms the chunk. */
export function warmOn(name: RouteChunk) {
  const warm = () => prefetchRoute(name);
  return { onPointerEnter: warm, onFocus: warm };
}
