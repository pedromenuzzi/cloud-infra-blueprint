/**
 * The editor's folder-sync indicator ("Synced to infra"), mounted in the
 * top bar with one line, plus the dialogs folder sync needs: both sides
 * changed, linking to a folder that already holds Terraform, and the
 * explanation for browsers without the File System Access API.
 */
import {
  AlertTriangle,
  FileArchive,
  FolderCheck,
  FolderSync,
  FolderX,
  Loader2,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ContextMenu } from '@/components/ContextMenu';
import { showToast } from '@/components/Toast';
import { Button, Modal } from '@/components/ui';
import { useEditor } from '@/features/editor/store';
import { exportZip } from '@/lib/download';
import type { ConflictInfo, Side } from '@/lib/fsSync';
import { cn, timeAgo } from '@/lib/utils';
import {
  attachFolderSync,
  closeUnsupported,
  reconnectFolder,
  resolveFolderConflicts,
  setConflictDialog,
  settlePendingLink,
  startFolderLink,
  syncNow,
  unlinkFolder,
  useFolderSync,
} from './folderSync';
import { warmOfflineCache } from './pwa';

const SIDE_TEXT: Record<Side, string> = {
  added: 'added',
  changed: 'changed',
  deleted: 'deleted',
  same: 'unchanged',
};

function conflictText(c: ConflictInfo): string {
  return `${SIDE_TEXT[c.app]} here · ${SIDE_TEXT[c.disk]} in the folder`;
}

function FileList({ label, names, tone }: { label: string; names: string[]; tone?: 'danger' | 'warning' }) {
  if (names.length === 0) return null;
  return (
    <div className="text-[12.5px]">
      <span className={cn('font-medium', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')}>
        {label}:
      </span>{' '}
      <span className="break-words font-mono text-[12px]">{names.join(', ')}</span>
    </div>
  );
}

function ConflictDialog() {
  const open = useFolderSync((s) => s.conflictOpen && s.status === 'conflict');
  const conflicts = useFolderSync((s) => s.conflicts);
  const label = useFolderSync((s) => s.label);
  const bodyId = useId();
  const emptied = conflicts.length > 0 && conflicts.every((c) => c.disk === 'deleted');
  return (
    <Modal
      open={open}
      onClose={() => setConflictDialog(false)}
      role="alertdialog"
      label={emptied ? `The Terraform files are gone from “${label}”` : `“${label}” and the editor both changed`}
      describedBy={bodyId}
    >
      <div className="p-5 max-sm:p-4">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/12 text-warning">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-[15px] font-semibold">
              {emptied ? `The Terraform files are gone from “${label}”` : `“${label}” and the editor both changed`}
            </h2>
            <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-muted">
              {emptied
                ? 'The folder may have been moved or emptied. Nothing was changed here. Write the project back to the folder, or take its (empty) state into the project.'
                : 'These files changed in the folder and in Cloud Blueprint since the last sync. Nothing is written until you choose which version to keep.'}
            </p>
          </div>
        </div>
        <ul className="mt-4 divide-y rounded-md border text-[12.5px]">
          {conflicts.map((c) => (
            <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
              <span className="font-mono text-[12px] font-semibold">{c.name}</span>
              <span className="text-muted">{conflictText(c)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConflictDialog(false)} title="Syncing waits until you choose">
            Later
          </Button>
          <Button variant="outline" onClick={() => resolveFolderConflicts('disk')}>
            {emptied ? 'Empty the project' : 'Use folder version'}
          </Button>
          <Button onClick={() => resolveFolderConflicts('app')}>
            {emptied ? 'Write project to folder' : 'Keep editor version'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** "Overwrites main.tf and deletes network.tf in the folder." */
function writeSummary(differ: string[], diskOnly: string[]): string {
  const parts = [
    differ.length > 0 ? `overwrites ${differ.join(', ')}` : '',
    diskOnly.length > 0 ? `deletes ${diskOnly.join(', ')}` : '',
  ].filter(Boolean);
  const text = `${parts.join(' and ')} in the folder.`;
  return text[0]!.toUpperCase() + text.slice(1);
}

function LinkChoiceDialog() {
  const pending = useFolderSync((s) => s.pendingLink);
  const bodyId = useId();
  const preview = pending?.preview;
  const title = pending ? `“${pending.label}” already has Terraform files` : '';
  return (
    <Modal open={pending !== null} onClose={() => void settlePendingLink(null)} label={title} describedBy={bodyId}>
      {pending && preview ? (
        <div className="p-5 max-sm:p-4">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <FolderSync className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="break-words text-[15px] font-semibold">{title}</h2>
              <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-muted">
                They differ from this project. Choose which side the folder sync starts from.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-1 rounded-md border bg-surface-2/40 px-3 py-2.5">
            <FileList label="Different" names={preview.differ} tone="warning" />
            <FileList label="Only in the folder" names={preview.diskOnly} />
            <FileList label="Only in this project" names={preview.appOnly} />
            <FileList label="Identical" names={preview.same} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void settlePendingLink('disk')}
              className="rounded-md border bg-surface-1 p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-[13px] font-semibold">Load the folder into the project</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                The project’s files are replaced by the folder’s. Nothing on disk changes.
              </span>
            </button>
            <button
              type="button"
              onClick={() => void settlePendingLink('app')}
              className="rounded-md border bg-surface-1 p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-[13px] font-semibold">Write this project to the folder</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                {writeSummary(preview.differ, preview.diskOnly)}
              </span>
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => void settlePendingLink(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function UnsupportedDialog() {
  const open = useFolderSync((s) => s.unsupportedOpen);
  const bodyId = useId();
  return (
    <Modal open={open} onClose={closeUnsupported} label="Folder sync needs Chrome or Edge" describedBy={bodyId}>
      <div className="p-5 max-sm:p-4">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <FolderSync className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Folder sync needs Chrome or Edge</h2>
            <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-muted">
              Keeping a project in sync with a folder on your disk uses the File System Access API, which this browser
              doesn’t offer. You can still download the project as Terraform files, and import a folder by dropping it
              on the dashboard.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={closeUnsupported}>
            Close
          </Button>
          <Button
            onClick={() => {
              const { projectName, files } = useEditor.getState();
              exportZip(projectName, files);
              closeUnsupported();
              showToast('Terraform zip downloaded', 'success');
            }}
          >
            <FileArchive className="h-4 w-4" /> Download .zip instead
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const CHIP =
  'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** "Synced to <folder>" in the top bar, and the folder-sync dialogs. */
export function FolderSyncStatus() {
  const status = useFolderSync((s) => s.status);
  const busy = useFolderSync((s) => s.busy);
  const label = useFolderSync((s) => s.label);
  const error = useFolderSync((s) => s.error);
  const syncedAt = useFolderSync((s) => s.syncedAt);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => attachFolderSync(), []);
  // the editor works offline once its lazy chunks are cached: fetch them while idle
  useEffect(() => warmOfflineCache(), []);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 6 });
  };

  let chip: React.ReactNode = null;
  if (status === 'synced') {
    chip = (
      <button
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={`Synced to folder ${label}`}
        title={`Saves go to the .tf files in “${label}”${syncedAt ? ` · last synced ${timeAgo(syncedAt)}` : ''}`}
        className={cn(CHIP, 'border-transparent text-faint hover:border-border hover:text-muted')}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FolderCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        )}
        <span className="hidden max-w-36 truncate xl:inline">Synced to {label}</span>
      </button>
    );
  } else if (status === 'permission') {
    chip = (
      <button
        type="button"
        onClick={() => void reconnectFolder()}
        title={`Allow Cloud Blueprint to edit “${label}” again to keep it in sync`}
        aria-label={`Reconnect folder ${label}`}
        className={cn(CHIP, 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15')}
      >
        <FolderSync className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden max-w-36 truncate md:inline">Reconnect {label}</span>
      </button>
    );
  } else if (status === 'conflict') {
    chip = (
      <button
        type="button"
        onClick={() => setConflictDialog(true)}
        aria-label={`Folder ${label}: changed on both sides — choose a version`}
        title="The folder and the editor both changed — choose which to keep"
        className={cn(CHIP, 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15')}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Sync conflict</span>
      </button>
    );
  } else if (status === 'missing' || status === 'error') {
    chip = (
      <button
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={`Folder sync paused: ${error ?? 'error'}`}
        title={error ?? undefined}
        className={cn(CHIP, 'border-danger/35 bg-danger/8 text-danger hover:bg-danger/12')}
      >
        <FolderX className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Sync paused</span>
      </button>
    );
  }

  return (
    <>
      {chip}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Folder sync"
          onClose={() => setMenu(null)}
          entries={[
            { id: 'sync', label: status === 'synced' ? 'Sync now' : 'Try again', icon: RefreshCw, onSelect: syncNow },
            { id: 'relink', label: 'Link another folder…', icon: FolderSync, onSelect: () => void startFolderLink() },
            'separator',
            { id: 'unlink', label: 'Stop syncing', icon: Unlink, danger: true, onSelect: () => void unlinkFolder() },
          ]}
        />
      ) : null}
      <ConflictDialog />
      <LinkChoiceDialog />
      <UnsupportedDialog />
    </>
  );
}
