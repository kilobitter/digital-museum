// "Remember on this device": the non-extractable CryptoKey in IndexedDB, keyed by the manifest salt.
// Every function swallows errors (IndexedDB can be missing or blocked): the viewer then just asks again.
const DB = 'vr-museum-keys';
const STORE = 'keys';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB error'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadStoredKey(salt: string): Promise<CryptoKey | null> {
  try {
    const k = await run<unknown>('readonly', (s) => s.get(salt));
    return k instanceof CryptoKey ? k : null;
  } catch {
    return null;
  }
}

export async function storeKey(salt: string, key: CryptoKey): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(key, salt));
    return true;
  } catch {
    return false;
  }
}

export async function forgetKey(salt: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(salt));
  } catch {
    /* nothing to forget */
  }
}
