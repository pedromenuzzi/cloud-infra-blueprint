/**
 * Folder sync in the editor. A subscriber on the editor store (the store
 * itself is untouched): after each save the change is written through to the
 * linked folder; when the window regains focus the folder is read again —
 * changes made only on disk reload the editor silently, changes on both
 * sides open the conflict dialog. The rules live in src/lib/fsSync.ts.
 */
import { create } from 'zustand';
import { confirmAction } from '@/components/Confirm';
import { showToast } from '@/components/Toast';
import { flushPendingSave, useEditor } from '@/features/editor/store';
import {
  baselineFor,
  createLink,
  findLinkByFolder,
  hasFolderPermission,
  idbLinkStore,
  isFolderSyncSupported,
  linkNeedsChoice,
  pickFolder,
  previewLink,
  readFolderFiles,
  requestFolderPermission,
  syncableFiles,
  syncFolder,
  type ConflictInfo,
  type DirHandleLike,
  type FolderLink,
  type LinkPreview,
  type SyncIO,
  type SyncOptions,
  type SyncResult,
} from '@/lib/fsSync';
import { getProject, updateProject } from '@/lib/storage';

export type FolderStatus = 'off' | 'permission' | 'synced' | 'conflict' | 'missing' | 'error';

interface FolderSyncState {
  projectId: string | null;
  status: FolderStatus;
  /** a sync pass is running */
  busy: boolean;
  label: string | null;
  conflicts: ConflictInfo[];
  error: string | null;
  syncedAt: string | null;
  conflictOpen: boolean;
  /** linking to a folder that already holds other Terraform: waiting for the user's choice */
  pendingLink: { dir: DirHandleLike; label: string; preview: LinkPreview; disk: Record<string, string> } | null;
  /** "Folder sync needs Chrome or Edge" */
  unsupportedOpen: boolean;
}

const OFF = {
  status: 'off' as const,
  busy: false,
  label: null,
  conflicts: [],
  error: null,
  syncedAt: null,
  conflictOpen: false,
};

export const useFolderSync = create<FolderSyncState>(() => ({
  projectId: null,
  ...OFF,
  pendingLink: null,
  unsupportedOpen: false,
}));

const store = idbLinkStore;
/** the open project's link (the in-memory copy is the one this tab trusts) */
let link: FolderLink | null = null;
let running: Promise<void> | null = null;
let queued: SyncOptions | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** editor files as of the last sync or reload: a save only syncs when they changed */
let lastFiles: Record<string, string> | null = null;
/** the editor is reloading what a sync just took from disk */
let loading = false;

const io: SyncIO = {
  appFiles: () => useEditor.getState().files,
  setAppFiles(files) {
    const { projectId } = useEditor.getState();
    const current = projectId ? getProject(projectId) : undefined;
    if (!projectId || !current) return false;
    const result = updateProject(projectId, { files }, { expectedRev: current.rev ?? 0 });
    if (!result.ok) return false;
    loading = true;
    try {
      useEditor.getState().load(result.project, { keepView: true });
    } finally {
      loading = false;
    }
    lastFiles = useEditor.getState().files;
    return true;
  },
  confirmRemove(names) {
    const label = link?.label ?? 'the folder';
    return confirmAction({
      title: names.length === 1 ? `Delete “${names[0]}” from “${label}”?` : `Delete ${names.length} files from “${label}”?`,
      body:
        `${names.length === 1 ? 'It was' : `${names.join(', ')} were`} removed from the project, but Cloud Blueprint ` +
        'didn’t create it on disk. Cancel keeps the file in the folder (it just stops syncing).',
      confirmLabel: 'Delete from folder',
      danger: true,
    });
  },
  saveLink: (next) => store.set(next),
};

function describeError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The folder could not be read or written';
}

function applyResult(result: SyncResult) {
  const prev = useFolderSync.getState();
  switch (result.status) {
    case 'synced':
      // changes that came from disk were loaded silently: they're the user's own
      useFolderSync.setState({ status: 'synced', syncedAt: link?.syncedAt ?? null, conflicts: [], conflictOpen: false, error: null });
      break;
    case 'conflict': {
      const same =
        prev.status === 'conflict' &&
        prev.conflicts.map((c) => c.name).join('\n') === result.conflicts.map((c) => c.name).join('\n');
      // a pass during an open question doesn't re-open a dialog the user put aside
      useFolderSync.setState({ status: 'conflict', conflicts: result.conflicts, conflictOpen: same ? prev.conflictOpen : true });
      break;
    }
    case 'permission':
      useFolderSync.setState({ status: 'permission' });
      break;
    case 'missing':
      useFolderSync.setState({ status: 'missing', error: 'The folder was moved, renamed or deleted' });
      break;
    case 'error':
      useFolderSync.setState({ status: 'error', error: result.message });
      break;
  }
}

/** One pass at a time; a request during a pass runs right after it. */
function runSync(options: SyncOptions = {}): Promise<void> {
  const current = link;
  if (!current) return Promise.resolve();
  if (running) {
    queued = { ...queued, ...options };
    return running;
  }
  clearTimeout(timer);
  useFolderSync.setState({ busy: true });
  lastFiles = useEditor.getState().files;
  running = syncFolder(current, io, options)
    .catch((err: unknown): SyncResult => ({ status: 'error', message: describeError(err) }))
    .then((result) => {
      if (link === current) applyResult(result);
    })
    .finally(() => {
      running = null;
      useFolderSync.setState({ busy: false });
      if (queued) {
        const next = queued;
        queued = null;
        void runSync(next);
      }
    });
  return running;
}

function schedule(delay = 300) {
  if (!link) return;
  clearTimeout(timer);
  timer = setTimeout(() => void runSync(), delay);
}

/** Load the link of the project the editor just opened. */
async function openProject(projectId: string | null) {
  link = null;
  clearTimeout(timer);
  useFolderSync.setState({ projectId, ...OFF });
  if (!projectId || !isFolderSyncSupported()) return;
  let found: FolderLink | undefined;
  try {
    found = await store.get(projectId);
  } catch {
    return;
  }
  if (!found || useEditor.getState().projectId !== projectId) return;
  link = found;
  useFolderSync.setState({ label: found.label, syncedAt: found.syncedAt, status: 'synced' });
  if (!(await hasFolderPermission(found.dir))) {
    if (link === found) useFolderSync.setState({ status: 'permission' });
    return;
  }
  await runSync();
}

let attached = false;
let mounted = 0;

/** Start listening to the editor (idempotent). Returns the unmount for the indicator. */
export function attachFolderSync(): () => void {
  mounted += 1;
  if (!attached) {
    attached = true;
    let project = useEditor.getState().projectId;
    lastFiles = useEditor.getState().files;
    void openProject(project);
    useEditor.subscribe((state) => {
      if (state.projectId !== project) {
        project = state.projectId;
        lastFiles = state.files;
        void openProject(project);
        return;
      }
      // write-through: once an edit is saved in the browser, it goes to the folder too
      if (link && !loading && state.saveState === 'saved' && state.files !== lastFiles) {
        lastFiles = state.files;
        schedule();
      }
    });
    // back from another app (maybe an editor that changed the files): look again
    const check = () => {
      if (mounted > 0 && link && document.visibilityState === 'visible' && useFolderSync.getState().status !== 'permission') {
        schedule(0);
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
  } else if (useEditor.getState().projectId !== useFolderSync.getState().projectId) {
    void openProject(useEditor.getState().projectId);
  }
  return () => {
    mounted -= 1;
  };
}

/* ------------------------------------------------------------- actions */

export function syncNow() {
  void runSync();
}

/** After a reload the browser forgets the permission: ask again (from a click). */
export async function reconnectFolder() {
  if (!link) return;
  if (await requestFolderPermission(link.dir)) await runSync();
  else showToast(`Cloud Blueprint needs permission to edit “${link.label}” to keep it in sync`, 'error');
}

export function resolveFolderConflicts(side: 'app' | 'disk') {
  useFolderSync.setState({ conflictOpen: false });
  void runSync({ resolve: side });
}

export function setConflictDialog(open: boolean) {
  useFolderSync.setState({ conflictOpen: open });
}

export async function unlinkFolder() {
  const current = link;
  const { projectId } = useFolderSync.getState();
  if (!current || !projectId) return;
  link = null;
  clearTimeout(timer);
  useFolderSync.setState({ ...OFF });
  await store.delete(projectId).catch(() => undefined);
  showToast(`Stopped syncing with “${current.label}” — its files stay as they are`);
}

async function finishLink(dir: DirHandleLike, label: string, synced: Record<string, string>, allowRemove: string[]) {
  const { projectId } = useEditor.getState();
  if (!projectId) return;
  const next = createLink({ projectId, dir, label, synced });
  link = next;
  useFolderSync.setState({ projectId, ...OFF, status: 'synced', label });
  try {
    await store.set(next);
  } catch {
    showToast('The folder link can’t be remembered in this browser — it lasts until you reload', 'error');
  }
  await runSync({ allowRemove });
  if (link === next && useFolderSync.getState().status === 'synced') showToast(`Synced to “${label}”`, 'success');
}

/** "Sync with folder…" in the editor: pick a folder and link the open project to it. */
export async function startFolderLink() {
  if (!isFolderSyncSupported()) {
    useFolderSync.setState({ unsupportedOpen: true });
    return;
  }
  const { projectId } = useEditor.getState();
  if (!projectId) return;
  let dir: DirHandleLike | null;
  try {
    dir = await pickFolder();
  } catch {
    showToast('That folder can’t be opened here', 'error');
    return;
  }
  if (!dir) return;
  flushPendingSave();

  const other = await findLinkByFolder(store, dir).catch(() => undefined);
  if (other && other.projectId !== projectId) {
    const owner = getProject(other.projectId);
    if (owner) {
      const ok = await confirmAction({
        title: `“${dir.name}” is linked to “${owner.name}”`,
        body: `Link it to this project instead? “${owner.name}” stops syncing with the folder (nothing is deleted).`,
        confirmLabel: 'Link to this project',
      });
      if (!ok) return;
    }
    await store.delete(other.projectId).catch(() => undefined);
  }

  let disk: Record<string, string>;
  try {
    disk = (await readFolderFiles(dir)).files;
  } catch {
    showToast(`“${dir.name}” can’t be read`, 'error');
    return;
  }
  const app = syncableFiles(useEditor.getState().files);
  const preview = previewLink(app, disk);
  if (linkNeedsChoice(preview)) {
    useFolderSync.setState({ pendingLink: { dir, label: dir.name, preview, disk } });
    return;
  }
  await finishLink(dir, dir.name, baselineFor('app', app, disk), []);
}

/** The choice for a folder that already holds other Terraform (null = cancel). */
export async function settlePendingLink(side: 'app' | 'disk' | null) {
  const pending = useFolderSync.getState().pendingLink;
  useFolderSync.setState({ pendingLink: null });
  if (!pending || !side) return;
  const app = syncableFiles(useEditor.getState().files);
  await finishLink(pending.dir, pending.label, baselineFor(side, app, pending.disk), side === 'app' ? pending.preview.diskOnly : []);
}

export function closeUnsupported() {
  useFolderSync.setState({ unsupportedOpen: false });
}
