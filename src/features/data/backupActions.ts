import { emptyProgress, learnSnapshot } from '@/learn/progress';
import { downloadBlob } from '@/lib/download';
import { listProjects, safeStorage } from '@/lib/storage';

/** When this browser last downloaded a full backup (ISO time). */
export const LAST_BACKUP_KEY = 'cb-last-backup';

export function lastBackupAt(): string | null {
  const value = safeStorage.getItem(LAST_BACKUP_KEY);
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * Downloads every project, and the learning map's progress when there is
 * any, as one backup .zip; null when there is nothing to back up.
 */
export async function downloadBackup(): Promise<{ fileName: string; count: number; learning: boolean } | null> {
  const projects = listProjects();
  const progress = learnSnapshot();
  const learning = JSON.stringify(progress) !== JSON.stringify(emptyProgress());
  if (projects.length === 0 && !learning) return null;
  const { backupFileName, buildBackup } = await import('@/lib/backup');
  const now = new Date();
  const bytes = buildBackup(projects, now, learning ? progress : undefined);
  const fileName = backupFileName(now);
  downloadBlob(new Blob([bytes.slice().buffer], { type: 'application/zip' }), fileName);
  safeStorage.setItem(LAST_BACKUP_KEY, now.toISOString());
  return { fileName, count: projects.length, learning };
}
