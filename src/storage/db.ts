// IndexedDB in the extension's own origin (never the Google page's), so Google clearing site
// data can't touch it and page scripts can't read it.

const DB_NAME = 'workspace-dark';
const DB_VERSION = 1;

export type StoreName = 'schemes' | 'options' | 'pages' | 'settings';

const KEY_PATHS: Record<StoreName, string> = {
  schemes: 'id',
  options: 'id',
  pages: 'key',
  settings: 'id',
};

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(KEY_PATHS)) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let result: T;
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return open().then((d) => promisify(d.transaction(store).objectStore(store).get(key)));
  },
  getAll<T>(store: StoreName): Promise<T[]> {
    return open().then((d) => promisify(d.transaction(store).objectStore(store).getAll()));
  },
  put<T>(store: StoreName, value: T): Promise<unknown> {
    return tx(store, 'readwrite', (s) => s.put(value));
  },
  putMany<T>(store: StoreName, values: T[]): Promise<unknown> {
    return tx(store, 'readwrite', (s) => {
      for (const v of values) s.put(v);
    });
  },
  delete(store: StoreName, key: string): Promise<unknown> {
    return tx(store, 'readwrite', (s) => s.delete(key));
  },
};

/** Ask Firefox not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}
