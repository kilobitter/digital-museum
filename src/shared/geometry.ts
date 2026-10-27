import type { Vec2, Wall, WallSide, Work } from './museum';

export function wallLength(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
}

export function wallDirection(w: Wall): Vec2 {
  const len = wallLength(w);
  if (len === 0) return { x: 1, y: 0 };
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

/** side * perp(dir), perp(d) = (-d.y, d.x). */
export function wallNormal(w: Wall, side: WallSide): Vec2 {
  const d = wallDirection(w);
  // avoid -0
  return { x: -d.y * side + 0, y: d.x * side + 0 };
}

export function closestPointOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  let t = 0;
  if (len > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
    t = Math.min(Math.max(t, 0), len);
  }
  const k = len > 0 ? t / len : 0;
  const point = { x: a.x + dx * k, y: a.y + dy * k };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

export function workPlacement(
  wall: Wall,
  work: Work,
  wallThickness: number,
): { center: Vec2; normal: Vec2 } {
  const len = wallLength(wall);
  const t = Math.min(Math.max(work.t, 0), len);
  const d = wallDirection(wall);
  const normal = wallNormal(wall, work.side);
  const h = wallThickness / 2;
  return {
    center: {
      x: wall.a.x + d.x * t + normal.x * h,
      y: wall.a.y + d.y * t + normal.y * h,
    },
    normal,
  };
}

/**
 * Plan yaw (0 = facing plan -y, 90 = facing plan +x, clockwise from above) ->
 * three.js rotation.y. Forward at rotation.y=0 is world -z (= plan -y); positive
 * rotation.y turns counter-clockwise from above (towards -x), so negate.
 */
export function yawToRotationY(yawDeg: number): number {
  return (-yawDeg * Math.PI) / 180 + 0;
}
