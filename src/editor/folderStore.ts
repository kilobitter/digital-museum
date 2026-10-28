// Museum store backed by a folder the user picked (File System Access API). The core is written against
// the small FolderFs interface so it can be unit-tested with an in-memory fake; folderAdapter.ts maps
// it onto a real FileSystemDirectoryHandle.
import type { Museum } from '../shared/museum';
import { ALLOWED_EXTENSIONS, MAX_MEDIA_BYTES, MEDIA_FILE_RE, MEDIA_NAME_RE, allowedExtension } from '../shared/mediaFiles';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import type { LoadResult, MuseumStore, SaveOutcome } from './store';

/** Paths are always exactly `museum.json` or `media/<name>`; nothing else is ever touched. */
export interface FolderFs {
  name: string;
  /** null when the file does not exist. */
  readFile(path: string): Promise<File | null>;
  /** Creates `media/` when needed. */
  writeFile(path: string, data: Blob | string): Promise<void>;
  /** A missing file is not an error. */
  removeFile(path: string): Promise<void>;
  /** Names of all entries (files and folders) directly inside '' (the folder) or 'media'. [] when missing. */
  list(dir: '' | 'media'): Promise<string[]>;
}

export interface FolderStoreOptions {
  /** Returns n random bytes. Defaults to crypto.getRandomValues. */
  randomBytes?: (n: number) => Uint8Array;
  createUrl?: (b: Blob) => string;
  revokeUrl?: (u: string) => void;
}

const MUSEUM_FILE = 'museum.json';
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export type FolderState = 'has-museum' | 'empty' | 'other-files';

/** Whether a freshly picked folder already holds a museum, is empty, or holds unrelated files. */
export async function inspectFolder(fs: FolderFs): Promise<FolderState> {
  const names = await fs.list('');
  if (names.includes(MUSEUM_FILE)) return 'has-museum';
  return names.some((n) => !JUNK.has(n.toLowerCase())) ? 'other-files' : 'empty';
}

const defaultRandom = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export function createFolderStore(fs: FolderFs, opts: FolderStoreOptions = {}): MuseumStore {
  const random = opts.randomBytes ?? defaultRandom;
  const createUrl = opts.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = opts.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  const urls = new Map<string, string>(); // "media/<name>" -> object URL
  /** lastModified of museum.json as of our last load/save; null = it did not exist. */
  let lastKnown: number | null = null;

  const setUrl = (file: string, blob: Blob) => {
    const old = urls.get(file);
    if (old) revokeUrl(old);
    urls.set(file, createUrl(blob));
  };
  const clearUrls = () => {
    for (const u of urls.values()) revokeUrl(u);
    urls.clear();
  };

  async function load(): Promise<LoadResult> {
    let f: File | null;
    try {
      f = await fs.readFile(MUSEUM_FILE);
    } catch (e) {
      return { status: 'invalid', errors: [`Could not read museum.json: ${String(e)}`] };
    }
    lastKnown = f ? f.lastModified : null;
    // media map: only names that match the shared pattern; anything else in the folder is ignored
    clearUrls();
    try {
      for (const name of await fs.list('media')) {
        if (!MEDIA_NAME_RE.test(name)) continue;
        const file = `media/${name}`;
        const mf = await fs.readFile(file);
        if (mf) setUrl(file, mf);
      }
    } catch { /* unreadable media folder: images just show as missing */ }
    if (!f) return { status: 'missing', museum: defaultMuseum() };
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch {
      return { status: 'invalid', errors: ['museum.json is not valid JSON'] };
    }
    const parsed = parseMuseum(json);
    return parsed.ok ? { status: 'ok', museum: parsed.museum } : { status: 'invalid', errors: parsed.errors };
  }

  async function save(m: Museum, o?: { overwrite?: boolean }): Promise<SaveOutcome> {
    const parsed = parseMuseum(m);
    if (!parsed.ok) return { ok: false, errors: parsed.errors };
    try {
      if (!o?.overwrite) {
        const cur = await fs.readFile(MUSEUM_FILE);
        const now = cur ? cur.lastModified : null;
        if (now !== lastKnown)
          return {
            ok: false,
            conflict: true,
            errors: ['museum.json in the folder was changed by something else (another tab, a sync program, or you copying files) since it was loaded.'],
          };
      }
      await fs.writeFile(MUSEUM_FILE, JSON.stringify(parsed.museum, null, 2) + '\n');
      const after = await fs.readFile(MUSEUM_FILE);
      lastKnown = after ? after.lastModified : null;
      return { ok: true };
    } catch (e) {
      return { ok: false, errors: [`Could not write to the folder: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  function newId(): string {
    let s = '';
    for (const b of random(10)) s += ID_ALPHABET[b % ID_ALPHABET.length];
    return s;
  }

  async function upload(name: string, data: Blob): Promise<string> {
    const ext = allowedExtension(name);
    if (!ext) throw new Error(`Unsupported file type (allowed: ${ALLOWED_EXTENSIONS.join(', ')})`);
    if (data.size === 0) throw new Error('Empty file');
    if (data.size > MAX_MEDIA_BYTES) throw new Error('File too large (max 50 MB)');
    for (let i = 0; i < 5; i++) {
      const file = `media/${newId()}.${ext}`;
      if (await fs.readFile(file)) continue; // id collision, try another
      await fs.writeFile(file, data);
      // point at the disk-backed file rather than the in-memory blob, so bulk uploads don't pile up in memory
      setUrl(file, (await fs.readFile(file)) ?? data);
      return file;
    }
    throw new Error('Could not pick a free file name');
  }

  async function deleteMedia(file: string): Promise<void> {
    if (!MEDIA_FILE_RE.test(file)) throw new Error(`Invalid media path: ${file}`);
    await fs.removeFile(file);
    const u = urls.get(file);
    if (u) revokeUrl(u);
    urls.delete(file);
  }

  return {
    kind: 'folder',
    label: fs.name,
    writable: true,
    previewUrl: './index.html?source=folder',
    load,
    save,
    upload,
    deleteMedia,
    mediaUrl: (file) => urls.get(file),
    dispose: clearUrls,
  };
}
