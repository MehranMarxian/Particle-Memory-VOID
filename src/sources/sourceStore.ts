/**
 * Source persistence (single slot): the last source you brought into VOID
 * survives a reload.
 *
 * Local files are kept in IndexedDB, best effort, size-capped; URL sources
 * simply restore by URL. Nothing here touches the simulation, and a missing
 * or broken record must never stand in the way of a fresh start.
 */

export interface StoredSource {
  name: string;
  blob: Blob;
  savedAt: number;
  size: number;
}

/** Above this, a source is too heavy to keep (IndexedDB quotas vary widely). */
export const SOURCE_STORE_LIMIT_BYTES = 64 * 1024 * 1024;

/** The store keeps exactly one memory: whichever one you loaded last. */
export const SOURCE_STORE_KEY = "last";

/** Should this file be remembered for the next visit? */
export function shouldPersist(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= SOURCE_STORE_LIMIT_BYTES;
}

/**
 * Which URL sources are worth re-fetching on boot. Screensaver-managed paths
 * (`/sources/...`) belong to the wrapper's own folder, so they are left alone.
 */
export function shouldRestoreUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/sources/")) return false;
  return url.startsWith("/") || /^https?:\/\//i.test(url);
}

/** Small interface so the store is testable without a browser. */
export interface KeyValueStore<T> {
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

/** In-memory stand-in: tests, and a safe fallback when IndexedDB is absent. */
export function createMemoryStore<T>(): KeyValueStore<T> {
  const map = new Map<string, T>();
  return {
    async get(key) {
      return map.has(key) ? (map.get(key) as T) : null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async del(key) {
      map.delete(key);
    },
  };
}

const DB_NAME = "void-memory";
const DB_STORE = "sources";

/** IndexedDB-backed store; degrades to memory when IndexedDB is unavailable. */
export function openSourceStore(): KeyValueStore<StoredSource> {
  if (typeof indexedDB === "undefined") return createMemoryStore<StoredSource>();
  let dbPromise: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(DB_STORE)) {
            request.result.createObjectStore(DB_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const request = act(tx.objectStore(DB_STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    async get(key) {
      try {
        const value = await run<StoredSource | undefined>("readonly", (s) => s.get(key));
        return value ?? null;
      } catch {
        return null;
      }
    },
    async put(key, value) {
      try {
        await run<IDBValidKey>("readwrite", (s) => s.put(value, key));
      } catch {
        // Quota or private mode: persistence is best-effort by design.
      }
    },
    async del(key) {
      try {
        await run<undefined>("readwrite", (s) => s.delete(key));
      } catch {
        // best effort
      }
    },
  };
}
