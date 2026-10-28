// Import sources: another museum read from a .zip or a folder. Read-only; nothing is ever written to the guest.
import type { Museum } from '../shared/museum';
import { MAX_MEDIA_BYTES, MEDIA_FILE_RE } from '../shared/mediaFiles';
import { parseMuseum } from '../shared/validate';
import { findMuseumRoot, openZip } from '../shared/zip';
import type { FsDirHandle, FsFileHandle } from '../shared/folderHandle';

export const MAX_MUSEUM_JSON_BYTES = 5 * 1024 * 1024;

export interface ImportSource {
  /** Folder or zip name, for messages. */
  label: string;
  museum: Museum;
  /** `file` is a media path from the guest museum ("media/x.png"). null = not in the source. Throws on unreadable / too large. */
  readMedia(file: string): Promise<Blob | null>;
}

/** A problem with the chosen museum that the user can read; nothing has been changed. */
export class ImportError extends Error {
  constructor(public errors: string[]) {
    super(errors.join('\n'));
  }
}

/** Where files can be read from: relative paths of all files, and a reader. */
interface Tree {
  label: string;
  paths: string[];
  read(path: string, maxBytes: number): Promise<Blob | null>;
}

function parseGuest(text: string, label: string): Museum {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError([`"${label}": museum.json is not valid JSON.`]);
  }
  const r = parseMuseum(json);
  if (!r.ok) throw new ImportError([`"${label}" is not a usable museum:`, ...r.errors.slice(0, 20), ...(r.errors.length > 20 ? [`…and ${r.errors.length - 20} more`] : [])]);
  return r.museum;
}

async function sourceFromTree(t: Tree): Promise<ImportSource> {
  const root = findMuseumRoot(t.paths);
  if (root === null) throw new ImportError([`No museum.json found in "${t.label}". Pick the folder (or zip) that was saved by the museum editor.`]);
  let blob: Blob | null;
  try {
    blob = await t.read(root + 'museum.json', MAX_MUSEUM_JSON_BYTES);
  } catch (e) {
    throw new ImportError([`Could not read museum.json in "${t.label}": ${e instanceof Error ? e.message : String(e)}`]);
  }
  if (!blob) throw new ImportError([`No museum.json found in "${t.label}".`]);
  const museum = parseGuest(await blob.text(), t.label);
  return {
    label: t.label,
    museum,
    readMedia: async (file) => {
      if (!MEDIA_FILE_RE.test(file)) return null; // never look anything else up
      return t.read(root + file, MAX_MEDIA_BYTES);
    },
  };
}

export async function sourceFromZip(zip: Blob, label = (zip as File).name || 'zip file'): Promise<ImportSource> {
  let archive;
  try {
    archive = await openZip(zip);
  } catch (e) {
    throw new ImportError([`"${label}" could not be read as a zip file: ${e instanceof Error ? e.message : String(e)}`]);
  }
  const byName = new Map(archive.entries.filter((e) => !e.isDirectory).map((e) => [e.name, e]));
  return sourceFromTree({
    label,
    paths: [...byName.keys()],
    read: async (path, max) => {
      const e = byName.get(path);
      return e ? archive.read(e, max) : null;
    },
  });
}

/** Files from `<input type="file" webkitdirectory>`: paths are webkitRelativePath ("Folder/museum.json"). */
export async function sourceFromFileList(files: ArrayLike<File>): Promise<ImportSource> {
  const map = new Map<string, File>();
  let label = 'folder';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    map.set(rel, f);
    if (i === 0 && rel.includes('/')) label = rel.split('/')[0];
  }
  return sourceFromTree({
    label,
    paths: [...map.keys()],
    read: async (path, max) => {
      const f = map.get(path);
      if (!f) return null;
      if (f.size > max) throw new Error(`"${path}" is too large (max ${Math.round(max / 1048576)} MB)`);
      return f;
    },
  });
}

const hidden = (n: string) => n.startsWith('.') || n === '__MACOSX';
const MAX_WALK_DEPTH = 3;

/** Folder picked with showDirectoryPicker (read-only use). */
export async function sourceFromDirHandle(root: FsDirHandle): Promise<ImportSource> {
  const paths: string[] = [];
  async function walk(dir: FsDirHandle, prefix: string, depth: number): Promise<void> {
    for await (const [name, h] of dir.entries()) {
      if (hidden(name)) continue;
      if (h.kind === 'file') paths.push(prefix + name);
      else if (depth < MAX_WALK_DEPTH && name !== 'media' && name !== 'node_modules') await walk(h, `${prefix}${name}/`, depth + 1);
    }
  }
  await walk(root, '', 0);
  const NOT_FOUND = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
  return sourceFromTree({
    label: root.name,
    paths,
    read: async (path, max) => {
      const parts = path.split('/');
      try {
        let dir = root;
        for (const d of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(d);
        const fh: FsFileHandle = await dir.getFileHandle(parts[parts.length - 1]);
        const f = await fh.getFile();
        if (f.size > max) throw new Error(`"${path}" is too large (max ${Math.round(max / 1048576)} MB)`);
        return f;
      } catch (e) {
        if (NOT_FOUND(e)) return null;
        throw e;
      }
    },
  });
}

/** Opens the folder picker for importing (read-only). null on cancel. */
export async function pickImportFolder(): Promise<FsDirHandle | null> {
  const w = window as unknown as { showDirectoryPicker(o: { id: string; mode: 'read' }): Promise<FsDirHandle> };
  try {
    return await w.showDirectoryPicker({ id: 'import', mode: 'read' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}
