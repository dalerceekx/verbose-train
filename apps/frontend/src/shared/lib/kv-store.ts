/**
 * A small async key-value store on this device: IndexedDB when the browser
 * has it (room for the offline copy of the farm's data and the queue of
 * unsent records), otherwise localStorage. Never used for tokens.
 */
const DB_NAME = 'meningfermam-offline';
const STORE = 'kv';
const FALLBACK_PREFIX = 'mf-kv:';

let database: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB'));
  });
}

function fallback(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const kvStore = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await openDatabase();
    try {
      if (db) return (await run<unknown>(db, 'readonly', (store) => store.get(key))) as T | undefined;
      const raw = fallback()?.getItem(FALLBACK_PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  },

  /** False when the device refused (storage full, private mode). */
  async set<T>(key: string, value: T): Promise<boolean> {
    const db = await openDatabase();
    try {
      if (db) await run(db, 'readwrite', (store) => store.put(value, key));
      else fallback()?.setItem(FALLBACK_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  async delete(key: string): Promise<void> {
    const db = await openDatabase();
    try {
      if (db) await run(db, 'readwrite', (store) => store.delete(key));
      else fallback()?.removeItem(FALLBACK_PREFIX + key);
    } catch {
      // ignore
    }
  },
};
