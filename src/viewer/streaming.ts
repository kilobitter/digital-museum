// Pure streaming policies: which items to load / unload for a given head position.
// Used for paintings (distance to the work) and audio zones (distance to the zone edge).
import type { Vec2 } from '../shared/museum';

export interface StreamLimits {
  /** Items at or inside this distance are wanted. */
  loadRadius: number;
  /** Resident items stay until they are farther than this (> loadRadius: hysteresis). */
  unloadRadius: number;
  /** Hard cap on resident + loading items. The farthest are evicted first. */
  maxResident: number;
  /** Max loads in flight at once. */
  maxConcurrent: number;
}

export interface StreamEntry {
  id: string;
  /** Distance from the head, metres. */
  dist: number;
}

export interface StreamPlan {
  /** Nearest first; already limited by free concurrency slots and the resident cap. */
  load: string[];
  /** Resident or in-flight items to release (farthest first). */
  unload: string[];
}

/**
 * `resident` = loaded items, `loading` = requests in flight. Both count against `maxResident`.
 * Rules: keep (resident|loading) items within unloadRadius; want unseen items within loadRadius;
 * if keep+want exceeds the cap, the nearest win and the farthest resident ones are evicted.
 */
export function planByDistance(
  entries: readonly StreamEntry[],
  resident: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  limits: StreamLimits,
): StreamPlan {
  const keep: StreamEntry[] = [];
  const want: StreamEntry[] = [];
  const unload: StreamEntry[] = [];
  for (const e of entries) {
    const have = resident.has(e.id) || loading.has(e.id);
    if (have) (e.dist <= limits.unloadRadius ? keep : unload).push(e);
    else if (e.dist <= limits.loadRadius) want.push(e);
  }
  const byDist = (a: StreamEntry, b: StreamEntry) => a.dist - b.dist || (a.id < b.id ? -1 : 1);
  keep.sort(byDist);
  want.sort(byDist);

  // Cap: nearest first among keep + want.
  const all = [...keep, ...want].sort(byDist);
  const allowed = new Set(all.slice(0, Math.max(0, limits.maxResident)).map((e) => e.id));
  for (const e of keep) if (!allowed.has(e.id)) unload.push(e);
  unload.sort((a, b) => b.dist - a.dist || (a.id < b.id ? -1 : 1));

  const slots = Math.max(0, limits.maxConcurrent - loading.size);
  const load = want.filter((e) => allowed.has(e.id)).slice(0, slots).map((e) => e.id);
  return { load, unload: unload.map((e) => e.id) };
}

export interface StreamItem {
  id: string;
  x: number;
  y: number;
}

/** Plan-distance variant: items are points. */
export function planStreaming(
  head: Vec2,
  items: readonly StreamItem[],
  resident: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  limits: StreamLimits,
): StreamPlan {
  const entries = items.map((it) => ({ id: it.id, dist: Math.hypot(it.x - head.x, it.y - head.y) }));
  return planByDistance(entries, resident, loading, limits);
}

export const PAINTING_LIMITS: StreamLimits = { loadRadius: 15, unloadRadius: 20, maxResident: 70, maxConcurrent: 4 };
/** Decoded audio is large (about 10 MB per minute per channel pair at 44.1 kHz), so the cap is small. */
export const AUDIO_LIMITS: StreamLimits = { loadRadius: 10, unloadRadius: 15, maxResident: 8, maxConcurrent: 2 };
