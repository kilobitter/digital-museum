// Maps FolderFs onto a real FileSystemDirectoryHandle. Refuses any path other than `museum.json`
// and `media/<single name>`, so the editor can never touch anything else in the user's folder.
import type { FsDirHandle } from '../shared/folderHandle';
import type { FolderFs } from './folderStore';

type Target = { dirName: '' | 'media'; name: string };

function parsePath(path: string): Target {
  if (path === 'museum.json') return { dirName: '', name: 'museum.json' };
  const m = /^media\/([^/\\]+)$/.exec(path);
  if (m && m[1] !== '.' && m[1] !== '..') return { dirName: 'media', name: m[1] };
  throw new Error(`Refusing to touch ${path}`);
}

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

export function fsFromHandle(root: FsDirHandle): FolderFs {
  async function dirOf(dirName: '' | 'media', create: boolean): Promise<FsDirHandle | null> {
    if (dirName === '') return root;
    try {
      return await root.getDirectoryHandle('media', { create });
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  return {
    name: root.name,
    async readFile(path) {
      const t = parsePath(path);
      const dir = await dirOf(t.dirName, false);
      if (!dir) return null;
      try {
        return await (await dir.getFileHandle(t.name)).getFile();
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async writeFile(path, data) {
      const t = parsePath(path);
      const dir = (await dirOf(t.dirName, true))!;
      const w = await (await dir.getFileHandle(t.name, { create: true })).createWritable();
      try {
        await w.write(data);
        await w.close();
      } catch (e) {
        await w.abort?.().catch(() => {});
        throw e;
      }
    },
    async removeFile(path) {
      const t = parsePath(path);
      const dir = await dirOf(t.dirName, false);
      if (!dir) return;
      try {
        await dir.removeEntry(t.name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
    async list(dirName) {
      const dir = await dirOf(dirName, false);
      if (!dir) return [];
      const names: string[] = [];
      for await (const [name] of dir.entries()) names.push(name);
      return names;
    },
  };
}
