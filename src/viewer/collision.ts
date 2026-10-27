// Pure 2D (plan-space) collision and teleport validation. No three.js here.
import { closestPointOnSegment, wallNormal } from '../shared/geometry';
import type { Museum, Vec2, Wall } from '../shared/museum';

export const PLAYER_RADIUS = 0.25;
const MAX_STEP = 0.1; // metres per collision substep (< wall half-thickness + radius, so no tunnelling)

/** Push `p` out of every thick wall (capsule: segment inflated by thickness/2 + radius). */
export function pushOut(p: Vec2, walls: readonly Wall[], thickness: number, radius = PLAYER_RADIUS): Vec2 {
  const R = thickness / 2 + radius;
  let x = p.x;
  let y = p.y;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const w of walls) {
      const c = closestPointOnSegment({ x, y }, w.a, w.b);
      if (c.dist < R) {
        let nx: number;
        let ny: number;
        if (c.dist > 1e-9) {
          nx = (x - c.point.x) / c.dist;
          ny = (y - c.point.y) / c.dist;
        } else {
          const n = wallNormal(w, 1);
          nx = n.x;
          ny = n.y;
        }
        x = c.point.x + nx * R;
        y = c.point.y + ny * R;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, y };
}

/** Move from `pos` by `delta`, sliding along walls. Returns the new position. */
export function resolveMove(
  pos: Vec2,
  delta: Vec2,
  walls: readonly Wall[],
  thickness: number,
  radius = PLAYER_RADIUS,
): Vec2 {
  const dist = Math.hypot(delta.x, delta.y);
  const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
  let cur = pos;
  for (let i = 0; i < steps; i++) {
    cur = pushOut({ x: cur.x + delta.x / steps, y: cur.y + delta.y / steps }, walls, thickness, radius);
  }
  return cur;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  const d2 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  const d3 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
  const d4 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Minimum distance between segments ab and cd. */
export function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    closestPointOnSegment(a, c, d).dist,
    closestPointOnSegment(b, c, d).dist,
    closestPointOnSegment(c, a, b).dist,
    closestPointOnSegment(d, a, b).dist,
  );
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of all walls and the spawn, grown by `margin`. Used for floor/ceiling extents. */
export function computeFloorBounds(museum: Museum, margin: number): Bounds {
  const pts: Vec2[] = [{ x: museum.settings.spawn.x, y: museum.settings.spawn.y }];
  for (const w of museum.walls) pts.push(w.a, w.b);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/**
 * Is `to` a valid teleport destination from `from`?
 * - on the floor (inside `bounds` when given),
 * - not inside / touching a wall (clearance thickness/2 + radius),
 * - the straight line from -> to does not cross a wall's thickness.
 */
export function isTeleportTargetValid(
  from: Vec2,
  to: Vec2,
  walls: readonly Wall[],
  thickness: number,
  radius = PLAYER_RADIUS,
  bounds?: Bounds,
): boolean {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  if (bounds && (to.x < bounds.minX || to.x > bounds.maxX || to.y < bounds.minY || to.y > bounds.maxY)) return false;
  const half = thickness / 2;
  for (const w of walls) {
    if (closestPointOnSegment(to, w.a, w.b).dist < half + radius) return false;
    if (segmentSegmentDistance(from, to, w.a, w.b) <= half) return false;
  }
  return true;
}

export interface ArcResult {
  /** Sampled points (x, y, z world) from the origin up to and including the floor hit (if any). */
  points: { x: number; y: number; z: number }[];
  /** Where the arc crosses y = 0, or null if it never lands within the sample budget. */
  hit: { x: number; z: number } | null;
}

/** Ballistic arc from `origin` along unit `dir` with initial speed, until it reaches the floor (y = 0). */
export function computeArc(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  speed = 7,
  gravity = 9.8,
  steps = 40,
  dt = 0.04,
): ArcResult {
  const points = [{ x: origin.x, y: origin.y, z: origin.z }];
  let prev = points[0];
  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    const p = {
      x: origin.x + dir.x * speed * t,
      y: origin.y + dir.y * speed * t - 0.5 * gravity * t * t,
      z: origin.z + dir.z * speed * t,
    };
    if (p.y <= 0) {
      const k = prev.y === p.y ? 0 : prev.y / (prev.y - p.y);
      const hit = { x: prev.x + (p.x - prev.x) * k, y: 0, z: prev.z + (p.z - prev.z) * k };
      points.push(hit);
      return { points, hit: { x: hit.x, z: hit.z } };
    }
    points.push(p);
    prev = p;
  }
  return { points, hit: null };
}
