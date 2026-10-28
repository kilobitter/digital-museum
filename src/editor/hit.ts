import type { Museum, Vec2, ZoneShape } from '../shared/museum';
import { closestPointOnSegment, wallDirection, wallLength, workPlacement } from '../shared/geometry';
import { distanceInside } from '../shared/zones';
import type { RectHandle } from './model';

export type Hit =
  | { type: 'zoneHandle'; id: string; handle: RectHandle | 'radius' }
  | { type: 'wallEnd'; id: string; end: 'a' | 'b' }
  | { type: 'spawn' }
  | { type: 'work'; id: string }
  | { type: 'wall'; id: string }
  | { type: 'zone'; id: string };

export function zoneHandles(shape: ZoneShape): { handle: RectHandle | 'radius'; p: Vec2 }[] {
  if (shape.kind === 'circle') return [{ handle: 'radius', p: { x: shape.cx + shape.r, y: shape.cy } }];
  return [
    { handle: 'nw', p: { x: shape.x, y: shape.y } },
    { handle: 'ne', p: { x: shape.x + shape.w, y: shape.y } },
    { handle: 'se', p: { x: shape.x + shape.w, y: shape.y + shape.h } },
    { handle: 'sw', p: { x: shape.x, y: shape.y + shape.h } },
  ];
}

/** The segment drawn for a work on the blueprint (on the outside of the wall face). */
export function workSegment(m: Museum, workId: string): { a: Vec2; b: Vec2; centre: Vec2 } | null {
  const work = m.works.find((w) => w.id === workId);
  const wall = work && m.walls.find((w) => w.id === work.wallId);
  if (!work || !wall) return null;
  const { center } = workPlacement(wall, work, m.settings.wallThickness);
  const d = wallDirection(wall);
  const h = work.width / 2;
  return { a: { x: center.x - d.x * h, y: center.y - d.y * h }, b: { x: center.x + d.x * h, y: center.y + d.y * h }, centre: center };
}

/** `tol` is the pick radius in metres (screen tolerance divided by zoom). */
export function hitTest(m: Museum, p: Vec2, tol: number, selectedZoneId: string | null): Hit | null {
  if (selectedZoneId) {
    const z = m.zones.find((x) => x.id === selectedZoneId);
    if (z) for (const h of zoneHandles(z.shape)) if (Math.hypot(p.x - h.p.x, p.y - h.p.y) <= tol * 1.3) return { type: 'zoneHandle', id: z.id, handle: h.handle };
  }
  let bestEnd: { id: string; end: 'a' | 'b'; d: number } | null = null;
  for (const w of m.walls)
    for (const end of ['a', 'b'] as const) {
      const d = Math.hypot(p.x - w[end].x, p.y - w[end].y);
      if (d <= tol * 1.2 && (!bestEnd || d < bestEnd.d)) bestEnd = { id: w.id, end, d };
    }
  if (bestEnd) return { type: 'wallEnd', id: bestEnd.id, end: bestEnd.end };

  const sp = m.settings.spawn;
  if (Math.hypot(p.x - sp.x, p.y - sp.y) <= Math.max(tol, 0.3)) return { type: 'spawn' };

  let bestWork: { id: string; d: number } | null = null;
  for (const w of m.works) {
    const s = workSegment(m, w.id);
    if (!s) continue;
    const d = closestPointOnSegment(p, s.a, s.b).dist;
    if (d <= Math.max(tol, 0.08) && (!bestWork || d < bestWork.d)) bestWork = { id: w.id, d };
  }
  if (bestWork) return { type: 'work', id: bestWork.id };

  let bestWall: { id: string; d: number } | null = null;
  for (const w of m.walls) {
    if (wallLength(w) === 0) continue;
    const d = closestPointOnSegment(p, w.a, w.b).dist;
    if (d <= Math.max(tol, m.settings.wallThickness / 2) && (!bestWall || d < bestWall.d)) bestWall = { id: w.id, d };
  }
  if (bestWall) return { type: 'wall', id: bestWall.id };

  for (let i = m.zones.length - 1; i >= 0; i--) if (distanceInside(m.zones[i].shape, p) > 0) return { type: 'zone', id: m.zones[i].id };
  return null;
}

export type AreaHit =
  | { type: 'areaHandle'; id: string; handle: RectHandle }
  | { type: 'area'; id: string };

export function areaHandles(rect: { x: number; y: number; w: number; h: number }): { handle: RectHandle; p: Vec2 }[] {
  return [
    { handle: 'nw', p: { x: rect.x, y: rect.y } },
    { handle: 'ne', p: { x: rect.x + rect.w, y: rect.y } },
    { handle: 'se', p: { x: rect.x + rect.w, y: rect.y + rect.h } },
    { handle: 'sw', p: { x: rect.x, y: rect.y + rect.h } },
  ];
}

/** Areas layer: handles of the selected area first, then the top-most area under the point. Nothing else is hit. */
export function hitTestAreas(m: Museum, p: Vec2, tol: number, selectedAreaId: string | null): AreaHit | null {
  const sel = selectedAreaId ? m.areas.find((a) => a.id === selectedAreaId) : undefined;
  if (sel) for (const h of areaHandles(sel.rect)) if (Math.hypot(p.x - h.p.x, p.y - h.p.y) <= tol * 1.3) return { type: 'areaHandle', id: sel.id, handle: h.handle };
  for (let i = m.areas.length - 1; i >= 0; i--) {
    const r = m.areas[i].rect;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { type: 'area', id: m.areas[i].id };
  }
  return null;
}
