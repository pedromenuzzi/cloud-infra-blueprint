import { downloadBlob } from '@/lib/download';
import { listProjects, safeStorage } from '@/lib/storage';

/** When this browser last downloaded a full backup (ISO time). */
export const LAST_BACKUP_KEY = 'cb-last-backup';

export function lastBackupAt(): string | null {
  const value = safeStorage.getItem(LAST_BACKUP_KEY);
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** Downloads every project as one backup .zip; null when there is nothing to back up. */
export async function downloadBackup(): Promise<{ fileName: string; count: number } | null> {
  const projects = listProjects();
  if (projects.length === 0) return null;
  const { backupFileName, buildBackup } = await import('@/lib/backup');
  const now = new Date();
  const bytes = buildBackup(projects, now);
  const fileName = backupFileName(now);
  downloadBlob(new Blob([bytes.slice().buffer], { type: 'application/zip' }), fileName);
  safeStorage.setItem(LAST_BACKUP_KEY, now.toISOString());
  return { fileName, count: projects.length };
}
