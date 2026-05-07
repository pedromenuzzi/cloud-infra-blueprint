/**
 * Vite-friendly worker entry. Re-exports `@blueprint/hcl/worker` so the app
 * can spawn it with:
 *
 *   const w = new Worker(new URL('./workers/hcl.worker.ts', import.meta.url), { type: 'module' });
 *
 * The actual postMessage protocol is defined in `@blueprint/hcl`'s worker file.
 */
import '@blueprint/hcl/worker';

export {};
