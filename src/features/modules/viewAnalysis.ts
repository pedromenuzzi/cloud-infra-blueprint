/**
 * What the analyses read for the IR on the canvas. The root module is read
 * as it is; an opened module is read as the calls that lead to it make it —
 * its `var.x` replaced by the literal inputs they give (src/ir/moduleInstance.ts)
 * — so the inspector's cost line and security card, and the security lens,
 * say what that module call will cost and expose.
 *
 * The editor store notes each opened-module view it derives; the analysis
 * of a view is computed on first use, once.
 */
import { instantiatePath } from '@/ir/moduleInstance';
import type { IR } from '@/ir/types';
import type { ModuleScope } from './scopedPatch';

const sources = new WeakMap<IR, () => IR>();

/** Called by the editor store for each view of an opened module (`root`: the root module's IR then). */
export function noteScopeView(view: IR, scope: ModuleScope, files: Record<string, string>, root: IR): void {
  let analysed: IR | undefined;
  sources.set(view, () => (analysed ??= instantiatePath(root, files, scope.path, view) ?? view));
}

/** The IR the cost estimate and the audit should read for `ir` (itself, unless it's an opened module's view). */
export function analysisIr(ir: IR): IR {
  return sources.get(ir)?.() ?? ir;
}
