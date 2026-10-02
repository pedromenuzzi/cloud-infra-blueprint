/**
 * Which child module is opened on the canvas, if any — a path of module
 * calls from the root module (`root › service › ecr`). The editor store's
 * `scope` follows it: the canvas, the inspector and ⌘K then work on that
 * module's blocks. Always loaded (the canvas and the menus open it); the
 * breadcrumb bar loads on first use.
 */
import { create } from 'zustand';
import { useEditor } from '@/features/editor/store';

export interface OpenedModule {
  /** project folder, `modules/network` */
  dir: string;
  /** the module call's name, as the breadcrumb shows it */
  name: string;
  /** what was selected one level up when this one opened: it comes back with that level */
  from?: string | null;
}

interface ModuleViewState {
  /** innermost last; empty: the root module's canvas */
  path: OpenedModule[];
}

export const useModuleView = create<ModuleViewState>(() => ({ path: [] }));

function applyPath(path: OpenedModule[]) {
  useModuleView.setState({ path });
  const last = path[path.length - 1];
  useEditor.getState().setScope(last ? { dir: last.dir, path: path.map((p) => p.name) } : null);
}

/**
 * Open a module call's module: from the root canvas it's the first step,
 * from an opened module one level deeper (the call is one of its blocks).
 */
export function openModuleView(dir: string, name: string) {
  const { path } = useModuleView.getState();
  const editor = useEditor.getState();
  applyPath([...path, { dir, name, from: editor.selection }]);
}

/** Open a module reached through these calls from the root (`['service', 'ecr']`), with `select` selected in it. */
export function openModulePath(steps: Array<{ dir: string; name: string }>, select?: string | null) {
  const { path } = useModuleView.getState();
  const same = path.length === steps.length && path.every((p, i) => p.dir === steps[i].dir && p.name === steps[i].name);
  if (!same) {
    const from = path.length === 0 ? useEditor.getState().selection : (path[0]?.from ?? null);
    applyPath(steps.map((s, i) => ({ ...s, from: i === 0 ? from : null })));
  }
  if (select !== undefined) useEditor.getState().setSelection(select, 'canvas');
}

/** Back to `depth` levels open (0: the root canvas), where that level's selection comes back. */
export function moduleViewTo(depth: number) {
  const { path } = useModuleView.getState();
  if (depth >= path.length) return;
  const back = path[Math.max(0, depth)]?.from ?? null;
  applyPath(path.slice(0, Math.max(0, depth)));
  const { ir, setSelection } = useEditor.getState();
  if (back && (ir.modules.some((m) => m.id === back) || ir.resources.some((r) => r.id === back))) setSelection(back);
}

/** One level up (to the root canvas from a first-level module). */
export function moduleViewBack() {
  moduleViewTo(useModuleView.getState().path.length - 1);
}

/** Leave without restoring anything (another project opened). */
export function closeModuleView() {
  if (useModuleView.getState().path.length > 0) applyPath([]);
}

// the store leaves the module by itself when its folder goes away (undo, code edits, a reload)
useEditor.subscribe((state, prev) => {
  if (state.scope === prev.scope || state.scope !== null) return;
  if (useModuleView.getState().path.length > 0) useModuleView.setState({ path: [] });
});
