// Preview of a museum straight from the folder the editor opened (`?source=folder`). Desktop browsers
// only: it needs the File System Access API and the folder handle the editor stored in IndexedDB.
import type { Museum } from '../shared/museum';
import { MEDIA_NAME_RE } from '../shared/mediaFiles';
import { loadFolderHandle, queryAccess, requestAccess, type FsDirHandle } from '../shared/folderHandle';
import { parseMuseum } from '../shared/validate';

export const wantsFolderSource = (): boolean => new URLSearchParams(window.location.search).get('source') === 'folder';

export class FolderSourceError extends Error {
  constructor(
    readonly title: string,
    readonly details: string[],
  ) {
    super(title);
  }
}

export interface FolderSource {
  museum: Museum;
  urlFor(file: string): string;
}

/**
 * `askForAccess(name)` must resolve from a click: it is called when the browser has not yet granted
 * read access to the folder in this session, and the permission prompt needs that user gesture.
 */
export async function openFolderSource(askForAccess: (folderName: string, grant: () => Promise<boolean>) => Promise<void>): Promise<FolderSource> {
  const handle = await loadFolderHandle();
  if (!handle)
    throw new FolderSourceError('No museum folder is open', ['Open the editor, choose your museum folder there, then use its Preview button.']);
  if ((await queryAccess(handle, 'read')) !== 'granted') {
    let granted = false;
    await askForAccess(handle.name, async () => {
      granted = (await requestAccess(handle, 'read')) === 'granted';
      return granted;
    });
    if (!granted) throw new FolderSourceError('Access to the folder was not given', [`Reload this page and allow access to "${handle.name}".`]);
  }
  return readFolder(handle);
}

async function readFolder(root: FsDirHandle): Promise<FolderSource> {
  let text: string;
  try {
    text = await (await (await root.getFileHandle('museum.json')).getFile()).text();
  } catch (e) {
    throw new FolderSourceError('Could not read museum.json', [`"${root.name}" has no readable museum.json (${e instanceof Error ? e.message : String(e)}).`]);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new FolderSourceError('museum.json is not valid JSON', [String(e)]);
  }
  const parsed = parseMuseum(json);
  if (!parsed.ok) throw new FolderSourceError('museum.json is invalid', parsed.errors);

  const urls = new Map<string, string>();
  try {
    const media = await root.getDirectoryHandle('media');
    for await (const [name, h] of media.entries()) {
      if (h.kind === 'file' && MEDIA_NAME_RE.test(name)) urls.set(`media/${name}`, URL.createObjectURL(await h.getFile()));
    }
  } catch { /* no media folder: files then fail to load and are reported as warnings */ }
  return { museum: parsed.museum, urlFor: (file) => urls.get(file) ?? 'data:,' };
}
