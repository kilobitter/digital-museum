// Import orchestration without UI: dedupe against the host library, read + upload the guest's files.
// The merge itself is pure (importMerge.ts); this only does the I/O around it.
import type { MediaItem, Museum } from '../shared/museum';
import type { MediaMapping } from './importMerge';
import { usedMediaIds } from './importMerge';
import type { ImportSource } from './importSource';
import type { MuseumStore } from './store';
import { runPool } from './uploadQueue';

export type PrepareResult =
  | { ok: true; mappings: Map<string, MediaMapping>; uploaded: number; warnings: string[] }
  | { ok: false; failures: string[]; uploaded: number };

const baseName = (file: string) => file.slice(file.lastIndexOf('/') + 1);

/**
 * Decides what to do with each guest media item and uploads what is needed through `store.upload`.
 * An item whose `file` path and `kind` equal a host item's is reused (museums started from a common copy);
 * no content hashing. Stops with `ok: false` when any upload fails (nothing in the museum has changed yet;
 * files already uploaded stay as unused media). Unreadable or missing source files just become "missing".
 */
export async function prepareMedia(
  host: Museum,
  source: ImportSource,
  store: Pick<MuseumStore, 'upload'>,
  opts: { onlyUsed?: boolean; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<PrepareResult> {
  const guest = source.museum;
  const used = usedMediaIds(guest);
  const mappings = new Map<string, MediaMapping>();
  const warnings: string[] = [];
  const todo: MediaItem[] = [];
  for (const item of guest.media) {
    if (opts.onlyUsed && !used.has(item.id)) continue;
    const same = host.media.find((h) => h.file === item.file && h.kind === item.kind);
    if (same) mappings.set(item.id, { reuse: same.id });
    else todo.push(item);
  }
  const total = todo.length;
  opts.onProgress?.(0, total);
  const results = await runPool(
    todo,
    opts.concurrency ?? 3,
    async (item) => {
      let blob: Blob | null;
      try {
        blob = await source.readMedia(item.file);
      } catch (e) {
        warnings.push(`${item.name || item.file} could not be read: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
      if (!blob) return null; // missing: the merge reports it
      return store.upload(baseName(item.file), blob);
    },
    (done) => opts.onProgress?.(done, total),
  );
  const failures: string[] = [];
  let uploaded = 0;
  results.forEach((r, i) => {
    if (!r.ok) failures.push(`${todo[i].name || todo[i].file}: ${r.error instanceof Error ? r.error.message : String(r.error)}`);
    else if (r.value !== null) {
      uploaded++;
      mappings.set(todo[i].id, { file: r.value });
    }
  });
  if (failures.length) return { ok: false, failures, uploaded };
  return { ok: true, mappings, uploaded, warnings };
}
