// File System Access API helpers shared by the editor and the viewer: local type declarations (the DOM
// lib does not ship them), permission helpers, and a tiny raw-IndexedDB store that remembers the museum
// folder between visits. No React, no three.js.

export type FsPermissionMode = 'read' | 'readwrite';
export type FsPermissionState = 'granted' | 'denied' | 'prompt';

export interface FsWritable {
  write(data: Blob | string | BufferSource): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
export interface FsFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsWritable>;
}
export interface FsDirHandle {
  readonly kind: 'directory';
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, FsFileHandle | FsDirHandle]>;
  queryPermission(d: { mode: FsPermissionMode }): Promise<FsPermissionState>;
  requestPermission(d: { mode: FsPermissionMode }): Promise<FsPermissionState>;
}

export const fsAccessSupported = (): boolean => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

/** Opens the browser's folder picker. Resolves null when the user cancels. */
export async function pickMuseumFolder(): Promise<FsDirHandle | null> {
  const w = window as unknown as { showDirectoryPicker(o: { id: string; mode: FsPermissionMode }): Promise<FsDirHandle> };
  try {
    return await w.showDirectoryPicker({ id: 'museum', mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

export async function queryAccess(h: FsDirHandle, mode: FsPermissionMode): Promise<FsPermissionState> {
  try {
    return await h.queryPermission({ mode });
  } catch {
    return 'denied';
  }
}
/** Must be called from a user gesture (a click). */
export async function requestAccess(h: FsDirHandle, mode: FsPermissionMode): Promise<FsPermissionState> {
  try {
    return await h.requestPermission({ mode });
  } catch {
    return 'denied';
  }
}

// ---- remembered handle (IndexedDB) ----
const DB_NAME = 'vr-museum';
const STORE = 'handles';
const KEY = 'museum-folder';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Never throws: private windows and blocked storage just mean "nothing remembered". */
export async function saveFolderHandle(h: FsDirHandle): Promise<boolean> {
  try {
    await withStore('readwrite', (s) => s.put(h, KEY));
    return true;
  } catch {
    return false;
  }
}
export async function loadFolderHandle(): Promise<FsDirHandle | null> {
  try {
    const v = await withStore<unknown>('readonly', (s) => s.get(KEY));
    return v && typeof v === 'object' && (v as FsDirHandle).kind === 'directory' ? (v as FsDirHandle) : null;
  } catch {
    return null;
  }
}
export async function clearFolderHandle(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch { /* nothing to clear */ }
}
