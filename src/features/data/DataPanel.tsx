/**
 * "Your data" on the dashboard: the storage meter (with a nudge at 70%),
 * persistent-storage request, backup of every project and restore from a
 * backup. The dialogs and the backup code load on first use.
 */
import {
  AlertTriangle,
  ArchiveRestore,
  CloudOff,
  DatabaseBackup,
  FolderSync,
  HardDrive,
  ShieldCheck,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { showToast } from '@/components/Toast';
import { Button } from '@/components/ui';
import { messagesFor, useMessages } from '@/i18n/messages';
import type { Project } from '@/lib/storage';
import { cn, timeAgo } from '@/lib/utils';
import { downloadBackup, lastBackupAt } from './backupActions';
import { openRestore, useDataDialogs } from './dataDialogs';
import { dataMessages } from './messages';
import { formatBytes, type Meter } from './meter';
import { usePwa, warmOfflineCache } from './pwa';
import { useOpenFolder } from './OpenFolderButton';
import { useStorageMeter } from './useStorageMeter';

const RestoreDialog = lazy(() => import('./RestoreDialog'));
const FreeSpaceDialog = lazy(() => import('./FreeSpaceDialog'));

async function backUp(): Promise<string | null> {
  try {
    const done = await downloadBackup();
    if (!done) {
      showToast(messagesFor(dataMessages).nothingToBackUp);
      return null;
    }
    showToast(messagesFor(dataMessages).backupDownloaded(done.count), 'success');
    return done.fileName;
  } catch {
    showToast(messagesFor(dataMessages).backupFailed, 'error');
    return null;
  }
}

async function backUpAndFreeSpace() {
  const name = await backUp();
  if (name) useDataDialogs.setState({ freeSpace: name });
}

const LEVEL_BAR: Record<Meter['level'], string> = {
  ok: 'bg-primary',
  nudge: 'bg-warning',
  full: 'bg-danger-solid',
};

function StorageBar({ meter, label }: { meter: Meter; label: string }) {
  const { used, total } = meter.binding === 'origin' && meter.origin ? meter.origin : meter.local;
  const m = useMessages(dataMessages);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={meter.percent}
      aria-valuetext={m.meterValue(meter.percent, formatBytes(used), formatBytes(total))}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', LEVEL_BAR[meter.level])}
        // a sliver stays visible at 0% so the bar reads as a meter
        style={{ width: `${Math.max(1.5, meter.ratio * 100)}%` }}
      />
    </div>
  );
}

/** Opens the restore flow for a chosen file (a hidden file input lives in the panel). */
function useRestorePicker() {
  const input = useRef<HTMLInputElement>(null);
  const m = useMessages(dataMessages);
  const element = (
    <input
      ref={input}
      type="file"
      accept=".zip,application/zip"
      className="hidden"
      aria-label={m.restoreInput}
      data-testid="restore-input"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) openRestore(file);
      }}
    />
  );
  return { open: () => input.current?.click(), element };
}

export function DataPanel({ projects, onChanged }: { projects: Project[]; onChanged(): void }) {
  const headingId = useId();
  const { meter, persisted, canPersist, requestPersist } = useStorageMeter(projects);
  const offlineReady = usePwa((s) => s.offlineReady);
  const restoreFile = useDataDialogs((s) => s.restore);
  const freeSpace = useDataDialogs((s) => s.freeSpace);
  const [askedPersist, setAskedPersist] = useState(false);
  const [lastBackup, setLastBackup] = useState(lastBackupAt);
  const picker = useRestorePicker();
  const folder = useOpenFolder();
  const m = useMessages(dataMessages);

  // the editor (Monaco, ELK) works offline once cached: fetch it while idle
  useEffect(() => warmOfflineCache(), []);

  const local = meter.local;
  return (
    <section className="mt-10" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-[11px] font-bold uppercase tracking-wider text-faint">
        {m.yourData}
      </h2>
      <div className="grid overflow-hidden rounded-[14px] border bg-surface-1 shadow-xs md:grid-cols-2">
        {/* storage */}
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted" aria-hidden="true" />
            <h3 className="text-[13.5px] font-semibold">{m.browserStorage}</h3>
            <span
              className={cn(
                'ml-auto whitespace-nowrap text-[12px] font-semibold tabular-nums',
                meter.level === 'ok' ? 'text-muted' : meter.level === 'nudge' ? 'text-warning' : 'text-danger',
              )}
            >
              {m.percentUsed(meter.percent)}
            </span>
          </div>
          <div className="mt-3">
            <StorageBar meter={meter} label={m.storageUsedLabel} />
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {m.projectsUsageBefore}
            <span className="font-medium text-foreground">{formatBytes(local.used)}</span>
            {m.projectsUsageAfter(formatBytes(local.total))}
          </p>
          {meter.origin ? (
            <p className="mt-0.5 text-[12px] text-faint">
              {meter.origin.used > 0 ? m.originUsed(formatBytes(meter.origin.used)) : ''}
              {m.originFree(formatBytes(meter.origin.free))}
            </p>
          ) : null}
          {meter.level !== 'ok' ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void backUpAndFreeSpace()}>
              <DatabaseBackup className="h-3.5 w-3.5" /> {m.backUpAndFree}
            </Button>
          ) : null}
          {canPersist ? (
            <div className="mt-4 border-t pt-3.5">
              {persisted ? (
                <p className="flex items-start gap-2 text-[12px] text-muted">
                  <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                  <span>
                    <span className="font-medium text-foreground">{m.protectedTitle}</span>
                    {m.protectedBody}
                  </span>
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const granted = await requestPersist();
                      setAskedPersist(true);
                      const text = messagesFor(dataMessages);
                      showToast(granted ? text.persistGranted : text.persistDeclined, granted ? 'success' : 'info');
                    }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> {m.keepMyData}
                  </Button>
                  <p className="min-w-0 flex-1 basis-56 text-[12px] leading-snug text-muted">
                    {askedPersist ? m.persistDeclinedHint : m.persistHint}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* backup */}
        <div className="border-t p-4 sm:p-5 md:border-l md:border-t-0">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-muted" aria-hidden="true" />
            <h3 className="text-[13.5px] font-semibold">{m.backup}</h3>
            <span className="ml-auto text-[12px] text-faint">
              {lastBackup ? m.lastBackup(timeAgo(lastBackup)) : m.noBackupYet}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{m.backupBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={projects.length === 0}
              onClick={async () => {
                if (await backUp()) setLastBackup(lastBackupAt());
              }}
            >
              <DatabaseBackup className="h-3.5 w-3.5" /> {m.backUpAll}
            </Button>
            <Button variant="outline" size="sm" onClick={picker.open}>
              <ArchiveRestore className="h-3.5 w-3.5" /> {m.restoreFromBackup}
            </Button>
            {picker.element}
          </div>
          <ul className="mt-4 space-y-1.5 border-t pt-3.5 text-[12px] text-muted">
            <li className="flex items-start gap-2">
              <CloudOff className="mt-px h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
              <span>{offlineReady ? m.offlineReady : m.offlineLater}</span>
            </li>
            <li className="flex items-start gap-2">
              <FolderSync className="mt-px h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
              {folder.supported ? (
                <span>
                  <button
                    type="button"
                    onClick={folder.open}
                    disabled={folder.busy}
                    className="font-medium text-primary hover:text-primary-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                  >
                    {m.openFolder}
                  </button>
                  {m.openFolderAfter}
                </span>
              ) : (
                <span>{m.folderUnsupported}</span>
              )}
            </li>
          </ul>
        </div>
      </div>

      {restoreFile ? (
        <Suspense fallback={null}>
          <RestoreDialog
            file={restoreFile}
            onClose={() => useDataDialogs.setState({ restore: null })}
            onRestored={({ added, replaced }) => {
              useDataDialogs.setState({ restore: null });
              showToast(messagesFor(dataMessages).restored(added + replaced, replaced), 'success');
              onChanged();
            }}
          />
        </Suspense>
      ) : null}
      {freeSpace ? (
        <Suspense fallback={null}>
          <FreeSpaceDialog
            backupName={freeSpace}
            onClose={() => useDataDialogs.setState({ freeSpace: null })}
            onDeleted={(count) => {
              useDataDialogs.setState({ freeSpace: null });
              if (count > 0) showToast(messagesFor(dataMessages).deletedToBackup(count), 'success');
              onChanged();
            }}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

const NUDGE_DISMISSED_KEY = 'cb-storage-nudge-dismissed';

function dismissedAt(): number {
  try {
    return Number(sessionStorage.getItem(NUDGE_DISMISSED_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * From 70% full: a callout at the top of the dashboard. Dismissed for this
 * session — it comes back if storage grows 5 more points.
 */
export function StorageNudge({ projects }: { projects: Project[] }) {
  const { meter } = useStorageMeter(projects);
  const [dismissed, setDismissed] = useState(dismissedAt);
  const m = useMessages(dataMessages);
  if (meter.level === 'ok' || (dismissed > 0 && meter.percent < dismissed + 5)) return null;
  const full = meter.level === 'full';
  return (
    <div
      role="status"
      className={cn(
        'mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border px-3.5 py-2.5',
        full ? 'border-danger/35 bg-danger/8' : 'border-warning/35 bg-warning/8',
      )}
    >
      <AlertTriangle className={cn('h-4 w-4 shrink-0', full ? 'text-danger' : 'text-warning')} aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-64 text-[12.5px] leading-snug">
        <span className="font-semibold">{m.nudgeTitle(meter.percent)}</span>{' '}
        <span className="text-muted">{full ? m.nudgeFull : m.nudgeNear}</span>
      </p>
      <Button size="sm" variant={full ? 'danger' : 'primary'} onClick={() => void backUpAndFreeSpace()}>
        <DatabaseBackup className="h-3.5 w-3.5" /> {m.backUpAndFree}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={m.dismissNudge}
        onClick={() => {
          try {
            sessionStorage.setItem(NUDGE_DISMISSED_KEY, String(meter.percent));
          } catch {
            /* remembered for this page only */
          }
          setDismissed(meter.percent);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
