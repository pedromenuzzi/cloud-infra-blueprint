import { emitResource } from './emitter.js';

import type { ResourceNode } from '@blueprint/ir';

/**
 * Apply a minimal text patch for a single resource.
 *
 * Spec section 4 — algoritmo IR -> HCL (patch mínimo):
 *
 *   "O emitter localiza o range textual original do recurso via
 *    trivia.rawTextRange. Reescreve apenas as linhas daquele recurso,
 *    preservando o resto do arquivo intacto."
 *
 * If the node has no `rawTextRange` (it was added via canvas, not parsed),
 * the new block is appended to the end of the file with a leading newline.
 */
export interface MinimalPatch {
  /** Start byte offset in the source file. */
  start: number;
  /** End byte offset (exclusive) in the source file. */
  end: number;
  /** Replacement text. */
  text: string;
}

export function patchResource(
  originalSource: string,
  updatedNode: ResourceNode,
): {
  patch: MinimalPatch;
  next: string;
} {
  const block = emitResource(updatedNode);
  if (updatedNode.trivia.rawTextRange) {
    const { start, end } = updatedNode.trivia.rawTextRange;
    const next = originalSource.slice(0, start) + block + originalSource.slice(end);
    return { patch: { start, end, text: block }, next };
  }
  // New node: append at end with separator.
  const sep = originalSource.endsWith('\n') ? '\n' : '\n\n';
  const start = originalSource.length;
  const text = sep + block + '\n';
  return {
    patch: { start, end: start, text },
    next: originalSource + text,
  };
}

/**
 * Remove a parsed resource from the source by its `rawTextRange`. Returns
 * the new source and a patch describing what was removed.
 */
export function removeResource(
  originalSource: string,
  node: ResourceNode,
): {
  patch: MinimalPatch;
  next: string;
} {
  if (!node.trivia.rawTextRange) {
    return { patch: { start: 0, end: 0, text: '' }, next: originalSource };
  }
  const { start, end } = node.trivia.rawTextRange;
  // Also drop the trailing newline so we don't leave a blank gap.
  let realEnd = end;
  if (originalSource[realEnd] === '\n') realEnd++;
  const next = originalSource.slice(0, start) + originalSource.slice(realEnd);
  return { patch: { start, end: realEnd, text: '' }, next };
}

/**
 * Recompute `rawTextRange` for nodes after a patch was applied. Necessary
 * because every patch shifts the absolute offsets of nodes that come after.
 *
 * The shift is just `(text.length - (end - start))` applied to every node
 * whose `rawTextRange.start >= patch.end`.
 */
export function shiftRanges(
  nodes: { trivia: { rawTextRange?: { start: number; end: number } } }[],
  patch: MinimalPatch,
): void {
  const delta = patch.text.length - (patch.end - patch.start);
  if (delta === 0) return;
  for (const n of nodes) {
    const r = n.trivia.rawTextRange;
    if (!r) continue;
    if (r.start >= patch.end) {
      r.start += delta;
      r.end += delta;
    }
  }
}
