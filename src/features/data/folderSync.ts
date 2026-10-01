/**
 * Folder sync in the editor. A subscriber on the editor store (the store
 * itself is untouched): after each save the change is written through to the
 * linked folder; the folder is read again when its .tf files change on disk
 * (a `FileSystemObserver`, where the browser has one — src/lib/fsWatch.ts)
 * and whenever the window regains focus — changes made only on disk reload
 * the editor silently, changes on both sides open the conflict dialog. The
 * rules live in src/lib/fsSync.ts.
 */
import { create } from 'zustand';
import { confirmAction } from '@/components/Confirm';
import { showToast } from '@/components/Toast';
import { flushPendingSave, useEditor } from '@/features/editor/store';
import { messagesFor } from '@/i18n/messages';
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
  problemOf,
  syncableFiles,
  syncFolder,
  type ConflictInfo,
  type DirHandleLike,
  type FolderLink,
  type FolderProblem,
  type LinkPreview,
  type SyncIO,
  type SyncOptions,
  type SyncResult,
} from '@/lib/fsSync';
import { watchFolder, type FolderWatch } from '@/lib/fsWatch';
import { getProject, updateProject } from '@/lib/storage';
import { dataMessages } from './messages';

/** the messages in the UI language of the moment (toasts and confirmations) */
const text = () => messagesFor(dataMessages);

export type FolderStatus = 'off' | 'permission' | 'synced' | 'conflict' | 'missing' | 'error';

interface FolderSyncState {
  projectId: string | null;
  status: FolderStatus;
  /** a sync pass is running */
  busy: boolean;
  label: string | null;
  conflicts: ConflictInfo[];
  /** why syncing stopped — a reason, shown in the language picked at the time (`folderProblemText`) */
  error: FolderProblem | null;
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
/** live disk changes of the link's folder (null: this browser can't watch, the focus check does it) */
let watcher: FolderWatch | null = null;

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
    const m = text();
    const label = link?.label ?? m.theFolder;
    return confirmAction({
      title: names.length === 1 ? m.deleteOneFromFolder(names[0]!, label) : m.deleteManyFromFolder(names.length, label),
      body: m.deleteFromFolderBody(names),
      confirmLabel: m.deleteFromFolder,
      danger: true,
    });
  },
  saveLink: (next) => store.set(next),
};

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
      useFolderSync.setState({ status: 'missing', error: { kind: 'missing' } });
      break;
    case 'error':
      useFolderSync.setState({ status: 'error', error: result.problem });
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
    .catch((err: unknown): SyncResult => ({ status: 'error', problem: problemOf(err) }))
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

/** Look at the folder while the editor is on screen: a change on disk runs a pass (debounced by the watch). */
function watch(current: FolderLink) {
  unwatch();
  watcher = watchFolder(
    current.dir,
    () => {
      if (mounted > 0 && link === current && useFolderSync.getState().status !== 'permission') schedule(0);
    },
    { isActive: () => document.visibilityState === 'visible' },
  );
}

function unwatch() {
  watcher?.stop();
  watcher = null;
}

/** Load the link of the project the editor just opened. */
async function openProject(projectId: string | null) {
  link = null;
  unwatch();
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
  if (link === found) watch(found);
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
  const current = link;
  if (await requestFolderPermission(current.dir)) {
    if (link === current) watch(current);
    await runSync();
  } else showToast(text().needsPermission(current.label), 'error');
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
  unwatch();
  clearTimeout(timer);
  useFolderSync.setState({ ...OFF });
  await store.delete(projectId).catch(() => undefined);
  showToast(text().stoppedSyncing(current.label));
}

async function finishLink(dir: DirHandleLike, label: string, synced: Record<string, string>, allowRemove: string[]) {
  const { projectId } = useEditor.getState();
  if (!projectId) return;
  const next = createLink({ projectId, dir, label, synced });
  link = next;
  watch(next);
  useFolderSync.setState({ projectId, ...OFF, status: 'synced', label });
  try {
    await store.set(next);
  } catch {
    showToast(text().linkNotRemembered, 'error');
  }
  await runSync({ allowRemove });
  if (link === next && useFolderSync.getState().status === 'synced') showToast(text().syncedToast(label), 'success');
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
    showToast(text().cantOpenFolder, 'error');
    return;
  }
  if (!dir) return;
  flushPendingSave();

  const other = await findLinkByFolder(store, dir).catch(() => undefined);
  if (other && other.projectId !== projectId) {
    const owner = getProject(other.projectId);
    if (owner) {
      const m = text();
      const ok = await confirmAction({
        title: m.linkedElsewhere(dir.name, owner.name),
        body: m.linkInstead(owner.name),
        confirmLabel: m.linkHere,
      });
      if (!ok) return;
    }
    await store.delete(other.projectId).catch(() => undefined);
  }

  let disk: Record<string, string>;
  try {
    disk = (await readFolderFiles(dir)).files;
  } catch {
    showToast(text().cantRead(dir.name), 'error');
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
