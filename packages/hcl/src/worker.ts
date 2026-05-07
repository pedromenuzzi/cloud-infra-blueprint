/**
 * Worker entry point. Loads `@cdktf/hcl2json` (which itself loads a WASM blob)
 * and exposes a small postMessage protocol used by the web app to keep the
 * main thread responsive.
 *
 * Protocol:
 *
 *   parse (raw AST passthrough — used by callers that have their own walk):
 *     { id, type: 'parse', filename, source }
 *       -> { id, type: 'result', ast }
 *       -> { id, type: 'error', error }
 *
 *   parse-incremental (full pipeline with per-block cache, recommended for
 *   interactive editing — see incremental.ts for the strategy):
 *     { id, type: 'parse-incremental', filename, source }
 *       -> { id, type: 'ir', ir, stats }
 *       -> { id, type: 'error', error }
 *
 *   invalidate (drop the per-file cache; called when a project closes):
 *     { type: 'invalidate', filename? }   // no reply
 */

import { parse as hclParse } from '@cdktf/hcl2json';

import { HclIncrementalParser, type IncrementalStats } from './incremental.js';

import type { Hcl2JsonAdapter } from './parser.js';
import type { IR } from '@blueprint/ir';

interface ParseRequest {
  id: number;
  type: 'parse';
  filename: string;
  source: string;
}

interface ParseIncrementalRequest {
  id: number;
  type: 'parse-incremental';
  filename: string;
  source: string;
}

interface InvalidateRequest {
  type: 'invalidate';
  filename?: string;
}

type WorkerRequest = ParseRequest | ParseIncrementalRequest | InvalidateRequest;

interface ParseSuccess {
  id: number;
  type: 'result';
  ast: unknown;
}

interface ParseIncrementalSuccess {
  id: number;
  type: 'ir';
  ir: IR;
  stats: IncrementalStats;
}

interface ParseError {
  id: number;
  type: 'error';
  error: string;
}

const adapter: Hcl2JsonAdapter = {
  parse: (filename, source) =>
    hclParse(filename, source) as Promise<
      ReturnType<Hcl2JsonAdapter['parse']> extends Promise<infer R> ? R : never
    >,
};

const incremental = new HclIncrementalParser(adapter);

self.addEventListener('message', async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'invalidate') {
    incremental.invalidate(msg.filename);
    return;
  }

  if (msg.type === 'parse') {
    try {
      const ast = await hclParse(msg.filename, msg.source);
      const reply: ParseSuccess = { id: msg.id, type: 'result', ast };
      (self as unknown as Worker).postMessage(reply);
    } catch (err) {
      const reply: ParseError = {
        id: msg.id,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      (self as unknown as Worker).postMessage(reply);
    }
    return;
  }

  if (msg.type === 'parse-incremental') {
    try {
      const ir = await incremental.parse(msg.filename, msg.source);
      const stats = incremental.statsFor(msg.filename) ?? {
        cacheHits: 0,
        cacheMisses: 0,
        fastPath: false,
        elapsedMs: 0,
      };
      const reply: ParseIncrementalSuccess = {
        id: msg.id,
        type: 'ir',
        ir,
        stats,
      };
      (self as unknown as Worker).postMessage(reply);
    } catch (err) {
      const reply: ParseError = {
        id: msg.id,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      (self as unknown as Worker).postMessage(reply);
    }
  }
});

export {};
