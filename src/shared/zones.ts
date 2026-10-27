import type { AudioZone, Vec2, ZoneShape } from './museum';

/** >0 inside = distance to nearest edge; <=0 outside (negative distance to the shape). */
export function distanceInside(shape: ZoneShape, p: Vec2): number {
  if (shape.kind === 'circle') {
    return shape.r - Math.hypot(p.x - shape.cx, p.y - shape.cy);
  }
  const dl = p.x - shape.x;
  const dr = shape.x + shape.w - p.x;
  const dt = p.y - shape.y;
  const db = shape.y + shape.h - p.y;
  const m = Math.min(dl, dr, dt, db);
  if (m > 0) return m;
  // outside (or on edge): negative Euclidean distance to the rect
  const ox = Math.max(-dl, -dr, 0);
  const oy = Math.max(-dt, -db, 0);
  return -Math.hypot(ox, oy) + 0;
}

export function zoneGain(zone: AudioZone, p: Vec2): number {
  const d = distanceInside(zone.shape, p);
  if (!(d > 0)) return 0;
  if (zone.fade <= 0) return zone.volume;
  const x = Math.min(Math.max(d / zone.fade, 0), 1);
  return zone.volume * (x * x * (3 - 2 * x));
}
