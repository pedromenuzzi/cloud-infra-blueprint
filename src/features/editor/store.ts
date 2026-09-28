/**
 * Editor store — owns the single source of truth.
 *
 * The .tf file texts are canonical (they persist and round-trip); the IR is
 * derived from them and kept in perfect sync:
 *
 *   canvas op ──▶ applyOpsWithPatches ──▶ minimal text patch ──▶ re-parse ─┐
 *      ▲                                                                   │
 *      └────────────────────── fresh IR + edges ◀──────────────────────────┘
 *
 *   Monaco keystroke ──▶ debounced parseProject ──▶ new IR (positions carried
 *   over by address) — parse errors freeze the canvas on the last good IR.
 */
import { create } from 'zustand';
import { showToast } from '@/components/Toast';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { deriveStructure } from '@/ir/graph';
import { autoLayout } from '@/ir/layout';
import type { Op } from '@/ir/ops';
import type { Diagnostic, IR, IREdge } from '@/ir/types';
import { emptyIR } from '@/ir/types';
import { validateProject } from '@/ir/validate';
import { getProject, updateProject, type Project } from '@/lib/storage';
import { getDef, isContainerType } from '@/resources/registry';
import { deleteResourcesOps } from './connections';

const FILE_ORDER = ['main.tf', 'variables.tf', 'outputs.tf', 'providers.tf', 'versions.tf'];

export function orderedFiles(files: Record<string, string>): string[] {
  const keys = Object.keys(files);
  return [
    ...FILE_ORDER.filter((f) => keys.includes(f)),
    ...keys.filter((f) => !FILE_ORDER.includes(f)).sort(),
  ];
}

interface Derived {
  ir: IR;
  edges: IREdge[];
  warnings: Diagnostic[];
}

function derive(ir: IR, prev?: IR): Derived {
  // carry canvas positions for nodes the text doesn't pin yet
  if (prev) {
    const prevById = new Map(prev.resources.map((r) => [r.id, r] as const));
    for (const node of ir.resources) {
      if (!node.position) {
        const old = prevById.get(node.id);
        if (old?.position) node.position = { ...old.position };
      }
    }
  }
  const edges = deriveStructure(ir, getDef);
  autoLayout(ir, isContainerType);
  return { ir, edges, warnings: validateProject(ir, getDef) };
}

interface EditorState {
  projectId: string | null;
  projectName: string;
  files: Record<string, string>;
  /** bumped whenever file text changed OUTSIDE Monaco (ops, undo, load) */
  filesRevision: number;
  ir: IR;
  edges: IREdge[];
  parseDiagnostics: Diagnostic[];
  warnings: Diagnostic[];
  codeErrored: boolean;
  selection: string | null;
  /** who changed the selection last — the code pane only scrolls for canvas picks */
  selectionOrigin: 'canvas' | 'code';
  /** bumped by revealInCode so the code pane scrolls + flashes the block */
  revealSeq: number;
  activeFile: string;
  saveState: 'saved' | 'saving';
  past: Array<Record<string, string>>;
  future: Array<Record<string, string>>;

  load(project: Project): void;
  applyCanvasOps(ops: Op[], select?: string | null): void;
  onCodeChange(file: string, text: string): void;
  setActiveFile(file: string): void;
  setSelection(id: string | null, origin?: 'canvas' | 'code'): void;
  renameProject(name: string): void;
  revealInCode(nodeId: string): void;
  /** delete resources + their nested children + references to them, as one undo step */
  deleteResources(ids: string[]): number;
  undo(): void;
  redo(): void;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let parseTimer: ReturnType<typeof setTimeout> | undefined;
/** files before the current burst of typing (already on the undo stack); a burst ends when the code parses */
let codeBurstBase: Record<string, string> | null = null;

const hasErrors = (diagnostics: Diagnostic[]) => diagnostics.some((d) => d.severity === 'error');

export const useEditor = create<EditorState>((set, get) => {
  const persist = () => {
    const { projectId } = get();
    if (!projectId) return;
    set({ saveState: 'saving' });
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const { projectId: id, files: current } = get();
      if (!id) return;
      updateProject(id, { files: current });
      set({ saveState: 'saved' });
    }, 500);
  };

  const pushHistory = (snapshot: Record<string, string> = { ...get().files }) => {
    const next = [...get().past, snapshot];
    if (next.length > 60) next.shift();
    set({ past: next, future: [] });
  };

  /**
   * Parse the typed code now instead of waiting for the debounce. Returns
   * false (and flags the code) when it doesn't parse.
   */
  const commitCode = (): boolean => {
    clearTimeout(parseTimer);
    parseTimer = undefined;
    const { ir: prev, files } = get();
    const { ir, diagnostics } = parseProject(files);
    if (hasErrors(diagnostics)) {
      set({ parseDiagnostics: diagnostics, codeErrored: true });
      return false;
    }
    codeBurstBase = null;
    const derived = derive(ir, prev);
    const selection = get().selection;
    set({
      ir: derived.ir,
      edges: derived.edges,
      warnings: derived.warnings,
      parseDiagnostics: diagnostics,
      codeErrored: false,
      selection: derived.ir.resources.some((r) => r.id === selection) ? selection : null,
    });
    return true;
  };

  return {
    projectId: null,
    projectName: '',
    files: {},
    filesRevision: 0,
    ir: emptyIR(),
    edges: [],
    parseDiagnostics: [],
    warnings: [],
    codeErrored: false,
    selection: null,
    selectionOrigin: 'canvas',
    revealSeq: 0,
    activeFile: 'main.tf',
    saveState: 'saved',
    past: [],
    future: [],

    load(project) {
      clearTimeout(parseTimer);
      parseTimer = undefined;
      codeBurstBase = null;
      const { ir, diagnostics } = parseProject(project.files);
      const errored = diagnostics.some((d) => d.severity === 'error');
      const derived = derive(ir);
      const fileList = orderedFiles(project.files);
      set({
        projectId: project.id,
        projectName: project.name,
        files: { ...project.files },
        filesRevision: get().filesRevision + 1,
        ir: derived.ir,
        edges: derived.edges,
        warnings: derived.warnings,
        parseDiagnostics: diagnostics,
        codeErrored: errored,
        selection: null,
        activeFile: fileList.includes('main.tf') ? 'main.tf' : (fileList[0] ?? 'main.tf'),
        saveState: 'saved',
        past: [],
        future: [],
      });
    },

    applyCanvasOps(ops, select) {
      if (ops.length === 0) return;
      // the IR only matches the text once the typed code has been parsed
      if ((parseTimer !== undefined || codeBurstBase) && !commitCode()) {
        showToast('Fix the errors in the code first — the canvas is read-only until it parses', 'error');
        return;
      }
      if (get().codeErrored) {
        showToast('Fix the errors in the code first — the canvas is read-only until it parses', 'error');
        return;
      }
      const { files, ir } = get();
      const outcome = applyOpsWithPatches(files, ir, ops);
      if (hasErrors(outcome.diagnostics)) {
        // never trade the user's text for a broken one
        showToast("That change couldn't be applied without breaking the code — make it in the code pane", 'error');
        return;
      }
      pushHistory({ ...files });
      const derived = derive(outcome.ir, ir);

      let selection = select !== undefined ? select : get().selection;
      if (selection) {
        selection = outcome.renamed.get(selection) ?? selection;
        if (!derived.ir.resources.some((r) => r.id === selection)) selection = null;
      }

      set({
        files: outcome.files,
        filesRevision: get().filesRevision + 1,
        ir: derived.ir,
        edges: derived.edges,
        warnings: derived.warnings,
        parseDiagnostics: outcome.diagnostics,
        codeErrored: false,
        selection,
        ...(select !== undefined ? { selectionOrigin: 'canvas' as const } : {}),
      });
      persist();
    },

    onCodeChange(file, text) {
      if (!codeBurstBase) {
        codeBurstBase = { ...get().files };
        pushHistory(codeBurstBase);
      }
      const files = { ...get().files, [file]: text };
      set({ files, saveState: 'saving' });
      persist();
      clearTimeout(parseTimer);
      parseTimer = setTimeout(commitCode, 350);
    },

    setActiveFile(file) {
      set({ activeFile: file });
    },

    setSelection(id, origin = 'canvas') {
      set({ selection: id, selectionOrigin: origin });
    },

    renameProject(name) {
      const { projectId } = get();
      const clean = name.trim() || 'Untitled';
      set({ projectName: clean });
      if (projectId) updateProject(projectId, { name: clean });
    },

    deleteResources(ids) {
      const { ir, edges } = get();
      const { ops, removed } = deleteResourcesOps(ir, edges, ids);
      if (ops.length > 0) get().applyCanvasOps(ops, null);
      return removed.length;
    },

    revealInCode(nodeId) {
      const node = get().ir.resources.find((r) => r.id === nodeId);
      if (!node) return;
      const file = node.trivia.sourceFile ?? 'main.tf';
      set({
        activeFile: file,
        selection: nodeId,
        selectionOrigin: 'canvas',
        revealSeq: get().revealSeq + 1,
      });
    },

    undo() {
      const { past, files } = get();
      if (past.length === 0) return;
      clearTimeout(parseTimer);
      parseTimer = undefined;
      codeBurstBase = null;
      const previous = past[past.length - 1];
      const { ir, diagnostics } = parseProject(previous);
      const derived = derive(ir, get().ir);
      set({
        past: past.slice(0, -1),
        future: [{ ...files }, ...get().future],
        files: previous,
        filesRevision: get().filesRevision + 1,
        ir: derived.ir,
        edges: derived.edges,
        warnings: derived.warnings,
        parseDiagnostics: diagnostics,
        codeErrored: hasErrors(diagnostics),
        selection: null,
      });
      persist();
    },

    redo() {
      const { future, files } = get();
      if (future.length === 0) return;
      clearTimeout(parseTimer);
      parseTimer = undefined;
      codeBurstBase = null;
      const next = future[0];
      const { ir, diagnostics } = parseProject(next);
      const derived = derive(ir, get().ir);
      set({
        future: future.slice(1),
        past: [...get().past, { ...files }],
        files: next,
        filesRevision: get().filesRevision + 1,
        ir: derived.ir,
        edges: derived.edges,
        warnings: derived.warnings,
        parseDiagnostics: diagnostics,
        codeErrored: hasErrors(diagnostics),
        selection: null,
      });
      persist();
    },
  };
});

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __editorStore: unknown }).__editorStore = useEditor;
}

export function loadProjectIntoEditor(id: string): boolean {
  const project = getProject(id);
  if (!project) return false;
  useEditor.getState().load(project);
  return true;
}
