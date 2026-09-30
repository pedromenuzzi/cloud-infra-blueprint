/**
 * Folder links as the dashboard sees them: which projects sync with a folder
 * on disk (their cards say so), and a link goes when its project does — a
 * deleted project must not leave its folder handle behind, nor make the next
 * "Open folder…" of that folder say it's already linked.
 */
import { useEffect, useState } from 'react';
import { idbLinkStore, type LinkStore } from '@/lib/fsSync';
import { getProject, type Project } from '@/lib/storage';

/** Forget a deleted project's folder link (the files on disk are left alone). */
export function forgetFolderLink(projectId: string, store: LinkStore = idbLinkStore): Promise<void> {
  return store.delete(projectId).catch(() => undefined);
}

/**
 * The folder label of every linked project (project id → "infra"). Links whose
 * project is gone — deleted in another tab, or before links were cleaned up —
 * are removed on the way. `exists` reads storage afresh: a project another tab
 * just created and linked isn't mistaken for a deleted one.
 */
export async function readFolderLinks(
  store: LinkStore = idbLinkStore,
  exists: (projectId: string) => boolean = (id) => getProject(id) !== undefined,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  for (const link of await store.all()) {
    if (exists(link.projectId)) labels.set(link.projectId, link.label);
    else await forgetFolderLink(link.projectId, store);
  }
  return labels;
}

const NONE: ReadonlyMap<string, string> = new Map();

/** The dashboard's view of the links, read again whenever its project list changes. */
export function useFolderLinks(projects: readonly Project[]): ReadonlyMap<string, string> {
  const [labels, setLabels] = useState(NONE);
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let live = true;
    readFolderLinks()
      .then((next) => {
        if (live) setLabels(next);
      })
      .catch(() => undefined); // IndexedDB unavailable (private mode…): no links to show
    return () => {
      live = false;
    };
  }, [projects]);
  return labels;
}
