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
import { openProjectRootPath, useEditor } from '@/features/editor/store';
import { messagesFor, useMessages } from '@/i18n/messages';
import { exportZip } from '@/lib/download';
import { folderProblemText, type ConflictInfo, type Side } from '@/lib/fsSync';
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
import { dataMessages } from './messages';
import { warmOfflineCache } from './pwa';

type Text = (typeof dataMessages)['en'];

function sideText(side: Side, m: Text): string {
  return side === 'added' ? m.sideAdded : side === 'changed' ? m.sideChanged : side === 'deleted' ? m.sideDeleted : m.sideSame;
}

function conflictText(c: ConflictInfo, m: Text): string {
  return m.conflictSides(sideText(c.app, m), sideText(c.disk, m));
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
  const label = useFolderSync((s) => s.label) ?? '';
  const bodyId = useId();
  const m = useMessages(dataMessages);
  const emptied = conflicts.length > 0 && conflicts.every((c) => c.disk === 'deleted');
  const title = emptied ? m.filesGone(label) : m.bothChanged(label);
  return (
    <Modal open={open} onClose={() => setConflictDialog(false)} role="alertdialog" label={title} describedBy={bodyId}>
      <div className="p-5 max-sm:p-4">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/12 text-warning">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-[15px] font-semibold">{title}</h2>
            <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-muted">
              {emptied ? m.filesGoneBody : m.bothChangedBody}
            </p>
          </div>
        </div>
        <ul className="mt-4 divide-y rounded-md border text-[12.5px]">
          {conflicts.map((c) => (
            <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
              <span className="font-mono text-[12px] font-semibold">{c.name}</span>
              <span className="text-muted">{conflictText(c, m)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConflictDialog(false)} title={m.laterHint}>
            {m.later}
          </Button>
          <Button variant="outline" onClick={() => resolveFolderConflicts('disk')}>
            {emptied ? m.emptyProject : m.useFolderVersion}
          </Button>
          <Button onClick={() => resolveFolderConflicts('app')}>
            {emptied ? m.writeToFolder : m.keepEditorVersion}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LinkChoiceDialog() {
  const pending = useFolderSync((s) => s.pendingLink);
  const bodyId = useId();
  const m = useMessages(dataMessages);
  const preview = pending?.preview;
  const title = pending ? m.alreadyHasTerraform(pending.label) : '';
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
                {m.differBody}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-1 rounded-md border bg-surface-2/40 px-3 py-2.5">
            <FileList label={m.listDifferent} names={preview.differ} tone="warning" />
            <FileList label={m.listFolderOnly} names={preview.diskOnly} />
            <FileList label={m.listProjectOnly} names={preview.appOnly} />
            <FileList label={m.listIdentical} names={preview.same} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void settlePendingLink('disk')}
              className="rounded-md border bg-surface-1 p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-[13px] font-semibold">{m.loadFolder}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">{m.loadFolderHint}</span>
            </button>
            <button
              type="button"
              onClick={() => void settlePendingLink('app')}
              className="rounded-md border bg-surface-1 p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-[13px] font-semibold">{m.writeProject}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                {m.writeSummary(preview.differ, preview.diskOnly)}
              </span>
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => void settlePendingLink(null)}>
              {m.cancel}
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
  const m = useMessages(dataMessages);
  return (
    <Modal open={open} onClose={closeUnsupported} label={m.needsChromium} describedBy={bodyId}>
      <div className="p-5 max-sm:p-4">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <FolderSync className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{m.needsChromium}</h2>
            <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-muted">
              {m.needsChromiumBody}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={closeUnsupported}>
            {m.close}
          </Button>
          <Button
            onClick={() => {
              const { projectName, files } = useEditor.getState();
              exportZip(projectName, files, { rootPath: openProjectRootPath() });
              closeUnsupported();
              showToast(messagesFor(dataMessages).zipDownloaded, 'success');
            }}
          >
            <FileArchive className="h-4 w-4" /> {m.downloadZipInstead}
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
  const label = useFolderSync((s) => s.label) ?? '';
  const problem = useFolderSync((s) => s.error);
  const syncedAt = useFolderSync((s) => s.syncedAt);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // the chip stays on screen while the language changes: text comes from reasons, not stored sentences
  const m = useMessages(dataMessages);
  const error = problem ? folderProblemText(problem) : null;

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
        aria-label={m.syncedToFolder(label)}
        title={m.savesGoTo(label, syncedAt ? timeAgo(syncedAt) : null)}
        className={cn(CHIP, 'border-transparent text-faint hover:border-border hover:text-muted')}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FolderCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        )}
        <span className="hidden max-w-36 truncate xl:inline">{m.syncedTo(label)}</span>
      </button>
    );
  } else if (status === 'permission') {
    chip = (
      <button
        type="button"
        onClick={() => void reconnectFolder()}
        title={m.allowAgain(label)}
        aria-label={m.reconnectFolder(label)}
        className={cn(CHIP, 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15')}
      >
        <FolderSync className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden max-w-36 truncate md:inline">{m.reconnect(label)}</span>
      </button>
    );
  } else if (status === 'conflict') {
    chip = (
      <button
        type="button"
        onClick={() => setConflictDialog(true)}
        aria-label={m.conflictLabel(label)}
        title={m.conflictTitle}
        className={cn(CHIP, 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15')}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden md:inline">{m.syncConflict}</span>
      </button>
    );
  } else if (status === 'missing' || status === 'error') {
    chip = (
      <button
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={m.pausedLabel(error ?? m.error)}
        title={error ?? undefined}
        className={cn(CHIP, 'border-danger/35 bg-danger/8 text-danger hover:bg-danger/12')}
      >
        <FolderX className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden md:inline">{m.syncPaused}</span>
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
          label={m.folderSync}
          onClose={() => setMenu(null)}
          entries={[
            { id: 'sync', label: status === 'synced' ? m.syncNow : m.tryAgain, icon: RefreshCw, onSelect: syncNow },
            { id: 'relink', label: m.linkAnother, icon: FolderSync, onSelect: () => void startFolderLink() },
            'separator',
            { id: 'unlink', label: m.stopSyncing, icon: Unlink, danger: true, onSelect: () => void unlinkFolder() },
          ]}
        />
      ) : null}
      <ConflictDialog />
      <LinkChoiceDialog />
      <UnsupportedDialog />
    </>
  );
}
