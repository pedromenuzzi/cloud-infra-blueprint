/**
 * "Back up and free space", step two: the backup is downloaded; pick the
 * projects to delete from this browser, biggest first. Loaded on first use.
 */
import { CheckCircle2, HardDrive } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { useMessages } from '@/i18n/messages';
import { deleteProject, listProjects, projectSize } from '@/lib/storage';
import { cn, timeAgo } from '@/lib/utils';
import { forgetFolderLink } from './folderLinks';
import { dataMessages } from './messages';
import { formatBytes } from './meter';

export default function FreeSpaceDialog({
  backupName,
  onClose,
  onDeleted,
}: {
  /** the backup that was just downloaded */
  backupName: string;
  onClose(): void;
  onDeleted(count: number): void;
}) {
  const listId = useId();
  const m = useMessages(dataMessages);
  const projects = useMemo(
    () =>
      listProjects()
        .map((project) => ({ project, size: projectSize(project) }))
        .sort((a, b) => b.size - a.size),
    [],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const freed = projects.filter((p) => selected.has(p.project.id)).reduce((n, p) => n + p.size, 0);

  const remove = () => {
    let count = 0;
    for (const id of selected) {
      if (!deleteProject(id)) continue;
      count += 1;
      void forgetFolderLink(id); // the folder on disk is left alone
    }
    onDeleted(count);
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
            <HardDrive className="h-4 w-4" />
          </span>
          <h2 className="text-[15px] font-semibold">{m.freeUpTitle}</h2>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4 max-sm:px-4">
        <p className="flex items-start gap-2 rounded-md border border-success/30 bg-success/8 px-3 py-2.5 text-[12.5px]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span>
            <span className="font-semibold text-success">{m.backupDone}</span>{' '}
            <span className="text-muted">
              {m.backupHoldsBefore}
              <span className="break-all font-mono text-[11.5px]">{backupName}</span>
              {m.backupHoldsAfter}
            </span>
          </span>
        </p>
        <div>
          <h3 id={listId} className="mb-1.5 text-[12.5px] font-medium text-muted">
            {m.selectToDelete}
          </h3>
          <ul aria-labelledby={listId} className="max-h-[min(340px,45vh)] divide-y overflow-y-auto rounded-md border">
            {projects.map(({ project, size }) => (
              <li key={project.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                    checked={selected.has(project.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(project.id)) next.delete(project.id);
                        else next.add(project.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{project.name}</span>
                    <span className="block text-[12px] text-muted">{m.updated(timeAgo(project.updatedAt))}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-muted">{formatBytes(size)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5 max-sm:px-4">
        <p className={cn('mr-auto text-[12px]', selected.size > 0 ? 'text-foreground' : 'text-muted')}>
          {selected.size > 0 ? m.frees(formatBytes(freed)) : m.nothingSelected}
        </p>
        <Button variant="outline" onClick={onClose}>
          {m.done}
        </Button>
        <Button variant="danger" disabled={selected.size === 0} onClick={remove}>
          {m.deleteProjects(selected.size)}
        </Button>
      </div>
    </Modal>
  );
}
