/**
 * Minimal-patch engine: canvas ops → smallest possible text edits.
 *
 * Only the touched blocks are re-emitted; every other byte of the user's
 * files (comments, blank lines, exotic expressions) stays untouched. After
 * splicing we re-parse so every block gets fresh, consistent text ranges.
 */
import type { Op } from '@/ir/ops';
import { applyOps } from '@/ir/ops';
import type { Diagnostic, IR } from '@/ir/types';
import { DEFAULT_FILES, emitOutput, emitProvider, emitResource, emitVariable } from './emitter';
import { parseProject } from './parser';

interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface PatchOutcome {
  files: Record<string, string>;
  ir: IR;
  diagnostics: Diagnostic[];
  renamed: Map<string, string>;
}

interface EmittableBlock {
  id: string;
  text: string;
  range?: { start: number; end: number };
  sourceFile?: string;
  defaultFile: string;
}

function collectEmittables(ir: IR): Map<string, EmittableBlock> {
  const map = new Map<string, EmittableBlock>();
  for (const r of ir.resources) {
    map.set(r.id, {
      id: r.id,
      text: emitResource(r),
      range: r.trivia.rawTextRange,
      sourceFile: r.trivia.sourceFile,
      defaultFile: DEFAULT_FILES.resource,
    });
  }
  for (const v of ir.variables) {
    map.set(v.id, {
      id: v.id,
      text: emitVariable(v),
      range: v.trivia.rawTextRange,
      sourceFile: v.trivia.sourceFile,
      defaultFile: DEFAULT_FILES.variable,
    });
  }
  for (const o of ir.outputs) {
    map.set(o.id, {
      id: o.id,
      text: emitOutput(o),
      range: o.trivia.rawTextRange,
      sourceFile: o.trivia.sourceFile,
      defaultFile: DEFAULT_FILES.output,
    });
  }
  for (const p of ir.providers) {
    map.set(p.id, {
      id: p.id,
      text: emitProvider(p),
      range: p.trivia.rawTextRange,
      sourceFile: p.trivia.sourceFile,
      defaultFile: DEFAULT_FILES.provider,
    });
  }
  return map;
}

function applyEdits(source: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

function normalize(source: string): string {
  return source.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

/**
 * Apply canvas ops to the project: returns new file texts (minimally patched)
 * and the fresh IR parsed back from them.
 */
export function applyOpsWithPatches(
  files: Record<string, string>,
  ir: IR,
  ops: Op[],
): PatchOutcome {
  const { ir: nextIR, touched, removed, renamed } = applyOps(ir, ops);

  // Old blocks (for ranges of removed / replaced text) and new block texts.
  const oldBlocks = collectEmittables(ir);
  const newBlocks = collectEmittables(nextIR);

  const editsByFile = new Map<string, Edit[]>();
  const appendsByFile = new Map<string, string[]>();
  const pushEdit = (file: string, e: Edit) => {
    const arr = editsByFile.get(file) ?? [];
    arr.push(e);
    editsByFile.set(file, arr);
  };
  const pushAppend = (file: string, text: string) => {
    const arr = appendsByFile.get(file) ?? [];
    arr.push(text);
    appendsByFile.set(file, arr);
  };

  for (const id of removed) {
    const old = oldBlocks.get(id);
    if (old?.range && old.sourceFile !== undefined) {
      pushEdit(old.sourceFile, { start: old.range.start, end: old.range.end, text: '' });
    }
  }

  for (const id of touched) {
    const block = newBlocks.get(id);
    if (!block) continue;
    // For renamed blocks, the original range lives under the old id.
    let oldId = id;
    for (const [from, to] of renamed) if (to === id) oldId = from;
    const old = oldBlocks.get(oldId);
    if (old?.range && old.sourceFile !== undefined) {
      pushEdit(old.sourceFile, { start: old.range.start, end: old.range.end, text: block.text });
    } else {
      pushAppend(block.sourceFile ?? block.defaultFile, block.text);
    }
  }

  const nextFiles: Record<string, string> = { ...files };
  for (const [file, edits] of editsByFile) {
    nextFiles[file] = normalize(applyEdits(nextFiles[file] ?? '', edits));
  }
  for (const [file, texts] of appendsByFile) {
    const existing = nextFiles[file] ?? '';
    const sep = existing.trim().length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
    nextFiles[file] = normalize(existing + sep + texts.join('\n'));
  }

  // Re-parse so ranges are fresh and canvas/code stay perfectly consistent.
  const { ir: freshIR, diagnostics } = parseProject(nextFiles);
  return { files: nextFiles, ir: freshIR, diagnostics, renamed };
}
