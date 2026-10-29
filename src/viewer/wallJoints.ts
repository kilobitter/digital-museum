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

function endAt(w: Wall, p: Vec2, others: readonly Wall[]): WallEnd {
  const d = wallDirection(w);
  let corner = false, straight = false, tee = false;
  for (const o of others) {
    if (o === w || wallLength(o) === 0) continue;
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
