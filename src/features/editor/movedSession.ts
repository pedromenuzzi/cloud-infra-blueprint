/**
 * What the editor remembers about `moved {}` blocks while a project is open:
 *
 *   - the blocks that were in the files when it was opened — history, maybe
 *     applied already, so never rewritten (see hcl/moved.ts); blocks written
 *     since are this session's and collapse;
 *   - whether renames and repetition changes keep the state (write a moved
 *     block): on by default when the project looks deployed (a remote
 *     backend, `moved` / `import` blocks), off for a design that has never
 *     been applied; the choice holds per project until the tab closes.
 */
import { create } from 'zustand';
import { looksDeployed, movedBlocks, movedKey, type MovedStatement } from '@/hcl/moved';
import { readLocalModule } from '@/ir/localModules';
import { moduleDirs } from '@/ir/modules';
import type { IR } from '@/ir/types';

let baseline = new Set<string>();
/** the root module while one of its local modules is open on the canvas (whether it looks deployed counts there too) */
let openedFrom: IR | null = null;

/** called when a project is loaded: its moved blocks become history, its local modules' included */
export function startMovedSession(ir: IR, files: Record<string, string> = {}) {
  const keys = movedBlocks(ir).map(movedKey);
  for (const dir of moduleDirs(files)) {
    const child = readLocalModule(files, dir);
    if (child) keys.push(...movedBlocks(child.ir).map(movedKey));
  }
  baseline = new Set(keys);
}

/** the root module's IR while a local module is open (null: the root module is on the canvas) */
export function noteRootIr(root: IR | null) {
  openedFrom = root;
}

export const isHistoryMove = (m: MovedStatement) => baseline.has(movedKey(m));

interface KeepState {
  byProject: Record<string, boolean>;
  set(projectId: string, keep: boolean): void;
}

export const useKeepState = create<KeepState>((set) => ({
  byProject: {},
  set: (projectId, keep) => set((s) => ({ byProject: { ...s.byProject, [projectId]: keep } })),
}));

/** the keep-state choice for a project: the user's, else what the project looks like */
export function keepStateFor(byProject: Record<string, boolean>, projectId: string | null, ir: IR): boolean {
  // inside an opened module, a deployed root (a remote backend…) deploys the module too
  return (projectId !== null ? byProject[projectId] : undefined) ?? (looksDeployed(ir) || (openedFrom !== null && openedFrom !== ir && looksDeployed(openedFrom)));
}
