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
import { dropMovesTo } from '@/hcl/moved';
import { applyOpsWithPatches } from '@/hcl/patch';
import { parseProject } from '@/hcl/parser';
import { useLocale } from '@/i18n/locale';
import { messagesFor } from '@/i18n/messages';
import { deriveStructure } from '@/ir/graph';
import { moduleDiagnostics } from '@/ir/moduleChecks';
import { carryModulePositions, layoutWithModules } from '@/ir/moduleLayout';
import { dirOfPath, findNode, hasNode, moduleEdges, nodeIds } from '@/ir/modules';
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
import { confirmModuleDelete } from '@/features/modules/deleteGuard';
import { applyOpsInModule, applyOpsInScope, parseFolder, type ModuleScope } from '@/features/modules/scopedPatch';
import { noteScopeView } from '@/features/modules/viewAnalysis';
import { deleteResourcesOps } from './connections';
import { isHistoryMove, noteRootIr, startMovedSession } from './movedSession';
import { storeMessages } from './store.messages';

const FILE_ORDER = ['main.tf', 'variables.tf', 'outputs.tf', 'providers.tf', 'versions.tf'];

/** The root module's files (the usual ones first), then each child module's, folder by folder. */
export function orderedFiles(files: Record<string, string>): string[] {
  const keys = Object.keys(files);
  const root = keys.filter((f) => !f.includes('/'));
  return [
    ...FILE_ORDER.filter((f) => root.includes(f)),
    ...root.filter((f) => !FILE_ORDER.includes(f)).sort(),
    ...keys.filter((f) => f.includes('/')).sort(),
  ];
}

interface Derived {
  ir: IR;
  edges: IREdge[];
  warnings: Diagnostic[];
}

/** Validation warnings: resources (validate.ts) and module calls (moduleChecks.ts, which reads child modules). */
function validateAll(ir: IR, files: Record<string, string>): Diagnostic[] {
  const warnings = validateProject(ir, getDef);
  return ir.modules.length > 0 ? [...warnings, ...moduleDiagnostics(ir, files)] : warnings;
}

function derive(ir: IR, prev: IR | undefined, files: Record<string, string>): Derived {
  // carry canvas positions for nodes the text doesn't pin yet
  if (prev) {
    const prevById = new Map(prev.resources.map((r) => [r.id, r] as const));
    for (const node of ir.resources) {
      if (!node.position) {
        const old = prevById.get(node.id);
        if (old?.position) node.position = { ...old.position };
      }
    }
    carryModulePositions(ir, prev);
  }
  const edges = deriveStructure(ir, getDef);
  if (ir.modules.length > 0) edges.push(...moduleEdges(ir));
  layoutWithModules(ir, isContainerType);
  return { ir, edges, warnings: validateAll(ir, files) };
}

/** the last view of each opened module folder: blocks the text doesn't place keep their spot when it opens again */
const lastViews = new Map<string, IR>();

/**
 * An opened module's view, derived like the root's from its own files; null
 * when the project no longer has its folder. `errored`: its code doesn't
 * parse (the caller keeps the last good view then, when there is one).
 */
function deriveScope(
  files: Record<string, string>,
  scope: ModuleScope,
  prev: IR | undefined,
  root: IR,
): { view: Derived; errored: boolean } | null {
  const parsed = parseFolder(files, scope.dir);
  if (!parsed) return null;
  const view = derive(parsed.ir, prev ?? lastViews.get(scope.dir), files);
  lastViews.set(scope.dir, view.ir);
  noteScopeView(view.ir, scope, files, root);
  return { view, errored: hasErrors(parsed.diagnostics) };
}

interface EditorState {
  projectId: string | null;
  projectName: string;
  files: Record<string, string>;
  /** bumped whenever file text changed OUTSIDE Monaco (ops, undo, load) */
  filesRevision: number;
  /**
   * What the canvas, the inspector and ⌘K work on: the root module's blocks,
   * or the opened module's (see `scope`) with project paths in `sourceFile`.
   */
  ir: IR;
  /** the root module's blocks, whatever is open (the project's cost, security and PDF read them) */
  rootIr: IR;
  /**
   * The local module opened on the canvas; null: the root module. `ir`,
   * `edges`, `warnings` and `codeErrored` are then the module's, and ops
   * patch its own files (one undo history for the whole project).
   */
  scope: ModuleScope | null;
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
  /** ops on the blocks of the child module in folder `dir` (an opened module), patched into its own files — one undo step */
  applyModuleOps(dir: string, ops: Op[]): void;
  /** open a local module on the canvas (null: back to the root module); the selection is cleared */
  setScope(scope: ModuleScope | null): void;
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

/** a derived view as store fields, the selection kept while it's still on it */
const viewState = (view: Derived, selection: string | null) => ({
  ir: view.ir,
  edges: view.edges,
  warnings: view.warnings,
  selection: selection && hasNode(view.ir, selection) ? selection : null,
});

/** what a read-only view says to an edit (a toast, Monaco's read-only tooltip), in the language in effect */
export const readOnlyHint = () => messagesFor(storeMessages).readOnlyHint;

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
    const { ir: prev, rootIr: prevRoot, files, scope } = get();
    const { ir, diagnostics } = parseProject(files);
    const rootErrored = hasErrors(diagnostics);
    // an opened module: the canvas follows its own files; the root's IR still follows its code when it parses
    const nextRoot = scope && !rootErrored ? derive(ir, prevRoot, files).ir : prevRoot;
    const opened = scope ? deriveScope(files, scope, prev, nextRoot) : null;
    if (opened) {
      const root = rootErrored ? {} : { rootIr: nextRoot };
      if (opened.errored) {
        set({ ...root, parseDiagnostics: diagnostics, codeErrored: true });
        return false;
      }
      codeBurstBase = null;
      set({ ...root, ...viewState(opened.view, get().selection), parseDiagnostics: diagnostics, codeErrored: false });
      return true;
    }
    if (rootErrored) {
      // an opened module whose folder went away: back on the root's last good view
      const back = scope ? { scope: null, ...viewState(derive(prevRoot, undefined, files), null) } : {};
      set({ ...back, parseDiagnostics: diagnostics, codeErrored: true });
      return false;
    }
    codeBurstBase = null;
    const derived = derive(ir, scope ? prevRoot : prev, files);
    set({ ...viewState(derived, scope ? null : get().selection), rootIr: derived.ir, scope: null, parseDiagnostics: diagnostics, codeErrored: false });
    return true;
  };

  /**
   * The store fields for files put back by undo / redo: the opened module's
   * view while its folder is still there (one history for root and modules),
   * else the root's; what's selected stays when it still exists (undoing an
   * align keeps the selection).
   */
  const restore = (snapshot: Record<string, string>) => {
    const { scope, rootIr, ir: view, selection } = get();
    const { ir, diagnostics } = parseProject(snapshot);
    const derived = derive(ir, scope ? rootIr : view, snapshot);
    const opened = scope ? deriveScope(snapshot, scope, view, derived.ir) : null;
    const shown = opened?.view ?? derived;
    return {
      files: snapshot,
      filesRevision: get().filesRevision + 1,
      ir: shown.ir,
      rootIr: derived.ir,
      scope: opened ? scope : null,
      edges: shown.edges,
      warnings: shown.warnings,
      parseDiagnostics: diagnostics,
      codeErrored: opened ? opened.errored : hasErrors(diagnostics),
      selection: scope && !opened ? null : keptSelection(selection, shown.ir),
    };
  };

  return {
    projectId: null,
    projectName: '',
    files: {},
    filesRevision: 0,
    ir: emptyIR(),
    rootIr: emptyIR(),
    scope: null,
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
      const derived = derive(ir, undefined, project.files);
      startMovedSession(ir, project.files);
      if (!keep) lastViews.clear();
      // a reload (another tab wrote the project) keeps an opened module open while its folder is there
      const scope = keep ? get().scope : null;
      const opened = scope ? deriveScope(project.files, scope, get().ir, derived.ir) : null;
      const view = opened?.view ?? derived;
      const fileList = orderedFiles(project.files);
      const { selection, activeFile } = get();
      set({
        projectId: project.id,
        projectName: project.name,
        files: { ...project.files },
        filesRevision: get().filesRevision + 1,
        ir: view.ir,
        rootIr: derived.ir,
        scope: opened ? scope : null,
        edges: view.edges,
        warnings: view.warnings,
        parseDiagnostics: diagnostics,
        codeErrored: opened ? opened.errored : errored,
        readOnly,
        selection: keep && selection && hasNode(view.ir, selection) ? selection : null,
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
        showToast(readOnlyHint(), 'info');
        return;
      }
      // the IR only matches the text once the typed code has been parsed
      if ((parseTimer !== undefined || codeBurstBase) && !commitCode()) {
        showToast(messagesFor(storeMessages).fixCodeFirst, 'error');
        return;
      }
      if (get().codeErrored) {
        showToast(messagesFor(storeMessages).fixCodeFirst, 'error');
        return;
      }
      const { files, ir, scope } = get();
      let outcome: { files: Record<string, string>; ir: IR; renamed: Map<string, string> };
      /** the root module's fresh parse diagnostics (an opened module's patch leaves the root's alone) */
      let rootDiagnostics: Diagnostic[] | undefined;
      if (scope) {
        // an opened module: the ops patch its own files, nothing else
        const scoped = applyOpsInScope(files, scope.dir, ir, ops);
        if (!scoped.ok) {
          showToast(scoped.message ?? messagesFor(storeMessages).cantApply, 'error');
          return;
        }
        outcome = scoped;
      } else {
        const patched = applyOpsWithPatches(files, ir, ops);
        // never trade the user's text for a broken (or wrongly spliced) one
        if (patched.refused || hasErrors(patched.diagnostics)) {
          showToast(patched.refused?.message ?? messagesFor(storeMessages).cantApply, 'error');
          return;
        }
        outcome = patched;
        rootDiagnostics = patched.diagnostics;
      }
      pushHistory({ ...files });
      const derived = derive(outcome.ir, ir, outcome.files);
      if (scope) {
        lastViews.set(scope.dir, derived.ir);
        noteScopeView(derived.ir, scope, outcome.files, get().rootIr);
      }

      let selection = select !== undefined ? select : get().selection;
      if (selection) {
        selection = outcome.renamed.get(selection) ?? selection;
        if (!hasNode(derived.ir, selection)) selection = null;
      }

      set({
        files: outcome.files,
        filesRevision: get().filesRevision + 1,
        ir: derived.ir,
        ...(rootDiagnostics ? { rootIr: derived.ir, parseDiagnostics: rootDiagnostics } : {}),
        edges: derived.edges,
        warnings: derived.warnings,
        codeErrored: false,
        selection,
        ...(select !== undefined ? { selectionOrigin: 'canvas' as const } : {}),
      });
      persist();
    },

    applyModuleOps(dir, ops) {
      if (ops.length === 0) return;
      // the module on the canvas: its view follows
      if (get().scope?.dir === dir) {
        get().applyCanvasOps(ops);
        return;
      }
      if (get().readOnly) {
        showToast(readOnlyHint(), 'info');
        return;
      }
      if ((parseTimer !== undefined || codeBurstBase) && !commitCode()) {
        showToast(messagesFor(storeMessages).fixCodeFirst, 'error');
        return;
      }
      const { files, ir } = get();
      const outcome = applyOpsInModule(files, dir, ops);
      if (!outcome.ok) {
        showToast(outcome.message ?? messagesFor(storeMessages).cantApply, 'error');
        return;
      }
      pushHistory({ ...files });
      // the root module's blocks are untouched: same IR, the module checks read the new files
      set({ files: outcome.files, filesRevision: get().filesRevision + 1, warnings: validateAll(ir, outcome.files) });
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

    setScope(next) {
      const { files, scope, rootIr, ir, activeFile, parseDiagnostics } = get();
      if (next?.dir === scope?.dir && next?.path.join('/') === scope?.path.join('/')) return;
      // the code pane follows: a file of the module (or of the root) opens when the one shown isn't
      const fileIn = (dir: string) => {
        const list = orderedFiles(files).filter((f) => dirOfPath(f) === dir);
        return list.includes(activeFile) ? activeFile : (list.find((f) => /(^|\/)main\.tf$/.test(f)) ?? list[0] ?? activeFile);
      };
      if (!next) {
        // positions are on the root's IR already: it comes back as it was left
        const view = derive(rootIr, undefined, files);
        set({ scope: null, ...viewState(view, null), rootIr: view.ir, codeErrored: hasErrors(parseDiagnostics), activeFile: fileIn('') });
        return;
      }
      const opened = deriveScope(files, next, scope?.dir === next.dir ? ir : undefined, rootIr);
      if (!opened) return;
      set({ scope: next, ...viewState(opened.view, null), codeErrored: opened.errored, activeFile: fileIn(next.dir) });
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
      const clean = name.trim() || messagesFor(storeMessages).untitled;
      set({ projectName: clean });
      if (!projectId) return;
      dirty = true;
      save();
    },

    deleteResources(ids) {
      const { ir, edges, readOnly } = get();
      if (readOnly) {
        showToast(readOnlyHint(), 'info');
        return 0;
      }
      const run = (state: { ir: IR; edges: IREdge[] }) => {
        const { ops, removed } = deleteResourcesOps(state.ir, state.edges, ids);
        // moved blocks this session wrote towards them go too (hcl/moved.ts)
        if (ops.length > 0) get().applyCanvasOps([...ops, ...dropMovesTo(state.ir, removed, isHistoryMove)], null);
        return removed.length;
      };
      // a module other blocks still read from: ask first (the deletion then runs on the IR of that moment)
      if (confirmModuleDelete(ir, ids, () => run(get()))) return 0;
      return run({ ir, edges });
    },

    revealInCode(nodeId) {
      const node = findNode(get().ir, nodeId);
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
      set({ ...restore(past[past.length - 1]), past: past.slice(0, -1), future: [{ ...files }, ...get().future] });
      persist();
    },

    redo() {
      const { future, files, readOnly } = get();
      if (future.length === 0 || readOnly) return;
      clearTimeout(parseTimer);
      parseTimer = undefined;
      codeBurstBase = null;
      set({ ...restore(future[0]), future: future.slice(1), past: [...get().past, { ...files }] });
      persist();
    },
  };
});

const keptSelection = (id: string | null, ir: IR) => (id && hasNode(ir, id) ? id : null);

// renames inside an opened module keep the state by default when the root looks deployed
useEditor.subscribe((state, prev) => {
  if (state.scope !== prev.scope || state.rootIr !== prev.rootIr) noteRootIr(state.scope ? state.rootIr : null);
});

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

// Keep the multi-selection consistent wherever the primary selection or the
// IR changes: a primary outside it means a single pick, deleted ids leave it.
useEditor.subscribe((state, prev) => {
  if (state.selection === prev.selection && state.ir === prev.ir && state.selectedIds === prev.selectedIds) return;
  const exists = nodeIds(state.ir);
  let ids = state.selectedIds.filter((id) => exists.has(id));
  if (state.selection === null) ids = [];
  else if (!ids.includes(state.selection)) ids = [state.selection];
  if (!sameIds(ids, state.selectedIds)) useEditor.setState({ selectedIds: ids });
});

/**
 * Validation warnings and parse errors are text produced when the code is
 * checked, in the language in effect then. On a language switch they're
 * produced again from the same IR and files, so the canvas badges, the
 * overview and the code pane's markers change language in place. Nothing
 * else is touched: no new IR, no undo step, no save.
 */
export function relocalizeEditorMessages() {
  const { ir, files, parseDiagnostics } = useEditor.getState();
  useEditor.setState({
    warnings: validateAll(ir, files),
    // nothing to translate when the code parsed cleanly
    ...(parseDiagnostics.length > 0 ? { parseDiagnostics: parseProject(files).diagnostics } : {}),
  });
}

useLocale.subscribe((state, prev) => {
  if (state.locale !== prev.locale) relocalizeEditorMessages();
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
