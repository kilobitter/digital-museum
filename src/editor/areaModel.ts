// Pure editor operations for floor/ceiling/open-sky areas. No React, no DOM.
import type { Area, Finish, Museum, Vec2 } from '../shared/museum';
import { closestPointOnSegment } from '../shared/geometry';
import { EPS, newId, round4, snapPoint, type RectHandle } from './model';

export type AreaRect = Area['rect'];
export const WALL_SNAP_M = 0.3;
export const MIN_AREA_SIZE = 0.1;

export const findArea = (m: Museum, id: string) => m.areas.find((a) => a.id === id);

/** Finish given to a new area's floor (a neutral warm tone, distinct from the default floor). */
export const NEW_AREA_FLOOR: Finish = { color: '#c9b99a', tileSize: 1 };

export function addArea(m: Museum, rect: AreaRect): { museum: Museum; id: string } | null {
  if (!(rect.w > EPS) || !(rect.h > EPS)) return null;
  const id = newId('area', m.areas.map((a) => a.id));
  const area: Area = {
    id,
    name: `Area ${m.areas.length + 1}`,
    rect: { x: round4(rect.x), y: round4(rect.y), w: round4(rect.w), h: round4(rect.h) },
    floor: { ...NEW_AREA_FLOOR },
  };
  return { museum: { ...m, areas: [...m.areas, area] }, id };
}

export function updateArea(m: Museum, id: string, patch: Partial<Omit<Area, 'id'>>): Museum {
  return {
    ...m,
    areas: m.areas.map((a) => {
      if (a.id !== id) return a;
      const next = { ...a, ...patch };
      if (next.floor === undefined) delete next.floor;
      if (next.ceiling === undefined) delete next.ceiling;
      if (next.openSky === undefined) delete next.openSky;
      return next;
    }),
  };
}

export type CeilingMode = 'none' | 'finish' | 'open';

export const ceilingModeOf = (a: Area): CeilingMode => (a.openSky ? 'open' : a.ceiling ? 'finish' : 'none');

/**
 * Switch what an area does to the ceiling: nothing, its own finish (`dflt` is used when it has none yet), or open
 * sky. An area must keep at least one of floor / ceiling / openSky, so 'none' is refused (museum returned as is)
 * for an area without a floor.
 */
export function setCeilingMode(m: Museum, id: string, mode: CeilingMode, dflt: Finish): Museum {
  const a = findArea(m, id);
  if (!a) return m;
  if (mode === 'none') return a.floor ? updateArea(m, id, { ceiling: undefined, openSky: undefined }) : m;
  if (mode === 'open') return updateArea(m, id, { ceiling: undefined, openSky: true });
  return updateArea(m, id, { ceiling: a.ceiling ?? { ...dflt }, openSky: undefined });
}

export function setAreaRect(m: Museum, id: string, patch: Partial<AreaRect>): Museum {
  const a = findArea(m, id);
  return a ? updateArea(m, id, { rect: { ...a.rect, ...patch } }) : m;
}

export function moveArea(m: Museum, id: string, delta: Vec2): Museum {
  const a = findArea(m, id);
  if (!a) return m;
  return updateArea(m, id, { rect: { ...a.rect, x: round4(a.rect.x + delta.x), y: round4(a.rect.y + delta.y) } });
}

/** Drag a corner of the rect to `p`; the opposite corner stays fixed. */
export function resizeAreaRect(rect: AreaRect, handle: RectHandle, p: Vec2, minSize = MIN_AREA_SIZE): AreaRect {
  const left = handle === 'nw' || handle === 'sw';
  const top = handle === 'nw' || handle === 'ne';
  const fx = left ? rect.x + rect.w : rect.x;
  const fy = top ? rect.y + rect.h : rect.y;
  const x = left ? Math.min(p.x, fx - minSize) : fx;
  const y = top ? Math.min(p.y, fy - minSize) : fy;
  const w = left ? fx - x : Math.max(p.x - fx, minSize);
  const h = top ? fy - y : Math.max(p.y - fy, minSize);
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

export function deleteArea(m: Museum, id: string): Museum {
  return { ...m, areas: m.areas.filter((a) => a.id !== id) };
}

/** A copy directly on top of the original, shifted by `offset` metres. */
export function duplicateArea(m: Museum, id: string, offset = 0.5): { museum: Museum; id: string } | null {
  const a = findArea(m, id);
  if (!a) return null;
  const nid = newId('area', m.areas.map((x) => x.id));
  const copy: Area = {
    ...a,
    id: nid,
    name: a.name ? `${a.name} copy` : '',
    rect: { ...a.rect, x: round4(a.rect.x + offset), y: round4(a.rect.y + offset) },
    ...(a.floor ? { floor: { ...a.floor } } : {}),
    ...(a.ceiling ? { ceiling: { ...a.ceiling } } : {}),
  };
  return { museum: { ...m, areas: [...m.areas, copy] }, id: nid };
}

export type Reorder = 'forward' | 'backward' | 'front' | 'back';

/** Change an area's place in the stack (later = drawn on top). Returns the same museum when nothing moves. */
export function reorderArea(m: Museum, id: string, how: Reorder): Museum {
  const i = m.areas.findIndex((a) => a.id === id);
  if (i < 0) return m;
  const j = how === 'forward' ? i + 1 : how === 'backward' ? i - 1 : how === 'front' ? m.areas.length - 1 : 0;
  if (j < 0 || j >= m.areas.length || j === i) return m;
  const areas = m.areas.slice();
  const [a] = areas.splice(i, 1);
  areas.splice(j, 0, a);
  return { ...m, areas };
}

// ---------- snapping ----------

/** x positions of vertical walls and y positions of horizontal walls (centre lines). */
export function wallLines(m: Museum): { xs: number[]; ys: number[] } {
  const xs = new Set<number>(), ys = new Set<number>();
  for (const w of m.walls) {
    if (Math.abs(w.a.x - w.b.x) < EPS) xs.add(round4((w.a.x + w.b.x) / 2));
    else if (Math.abs(w.a.y - w.b.y) < EPS) ys.add(round4((w.a.y + w.b.y) / 2));
  }
  return { xs: [...xs], ys: [...ys] };
}

/** The shift (line - value) to the closest line within `tol` for any of `values`, or null. */
function bestShift(values: number[], lines: number[], tol: number): number | null {
  let best: number | null = null;
  for (const v of values) for (const l of lines) {
    const d = l - v;
    if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/** Snap a point: to wall centre lines within ~0.3 m per axis, else to the grid. */
export function snapAreaPoint(m: Museum, p: Vec2, grid: number, tol = WALL_SNAP_M): Vec2 {
  const { xs, ys } = wallLines(m);
  const sx = bestShift([p.x], xs, tol), sy = bestShift([p.y], ys, tol);
  const g = snapPoint(p, grid);
  return { x: sx === null ? g.x : round4(p.x + sx), y: sy === null ? g.y : round4(p.y + sy) };
}

/**
 * Snap a whole rect being moved by `delta` (already grid-snapped by the caller): either of its
 * left/right edges to a vertical wall line, top/bottom to a horizontal one, within ~0.3 m.
 */
export function snapAreaMove(m: Museum, rect: AreaRect, delta: Vec2, tol = WALL_SNAP_M): Vec2 {
  const { xs, ys } = wallLines(m);
  const x = rect.x + delta.x, y = rect.y + delta.y;
  const sx = bestShift([x, x + rect.w], xs, tol), sy = bestShift([y, y + rect.h], ys, tol);
  return { x: round4(delta.x + (sx ?? 0)), y: round4(delta.y + (sy ?? 0)) };
}

/** Rect between two drag points, grid-and-wall snapped. */
export function rectFromDrag(a: Vec2, b: Vec2): AreaRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// ---------- fill room ----------

/**
 * The largest axis-aligned rectangle around `p` bounded by the nearest walls: rays are cast left,
 * right, up and down; the first wall segment each ray crosses fixes that edge at the wall's centre
 * line. A ray that misses (e.g. goes through a doorway gap) continues to the next wall. Returns null
 * when `p` is inside a wall or any ray hits nothing (open side).
 */
export function fillRoom(m: Museum, p: Vec2): AreaRect | null {
  const half = m.settings.wallThickness / 2;
  for (const w of m.walls) if (closestPointOnSegment(p, w.a, w.b).dist < half) return null;
  let left = -Infinity, right = Infinity, up = -Infinity, down = Infinity;
  for (const w of m.walls) {
    // horizontal ray (y = p.y) against non-horizontal walls
    if (Math.abs(w.a.y - w.b.y) > EPS && p.y >= Math.min(w.a.y, w.b.y) - EPS && p.y <= Math.max(w.a.y, w.b.y) + EPS) {
      const x = w.a.x + ((p.y - w.a.y) * (w.b.x - w.a.x)) / (w.b.y - w.a.y);
      if (x < p.x - EPS) left = Math.max(left, x);
      else if (x > p.x + EPS) right = Math.min(right, x);
    }
    // vertical ray (x = p.x) against non-vertical walls
    if (Math.abs(w.a.x - w.b.x) > EPS && p.x >= Math.min(w.a.x, w.b.x) - EPS && p.x <= Math.max(w.a.x, w.b.x) + EPS) {
      const y = w.a.y + ((p.x - w.a.x) * (w.b.y - w.a.y)) / (w.b.x - w.a.x);
      if (y < p.y - EPS) up = Math.max(up, y);
      else if (y > p.y + EPS) down = Math.min(down, y);
    }
  }
  if (![left, right, up, down].every(Number.isFinite)) return null;
  const rect = { x: round4(left), y: round4(up), w: round4(right - left), h: round4(down - up) };
  return rect.w > EPS && rect.h > EPS ? rect : null;
}

/** Colour of an open-sky area on the blueprint. */
export const SKY_BLUE = '#8fc4f0';

/** Short surface tag for the blueprint label: F = floor, C = ceiling finish, O = open sky, e.g. "F+O". */
export function areaTag(a: Area): string {
  return [a.floor ? 'F' : '', a.ceiling ? 'C' : '', a.openSky ? 'O' : ''].filter(Boolean).join('+');
}
