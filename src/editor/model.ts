// Pure editor operations on an immutable Museum. No React, no DOM.
import type { AudioZone, MediaItem, Museum, MuseumSettings, Vec2, Wall, WallSide, Work, ZoneShape } from '../shared/museum';
import { closestPointOnSegment, wallLength, wallNormal } from '../shared/geometry';

export const EPS = 1e-4;

export const round4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0;
export const snapValue = (v: number, grid: number) => round4(Math.round(v / grid) * grid);
export const snapPoint = (p: Vec2, grid: number): Vec2 => ({ x: snapValue(p.x, grid), y: snapValue(p.y, grid) });

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId(prefix: string, taken: Iterable<string>, rand: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    const id = `${prefix}-${s}`;
    if (!used.has(id)) return id;
  }
}

export const findWall = (m: Museum, id: string) => m.walls.find((w) => w.id === id);
export const findWork = (m: Museum, id: string) => m.works.find((w) => w.id === id);
export const findZone = (m: Museum, id: string) => m.zones.find((z) => z.id === id);
export const findMedia = (m: Museum, id: string) => m.media.find((x) => x.id === id);

const samePt = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;

// ---------- walls ----------

export function addWall(m: Museum, a: Vec2, b: Vec2): { museum: Museum; id: string } | null {
  if (samePt(a, b)) return null;
  const id = newId('wall', m.walls.map((w) => w.id));
  return { museum: { ...m, walls: [...m.walls, { id, a: { ...a }, b: { ...b } }] }, id };
}

/** Four walls around the rectangle; consecutive walls share the exact same corner coordinates. */
export function addRoom(m: Museum, p1: Vec2, p2: Vec2): { museum: Museum; ids: string[] } | null {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
  if (x1 - x0 < EPS || y1 - y0 < EPS) return null;
  const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const taken = m.walls.map((w) => w.id);
  const walls: Wall[] = [];
  for (let i = 0; i < 4; i++) {
    const id = newId('wall', taken);
    taken.push(id);
    walls.push({ id, a: { ...c[i] }, b: { ...c[(i + 1) % 4] } });
  }
  return { museum: { ...m, walls: [...m.walls, ...walls] }, ids: walls.map((w) => w.id) };
}

export interface EndpointRef {
  wallId: string;
  end: 'a' | 'b';
}

/** All wall endpoints coincident with the given one (including itself). */
export function coincidentEndpoints(m: Museum, wallId: string, end: 'a' | 'b'): EndpointRef[] {
  const w = findWall(m, wallId);
  if (!w) return [];
  const p = w[end];
  const out: EndpointRef[] = [];
  for (const o of m.walls) {
    if (samePt(o.a, p)) out.push({ wallId: o.id, end: 'a' });
    if (samePt(o.b, p)) out.push({ wallId: o.id, end: 'b' });
  }
  return out;
}

/** Move the given endpoints to `to`. Returns the museum unchanged if any wall would collapse to zero length. */
export function moveEndpoints(m: Museum, refs: EndpointRef[], to: Vec2): Museum {
  const walls = m.walls.map((w) => {
    let a = w.a, b = w.b;
    for (const r of refs) {
      if (r.wallId !== w.id) continue;
      if (r.end === 'a') a = { ...to };
      else b = { ...to };
    }
    return a === w.a && b === w.b ? w : { ...w, a, b };
  });
  if (walls.some((w) => samePt(w.a, w.b))) return m;
  return { ...m, walls };
}

export function moveWall(m: Museum, wallId: string, delta: Vec2): Museum {
  return {
    ...m,
    walls: m.walls.map((w) =>
      w.id === wallId ? { ...w, a: { x: round4(w.a.x + delta.x), y: round4(w.a.y + delta.y) }, b: { x: round4(w.b.x + delta.x), y: round4(w.b.y + delta.y) } } : w,
    ),
  };
}

export function deleteWall(m: Museum, wallId: string): Museum {
  return { ...m, walls: m.walls.filter((w) => w.id !== wallId), works: m.works.filter((w) => w.wallId !== wallId) };
}

// ---------- works ----------

export function imageHeight(m: Museum, work: Work): number {
  const media = findMedia(m, work.mediaId);
  if (media?.width && media.height) return (work.width * media.height) / media.width;
  return work.width;
}

/** Clamp t so the whole work stays on its wall (centred when the wall is shorter than the work). */
export function clampT(wall: Wall, width: number, t: number): number {
  const len = wallLength(wall);
  if (len <= width) return round4(len / 2);
  return round4(Math.min(Math.max(t, width / 2), len - width / 2));
}

export interface HangTarget {
  wallId: string;
  side: WallSide;
  t: number;
  /** Where the closest point on the wall centre line is. */
  point: Vec2;
}

/** Wall face under a plan-space point: nearest wall within thickness/2 + tolerance; side from which side of the centre line the point is on. */
export function findHangTarget(m: Museum, p: Vec2, tolerance = 0.4): HangTarget | null {
  let best: { wall: Wall; cp: ReturnType<typeof closestPointOnSegment> } | null = null;
  for (const wall of m.walls) {
    const cp = closestPointOnSegment(p, wall.a, wall.b);
    if (cp.dist > m.settings.wallThickness / 2 + tolerance) continue;
    if (!best || cp.dist < best.cp.dist) best = { wall, cp };
  }
  if (!best) return null;
  const n = wallNormal(best.wall, 1);
  const side: WallSide = (p.x - best.cp.point.x) * n.x + (p.y - best.cp.point.y) * n.y >= 0 ? 1 : -1;
  return { wallId: best.wall.id, side, t: best.cp.t, point: best.cp.point };
}

export function defaultWorkWidth(wallLen: number): number {
  return round4(Math.max(0.1, Math.min(1.0, wallLen - 0.2)));
}

export function hangWork(m: Museum, mediaId: string, target: HangTarget): { museum: Museum; id: string } | null {
  const media = findMedia(m, mediaId);
  const wall = findWall(m, target.wallId);
  if (!media || media.kind !== 'image' || !wall) return null;
  const width = defaultWorkWidth(wallLength(wall));
  const id = newId('work', m.works.map((w) => w.id));
  const work: Work = {
    id,
    mediaId,
    wallId: wall.id,
    side: target.side,
    t: clampT(wall, width, target.t),
    centerHeight: 1.5,
    width,
    title: media.name.replace(/\.[^./\\]+$/, ''),
    artist: '',
  };
  return { museum: { ...m, works: [...m.works, work] }, id };
}

export function updateWork(m: Museum, id: string, patch: Partial<Omit<Work, 'id'>>): Museum {
  return { ...m, works: m.works.map((w) => (w.id === id ? { ...w, ...patch } : w)) };
}

export function setWorkT(m: Museum, id: string, t: number): Museum {
  const w = findWork(m, id);
  const wall = w && findWall(m, w.wallId);
  if (!w || !wall) return m;
  return updateWork(m, id, { t: clampT(wall, w.width, t) });
}

export function setWorkWidth(m: Museum, id: string, width: number): Museum {
  const w = findWork(m, id);
  if (!w || !(width > 0)) return m;
  return updateWork(m, id, { width });
}

export function flipWork(m: Museum, id: string): Museum {
  const w = findWork(m, id);
  return w ? updateWork(m, id, { side: w.side === 1 ? -1 : 1 }) : m;
}

export function deleteWork(m: Museum, id: string): Museum {
  return { ...m, works: m.works.filter((w) => w.id !== id) };
}

// ---------- zones ----------

export function addZone(m: Museum, shape: ZoneShape, mediaId: string): { museum: Museum; id: string } {
  const id = newId('zone', m.zones.map((z) => z.id));
  const n = m.zones.length + 1;
  const zone: AudioZone = { id, name: `Zone ${n}`, mediaId, shape, volume: 0.8, fade: 1 };
  return { museum: { ...m, zones: [...m.zones, zone] }, id };
}

export function updateZone(m: Museum, id: string, patch: Partial<Omit<AudioZone, 'id'>>): Museum {
  return { ...m, zones: m.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) };
}

export function deleteZone(m: Museum, id: string): Museum {
  return { ...m, zones: m.zones.filter((z) => z.id !== id) };
}

export function moveZone(m: Museum, id: string, delta: Vec2): Museum {
  const z = findZone(m, id);
  if (!z) return m;
  const s = z.shape;
  const shape: ZoneShape =
    s.kind === 'rect' ? { ...s, x: round4(s.x + delta.x), y: round4(s.y + delta.y) } : { ...s, cx: round4(s.cx + delta.x), cy: round4(s.cy + delta.y) };
  return updateZone(m, id, { shape });
}

export type RectHandle = 'nw' | 'ne' | 'se' | 'sw';

/** Drag a rect corner to `p`, keeping the opposite corner fixed; min size `minSize`. */
export function resizeRect(shape: Extract<ZoneShape, { kind: 'rect' }>, handle: RectHandle, p: Vec2, minSize = 0.1): ZoneShape {
  const left = handle === 'nw' || handle === 'sw';
  const top = handle === 'nw' || handle === 'ne';
  const fixedX = left ? shape.x + shape.w : shape.x;
  const fixedY = top ? shape.y + shape.h : shape.y;
  let x = left ? Math.min(p.x, fixedX - minSize) : fixedX;
  let y = top ? Math.min(p.y, fixedY - minSize) : fixedY;
  let w = left ? fixedX - x : Math.max(p.x - fixedX, minSize);
  let h = top ? fixedY - y : Math.max(p.y - fixedY, minSize);
  x = round4(x); y = round4(y); w = round4(w); h = round4(h);
  return { kind: 'rect', x, y, w, h };
}

export function resizeCircle(shape: Extract<ZoneShape, { kind: 'circle' }>, p: Vec2, minR = 0.1): ZoneShape {
  return { ...shape, r: round4(Math.max(minR, Math.hypot(p.x - shape.cx, p.y - shape.cy))) };
}

// ---------- settings / spawn / media ----------

export function updateSettings(m: Museum, patch: Partial<Omit<MuseumSettings, 'spawn'>>): Museum {
  return { ...m, settings: { ...m.settings, ...patch } };
}

export function setSpawn(m: Museum, patch: Partial<MuseumSettings['spawn']>): Museum {
  return { ...m, settings: { ...m.settings, spawn: { ...m.settings.spawn, ...patch } } };
}

export function mediaUsage(m: Museum, mediaId: string): number {
  return m.works.filter((w) => w.mediaId === mediaId).length + m.zones.filter((z) => z.mediaId === mediaId).length;
}

export function addMedia(m: Museum, item: Omit<MediaItem, 'id'>): { museum: Museum; id: string } {
  const id = newId('m', m.media.map((x) => x.id));
  return { museum: { ...m, media: [...m.media, { ...item, id }] }, id };
}

/** Removes a media entry; refuses (returns null) while it is still used. */
export function removeMedia(m: Museum, mediaId: string): Museum | null {
  if (mediaUsage(m, mediaId) > 0) return null;
  return { ...m, media: m.media.filter((x) => x.id !== mediaId) };
}

// ---------- warnings ----------

export interface EditorWarning {
  kind: 'past-wall-end' | 'overlap' | 'above-wall' | 'below-floor' | 'zone-no-audio' | 'spawn-in-wall';
  message: string;
  target: { type: 'work' | 'zone' | 'spawn'; id: string };
}

export function computeWarnings(m: Museum): EditorWarning[] {
  const out: EditorWarning[] = [];
  const label = (w: Work) => `"${w.title || w.id}"`;
  const tol = 1e-6;

  for (const w of m.works) {
    const wall = findWall(m, w.wallId);
    if (wall) {
      const len = wallLength(wall);
      if (w.t - w.width / 2 < -tol || w.t + w.width / 2 > len + tol)
        out.push({ kind: 'past-wall-end', message: `Work ${label(w)} extends past the end of its wall`, target: { type: 'work', id: w.id } });
    }
    const h = imageHeight(m, w);
    if (w.centerHeight + h / 2 > m.settings.wallHeight + tol)
      out.push({ kind: 'above-wall', message: `Work ${label(w)} reaches above the wall top (${round4(w.centerHeight + h / 2)} m > ${m.settings.wallHeight} m)`, target: { type: 'work', id: w.id } });
    if (w.centerHeight - h / 2 < -tol)
      out.push({ kind: 'below-floor', message: `Work ${label(w)} hangs below the floor`, target: { type: 'work', id: w.id } });
  }

  for (let i = 0; i < m.works.length; i++) {
    for (let j = i + 1; j < m.works.length; j++) {
      const a = m.works[i], b = m.works[j];
      if (a.wallId !== b.wallId || a.side !== b.side) continue;
      const dx = Math.abs(a.t - b.t) - (a.width + b.width) / 2;
      const dy = Math.abs(a.centerHeight - b.centerHeight) - (imageHeight(m, a) + imageHeight(m, b)) / 2;
      if (dx < -tol && dy < -tol)
        out.push({ kind: 'overlap', message: `Works ${label(a)} and ${label(b)} overlap on the same wall face`, target: { type: 'work', id: b.id } });
    }
  }

  for (const z of m.zones) {
    const media = findMedia(m, z.mediaId);
    if (!media || media.kind !== 'audio')
      out.push({ kind: 'zone-no-audio', message: `Zone "${z.name || z.id}" has no audio`, target: { type: 'zone', id: z.id } });
  }

  const sp = m.settings.spawn;
  for (const wall of m.walls) {
    if (closestPointOnSegment(sp, wall.a, wall.b).dist < m.settings.wallThickness / 2) {
      out.push({ kind: 'spawn-in-wall', message: 'The spawn point is inside a wall', target: { type: 'spawn', id: 'spawn' } });
      break;
    }
  }
  return out;
}
