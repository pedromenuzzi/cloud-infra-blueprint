import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { showToast } from '@/components/Toast';
import { Button } from '@/components/ui';
import { messagesFor, useMessages } from '@/i18n/messages';
import {
  createLink,
  findLinkByFolder,
  hashFiles,
  idbLinkStore,
  isFolderSyncSupported,
  pickFolder,
  readRootModule,
  type DirHandleLike,
} from '@/lib/fsSync';
import { importNote } from '@/lib/importTf';
import { createProject, getProject, uniqueProjectName } from '@/lib/storage';
import { dataMessages } from './messages';

/** An existing project already linked to this folder (stale links to deleted projects are dropped). */
async function linkedProject(dir: DirHandleLike): Promise<string | null> {
  const link = await findLinkByFolder(idbLinkStore, dir).catch(() => undefined);
  if (!link) return null;
  if (getProject(link.projectId)) return link.projectId;
  await idbLinkStore.delete(link.projectId).catch(() => undefined);
  return null;
}

/**
 * "Open folder…": imports the Terraform root module of a folder as a project
 * linked to it (saves go straight to the .tf files on disk), then opens it.
 */
export function useOpenFolder() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    const m = messagesFor(dataMessages);
    let dir: DirHandleLike | null;
    try {
      dir = await pickFolder();
    } catch {
      showToast(m.cantOpenFolder, 'error');
      return;
    }
    if (!dir) return;
    setBusy(true);
    try {
      const existing = await linkedProject(dir);
      if (existing) {
        showToast(m.alreadyLinked);
        navigate(`/editor/${existing}`);
        return;
      }
      const module = await readRootModule(dir);
      if (!module) {
        showToast(m.noTfIn(dir.name), 'error');
        return;
      }
      // the root module can sit below the picked folder, and be linked already
      const root = module.dir !== dir ? await linkedProject(module.dir) : null;
      if (root) {
        showToast(m.labelAlreadyLinked(module.label));
        navigate(`/editor/${root}`);
        return;
      }
      let projectId: string;
      try {
        projectId = createProject({
          name: uniqueProjectName(dir.name),
          files: module.files,
          description: m.syncedWith(module.label),
        }).id;
      } catch {
        return; // storage full — the storage notice says so
      }
      try {
        await idbLinkStore.set(
          createLink({ projectId, dir: module.dir, label: module.label, synced: hashFiles(module.files) }),
        );
      } catch {
        showToast(m.linkNotSaved, 'error');
      }
      const note = importNote({
        name: dir.name,
        files: module.files,
        rootDir: module.label.slice(dir.name.length + 1),
        skipped: module.skipped,
        oversized: module.oversized,
      });
      showToast(note ?? m.openedFolder(module.label), note ? 'info' : 'success');
      navigate(`/editor/${projectId}`);
    } catch {
      showToast(m.cantRead(dir.name), 'error');
    } finally {
      setBusy(false);
    }
  };

  return { open: () => void open(), busy, supported: isFolderSyncSupported() };
}

/**
 * "Open folder…" next to "Import .tf" (Chromium only — hidden elsewhere, and
 * on phones, which have no folder access). Icon-only until there's room.
 */
export function OpenFolderButton() {
  const { open, busy, supported } = useOpenFolder();
  const m = useMessages(dataMessages);
  if (!supported) return null;
  return (
    <Button
      variant="outline"
      onClick={open}
      disabled={busy}
      aria-label={m.openFolder}
      title={m.openFolderTitle}
      className="max-sm:hidden max-2xl:w-8.5 max-2xl:px-0"
    >
      <FolderOpen className="h-4 w-4" /> <span className="hidden 2xl:inline">{m.openFolder}</span>
    </Button>
  );
}
