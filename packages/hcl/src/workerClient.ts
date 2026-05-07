import type { IncrementalStats } from './incremental.js';
import type { Hcl2JsonAdapter, HclAstFile } from './parser.js';
import type { IR } from '@blueprint/ir';

/**
 * Convenience adapter that talks to the WebWorker shipped in `worker.ts`.
 *
 * Usage from the web app:
 *
 *   const worker = new Worker(new URL('@blueprint/hcl/worker', import.meta.url), { type: 'module' });
 *   const adapter = createWorkerAdapter(worker);
 *   const ir = await parse({ 'main.tf': source }, adapter);
 */
export function createWorkerAdapter(worker: Worker): Hcl2JsonAdapter {
  let nextId = 1;
  const inflight = new Map<
    number,
    { resolve: (v: HclAstFile) => void; reject: (e: Error) => void }
  >();

  worker.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as
      | { id: number; type: 'result'; ast: HclAstFile }
      | { id: number; type: 'error'; error: string };
    if (!msg || typeof msg !== 'object' || (msg.type !== 'result' && msg.type !== 'error')) return;
    const handlers = inflight.get(msg.id);
    if (!handlers) return;
    inflight.delete(msg.id);
    if (msg.type === 'result') handlers.resolve(msg.ast);
    else handlers.reject(new Error(msg.error));
  });

  return {
    parse(filename, source) {
      const id = nextId++;
      return new Promise<HclAstFile>((resolve, reject) => {
        inflight.set(id, { resolve, reject });
        worker.postMessage({ id, type: 'parse', filename, source });
      });
    },
  };
}

/**
 * Higher-level client that talks to the worker's `parse-incremental`
 * protocol. Returns the parsed IR and per-call stats so the caller can
 * surface "cache hit / miss" telemetry in the UI when useful.
 */
export interface IncrementalWorkerClient {
  parse(filename: string, source: string): Promise<{ ir: IR; stats: IncrementalStats }>;
  invalidate(filename?: string): void;
}

export function createIncrementalWorkerClient(worker: Worker): IncrementalWorkerClient {
  let nextId = 1;
  const inflight = new Map<
    number,
    { resolve: (v: { ir: IR; stats: IncrementalStats }) => void; reject: (e: Error) => void }
  >();

  worker.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as
      | { id: number; type: 'ir'; ir: IR; stats: IncrementalStats }
      | { id: number; type: 'error'; error: string };
    if (!msg || typeof msg !== 'object' || (msg.type !== 'ir' && msg.type !== 'error')) return;
    const handlers = inflight.get(msg.id);
    if (!handlers) return;
    inflight.delete(msg.id);
    if (msg.type === 'ir') handlers.resolve({ ir: msg.ir, stats: msg.stats });
    else handlers.reject(new Error(msg.error));
  });

  return {
    parse(filename, source) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        inflight.set(id, { resolve, reject });
        worker.postMessage({ id, type: 'parse-incremental', filename, source });
      });
    },
    invalidate(filename) {
      worker.postMessage({ type: 'invalidate', filename });
    },
  };
}

/**
 * Node-side adapter used by tests and the API. Imports `@cdktf/hcl2json`
 * directly (no worker) and wraps its async `parse`.
 */
export async function createNodeAdapter(): Promise<Hcl2JsonAdapter> {
  const mod = await import('@cdktf/hcl2json');
  return {
    parse(filename, source) {
      return mod.parse(filename, source) as Promise<HclAstFile>;
    },
  };
}
