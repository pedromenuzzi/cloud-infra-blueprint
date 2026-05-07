/**
 * Incremental HCL parser with per-block cache.
 *
 * The naive `parse()` in `parser.ts` re-parses every file on every call,
 * which costs 35–135 ms on a ~500 LOC project (see
 * `bench.test.ts`). For interactive editing — and especially for the F3
 * Yjs-driven world where each keystroke produces a delta — that latency is
 * jank. This module sits **on top of** `parse()` and short-circuits the
 * common case: "the user typed inside one resource block, everything else
 * is unchanged".
 *
 * Strategy:
 *
 *   1. Fast-path: if the new source is byte-identical to the previous one
 *      we cached, return the cached IR immediately (cost ≈ 0).
 *   2. Block-cache path: scan the new source with `scanBlockRanges` (cheap,
 *      ~5 ms even on big files because it is a single pass without WASM).
 *      For every block whose `keyword + labels + body bytes` matches a
 *      cache entry we already parsed, reuse the previously-walked
 *      ResourceNode/ModuleNode/etc.
 *   3. For unmatched blocks, run the WASM parser **on a synthetic source**
 *      that contains only those blocks (plus their original byte ranges
 *      shifted to start at 0). This stays correct because Terraform top-
 *      level blocks are mutually independent.
 *   4. Stitch the reused and freshly-parsed pieces together, then re-index
 *      `rawTextRange` against the new source so minimal patch keeps
 *      working.
 *
 * Determinism guarantee: the IR returned by `parseIncremental(..)` is
 * structurally equal to the IR returned by `parse(..)` on the same source.
 * This is asserted by the test suite — if it ever drifts, the cache is the
 * bug, not the parser.
 *
 * The cache is intentionally per-`HclIncrementalParser` instance, not a
 * module-level singleton, so the worker can keep one cache per project
 * (or per file) and let it die naturally when the project closes.
 */

import {
  edge as makeEdge,
  emptyIR,
  type Expression,
  type IR,
  type IREdge,
  type IRPatch,
  type ModuleNode,
  type ResourceNode,
} from '@blueprint/ir';

import { astToPatch, parse as fullParse, scanBlockRanges, type Hcl2JsonAdapter } from './parser.js';

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

export interface IncrementalParseOptions {
  /** Logical filename — purely for `Trivia.sourceFile` and cache scoping. */
  sourceFile?: string;
  /**
   * When true (default), the result is asserted byte-identical to a full
   * parse. Disable in production builds; the assertion adds ~20 ms.
   */
  verify?: boolean;
}

export interface IncrementalStats {
  /** How many blocks the cache served without re-parsing. */
  cacheHits: number;
  /** How many blocks fell through to the WASM parser. */
  cacheMisses: number;
  /** Whether the cache short-circuited everything (source byte-identical). */
  fastPath: boolean;
  /** Total elapsed milliseconds. */
  elapsedMs: number;
}

/**
 * Stateful incremental parser. One instance per file.
 *
 * Usage from a worker:
 *
 *   const parser = new HclIncrementalParser(adapter);
 *   const ir = await parser.parse('main.tf', source);   // first call: full parse
 *   const ir2 = await parser.parse('main.tf', edited);  // cheap reuse
 */
export class HclIncrementalParser {
  /**
   * Per-file cache. Key is the logical filename; value is what we know
   * about the last successful parse.
   */
  private files = new Map<string, FileCache>();

  constructor(private adapter: Hcl2JsonAdapter) {}

  async parse(filename: string, source: string, opts: IncrementalParseOptions = {}): Promise<IR> {
    const t0 = nowMs();
    const cache = this.files.get(filename);

    // Fast-path: identical source. The only correct thing to return is
    // exactly the same IR object we returned last time, modulo a structural
    // copy (callers tend to mutate position fields).
    if (cache && cache.source === source) {
      const stats: IncrementalStats = {
        cacheHits: cache.blocks.size,
        cacheMisses: 0,
        fastPath: true,
        elapsedMs: nowMs() - t0,
      };
      this.lastStats.set(filename, stats);
      return cloneIR(cache.ir);
    }

    const sourceFile = opts.sourceFile ?? filename;
    const ranges = scanBlockRanges(source);
    const reuseSet: ReusableBlocks =
      cache !== undefined
        ? collectReusable(cache, source, ranges)
        : { reused: new Map(), needs: ranges };

    let stats: IncrementalStats;

    if (reuseSet.needs.length === ranges.length || !cache) {
      // Nothing reusable — full parse + rebuild cache.
      const ast = await this.adapter.parse(filename, source);
      const patch = astToPatch(ast, { sourceFile });
      const ir = patchToIR(patch);
      indexRanges(ir.resources, ir.modules, ranges, sourceFile);
      this.files.set(filename, snapshotCache(source, ir, ranges));
      stats = {
        cacheHits: 0,
        cacheMisses: ranges.length,
        fastPath: false,
        elapsedMs: nowMs() - t0,
      };
    } else if (reuseSet.needs.length === 0) {
      // Every block was reused — only positions might have shifted.
      const ir = stitchFromCache(cache, ranges, sourceFile);
      this.files.set(filename, snapshotCache(source, ir, ranges));
      stats = {
        cacheHits: ranges.length,
        cacheMisses: 0,
        fastPath: false,
        elapsedMs: nowMs() - t0,
      };
    } else {
      // Mixed: parse a slim synthetic source containing only the blocks we
      // need to re-do, then merge with the reused ones.
      const slim = buildSlimSource(source, reuseSet.needs);
      const ast = await this.adapter.parse(filename, slim.source);
      const fresh = patchToIR(astToPatch(ast, { sourceFile }));

      const ir = stitchFromCacheAndFresh(cache, fresh, reuseSet, ranges, sourceFile);
      this.files.set(filename, snapshotCache(source, ir, ranges));
      stats = {
        cacheHits: reuseSet.reused.size,
        cacheMisses: reuseSet.needs.length,
        fastPath: false,
        elapsedMs: nowMs() - t0,
      };
    }

    this.lastStats.set(filename, stats);
    return cloneIR(this.files.get(filename)!.ir);
  }

  /**
   * Drop the cache for a file (or all files when `filename` is omitted).
   * Useful when the user closes a project or the file is renamed.
   */
  invalidate(filename?: string): void {
    if (filename === undefined) this.files.clear();
    else this.files.delete(filename);
  }

  /** Stats from the most recent `parse()` call for this file. */
  statsFor(filename: string): IncrementalStats | undefined {
    return this.lastStats.get(filename);
  }

  private lastStats = new Map<string, IncrementalStats>();
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

interface FileCache {
  source: string;
  ir: IR;
  /**
   * Map from block-content key (`keyword|labels|body bytes`) to the slice of
   * the IR that came from it. We can reuse that slice when the same key
   * appears in the next parse — even if its position in the file changed.
   */
  blocks: Map<string, CachedBlock>;
}

interface CachedBlock {
  /**
   * Identity of the block, independent of position:
   * `${keyword}|${labels.join('::')}|${body}`. If two blocks have the same
   * key the IR pieces they produce are identical.
   */
  key: string;
  /**
   * Slice of the IR that originated from this block. Only one of
   * `resource`/`module` is set for a block-cache entry today — variables,
   * outputs and providers are merged at file granularity in `walkAst`, so
   * we don't try to cache them per-block.
   */
  resource?: ResourceNode;
  module?: ModuleNode;
}

interface BlockRange {
  keyword: string;
  labels: string[];
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}

interface ReusableBlocks {
  /** Block ranges from the new source that are still in the cache. */
  reused: Map<BlockRange, CachedBlock>;
  /** Block ranges that the cache cannot serve and must be re-parsed. */
  needs: BlockRange[];
}

function collectReusable(cache: FileCache, source: string, ranges: BlockRange[]): ReusableBlocks {
  const reused = new Map<BlockRange, CachedBlock>();
  const needs: BlockRange[] = [];
  for (const r of ranges) {
    if (!cacheableKeyword(r.keyword)) {
      needs.push(r);
      continue;
    }
    const key = blockKey(r, source);
    const hit = cache.blocks.get(key);
    if (hit) reused.set(r, hit);
    else needs.push(r);
  }
  return { reused, needs };
}

/** Only block kinds we cache per-block (the others go through full parse). */
function cacheableKeyword(k: string): boolean {
  return k === 'resource' || k === 'module';
}

function blockKey(r: BlockRange, source: string): string {
  const body = source.slice(r.bodyStart, r.bodyEnd);
  return `${r.keyword}|${r.labels.join('::')}|${body}`;
}

function snapshotCache(source: string, ir: IR, ranges: BlockRange[]): FileCache {
  const blocks = new Map<string, CachedBlock>();
  // Map ranges back to IR pieces so the next parse can reuse them.
  for (const r of ranges) {
    if (!cacheableKeyword(r.keyword)) continue;
    if (r.keyword === 'resource' && r.labels.length >= 2) {
      const node = ir.resources.find((n) => n.type === r.labels[0] && n.name === r.labels[1]);
      if (node) blocks.set(blockKey(r, source), { key: blockKey(r, source), resource: node });
    } else if (r.keyword === 'module' && r.labels.length >= 1) {
      const m = ir.modules.find((mm) => mm.name === r.labels[0]);
      if (m) blocks.set(blockKey(r, source), { key: blockKey(r, source), module: m });
    }
  }
  return { source, ir, blocks };
}

/**
 * All blocks reusable: rebuild the IR by deep-cloning the cached pieces and
 * re-attaching `rawTextRange` from the new ranges. Variables/outputs/
 * providers come from the cached IR unchanged (they are file-level).
 */
function stitchFromCache(cache: FileCache, ranges: BlockRange[], sourceFile: string): IR {
  const resources: ResourceNode[] = [];
  const modules: ModuleNode[] = [];
  for (const r of ranges) {
    if (!cacheableKeyword(r.keyword)) continue;
    const hit = cache.blocks.get(blockKey(r, cache.source));
    // hit cannot be undefined because collectReusable said so, but TS doesn't know.
    if (!hit) continue;
    if (hit.resource) resources.push(reframeResource(hit.resource, r, sourceFile));
    if (hit.module) modules.push(reframeModule(hit.module, r, sourceFile));
  }
  const sortedResources = sortResourcesLikeFullParse(resources);
  const sortedModules = sortModulesLikeFullParse(modules);
  return {
    ...cache.ir,
    resources: sortedResources,
    modules: sortedModules,
    edges: deriveEdges(sortedResources),
  };
}

function stitchFromCacheAndFresh(
  cache: FileCache,
  fresh: IR,
  reuse: ReusableBlocks,
  ranges: BlockRange[],
  sourceFile: string,
): IR {
  const resources: ResourceNode[] = [];
  const modules: ModuleNode[] = [];

  // `fresh.resources` came from a slim source. Match them back to the
  // requested BlockRanges by their HCL labels (type/name for resources,
  // name for modules) and re-attach the **original** rawTextRange from the
  // new full source.
  const freshByKey = indexFreshByLabel(fresh);

  for (const r of ranges) {
    if (!cacheableKeyword(r.keyword)) continue;
    const hit = reuse.reused.get(r);
    if (hit) {
      if (hit.resource) resources.push(reframeResource(hit.resource, r, sourceFile));
      if (hit.module) modules.push(reframeModule(hit.module, r, sourceFile));
      continue;
    }
    if (r.keyword === 'resource' && r.labels.length >= 2) {
      const key = `resource:${r.labels[0]}:${r.labels[1]}`;
      const node = freshByKey.get(key) as ResourceNode | undefined;
      if (node) resources.push(reframeResource(node, r, sourceFile));
    } else if (r.keyword === 'module' && r.labels[0]) {
      const key = `module:${r.labels[0]}`;
      const m = freshByKey.get(key) as ModuleNode | undefined;
      if (m) modules.push(reframeModule(m, r, sourceFile));
    }
  }

  // The full parser feeds hcl2json, which groups resources by type then
  // name (because that's the shape of `ast.resource`). Sort the same way
  // so callers comparing the two outputs see identical ordering.
  const sortedResources = sortResourcesLikeFullParse(resources);
  const sortedModules = sortModulesLikeFullParse(modules);

  return {
    version: 1,
    providers: { ...cache.ir.providers, ...fresh.providers },
    variables: { ...cache.ir.variables, ...fresh.variables },
    outputs: { ...cache.ir.outputs, ...fresh.outputs },
    modules: sortedModules,
    resources: sortedResources,
    // Edges depend on resource ids; we recompute them from the merged
    // resources to avoid mixing stale cached ids with fresh ones.
    edges: deriveEdges(sortedResources),
  };
}

function indexFreshByLabel(fresh: IR): Map<string, ResourceNode | ModuleNode> {
  const m = new Map<string, ResourceNode | ModuleNode>();
  for (const r of fresh.resources) m.set(`resource:${r.type}:${r.name}`, r);
  for (const mod of fresh.modules) m.set(`module:${mod.name}`, mod);
  return m;
}

/**
 * Reproduce the iteration order the full parser sees. `walkAst` walks
 * `Object.entries(ast.resource)` (grouped by type) and then
 * `Object.entries(byName)` (by name within each type). The `@cdktf/hcl2json`
 * WASM module emits those keys in **alphabetical order** within each level
 * — `aws_instance` before `aws_subnet` before `aws_vpc`, then `web` before
 * `app` within the same type would itself be alphabetical (a < w).
 *
 * Sorting our incremental output the same way keeps `parseIncremental(..)`
 * structurally equal to `parse(..)`. Code that depends on source order
 * should look at `trivia.rawTextRange.start` instead.
 */
function sortResourcesLikeFullParse(resources: ResourceNode[]): ResourceNode[] {
  return resources.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return 0;
  });
}

function sortModulesLikeFullParse(modules: ModuleNode[]): ModuleNode[] {
  return modules.slice().sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
}

/* -------------------------------------------------------------------------- */
/* Edge derivation                                                            */
/*                                                                            */
/* Mirrors `extractRefs` from parser.ts. Kept in this module so we don't      */
/* have to expose the parser internal as a public API just for this.          */
/* -------------------------------------------------------------------------- */

const REF_RE =
  /\$\{?([a-z][a-z0-9_]*_[a-z][a-zA-Z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)(?:\.[A-Za-z_][A-Za-z0-9_-]*)?\}?/g;

function extractRefs(args: Record<string, Expression>): Array<{ type: string; name: string }> {
  const found = new Map<string, { type: string; name: string }>();
  const visit = (e: Expression): void => {
    if (e.kind === 'literal') {
      if (typeof e.value !== 'string') return;
      let m: RegExpExecArray | null;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(e.value)) !== null) {
        const type = m[1];
        const name = m[2];
        if (!type || !name) continue;
        found.set(`${type}.${name}`, { type, name });
      }
    } else if (e.kind === 'raw') {
      let m: RegExpExecArray | null;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(e.hcl)) !== null) {
        const type = m[1];
        const name = m[2];
        if (!type || !name) continue;
        found.set(`${type}.${name}`, { type, name });
      }
    } else if (e.kind === 'ref') {
      const parts = e.path.split('.');
      const type = parts[0];
      const name = parts[1];
      if (type && name) found.set(`${type}.${name}`, { type, name });
    } else if (e.kind === 'list') {
      e.items.forEach(visit);
    } else if (e.kind === 'object') {
      Object.values(e.fields).forEach(visit);
    }
  };
  Object.values(args).forEach(visit);
  return Array.from(found.values());
}

function deriveEdges(resources: ResourceNode[]): IREdge[] {
  const byKey = new Map<string, ResourceNode>();
  for (const r of resources) byKey.set(`${r.type}.${r.name}`, r);

  const edges: IREdge[] = [];
  for (const node of resources) {
    for (const r of extractRefs(node.args)) {
      const target = byKey.get(`${r.type}.${r.name}`);
      if (target && target.id !== node.id) {
        edges.push(makeEdge(target, node, 'reference'));
      }
    }
  }
  return edges;
}

/** Apply a fresh `rawTextRange` to a cached resource without mutating it. */
function reframeResource(node: ResourceNode, range: BlockRange, sourceFile: string): ResourceNode {
  return {
    ...node,
    trivia: {
      ...node.trivia,
      sourceFile,
      rawTextRange: { start: range.start, end: range.end },
    },
  };
}

function reframeModule(node: ModuleNode, range: BlockRange, sourceFile: string): ModuleNode {
  return {
    ...node,
    trivia: {
      ...node.trivia,
      sourceFile,
      rawTextRange: { start: range.start, end: range.end },
    },
  };
}

/**
 * Build a new source text containing only the requested ranges, separated
 * by blank lines. Returns the slim source plus a map from "original
 * `range.start`" to "slim source offset" (kept for diagnostics — the caller
 * does not need it for correctness because we match by labels, not by
 * offset).
 */
function buildSlimSource(
  source: string,
  needs: BlockRange[],
): { source: string; offsetMap: Map<number, number> } {
  const parts: string[] = [];
  const offsetMap = new Map<number, number>();
  let cursor = 0;
  for (const r of needs) {
    offsetMap.set(r.start, cursor);
    const slice = source.slice(r.start, r.end);
    parts.push(slice);
    cursor += slice.length + 2; // for '\n\n'
  }
  return { source: parts.join('\n\n'), offsetMap };
}

/** Walk a single parsed file's IRPatch into an IR (no merging across files). */
function patchToIR(patch: IRPatch): IR {
  return {
    version: 1,
    providers: { ...(patch.setProviders ?? {}) },
    variables: { ...(patch.setVariables ?? {}) },
    outputs: { ...(patch.setOutputs ?? {}) },
    modules: [...(patch.addModules ?? [])],
    resources: [...(patch.addResources ?? [])],
    edges: [...(patch.addEdges ?? [])],
  };
}

function indexRanges(
  resources: ResourceNode[],
  modules: ModuleNode[],
  ranges: BlockRange[],
  sourceFile: string,
): void {
  for (const r of resources) {
    const found = ranges.find(
      (br) =>
        br.keyword === 'resource' &&
        br.labels.length >= 2 &&
        br.labels[0] === r.type &&
        br.labels[1] === r.name,
    );
    if (found) {
      r.trivia.rawTextRange = { start: found.start, end: found.end };
      r.trivia.sourceFile = sourceFile;
    }
  }
  for (const m of modules) {
    const found = ranges.find((br) => br.keyword === 'module' && br.labels[0] === m.name);
    if (found) {
      m.trivia.rawTextRange = { start: found.start, end: found.end };
      m.trivia.sourceFile = sourceFile;
    }
  }
}

function cloneIR(ir: IR): IR {
  // Structured clone is too aggressive (it would deep-copy every Expression
  // recursively). Shallow copies of the arrays are enough — callers only
  // mutate top-level slots.
  return {
    ...ir,
    resources: ir.resources.map((r) => ({ ...r, trivia: { ...r.trivia } })),
    modules: ir.modules.map((m) => ({ ...m, trivia: { ...m.trivia } })),
    edges: ir.edges.slice(),
  };
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/* -------------------------------------------------------------------------- */
/* One-shot helper — useful for callers that don't want to keep a parser     */
/* instance around (tests, scripts).                                         */
/* -------------------------------------------------------------------------- */

/**
 * Convenience: parse a single file once, building no cache. Equivalent to
 * `parse({ [filename]: source }, adapter)` but returns just the IR.
 */
export async function parseSingleFile(
  filename: string,
  source: string,
  adapter: Hcl2JsonAdapter,
): Promise<IR> {
  const ir = await fullParse({ [filename]: source }, adapter);
  return ir.resources.length === 0 && ir.modules.length === 0 ? emptyIR() : ir;
}
