// Tiny IndexedDB wrapper. Audio and cover art live here (too big for localStorage).

type StoreName = "audio" | "covers";
const DB_NAME = "earworm";
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      if (!db.objectStoreNames.contains("covers")) db.createObjectStore("covers");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// Some WebKit builds (Safari private browsing, for one) refuse Blobs in IndexedDB,
// so those get stored as plain bytes instead.
interface Packed {
  type: string;
  bytes: ArrayBuffer;
}

export const db = {
  put: async (store: StoreName, key: string, value: Blob) => {
    try {
      await tx(store, "readwrite", (s) => s.put(value, key));
    } catch (e) {
      if ((e as DOMException)?.name === "QuotaExceededError") throw e;
      const packed: Packed = { type: value.type, bytes: await value.arrayBuffer() };
      await tx(store, "readwrite", (s) => s.put(packed, key));
    }
  },
  get: async (store: StoreName, key: string) => {
    const v = await tx<Blob | Packed | undefined>(store, "readonly", (s) => s.get(key));
    return v && !(v instanceof Blob) ? new Blob([v.bytes], { type: v.type }) : v;
  },
  del: (store: StoreName, key: string) => tx(store, "readwrite", (s) => s.delete(key)),
};

// Object URLs are cached so the same blob isn't re-read on every render.
const urlCache = new Map<string, Promise<string | null>>();
const resolved = new Map<string, string | null>();

export function blobUrl(store: StoreName, key: string): Promise<string | null> {
  const k = `${store}:${key}`;
  let p = urlCache.get(k);
  if (!p) {
    p = db.get(store, key).then(
      (b) => {
        const u = b ? URL.createObjectURL(b) : null;
        resolved.set(k, u);
        return u;
      },
      () => {
        urlCache.delete(k);
        return null;
      },
    );
    urlCache.set(k, p);
  }
  return p;
}

/** The URL if blobUrl() already resolved it (null = missing), undefined if not known yet. */
export function blobUrlNow(store: StoreName, key: string) {
  return resolved.get(`${store}:${key}`);
}

export function forgetUrl(store: StoreName, key: string) {
  const k = `${store}:${key}`;
  const p = urlCache.get(k);
  if (p) p.then((u) => u && URL.revokeObjectURL(u));
  urlCache.delete(k);
  resolved.delete(k);
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not critical */
  }
}
