export { emitBlock, emitBody, emitIR, emitModule, emitResource, expr } from './emitter.js';
export { HclIncrementalParser, parseSingleFile } from './incremental.js';
export type { IncrementalParseOptions, IncrementalStats } from './incremental.js';
export {
  astToPatch,
  classifyValue,
  inferProviderFromType,
  parse,
  scanBlockRanges,
  walkAst,
} from './parser.js';
export type { Hcl2JsonAdapter, HclAstFile, ParseOptions } from './parser.js';
export { patchResource, removeResource, shiftRanges } from './patch.js';
export type { MinimalPatch } from './patch.js';
export {
  createIncrementalWorkerClient,
  createNodeAdapter,
  createWorkerAdapter,
} from './workerClient.js';
export type { IncrementalWorkerClient } from './workerClient.js';
