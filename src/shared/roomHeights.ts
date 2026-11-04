// Room heights: an area may set `roomHeight`; walls follow the rooms on their two sides. Pure, no three.js.
import { wallDirection, wallLength } from './geometry';
import type { Museum, Wall, WallSide } from './museum';

const MIN_PIECE = 1e-4; // metres: shorter pieces are merged into a neighbour
const SAME = 1e-9;

/** Height of the room at plan point (x, y): the top-most (last) area with `roomHeight` strictly containing it, else the default. */
export function roomHeightAt(m: Museum, x: number, y: number): number {
  for (let i = m.areas.length - 1; i >= 0; i--) {
    const a = m.areas[i];
    if (a.roomHeight === undefined) continue;
    const r = a.rect;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return a.roomHeight;
  }
  return m.settings.wallHeight;
}

export interface WallHeightPiece {
  from: number;
  to: number;
  /** Room height on the +perp(d) side. */
  plus: number;
  /** Room height on the -perp(d) side. */
  minus: number;
  /** max(plus, minus): the height the wall box has here. */
  top: number;
}

/**
 * The wall's height along its length, as pieces covering [0, length] in order with no gaps. Each side is sampled
 * just outside the wall (half a thickness plus 1 cm from the centre line) in the middle of each interval; breaks
 * are where either sample line crosses an edge of an area that sets `roomHeight`.
 */
export function wallHeightProfile(m: Museum, wall: Wall): WallHeightPiece[] {
  const len = wallLength(wall);
  const H = m.settings.wallHeight;
  const tall = m.areas.filter((a) => a.roomHeight !== undefined);
  if (tall.length === 0) return [{ from: 0, to: len, plus: H, minus: H, top: H }];
  const d = wallDirection(wall);
  const off = m.settings.wallThickness / 2 + 0.01;
  const nx = -d.y, ny = d.x;
  const at = (t: number, side: 1 | -1) => roomHeightAt(m, wall.a.x + d.x * t + nx * off * side, wall.a.y + d.y * t + ny * off * side);
  if (len === 0) {
    const plus = at(0, 1), minus = at(0, -1);
    return [{ from: 0, to: 0, plus, minus, top: Math.max(plus, minus) }];
  }
  const cuts = [0, len];
  for (const side of [1, -1] as const) {
    const ox = wall.a.x + nx * off * side, oy = wall.a.y + ny * off * side;
    for (const a of tall) {
      const r = a.rect;
      if (Math.abs(d.x) > 1e-12) for (const X of [r.x, r.x + r.w]) cuts.push((X - ox) / d.x);
      if (Math.abs(d.y) > 1e-12) for (const Y of [r.y, r.y + r.h]) cuts.push((Y - oy) / d.y);
    }
  }
  cuts.sort((p, q) => p - q);
  // keep cuts inside (0, len), at least MIN_PIECE apart from each other and from the end
  const breaks = [0];
  for (const c of cuts) if (c > breaks[breaks.length - 1] + MIN_PIECE && c < len - MIN_PIECE) breaks.push(c);
  breaks.push(len);
  const out: WallHeightPiece[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const mid = (breaks[i] + breaks[i + 1]) / 2;
    const plus = at(mid, 1), minus = at(mid, -1);
    const last = out[out.length - 1];
    if (last && Math.abs(last.plus - plus) < SAME && Math.abs(last.minus - minus) < SAME) last.to = breaks[i + 1];
    else out.push({ from: breaks[i], to: breaks[i + 1], plus, minus, top: Math.max(plus, minus) });
  }
  return out;
}

/** Wall height at distance `t` along the wall (clamped to the profile). */
export function wallTopAt(profile: WallHeightPiece[], t: number): number {
  const c = Math.min(Math.max(t, profile[0].from), profile[profile.length - 1].to);
  for (const p of profile) if (c <= p.to + 1e-9) return p.top;
  return profile[profile.length - 1].top;
}

/** The lowest room height on one face of the wall over [from, to] (distances along the wall, clamped to it). */
export function wallSideHeight(m: Museum, wall: Wall, side: WallSide, from: number, to: number): number {
  const profile = wallHeightProfile(m, wall);
  const len = wallLength(wall);
  const lo = Math.min(Math.max(Math.min(from, to), 0), len);
  const hi = Math.min(Math.max(Math.max(from, to), 0), len);
  const h = (p: WallHeightPiece) => (side === 1 ? p.plus : p.minus);
  let best = Infinity;
  for (const p of profile) if (p.to > lo + 1e-9 && p.from < hi - 1e-9) best = Math.min(best, h(p));
  if (best === Infinity) {
    const mid = (lo + hi) / 2;
    const p = profile.find((q) => mid <= q.to + 1e-9) ?? profile[profile.length - 1];
    best = h(p);
  }
  return best;
}
