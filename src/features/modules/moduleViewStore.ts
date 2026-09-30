/**
 * Which child module is opened over the canvas, if any — a path of folders
 * from the root module (`root › service › ecr`). Always loaded (the canvas
 * and the menus open it); the view itself loads on first use.
 */
import { create } from 'zustand';
import { useEditor } from '@/features/editor/store';

export interface OpenedModule {
  /** project folder, `modules/network` */
  dir: string;
  /** the module call's name, as the breadcrumb shows it */
  name: string;
}

interface ModuleViewState {
  /** innermost last; empty: the root module's canvas */
  path: OpenedModule[];
  /** what was selected on the root canvas: the inspector steps aside while a module is open, and comes back */
  returnTo: string | null;
}

export const useModuleView = create<ModuleViewState>(() => ({ path: [], returnTo: null }));

/** Open a module: from the root canvas it's the first step, from an opened module one level deeper. */
export function openModuleView(dir: string, name: string, options: { nested?: boolean } = {}) {
  const { path } = useModuleView.getState();
  if (options.nested && path.length > 0) {
    useModuleView.setState({ path: [...path, { dir, name }] });
    return;
  }
  const editor = useEditor.getState();
  useModuleView.setState({ path: [{ dir, name }], returnTo: path.length > 0 ? useModuleView.getState().returnTo : editor.selection });
  if (editor.selection) editor.setSelection(null);
}

/** Back to `depth` levels open (0: the root canvas, where the selection comes back). */
export function moduleViewTo(depth: number) {
  const { path, returnTo } = useModuleView.getState();
  const next = path.slice(0, Math.max(0, depth));
  useModuleView.setState({ path: next, ...(next.length === 0 ? { returnTo: null } : {}) });
  if (next.length === 0 && path.length > 0 && returnTo) {
    const { ir, setSelection } = useEditor.getState();
    if (ir.modules.some((m) => m.id === returnTo) || ir.resources.some((r) => r.id === returnTo)) setSelection(returnTo);
  }
}

/** One level up (to the root canvas from a first-level module). */
export function moduleViewBack() {
  moduleViewTo(useModuleView.getState().path.length - 1);
}

/** Leave without restoring anything (another project opened). */
export function closeModuleView() {
  if (useModuleView.getState().path.length > 0) useModuleView.setState({ path: [], returnTo: null });
}
