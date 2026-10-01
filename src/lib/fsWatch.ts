/**
 * Live disk changes for a linked folder, through `FileSystemObserver`
 * (Chromium 129+). Without it — or when observing fails — nothing is
 * watched and the editor keeps its fallback: looking at the folder again
 * when the window regains focus or the tab becomes visible
 * (features/data/folderSync.ts). The sync itself, with its three-way merge
 * and conflict rules, is src/lib/fsSync.ts: this only says when to run it.
 */
import { isSyncableName, type DirHandleLike } from './fsSync';

/** What an observer reports (the subset used here). */
export interface FsChangeRecord {
  type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored' | (string & {});
  /** the path of the change below the observed folder: `['main.tf']`, `[]` for the folder itself */
  relativePathComponents?: readonly string[];
  /** for `moved`: where it was */
  relativePathMovedFrom?: readonly string[] | null;
}

export interface FsObserverLike {
  observe(handle: DirHandleLike, options?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
}

export type FsObserverCtor = new (callback: (records: FsChangeRecord[], observer: FsObserverLike) => void) => FsObserverLike;

/** The browser's `FileSystemObserver`, when it has one. */
export function fileSystemObserver(): FsObserverCtor | null {
  const ctor = (globalThis as { FileSystemObserver?: unknown }).FileSystemObserver;
  return typeof ctor === 'function' ? (ctor as FsObserverCtor) : null;
}

/** Only the .tf files directly in the folder are synced: other changes don't need a pass. */
export function isRelevantChange(record: FsChangeRecord): boolean {
  // the observer lost track, or the folder itself went away: look at everything
  if (record.type === 'unknown' || record.type === 'errored') return true;
  const at = (path: readonly string[] | null | undefined) =>
    !!path && (path.length === 0 || (path.length === 1 && isSyncableName(path[0])));
  return at(record.relativePathComponents) || (record.type === 'moved' && at(record.relativePathMovedFrom));
}

export interface WatchOptions {
  /** quiet time after the last change before `onChange` (editors write in bursts: temp file, rename…) */
  debounceMs?: number;
  /** changes seen while this is false are left to the focus / visibility check */
  isActive?: () => boolean;
  /** the observer class (tests pass a fake) */
  Observer?: FsObserverCtor | null;
}

export interface FolderWatch {
  stop(): void;
}

export const WATCH_DEBOUNCE_MS = 400;

/**
 * Call `onChange` once the .tf files directly in `dir` changed on disk and
 * the changes settled. Null when this browser can't watch a folder.
 */
export function watchFolder(dir: DirHandleLike, onChange: () => void, options: WatchOptions = {}): FolderWatch | null {
  const Observer = options.Observer === undefined ? fileSystemObserver() : options.Observer;
  if (!Observer) return null;
  const { debounceMs = WATCH_DEBOUNCE_MS, isActive = () => true } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let observer: FsObserverLike;
  try {
    observer = new Observer((records) => {
      if (stopped || !records.some(isRelevantChange) || !isActive()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!stopped && isActive()) onChange();
      }, debounceMs);
    });
  } catch {
    return null;
  }
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    observer.disconnect();
  };
  // observing can still be refused (permission, a folder that's gone): the focus check stays
  observer.observe(dir, { recursive: false }).catch(stop);
  return { stop };
}
