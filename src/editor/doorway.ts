// Cutting a doorway into a wall. Pure; no React, no DOM.
import type { Museum, Vec2, Wall, Work } from '../shared/museum';
import { closestPointOnSegment, wallDirection, wallLength } from '../shared/geometry';
import { newId, round4, snapValue } from './model';

/** A wall piece shorter than this next to a doorway is dropped (the gap extends to that end). */
export const MIN_PIECE_M = 0.15;
export const DOOR_MIN_M = 0.5;
export const DOOR_MAX_M = 4;
export const DOOR_DEFAULT_M = 1.2;
const T_EPS = 1e-6;

export const clampDoorWidth = (w: number): number => (Number.isFinite(w) ? Math.min(DOOR_MAX_M, Math.max(DOOR_MIN_M, w)) : DOOR_DEFAULT_M);

export type GapResult =
  | { ok: true; /** gap start/end, metres from wall point `a` (after clamping and sliver absorption) */ from: number; to: number; hasFirst: boolean; hasSecond: boolean }
  | { ok: false; reason: string };

/**
 * Where the gap of a `width` door centred at `centreT` falls on a wall of length `len`. The gap is moved inside the
 * wall; a remaining piece under MIN_PIECE_M is dropped and the gap grows to that end.
 */
export function doorwayGap(len: number, centreT: number, width: number): GapResult {
  if (len <= width) return { ok: false, reason: 'This wall is shorter than the door.' };
  let from = centreT - width / 2;
  let to = centreT + width / 2;
  if (from < 0) (from = 0), (to = width);
  if (to > len) (to = len), (from = len - width);
  const hasFirst = from >= MIN_PIECE_M;
  const hasSecond = len - to >= MIN_PIECE_M;
  if (!hasFirst && !hasSecond) return { ok: false, reason: 'This wall is only just longer than the door. Use a narrower door or delete the wall.' };
  return { ok: true, from: hasFirst ? round4(from) : 0, to: hasSecond ? round4(to) : len, hasFirst, hasSecond };
}

export type DoorwayResult =
  | { ok: true; museum: Museum; removedWorks: Work[]; /** ids of the wall pieces that now exist (first piece first) */ wallIds: string[] }
  | { ok: false; reason: string };

/**
 * Split a wall into two, leaving a gap of `width` centred at `centreT` (metres from `a`). The first piece keeps the
 * wall's id (when only one piece remains, that piece keeps it); the second gets a new id; both keep the finish.
 * Works fully on one side stay on that piece (the second piece's `t` is re-based to its own `a`); works touching the
 * gap are removed and returned. Zones and areas are untouched.
 */
export function cutDoorway(m: Museum, wallId: string, centreT: number, width: number): DoorwayResult {
  const wall = m.walls.find((w) => w.id === wallId);
  if (!wall) return { ok: false, reason: 'Wall not found.' };
  const len = wallLength(wall);
  const gap = doorwayGap(len, centreT, width);
  if (!gap.ok) return gap;
  const d = wallDirection(wall);
  const at = (t: number): Vec2 => ({ x: round4(wall.a.x + d.x * t), y: round4(wall.a.y + d.y * t) });

  const copy = (): Wall => ({ ...wall, ...(wall.finish ? { finish: { ...wall.finish } } : {}) });
  const secondId = gap.hasFirst && gap.hasSecond ? newId('wall', m.walls.map((w) => w.id)) : wall.id;
  const pieces: Wall[] = [];
  if (gap.hasFirst) pieces.push({ ...copy(), b: at(gap.from) });
  if (gap.hasSecond) pieces.push({ ...copy(), id: secondId, a: at(gap.to) });

  const removedWorks: Work[] = [];
  const works: Work[] = [];
  for (const k of m.works) {
    if (k.wallId !== wallId) {
      works.push(k);
      continue;
    }
    const lo = k.t - k.width / 2, hi = k.t + k.width / 2;
    if (hi <= gap.from + T_EPS) works.push(k); // stays on the first piece (or, when it is dropped, cannot happen: gap.from is 0)
    else if (lo >= gap.to - T_EPS) works.push({ ...k, wallId: pieces[pieces.length - 1].id, t: round4(k.t - gap.to) });
    else removedWorks.push(k);
  }

  const walls: Wall[] = [];
  for (const w of m.walls) {
    if (w.id !== wallId) walls.push(w);
    else walls.push(...pieces);
  }
  return { ok: true, museum: { ...m, walls, works }, removedWorks, wallIds: pieces.map((p) => p.id) };
}

export type DoorTarget = {
  wallId: string;
  centreT: number;
  gap: GapResult;
  /** Gap end points in plan coordinates, for the preview (only when gap.ok). */
  line: { a: Vec2; b: Vec2 } | null;
};

/** The wall under the cursor and where the gap would go (centre snapped to 0.05 m, clamped as cutDoorway does). */
export function findDoorTarget(m: Museum, p: Vec2, tol: number, width: number): DoorTarget | null {
  let best: { wall: Wall; t: number; dist: number } | null = null;
  const reach = Math.max(tol, m.settings.wallThickness / 2 + 0.15);
  for (const wall of m.walls) {
    if (wallLength(wall) === 0) continue;
    const cp = closestPointOnSegment(p, wall.a, wall.b);
    if (cp.dist <= reach && (!best || cp.dist < best.dist)) best = { wall, t: cp.t, dist: cp.dist };
  }
  if (!best) return null;
  const centreT = round4(snapValue(best.t, 0.05));
  const gap = doorwayGap(wallLength(best.wall), centreT, width);
  let line: DoorTarget['line'] = null;
  if (gap.ok) {
    const d = wallDirection(best.wall), a = best.wall.a;
    line = { a: { x: a.x + d.x * gap.from, y: a.y + d.y * gap.from }, b: { x: a.x + d.x * gap.to, y: a.y + d.y * gap.to } };
  }
  return { wallId: best.wall.id, centreT, gap, line };
}
