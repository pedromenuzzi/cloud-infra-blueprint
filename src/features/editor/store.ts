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
  activeFile: string;
  saveState: 'saved' | 'saving';
  past: Array<Record<string, string>>;
  future: Array<Record<string, string>>;

  load(project: Project): void;
  applyCanvasOps(ops: Op[], select?: string | null): void;
  onCodeChange(file: string, text: string): void;
  setActiveFile(file: string): void;
  setSelection(id: string | null): void;
  renameProject(name: string): void;
  revealInCode(nodeId: string): void;
  undo(): void;
  redo(): void;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let parseTimer: ReturnType<typeof setTimeout> | undefined;
let lastHistoryPush = 0;

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

  const pushHistory = (coalesce = false) => {
    const now = Date.now();
    if (coalesce && now - lastHistoryPush < 1500) return;
    lastHistoryPush = now;
    const { files, past } = get();
    const next = [...past, { ...files }];
    if (next.length > 60) next.shift();
    set({ past: next, future: [] });
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
    activeFile: 'main.tf',
    saveState: 'saved',
    past: [],
    future: [],

    load(project) {
      clearTimeout(parseTimer);
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
      const { files, ir } = get();
      pushHistory();
      const outcome = applyOpsWithPatches(files, ir, ops);
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
        codeErrored: outcome.diagnostics.some((d) => d.severity === 'error'),
        selection,
      });
      persist();
    },

    onCodeChange(file, text) {
      const files = { ...get().files, [file]: text };
      set({ files, saveState: 'saving' });
      persist();
      clearTimeout(parseTimer);
      parseTimer = setTimeout(() => {
        const { ir: prev } = get();
        const { ir, diagnostics } = parseProject(get().files);
        const errored = diagnostics.some((d) => d.severity === 'error');
        if (errored) {
          set({ parseDiagnostics: diagnostics, codeErrored: true });
          return;
        }
        pushHistory(true);
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
      }, 350);
    },

    setActiveFile(file) {
      set({ activeFile: file });
    },

    setSelection(id) {
      set({ selection: id });
    },

    renameProject(name) {
      const { projectId } = get();
      const clean = name.trim() || 'Untitled';
      set({ projectName: clean });
      if (projectId) updateProject(projectId, { name: clean });
    },

    revealInCode(nodeId) {
      const node = get().ir.resources.find((r) => r.id === nodeId);
      if (!node) return;
      const file = node.trivia.sourceFile ?? 'main.tf';
      set({ activeFile: file });
    },

    undo() {
      const { past, files } = get();
      if (past.length === 0) return;
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
        codeErrored: diagnostics.some((d) => d.severity === 'error'),
        selection: null,
      });
      persist();
    },

    redo() {
      const { future, files } = get();
      if (future.length === 0) return;
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
        codeErrored: diagnostics.some((d) => d.severity === 'error'),
        selection: null,
      });
      persist();
    },
  };
});

if (import.meta.env.DEV) {
  (window as unknown as { __editorStore: unknown }).__editorStore = useEditor;
}

export function loadProjectIntoEditor(id: string): boolean {
  const project = getProject(id);
  if (!project) return false;
  useEditor.getState().load(project);
  return true;
}
