/**
 * Restore from backup: validate the .zip, show what would happen to each
 * project (new / already here / differs), let the user choose copies or
 * replacement, then store everything in one write. Loaded on first use.
 */
import { AlertTriangle, ArchiveRestore, Check, FileWarning } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Badge, Button, Modal } from '@/components/ui';
import {
  applyRestore,
  parseBackup,
  planRestore,
  resolveRestore,
  type ParsedBackup,
  type RestoreAction,
  type RestoreItem,
  type RestoreMode,
} from '@/lib/backup';
import { listProjects, localStorageUsage } from '@/lib/storage';
import { cn, timeAgo } from '@/lib/utils';
import { formatBytes } from './meter';

export interface RestoreSummary {
  added: number;
  replaced: number;
}

type Phase =
  | { kind: 'reading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; backup: ParsedBackup };

const STATUS: Record<RestoreItem['status'], { label: string; variant: 'success' | 'outline' | 'warning' }> = {
  new: { label: 'New', variant: 'success' },
  duplicate: { label: 'Already here', variant: 'outline' },
  conflict: { label: 'Differs', variant: 'warning' },
};

function fileCount(files: Record<string, string>) {
  const n = Object.keys(files).length;
  return `${n} file${n === 1 ? '' : 's'}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) || d.getTime() === 0 ? null : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function detail(item: RestoreItem, action: RestoreAction, mode: RestoreMode): { text: string; warn?: boolean } {
  const { project, existing } = item;
  const base = `${fileCount(project.files)} · updated ${timeAgo(project.updatedAt)}`;
  if (item.status === 'duplicate') {
    return { text: existing && existing.name !== project.name ? `Same files as “${existing.name}” here — skipped` : 'Same files as the copy here — skipped' };
  }
  if (item.status === 'conflict') {
    if (action === 'replace' && item.existingIsNewer) {
      return { text: `Yours was changed ${timeAgo(existing!.updatedAt)} — after this backup. Replacing loses those changes.`, warn: true };
    }
    if (mode === 'replace' && action === 'replace') return { text: `${base} · replaces the version here` };
    return { text: `${base} · the version here is kept${item.existingIsNewer ? ' (it’s newer)' : ''}` };
  }
  return { text: base };
}

export default function RestoreDialog({
  file,
  onClose,
  onRestored,
}: {
  file: File;
  onClose(): void;
  onRestored(summary: RestoreSummary): void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  // re-plan against what's stored now (another tab may have changed it)
  const [epoch, setEpoch] = useState(0);
  const [mode, setMode] = useState<RestoreMode>('copy');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const modeName = useId();
  const listId = useId();
  const readyFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    file
      .arrayBuffer()
      .then((buffer) => {
        if (!live) return;
        const result = parseBackup(new Uint8Array(buffer));
        if (!result.ok) {
          setPhase({ kind: 'error', message: result.error });
          return;
        }
        const plan = planRestore(result.backup, listProjects());
        setSelected(new Set(plan.items.filter((i) => i.status !== 'duplicate').map((i) => i.project.id)));
        setPhase({ kind: 'ready', backup: result.backup });
      })
      .catch(() => live && setPhase({ kind: 'error', message: 'The file could not be read.' }));
    return () => {
      live = false;
    };
  }, [file]);

  const existing = useMemo(
    () => (phase.kind === 'ready' ? listProjects() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, epoch],
  );
  const plan = useMemo(() => (phase.kind === 'ready' ? planRestore(phase.backup, existing) : null), [phase, existing]);
  const resolved = useMemo(
    () => (plan ? resolveRestore(plan, { mode, selected, existing }) : null),
    [plan, mode, selected, existing],
  );
  const free = useMemo(() => {
    const { used, budget } = localStorageUsage();
    return Math.max(0, budget - used);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  const adding = resolved?.add.length ?? 0;
  const replacing = resolved?.replace.length ?? 0;
  const total = adding + replacing;
  const tooBig = resolved ? resolved.bytes > free : false;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const restore = () => {
    if (!resolved || total === 0) return;
    setBusy(true);
    const result = applyRestore(resolved);
    setBusy(false);
    if (result.ok) {
      onRestored({ added: result.added.length, replaced: result.replaced.length });
      return;
    }
    if (result.reason === 'quota') {
      setApplyError(
        `There isn’t enough browser storage for this restore (it needs about ${formatBytes(resolved.bytes)}, ` +
          `${formatBytes(free)} is free). Nothing was changed. Deselect some projects, or delete projects you no longer need, and try again.`,
      );
    } else {
      setApplyError('Your projects changed in another tab meanwhile. Review the list again, then restore.');
      setEpoch((e) => e + 1);
    }
  };

  // the dialog opened while reading: once the plan shows, start at the first choice
  useEffect(() => {
    if (phase.kind !== 'reading') readyFocus.current?.focus({ preventScroll: true });
  }, [phase.kind]);

  const exported = phase.kind === 'ready' ? formatDate(phase.backup.exportedAt) : null;
  const title = (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
        <ArchiveRestore className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">Restore from backup</h2>
        <p className="truncate text-[12px] text-muted">
          {file.name}
          {phase.kind === 'ready'
            ? ` · ${phase.backup.projects.length} project${phase.backup.projects.length === 1 ? '' : 's'}${exported ? ` · exported ${exported}` : ''}`
            : ''}
        </p>
      </div>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={title} wide>
      {phase.kind === 'reading' ? (
        <div className="flex items-center justify-center gap-3 px-5 py-12 text-[13px] text-muted" aria-busy="true">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
          Reading the backup…
        </div>
      ) : phase.kind === 'error' ? (
        <div className="px-5 py-5 max-sm:px-4">
          <div role="alert" className="flex gap-3 rounded-md border border-danger/30 bg-danger/8 p-3.5">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div className="min-w-0 text-[13px] leading-relaxed">
              <p className="font-semibold text-danger">This backup can’t be restored</p>
              <p className="mt-0.5 text-muted">{phase.message}</p>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button ref={(el) => void (readyFocus.current ??= el)} variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4 px-5 py-4 max-sm:px-4">
            <ul className="flex flex-wrap gap-2 text-[12px]" aria-label="Summary">
              <li>
                <Badge variant="success">{plan!.counts.new} new</Badge>
              </li>
              <li>
                <Badge variant="outline">{plan!.counts.duplicate} already here</Badge>
              </li>
              <li>
                <Badge variant={plan!.counts.conflict > 0 ? 'warning' : 'outline'}>
                  {plan!.counts.conflict} differ{plan!.counts.conflict === 1 ? 's' : ''} from yours
                </Badge>
              </li>
            </ul>

            {plan!.counts.conflict > 0 ? (
              <fieldset>
                <legend className="mb-2 text-[12px] font-medium text-muted">
                  For projects that differ from the ones in this browser
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['copy', 'Add as copies', 'Keep yours; the backup’s version is added next to it.'],
                      [
                        'replace',
                        'Replace existing',
                        `Overwrite ${plan!.counts.conflict === 1 ? 'the project' : `the ${plan!.counts.conflict} projects`} here with the backup’s version.`,
                      ],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label
                      key={value}
                      className={cn(
                        'flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors hover:border-border-strong',
                        mode === value ? 'border-primary bg-primary-soft' : 'bg-surface-1',
                      )}
                    >
                      <input
                        ref={value === 'copy' ? (el) => void (readyFocus.current ??= el) : undefined}
                        type="radio"
                        name={modeName}
                        value={value}
                        checked={mode === value}
                        onChange={() => {
                          setMode(value);
                          setApplyError(null);
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold">{label}</span>
                        <span className="block text-[12px] leading-snug text-muted">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 id={listId} className="text-[11px] font-bold uppercase tracking-wider text-faint">
                  Projects in the backup
                </h3>
                <span className="text-[11.5px] text-faint">{total} selected</span>
              </div>
              <ul
                aria-labelledby={listId}
                className="max-h-[min(340px,45vh)] divide-y overflow-y-auto rounded-md border bg-surface-1"
              >
                {resolved!.entries.map(({ item, action, name }) => {
                  const status = STATUS[item.status];
                  const disabled = item.status === 'duplicate';
                  const info = detail(item, action, mode);
                  const renamed = !disabled && action !== 'skip' && name !== item.project.name;
                  return (
                    <li key={item.project.id}>
                      <label
                        className={cn(
                          'flex items-start gap-3 px-3 py-2.5',
                          disabled ? 'cursor-default opacity-70' : 'cursor-pointer hover:bg-surface-2/60',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                          checked={!disabled && selected.has(item.project.id)}
                          disabled={disabled}
                          onChange={() => {
                            toggle(item.project.id);
                            setApplyError(null);
                          }}
                          aria-describedby={`${listId}-${item.project.id}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="min-w-0 truncate text-[13px] font-semibold">{item.project.name}</span>
                            {renamed ? <span className="text-[12px] text-muted">→ {name}</span> : null}
                            <Badge variant={status.variant}>{status.label}</Badge>
                            {action === 'replace' ? <Badge variant="danger">Replaces yours</Badge> : null}
                            {action === 'copy' ? <Badge variant="default">Added as a copy</Badge> : null}
                          </span>
                          <span
                            id={`${listId}-${item.project.id}`}
                            className={cn('mt-0.5 flex items-start gap-1 text-[12px]', info.warn ? 'text-warning' : 'text-muted')}
                          >
                            {info.warn ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> : null}
                            {info.text}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
                {phase.backup.invalid.map((entry, i) => (
                  <li key={`invalid-${i}`} className="flex items-start gap-3 px-3 py-2.5 opacity-80">
                    <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{entry.name}</span>
                      <span className="block text-[12px] text-danger">Can’t be restored: {entry.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {applyError ? (
              <p role="alert" className="flex gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2.5 text-[12.5px] text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {applyError}
              </p>
            ) : tooBig && total > 0 ? (
              <p className="flex gap-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-2.5 text-[12.5px] text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This needs about {formatBytes(resolved!.bytes)}, and only {formatBytes(free)} of browser storage is free.
                It may not fit — deselect some projects, or delete projects you no longer need.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5 max-sm:px-4">
            <p className="mr-auto text-[12px] text-muted">
              {total === 0 ? (
                'Nothing selected'
              ) : (
                <>
                  <Check className="mr-1 inline h-3.5 w-3.5 text-success" />
                  {[adding > 0 ? `Adds ${adding}` : '', replacing > 0 ? `${adding > 0 ? 'replaces' : 'Replaces'} ${replacing}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                  {` · about ${formatBytes(resolved!.bytes)}`}
                </>
              )}
            </p>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              ref={(el) => void (readyFocus.current ??= el)}
              variant={replacing > 0 ? 'danger' : 'primary'}
              disabled={total === 0 || busy}
              onClick={restore}
            >
              {replacing > 0
                ? `Restore and replace ${replacing}`
                : `Restore ${total} project${total === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
