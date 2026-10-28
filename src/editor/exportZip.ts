// Export a museum as one .zip: museum.json (as saved) plus every file in its media list.
import type { Museum } from '../shared/museum';
import { parseMuseum } from '../shared/validate';
import { writeZip } from '../shared/zip';
import type { MuseumStore } from './store';

/** A safe file name for the download. */
export function zipFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
  return `${clean || 'museum'}.zip`;
}

export async function exportMuseumZip(
  museum: Museum,
  store: Pick<MuseumStore, 'mediaUrl'>,
  fetchFn: (url: string) => Promise<{ ok: boolean; blob(): Promise<Blob> }> = (u) => fetch(u),
): Promise<{ blob: Blob; missing: string[]; fileName: string }> {
  const parsed = parseMuseum(museum);
  const json = JSON.stringify(parsed.ok ? parsed.museum : museum, null, 2) + '\n';
  const entries: { name: string; data: Blob }[] = [{ name: 'museum.json', data: new Blob([json], { type: 'application/json' }) }];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const item of museum.media) {
    if (seen.has(item.file)) continue;
    seen.add(item.file);
    const url = store.mediaUrl(item.file);
    try {
      const res = url ? await fetchFn(url) : null;
      if (!res || !res.ok) throw new Error('missing');
      entries.push({ name: item.file, data: await res.blob() });
    } catch {
      missing.push(item.file);
    }
  }
  return { blob: await writeZip(entries), missing, fileName: zipFileName(museum.name) };
}
