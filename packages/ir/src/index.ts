export type * from './types.js';
export type {
  EmitContext,
  ResourceCategory,
  ResourceDefinition,
  ResourcePort,
} from './defineResource.js';

export { defineResource } from './defineResource.js';
export {
  edge,
  emptyIR,
  inferProvider,
  lit,
  list,
  newId,
  newModule,
  newResource,
  obj,
  raw,
  ref,
  toExpr,
} from './factory.js';
export {
  applyOp,
  applyOps,
  applyPatch,
  detectCycle,
  findModuleMaybe,
  findResource,
  findResourceMaybe,
} from './graph.js';
export { invertOp, invertOps } from './invert.js';
