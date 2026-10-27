// Library helpers: painting search / filter / counts.
import type { MediaItem, Museum } from '../shared/museum';

export type HungFilter = 'all' | 'hung' | 'unhung';

export const hungIds = (m: Museum): Set<string> => new Set(m.works.map((w) => w.mediaId));

/** Case-insensitive match on title, artist and original file name (all words must match). */
export function filterPaintings(m: Museum, query: string, filter: HungFilter): MediaItem[] {
  const hung = hungIds(m);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return m.media.filter((it) => {
    if (it.kind !== 'image') return false;
    if (filter === 'hung' && !hung.has(it.id)) return false;
    if (filter === 'unhung' && hung.has(it.id)) return false;
    if (words.length === 0) return true;
    const hay = `${it.title ?? ''}\n${it.artist ?? ''}\n${it.name}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function paintingCounts(m: Museum): { total: number; unhung: number } {
  const hung = hungIds(m);
  let total = 0, unhung = 0;
  for (const it of m.media) {
    if (it.kind !== 'image') continue;
    total++;
    if (!hung.has(it.id)) unhung++;
  }
  return { total, unhung };
}

export const countLabel = (c: { total: number; unhung: number }) => `${c.total} painting${c.total === 1 ? '' : 's'} · ${c.unhung} unhung`;

/** Index window [start, end) of fixed-width items visible in a scroller, with `overscan` extra items each side. */
export function visibleWindow(scrollLeft: number, viewWidth: number, itemWidth: number, count: number, overscan = 4): [number, number] {
  const start = Math.min(count, Math.max(0, Math.floor(scrollLeft / itemWidth) - overscan));
  const end = Math.min(count, Math.ceil((scrollLeft + viewWidth) / itemWidth) + overscan);
  return [start, Math.max(start, end)];
}
