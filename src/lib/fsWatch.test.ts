import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirHandleLike } from './fsSync';
import { fileSystemObserver, isRelevantChange, watchFolder, WATCH_DEBOUNCE_MS, type FsChangeRecord, type FsObserverCtor, type FsObserverLike } from './fsWatch';

const dir = { kind: 'directory', name: 'infra' } as DirHandleLike;

/** A stand-in for the browser's FileSystemObserver: the test calls `emit` as the disk changes. */
function fakeObserver({ refuse = false } = {}) {
  const instances: Array<{ emit(records: FsChangeRecord[]): void; observed: unknown[]; disconnected: boolean }> = [];
  class Fake implements FsObserverLike {
    observed: unknown[] = [];
    disconnected = false;
    constructor(private callback: (records: FsChangeRecord[], observer: FsObserverLike) => void) {
      instances.push(this);
    }
    emit(records: FsChangeRecord[]) {
      if (!this.disconnected) this.callback(records, this);
    }
    observe(handle: DirHandleLike, options?: { recursive?: boolean }) {
      this.observed.push([handle, options]);
      return refuse ? Promise.reject(new DOMException('denied', 'NotAllowedError')) : Promise.resolve();
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  return { Observer: Fake as unknown as FsObserverCtor, instances };
}

const modified = (name: string): FsChangeRecord => ({ type: 'modified', relativePathComponents: [name] });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('watching a linked folder', () => {
  it('uses the browser’s FileSystemObserver only where there is one', () => {
    vi.stubGlobal('FileSystemObserver', undefined);
    expect(fileSystemObserver()).toBeNull();
    expect(watchFolder(dir, () => {})).toBeNull();
    const { Observer } = fakeObserver();
    vi.stubGlobal('FileSystemObserver', Observer);
    expect(fileSystemObserver()).toBe(Observer);
    expect(watchFolder(dir, () => {})).not.toBeNull();
  });

  it('observes the folder itself, not its subfolders', () => {
    const { Observer, instances } = fakeObserver();
    watchFolder(dir, () => {}, { Observer });
    expect(instances[0].observed).toEqual([[dir, { recursive: false }]]);
  });

  it('runs one pass once a burst of changes to .tf files settles', () => {
    const { Observer, instances } = fakeObserver();
    const onChange = vi.fn();
    watchFolder(dir, onChange, { Observer });
    // an editor saving: a temp file, then the rename over main.tf, then variables.tf
    instances[0].emit([{ type: 'appeared', relativePathComponents: ['.main.tf.swp'] }]);
    instances[0].emit([{ type: 'moved', relativePathComponents: ['main.tf'], relativePathMovedFrom: ['.main.tf.tmp'] }]);
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS - 100);
    instances[0].emit([modified('variables.tf')]);
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    // a later change is another pass
    instances[0].emit([{ type: 'disappeared', relativePathComponents: ['outputs.tf'] }]);
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ignores what the sync never touches: other files, subfolders', () => {
    const { Observer, instances } = fakeObserver();
    const onChange = vi.fn();
    watchFolder(dir, onChange, { Observer, debounceMs: 50 });
    instances[0].emit([modified('README.md'), modified('.terraform.lock.hcl'), { type: 'appeared', relativePathComponents: ['modules'] }]);
    instances[0].emit([{ type: 'modified', relativePathComponents: ['modules', 'net.tf'] }]);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('looks at everything when the observer lost track, or the folder itself changed', () => {
    for (const record of [
      { type: 'unknown' },
      { type: 'errored' },
      { type: 'disappeared', relativePathComponents: [] },
      { type: 'moved', relativePathComponents: ['main.tf.bak'], relativePathMovedFrom: ['main.tf'] },
    ] as FsChangeRecord[]) {
      expect(isRelevantChange(record), JSON.stringify(record)).toBe(true);
    }
  });

  it('leaves changes to the focus check while the tab is hidden', () => {
    const { Observer, instances } = fakeObserver();
    const onChange = vi.fn();
    let visible = false;
    watchFolder(dir, onChange, { Observer, isActive: () => visible });
    instances[0].emit([modified('main.tf')]);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    // hidden between the change and the end of the quiet time: still the focus check's
    visible = true;
    instances[0].emit([modified('main.tf')]);
    visible = false;
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    visible = true;
    instances[0].emit([modified('main.tf')]);
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops: the observer is disconnected and a pending pass is dropped', () => {
    const { Observer, instances } = fakeObserver();
    const onChange = vi.fn();
    const watch = watchFolder(dir, onChange, { Observer })!;
    instances[0].emit([modified('main.tf')]);
    watch.stop();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    expect(instances[0].disconnected).toBe(true);
  });

  it('gives up quietly when observing is refused (the focus check stays)', async () => {
    const { Observer, instances } = fakeObserver({ refuse: true });
    const onChange = vi.fn();
    expect(watchFolder(dir, onChange, { Observer })).not.toBeNull();
    await vi.runAllTimersAsync();
    expect(instances[0].disconnected).toBe(true);
    instances[0].emit([modified('main.tf')]);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();

    const Throwing = class {
      constructor() {
        throw new TypeError('Illegal constructor');
      }
    } as unknown as FsObserverCtor;
    expect(watchFolder(dir, onChange, { Observer: Throwing })).toBeNull();
  });
});
