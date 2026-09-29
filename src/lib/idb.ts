/**
 * A tiny promise wrapper over one IndexedDB key/value store — for values
 * localStorage can't hold, like File System Access directory handles
 * (structured-cloneable, not JSON).
 */
const DB_NAME = 'cloud-blueprint';
const STORE = 'kv';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgrades the schema: let it, and reopen next time
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
      }),
  );
}

export const idb = {
  get<T>(key: string): Promise<T | undefined> {
    return run('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  },
  set(key: string, value: unknown): Promise<void> {
    return run('readwrite', (s) => s.put(value, key)).then(() => undefined);
  },
  delete(key: string): Promise<void> {
    return run('readwrite', (s) => s.delete(key)).then(() => undefined);
  },
  /** every value whose key starts with `prefix` */
  values<T>(prefix: string): Promise<T[]> {
    return run('readonly', (s) => s.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`)) as IDBRequest<T[]>);
  },
};
