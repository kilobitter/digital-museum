// Bulk upload helpers: a small concurrency pool, duplicate detection and a result summary.

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Never rejects: each item's outcome
 * is returned in input order. `onDone(finished, total)` fires after each item settles.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onDone?: (finished: number, total: number) => void,
): Promise<({ ok: true; value: R } | { ok: false; error: unknown })[]> {
  const results: ({ ok: true; value: R } | { ok: false; error: unknown })[] = new Array(items.length);
  let next = 0;
  let finished = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
      onDone?.(++finished, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane));
  return results;
}

/**
 * A file already in the library: an existing item with the same original name (MediaItem.name) AND a
 * known, equal byte size. The museum format has no field for the original size, so sizes are remembered
 * per browser (`knownSizes`, keyed by stored file). An unknown size is never a match: camera names like
 * "IMG_0001.jpg" collide constantly, and silently dropping someone's work is worse than a duplicate.
 * Callers add files of the current batch to `library` with their size recorded, so identical
 * name + size twins within one drop skip the second, while same name with a different size uploads both.
 */
export function isDuplicate(
  library: readonly { name: string; file: string }[],
  knownSizes: Readonly<Record<string, number>>,
  file: { name: string; size: number },
): boolean {
  return library.some((it) => it.name === file.name && knownSizes[it.file] !== undefined && knownSizes[it.file] === file.size);
}

export function summarizeUpload(added: number, skipped: string[], failures: string[]): string {
  const list = (xs: string[]) => xs.slice(0, 4).join('; ') + (xs.length > 4 ? `; and ${xs.length - 4} more` : '');
  const parts = [`${added} uploaded`];
  if (skipped.length) parts.push(`${skipped.length} already in library (${list(skipped)})`);
  if (failures.length) parts.push(`${failures.length} failed: ${list(failures)}`);
  return parts.join(' | ');
}
