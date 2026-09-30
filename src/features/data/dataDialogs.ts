/**
 * The dashboard's data dialogs (restore from backup, free up space): hosted by
 * the data panel (./DataPanel.tsx), opened from anywhere — the panel itself,
 * a backup dropped on the dashboard or picked to import, the command palette.
 * Kept apart from the panel so opening one doesn't pull the panel's code in.
 */
import { create } from 'zustand';

export const useDataDialogs = create<{ restore: File | null; freeSpace: string | null }>(() => ({
  restore: null,
  freeSpace: null,
}));

/** Open the restore dialog for this backup (shown by the dashboard's data panel). */
export function openRestore(file: File) {
  useDataDialogs.setState({ restore: file });
}

/**
 * The backup among files dropped or picked to import: one .zip whose manifest
 * says it was made by this app. Null for anything else — Terraform (loose
 * files, folders, zips of .tf files) goes through the importer as before.
 */
export async function backupAmong(files: readonly File[]): Promise<File | null> {
  const [file] = files;
  if (files.length !== 1 || !/\.zip$/i.test(file.name)) return null;
  try {
    const [{ isBackupZip }, bytes] = await Promise.all([import('@/lib/backup'), file.arrayBuffer()]);
    return isBackupZip(new Uint8Array(bytes)) ? file : null;
  } catch {
    return null; // unreadable: the importer says what's wrong with it
  }
}
