// How each wall end meets its neighbours, so corners close without coplanar (flickering) faces.
import { closestPointOnSegment, wallDirection, wallLength } from '../shared/geometry';
import type { Vec2, Wall } from '../shared/museum';

/** extend: the box reaches half a thickness past the end point; cap: the end face is drawn. */
export interface WallEnd {
  extend: boolean;
  cap: boolean;
}

const JOIN_EPS = 0.01; // metres
const COLLINEAR_SIN = Math.sin(Math.PI / 180);

/** o lies on w's line and shares more than a touch of its length (handled by wallSpans, not as a joint). */
function overlaps(w: Wall, o: Wall): boolean {
  const d = wallDirection(w), len = wallLength(w);
  const along = (p: Vec2) => (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y;
  const off = (p: Vec2) => Math.abs((p.x - w.a.x) * d.y - (p.y - w.a.y) * d.x);
  if (len === 0 || off(o.a) > JOIN_EPS || off(o.b) > JOIN_EPS) return false;
  const s = along(o.a), t = along(o.b);
  return Math.min(len, Math.max(s, t)) - Math.max(0, Math.min(s, t)) > JOIN_EPS;
}

function endAt(w: Wall, p: Vec2, others: readonly Wall[]): WallEnd {
  const d = wallDirection(w);
  let corner = false, straight = false, tee = false;
  for (const o of others) {
    if (o === w || wallLength(o) === 0 || overlaps(w, o)) continue;
    const touchesEnd = Math.hypot(o.a.x - p.x, o.a.y - p.y) <= JOIN_EPS || Math.hypot(o.b.x - p.x, o.b.y - p.y) <= JOIN_EPS;
    if (touchesEnd) {
      const e = wallDirection(o);
      if (Math.abs(d.x * e.y - d.y * e.x) < COLLINEAR_SIN) straight = true;
      else corner = true;
    } else if (closestPointOnSegment(p, o.a, o.b).dist <= JOIN_EPS) tee = true;
  }
  // Straight continuation: butt the boxes together (no overlap). Corner: extend to close the notch, but drop the
  // end face, which would lie in the plane of the other wall's outer face. T-junction: stop at the other wall's
  // centre line, hidden inside it. Free end: as before (extended, capped).
  if (straight) return { extend: false, cap: false };
  if (corner) return { extend: true, cap: false };
  if (tee) return { extend: false, cap: false };
  return { extend: true, cap: true };
}

/** For every wall, how its `a` and `b` ends are built. */
export function wallEnds(walls: readonly Wall[]): Map<string, { a: WallEnd; b: WallEnd }> {
  const out = new Map<string, { a: WallEnd; b: WallEnd }>();
  for (const w of walls) out.set(w.id, { a: endAt(w, w.a, walls), b: endAt(w, w.b, walls) });
  return out;
}

/** A piece of a wall box, in metres along the wall from `a` (from < 0 / to > length when the end is extended). */
export interface WallSpan {
  from: number;
  to: number;
  capFrom: boolean;
  capTo: boolean;
}

const MIN_SPAN = 1e-4; // metres

/**
 * The pieces of each wall box that are drawn. Where walls lie on top of each other on the same line (two rooms
 * drawn side by side each have a wall on the shared line), only the latest wall in the list is drawn, so the
 * overlap has one set of faces instead of two that flicker. Cut ends are left open; the later wall's box closes them.
 */
export function wallSpans(walls: readonly Wall[], ends: Map<string, { a: WallEnd; b: WallEnd }>, thickness: number): Map<string, WallSpan[]> {
  const ext = (on: boolean) => (on ? thickness / 2 : 0);
  const out = new Map<string, WallSpan[]>();
  walls.forEach((w, i) => {
    const len = wallLength(w);
    const e = ends.get(w.id)!;
    let spans: WallSpan[] = [{ from: -ext(e.a.extend), to: len + ext(e.b.extend), capFrom: e.a.cap, capTo: e.b.cap }];
    if (len > 0) {
      const d = wallDirection(w);
      const along = (p: Vec2) => (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y;
      const off = (p: Vec2) => Math.abs((p.x - w.a.x) * d.y - (p.y - w.a.y) * d.x);
      for (const o of walls.slice(i + 1)) {
        if (wallLength(o) === 0 || off(o.a) > JOIN_EPS || off(o.b) > JOIN_EPS) continue;
        // the later wall's whole box, extensions included, measured along this wall
        const od = wallDirection(o), oe = ends.get(o.id)!;
        const s = along({ x: o.a.x - od.x * ext(oe.a.extend), y: o.a.y - od.y * ext(oe.a.extend) });
        const t = along({ x: o.b.x + od.x * ext(oe.b.extend), y: o.b.y + od.y * ext(oe.b.extend) });
        const lo = Math.min(s, t), hi = Math.max(s, t);
        spans = spans.flatMap((sp) => {
          if (hi - lo < MIN_SPAN || hi <= sp.from + MIN_SPAN || lo >= sp.to - MIN_SPAN) return [sp];
          const keep: WallSpan[] = [];
          if (lo - sp.from >= MIN_SPAN) keep.push({ ...sp, to: lo, capTo: false });
          if (sp.to - hi >= MIN_SPAN) keep.push({ ...sp, from: hi, capFrom: false });
          return keep;
        });
      }
    }
    out.set(w.id, spans);
  });
  return out;
}
