import { applyOps, emptyIR, invertOps, type IR, type Op } from '@blueprint/ir';
import { create } from 'zustand';

/**
 * Maximum entries kept in the undo / redo history.
 *
 * 50 covers a typical editing session (canvas drags + inspector tweaks)
 * without letting the history snapshot the IR forever — each history entry
 * is a pair of (forward, inverse) `Op` lists, so the bound is on _entries_,
 * not bytes. The forward ops can carry full `ResourceNode` payloads (e.g.
 * the resource that was removed), so 50 keeps memory comfortably bounded
 * while covering ~30 minutes of intense editing.
 */
const HISTORY_LIMIT = 50;

/**
 * One step of editing as remembered by the store.
 *
 * We persist BOTH the forward and inverse op lists because:
 *
 *   - Forward ops may delete data (e.g. `remove_resource`). After applying
 *     the inverse to undo, that data is back in the IR, but the **forward**
 *     op still references it by id. Storing the forward list keeps redo
 *     simple: replay it as-is.
 *   - Computing the inverse-of-the-inverse on the fly only works when the
 *     pre-state has the relevant data. After undoing an `add_resource`,
 *     the post-undo IR no longer contains the node — so the
 *     "double-invert" trick silently drops the redo. Storing both lists
 *     side-steps that class of bug.
 */
interface HistoryEntry {
  forward: Op[];
  inverse: Op[];
}

interface IRState {
  ir: IR;

  /** Currently selected node id (resource or module). */
  selectedNodeId: string | undefined;

  /**
   * Past entries — top of the stack is the most recent action. To undo,
   * pop the entry and apply `entry.inverse` to the IR.
   */
  past: HistoryEntry[];

  /**
   * Future entries — top of the stack is the most recently undone action.
   * To redo, pop the entry and apply `entry.forward` to the IR.
   */
  future: HistoryEntry[];

  /**
   * Apply a sequence of `Op`s to the IR and push their inverse on the
   * undo stack. Clears the redo stack — once you take a different action,
   * the previous "future" is gone (standard text-editor semantics).
   */
  apply(ops: Op[]): void;

  /**
   * Replace the IR wholesale (used by templates and project load).
   * Resets history because reasoning about an undo across "load project"
   * is more confusing than helpful.
   */
  setIR(next: IR): void;

  select(nodeId: string | undefined): void;

  /** Undo the most recent batch. No-op if `past` is empty. */
  undo(): void;

  /** Redo the most recently undone batch. No-op if `future` is empty. */
  redo(): void;

  /** Whether the corresponding action is meaningful right now. */
  canUndo(): boolean;
  canRedo(): boolean;

  /** Clear all state and history. Used by tests and project switches. */
  reset(): void;
}

/**
 * Append an entry to a bounded stack, dropping the oldest entry when full.
 * Returns a new array (does not mutate `stack`).
 */
function pushBounded<T>(stack: T[], entry: T, limit = HISTORY_LIMIT): T[] {
  const next = stack.length >= limit ? stack.slice(1) : stack.slice();
  next.push(entry);
  return next;
}

/**
 * Global zustand store holding the canonical IR for the open project.
 *
 * Both the canvas (React Flow) and the Monaco editor read/write from here.
 * In F3 the Yjs-backed worker becomes the actual source of truth and this
 * store will be a derived view; the `apply` API stays the same so the
 * canvas/inspector code does not have to change.
 *
 * Undo/Redo lives here in F2 so the UX feels right from the first click on
 * the canvas. When Yjs lands in F3 the `past`/`future` stacks will be
 * replaced by `Y.UndoManager` (binary-compatible with the same API surface)
 * — see [docs/adr/0004-yjs-vs-ot.md](../../../../docs/adr/0004-yjs-vs-ot.md).
 */
export const useIRStore = create<IRState>((set, get) => ({
  ir: emptyIR(),
  selectedNodeId: undefined,
  past: [],
  future: [],

  apply: (ops) => {
    if (ops.length === 0) return;
    set((s) => {
      const inverse = invertOps(s.ir, ops);
      const next = applyOps(s.ir, ops);
      // If the batch had no observable effect we don't pollute history.
      if (inverse.length === 0 && next === s.ir) return s;
      return {
        ir: next,
        past: pushBounded(s.past, { forward: ops, inverse }),
        future: [],
      };
    });
  },

  setIR: (next) => set({ ir: next, past: [], future: [] }),

  select: (nodeId) => set({ selectedNodeId: nodeId }),

  undo: () => {
    set((s) => {
      if (s.past.length === 0) return s;
      const entry = s.past[s.past.length - 1]!;
      return {
        ir: applyOps(s.ir, entry.inverse),
        past: s.past.slice(0, -1),
        future: pushBounded(s.future, entry),
      };
    });
  },

  redo: () => {
    set((s) => {
      if (s.future.length === 0) return s;
      const entry = s.future[s.future.length - 1]!;
      return {
        ir: applyOps(s.ir, entry.forward),
        past: pushBounded(s.past, entry),
        future: s.future.slice(0, -1),
      };
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  reset: () => set({ ir: emptyIR(), selectedNodeId: undefined, past: [], future: [] }),
}));
