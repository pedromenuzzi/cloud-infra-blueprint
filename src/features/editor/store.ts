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
import {
  createProject,
  getProject,
  PROJECTS_KEY,
  restoreProject,
  sameFiles,
  uniqueProjectName,
  updateProject,
  type Project,
} from '@/lib/storage';
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
  /** a read-only view (a `#view=` link): nothing can be edited and nothing is ever stored */
  readOnly: boolean;
  selection: string | null;
  /**
   * Every selected resource (box or Ctrl-click on the canvas); always holds
   * `selection`, the one the inspector shows, when there is one.
   */
  selectedIds: string[];
  /** who changed the selection last — the code pane only scrolls for canvas picks */
  selectionOrigin: 'canvas' | 'code';
  /** bumped by revealInCode so the code pane scrolls + flashes the block */
  revealSeq: number;
  activeFile: string;
  /** 'error': the last save failed (see saveError) — edits stay in memory until it's resolved */
  saveState: 'saved' | 'saving' | 'error';
  /** why saving failed: storage full, or the project changed / was deleted in another tab */
  saveError: 'quota' | 'conflict' | 'deleted' | null;
  /** another tab changed or deleted this project while this one had unsaved edits */
  conflict: 'changed' | 'deleted' | null;
  past: Array<Record<string, string>>;
  future: Array<Record<string, string>>;

  /**
   * `keepView` keeps the open file + selection when they still exist (reload from another tab).
   * `readOnly` opens a project that isn't stored (a view link): edits are refused, nothing persists.
   */
  load(project: Project, options?: { keepView?: boolean; readOnly?: boolean }): void;
  /**
   * Settle a conflict: 'reload' takes the other tab's version, 'overwrite'
   * keeps this tab's, 'restore' puts a deleted project back, 'fork' saves this
   * tab's copy as a new project, 'discard' drops it. Returns the id of the
   * project the editor should show next (null after 'discard').
   */
  resolveConflict(choice: 'reload' | 'overwrite' | 'restore' | 'fork' | 'discard'): string | null;
  applyCanvasOps(ops: Op[], select?: string | null): void;
  onCodeChange(file: string, text: string): void;
  setActiveFile(file: string): void;
  setSelection(id: string | null, origin?: 'canvas' | 'code'): void;
  /** the canvas selection; the primary stays when it's still in it unless `primary` says otherwise */
  setSelectedIds(ids: string[], primary?: string | null): void;
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

export const READ_ONLY_HINT = 'This is a read-only view — make a copy to edit it';

/* persistence bookkeeping for the open project */
/** the stored project as this tab last loaded or wrote it — its `rev` guards against stale writes */
let stored: Project | null = null;
/** edits not written yet (pending debounce, or a write that failed) */
let dirty = false;
/** writes pending edits now; true when nothing is left unsaved (set up by the store) */
let saveNow: () => boolean = () => true;

export const useEditor = create<EditorState>((set, get) => {
  const save = (): boolean => {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    const { projectId: id, files, projectName, conflict, readOnly } = get();
    if (readOnly) return true; // a view link is never written anywhere
    if (!id || !dirty) return !dirty;
    if (conflict) return false; // waiting for the user's choice — never overwrite silently
    const result = updateProject(id, { files, name: projectName }, { expectedRev: stored?.rev ?? 0 });
    if (result.ok) {
      stored = result.project;
      dirty = false;
      set({ saveState: 'saved', saveError: null });
      return true;
    }
    if (result.reason === 'quota') set({ saveState: 'error', saveError: 'quota' });
    else if (result.reason === 'missing') set({ saveState: 'error', saveError: 'deleted', conflict: 'deleted' });
    else set({ saveState: 'error', saveError: 'conflict', conflict: 'changed' });
    return false;
  };
  saveNow = save;

  const persist = () => {
    const { projectId, readOnly } = get();
    if (!projectId || readOnly) return;
    dirty = true;
    if (get().conflict) return;
    set({ saveState: 'saving' });
    clearTimeout(persistTimer);
    persistTimer = setTimeout(save, 500);
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
    readOnly: false,
    selection: null,
    selectedIds: [],
    selectionOrigin: 'canvas',
    revealSeq: 0,
    activeFile: 'main.tf',
    saveState: 'saved',
    saveError: null,
    conflict: null,
    past: [],
    future: [],

    load(input, options = {}) {
      const keep = options.keepView === true && get().projectId === input.id;
      let project = input;
      if (!keep && dirty) {
        // a pending save belongs to the project on screen — write it before replacing it
        const saved = save();
        if (input.id === get().projectId) {
          // reopening the same project: keep edits that couldn't be stored rather than
          // reload an older copy; otherwise what was just written is newer than `input`
          if (!saved) return;
          project = getProject(input.id) ?? input;
        }
      }
      clearTimeout(persistTimer);
      clearTimeout(parseTimer);
      parseTimer = undefined;
      codeBurstBase = null;
      const readOnly = options.readOnly === true;
      stored = readOnly ? null : project;
      dirty = false;
      const { ir, diagnostics } = parseProject(project.files);
      const errored = diagnostics.some((d) => d.severity === 'error');
      const derived = derive(ir);
      const fileList = orderedFiles(project.files);
      const { selection, activeFile } = get();
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
        readOnly,
        selection: keep && derived.ir.resources.some((r) => r.id === selection) ? selection : null,
        activeFile:
          keep && fileList.includes(activeFile)
            ? activeFile
            : fileList.includes('main.tf')
              ? 'main.tf'
              : (fileList[0] ?? 'main.tf'),
        saveState: 'saved',
        saveError: null,
        conflict: null,
        past: [],
        future: [],
      });
    },

    resolveConflict(choice) {
      const { projectId: id, projectName, files } = get();
      if (!id) return null;
      const current = getProject(id);
      const gone = () => {
        set({ conflict: 'deleted', saveState: 'error', saveError: 'deleted' });
        return id;
      };
      switch (choice) {
        case 'reload':
          if (!current) return gone();
          get().load(current, { keepView: true });
          return id;
        case 'overwrite':
          if (!current) return gone();
          stored = current; // their revision becomes the base; ours is written over it
          dirty = true;
          set({ conflict: null });
          save();
          return id;
        case 'restore': {
          const now = new Date().toISOString();
          const base: Project = stored ?? { id, name: projectName, files, providers: [], createdAt: now, updatedAt: now };
          const result = restoreProject({ ...base, id, name: projectName, files });
          if (result.ok) {
            stored = result.project;
            dirty = false;
            set({ conflict: null, saveState: 'saved', saveError: null });
          } else if (result.reason === 'conflict') {
            set({ conflict: 'changed', saveState: 'error', saveError: 'conflict' });
          } else {
            set({ saveState: 'error', saveError: 'quota' });
          }
          return id;
        }
        case 'fork':
          try {
            const project = createProject({
              name: uniqueProjectName(projectName),
              files,
              description: stored?.description,
              templateSlug: stored?.templateSlug,
            });
            dirty = false;
            set({ conflict: null });
            get().load(project);
            return project.id;
          } catch {
            set({ saveState: 'error', saveError: 'quota' });
            return id;
          }
        case 'discard':
          clearTimeout(persistTimer);
          dirty = false;
          stored = null;
          set({ conflict: null, saveState: 'saved', saveError: null, projectId: null });
          return null;
      }
    },

    applyCanvasOps(ops, select) {
      if (ops.length === 0) return;
      if (get().readOnly) {
        showToast(READ_ONLY_HINT, 'info');
        return;
      }
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
      // never trade the user's text for a broken (or wrongly spliced) one
      if (outcome.refused || hasErrors(outcome.diagnostics)) {
        showToast(
          outcome.refused?.message ?? "That change couldn't be applied without breaking the code — make it in the code pane",
          'error',
        );
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
      if (get().readOnly) return;
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

    setSelectedIds(ids, primary) {
      const { selection, selectedIds } = get();
      const next = primary !== undefined ? primary : selection && ids.includes(selection) ? selection : (ids[ids.length - 1] ?? null);
      if (next === selection && sameIds(ids, selectedIds)) return;
      set({ selectedIds: ids, selection: next, selectionOrigin: 'canvas' });
    },

    renameProject(name) {
      const { projectId, readOnly } = get();
      if (readOnly) return;
      const clean = name.trim() || 'Untitled';
      set({ projectName: clean });
      if (!projectId) return;
      dirty = true;
      save();
    },

    deleteResources(ids) {
      const { ir, edges, readOnly } = get();
      if (readOnly) {
        showToast(READ_ONLY_HINT, 'info');
        return 0;
      }
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
      const { past, files, readOnly } = get();
      if (past.length === 0 || readOnly) return;
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
        // keep what's selected when it still exists (undoing an align keeps the selection)
        selection: keptSelection(get().selection, derived.ir),
      });
      persist();
    },

    redo() {
      const { future, files, readOnly } = get();
      if (future.length === 0 || readOnly) return;
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
        // keep what's selected when it still exists (undoing an align keeps the selection)
        selection: keptSelection(get().selection, derived.ir),
      });
      persist();
    },
  };
});

const keptSelection = (id: string | null, ir: IR) => (id && ir.resources.some((r) => r.id === id) ? id : null);

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

// Keep the multi-selection consistent wherever the primary selection or the
// IR changes: a primary outside it means a single pick, deleted ids leave it.
useEditor.subscribe((state, prev) => {
  if (state.selection === prev.selection && state.ir === prev.ir && state.selectedIds === prev.selectedIds) return;
  const exists = new Set(state.ir.resources.map((r) => r.id));
  let ids = state.selectedIds.filter((id) => exists.has(id));
  if (state.selection === null) ids = [];
  else if (!ids.includes(state.selection)) ids = [state.selection];
  if (!sameIds(ids, state.selectedIds)) useEditor.setState({ selectedIds: ids });
});

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __editorStore: unknown }).__editorStore = useEditor;
}

/** Write the pending (debounced) save right away. True when nothing is left unsaved. */
export function flushPendingSave(): boolean {
  return saveNow();
}

/**
 * Another tab wrote the projects. Reload the open project when this tab has
 * nothing unsaved; otherwise raise a conflict for the user to settle.
 */
function onStorageChanged(e: StorageEvent) {
  if (e.key !== PROJECTS_KEY && e.key !== null) return;
  const state = useEditor.getState();
  // a view link isn't one of the stored projects: other tabs' writes never concern it
  if (!state.projectId || state.conflict || state.readOnly) return;
  const current = getProject(state.projectId);
  if (!current) {
    clearTimeout(persistTimer);
    dirty = true; // what's on screen now exists nowhere else
    useEditor.setState({ conflict: 'deleted', saveState: 'error', saveError: 'deleted' });
    return;
  }
  if ((current.rev ?? 0) === (stored?.rev ?? 0)) {
    // another project changed; if ours failed for lack of space, retry — room may have been freed
    if (dirty && state.saveError === 'quota') saveNow();
    return;
  }
  if (stored && sameFiles(current.files, stored.files)) {
    // metadata only (e.g. renamed on the dashboard): adopt it and keep local edits
    stored = current;
    if (current.name !== state.projectName) useEditor.setState({ projectName: current.name });
    return;
  }
  if (!dirty) {
    state.load(current, { keepView: true });
    return;
  }
  clearTimeout(persistTimer);
  useEditor.setState({ conflict: 'changed', saveState: 'error', saveError: 'conflict' });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', onStorageChanged);
  // without a flush, the last half-second of edits is lost on reload / close / tab switch
  window.addEventListener('pagehide', () => saveNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('beforeunload', (e) => {
    if (saveNow()) return;
    // edits that can't be stored (storage full / unresolved conflict): let the browser ask
    e.preventDefault();
    e.returnValue = '';
  });
}

export function loadProjectIntoEditor(id: string): boolean {
  const project = getProject(id);
  if (!project) return false;
  useEditor.getState().load(project);
  return true;
}
