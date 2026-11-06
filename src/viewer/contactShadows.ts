// Faked, static soft shadows where surfaces meet: thin strips with an alpha gradient (wall foot, ceiling joint, free wall
// ends, exposed corners, behind frames), all accumulated into ONE mesh. One draw call, no textures, no shadow maps.
import * as THREE from 'three';
import { closestPointOnSegment, wallDirection, wallLength, wallNormal } from '../shared/geometry';
import type { Museum, Vec2, Wall } from '../shared/museum';
import type { PaintingSlot } from './scene';
import { areaQuads, type CeilingGroup, type CeilingStep } from './surfaces';
import type { WallEnd, WallPiece } from './wallJoints';

// Tuning (metres / alpha).
export const FOOT_WIDTH = 0.35; // wall foot, and the floor beside it
export const CEILING_WIDTH = 0.3; // under the ceiling, and on the wall below it
export const FOOT_PEAK = 0.22;
export const CEILING_PEAK = 0.18;
export const FRAME_PEAK = 0.26;
export const FRAME_REACH = 0.05; // how far the frame shadow reaches past the frame
export const FRAME_SHIFT = 0.015; // and how far it is shifted down
export const FLOOR_UNDER = 0.03; // the floor strip also runs this far under the wall (see wall loop)
export const GAP = 0.0015; // strips lie this far off their surface (the material's depth bias does the rest)
// Three rows across a strip (peak against the joint, a third in the middle, zero), so there is no visible straight ramp.
const ROW_POS = [0, 0.5, 1];
const ROW_ALPHA = [1, 1 / 3, 0];
// Frame ring rows: [distance past the frame edge (negative = under the frame), alpha].
const FRAME_ROWS: [number, number][] = [[-0.005, 1], [0, 1], [FRAME_REACH / 2, 1 / 3], [FRAME_REACH, 0]];
const ARC_SEGMENTS = 6;
const JOIN_EPS = 0.01;
const COLLINEAR_SIN = Math.sin(Math.PI / 180);

export interface ContactShadowInput {
  museum: Museum;
  /** Result of wallPieces(...) in scene.ts: the drawn pieces per wall id. */
  pieces: Map<string, WallPiece[]>;
  /** Result of wallEnds(...) in scene.ts. */
  ends: Map<string, { a: WallEnd; b: WallEnd }>;
  /** decomposeCeiling(...).groups, or [] when settings.ceiling is false. */
  ceilings: readonly CeilingGroup[];
  /** The works as placed by scene.ts. */
  slots: readonly PaintingSlot[];
  /** The door headers scene.ts builds (T15): a wall face that continues above a doorway between rooms of different height. */
  headers?: readonly { step: CeilingStep; wall: Wall }[];
}

type V3 = [number, number, number];
type Vert = [number, number, number, number]; // x, y, z, alpha strength

class Accumulator {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  /** One triangle, flipped if needed so it faces `n` (zero-area triangles are dropped). */
  tri(a: Vert, b: Vert, c: Vert, n: V3): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) return;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) this.pos.push(p[0], p[1], p[2]), this.col.push(0, 0, 0, p[3]);
  }
  quad(a: Vert, b: Vert, c: Vert, d: Vert, n: V3): void {
    this.tri(a, b, c, n);
    this.tri(a, c, d, n);
  }
  /** A strip from edge e0-e1, fading across offset `v` in three rows. */
  strip(e0: V3, e1: V3, v: V3, peak: number, n: V3): void {
    const row = (e: V3, j: number): Vert => [e[0] + v[0] * ROW_POS[j], e[1] + v[1] * ROW_POS[j], e[2] + v[2] * ROW_POS[j], peak * ROW_ALPHA[j]];
    for (let j = 0; j < 2; j++) this.quad(row(e0, j), row(e1, j), row(e1, j + 1), row(e0, j + 1), n);
  }
  /** A band of constant strength from edge e0-e1 across offset `v`. */
  band(e0: V3, e1: V3, v: V3, peak: number, n: V3): void {
    const a = (e: V3, k: number): Vert => [e[0] + v[0] * k, e[1] + v[1] * k, e[2] + v[2] * k, peak];
    this.quad(a(e0, 0), a(e1, 0), a(e1, 1), a(e0, 1), n);
  }
  /**
   * A fan along chord a1-a2 at height y: a ring of radius `r` around it, swept from angle `a0` by `sweep` (plan angles), facing `n`
   * (up on a floor, down on a ceiling). `r` may be a function of a ray's start point and unit direction (0 = no ray).
   */
  fan(a1: Vec2, a2: Vec2, a0: number, sweep: number, y: number, r: number | ((q: Vec2, dir: Vec2) => number), peak: number, n: V3 = [0, 1, 0], segs = ARC_SEGMENTS): void {
    const radii: number[] = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, ang = a0 + sweep * t;
      radii.push(typeof r === 'number' ? r : r({ x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t }, { x: Math.cos(ang), y: Math.sin(ang) }));
    }
    const ring = (j: number): Vert[] => {
      const out: Vert[] = [];
      for (let k = 0; k <= segs; k++) {
        const t = k / segs, ang = a0 + sweep * t;
        out.push([a1.x + (a2.x - a1.x) * t + Math.cos(ang) * radii[k] * ROW_POS[j], y, a1.y + (a2.y - a1.y) * t + Math.sin(ang) * radii[k] * ROW_POS[j], peak * ROW_ALPHA[j]]);
      }
      return out;
    };
    const rows = [ring(0), ring(1), ring(2)];
    for (let j = 0; j < 2; j++) for (let k = 0; k < segs; k++) this.quad(rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k], n);
  }
}

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Interval of s where the line p0 + s*d lies inside the open rect, or null. */
function clipToRect(p0: Vec2, d: Vec2, r: { x: number; y: number; w: number; h: number }): [number, number] | null {
  let lo = -Infinity, hi = Infinity;
  for (const [p, dd, min, max] of [[p0.x, d.x, r.x, r.x + r.w], [p0.y, d.y, r.y, r.y + r.h]] as const) {
    if (Math.abs(dd) < 1e-12) {
      if (p <= min || p >= max) return null;
    } else {
      const s0 = (min - p) / dd, s1 = (max - p) / dd;
      lo = Math.max(lo, Math.min(s0, s1));
      hi = Math.min(hi, Math.max(s0, s1));
    }
  }
  return hi - lo > 1e-6 ? [lo, hi] : null;
}

type Rect = { x: number; y: number; w: number; h: number };
const inRect = (q: Vec2, r: Rect): boolean => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;

/** How far from q along plan direction dir the rect extends. */
function exitDistance(q: Vec2, dir: Vec2, r: Rect): number {
  let t = Infinity;
  if (dir.x > 1e-9) t = Math.min(t, (r.x + r.w - q.x) / dir.x);
  if (dir.x < -1e-9) t = Math.min(t, (r.x - q.x) / dir.x);
  if (dir.y > 1e-9) t = Math.min(t, (r.y + r.h - q.y) / dir.y);
  if (dir.y < -1e-9) t = Math.min(t, (r.y - q.y) / dir.y);
  return t;
}

const EXTENT_NUDGE = 1e-5;
/**
 * How far from plan point q along unit direction dir (up to max) the ceiling stays at `height`. The ceiling is cut into rects along
 * every area edge, so this walks through neighbouring rects of that height. 0 when q itself has no ceiling at that height.
 */
function ceilingExtent(ceilings: readonly CeilingGroup[], q: Vec2, dir: Vec2, height: number, max: number): number {
  const rects = ceilings.filter((g) => Math.abs(g.height - height) < 1e-6).flatMap((g) => g.rects);
  let t = 0;
  for (let i = 0; i < 64 && t < max; i++) {
    const p = { x: q.x + dir.x * (t + EXTENT_NUDGE), y: q.y + dir.y * (t + EXTENT_NUDGE) }; // just past the last edge: half-open rects
    const r = rects.find((rc) => inRect(p, rc));
    if (!r) return t;
    t = Math.max(t + EXTENT_NUDGE, t + EXTENT_NUDGE + exitDistance(p, dir, r));
  }
  return Math.min(t, max);
}

/** Intervals [lo, hi] of [s0, s1] left after removing `blocks`. */
function subtract(s0: number, s1: number, blocks: [number, number][]): [number, number][] {
  let out: [number, number][] = [[s0, s1]];
  for (const [lo, hi] of blocks) {
    out = out.flatMap(([a, b]) => (hi <= a || lo >= b ? [[a, b] as [number, number]] : [[a, Math.min(b, lo)], [Math.max(a, hi), b]] as [number, number][]).filter(([x, y]) => y - x > 1e-6));
  }
  return out;
}

export function contactShadowGeometry(input: ContactShadowInput): THREE.BufferGeometry | null {
  const { museum, pieces, ends, ceilings, slots, headers = [] } = input;
  const T = museum.settings.wallThickness;
  const face = T / 2;
  const off = T / 2 + GAP;
  const acc = new Accumulator();
  // Floor areas stack 1 mm per level, so floor strips sit above the highest one.
  let fy = 0;
  for (const q of areaQuads(museum)) fy = Math.max(fy, q.y);
  fy += GAP;

  // The ceiling group over plan point q, unless the walls there (top `top`) do not reach it.
  const ceilingAt = (q: Vec2, top: number): CeilingGroup | undefined => {
    const g = ceilings.find((c) => c.rects.some((r) => inRect(q, r)));
    return g && g.height <= top + 1e-6 ? g : undefined;
  };
  // A door header continues one of `ws` (or a parallel wall) across plan point q: its strips already carry the ceiling shadow there.
  const headerContinues = (q: Vec2, ws: readonly Wall[]): boolean =>
    headers.some((h) => {
      const hd = wallDirection(h.wall);
      return ws.some((w) => { const d = wallDirection(w); return h.wall === w || Math.abs(hd.x * d.y - hd.y * d.x) < COLLINEAR_SIN; }) &&
        [h.step.a, h.step.b].some((e) => Math.hypot(e.x - q.x, e.y - q.y) <= T + 1e-6);
    });
  const ceilingFan = (a1: Vec2, a2: Vec2, a0: number, sweep: number, g: CeilingGroup, segs?: number): void =>
    acc.fan(a1, a2, a0, sweep, g.height - GAP, (q, dir) => ceilingExtent(ceilings, q, dir, g.height, CEILING_WIDTH), CEILING_PEAK, [0, -1, 0], segs);

  for (const w of museum.walls) {
    const list = pieces.get(w.id) ?? [];
    if (!list.length) continue;
    const d = wallDirection(w);
    const at = (s: number, n: Vec2, o: number, y: number): V3 => [w.a.x + d.x * s + n.x * o, y, w.a.y + d.y * s + n.y * o];
    for (const side of [1, -1] as const) {
      const n = wallNormal(w, side);
      const n3: V3 = [n.x, 0, n.y];
      // Where this face line runs inside another wall's box (inner corners, T and X junctions) nothing is drawn: it would
      // be hidden there, and the depth bias would let it show through as a thin line along the joint.
      const blocks: [number, number][] = [];
      for (const o of museum.walls) {
        if (o === w || !pieces.get(o.id)?.length || wallLength(o) === 0) continue;
        const od = wallDirection(o), oe = ends.get(o.id)!;
        const oa = oe.a.extend ? T / 2 : 0, ob = oe.b.extend ? T / 2 : 0, olen = wallLength(o);
        const p0 = { x: w.a.x + n.x * off - o.a.x, y: w.a.y + n.y * off - o.a.y };
        // L(s) in o's frame: along = p0.x*od.x + p0.y*od.y + s*(d.x*od.x + d.y*od.y); across likewise with perp(od)
        const al0 = p0.x * od.x + p0.y * od.y, alk = d.x * od.x + d.y * od.y;
        const ac0 = p0.x * -od.y + p0.y * od.x, ack = d.x * -od.y + d.y * od.x;
        const iv = (c0: number, ck: number, min: number, max: number): [number, number] | null => {
          if (Math.abs(ck) < 1e-9) return c0 > min && c0 < max ? [-Infinity, Infinity] : null;
          const a = (min - c0) / ck, b = (max - c0) / ck;
          return [Math.min(a, b), Math.max(a, b)];
        };
        const ia = iv(al0, alk, -oa, olen + ob), ic = iv(ac0, ack, -T / 2, T / 2);
        if (!ia || !ic) continue;
        const lo = Math.max(ia[0], ic[0]), hi = Math.min(ia[1], ic[1]);
        if (hi - lo > 1e-6) blocks.push([lo, hi]);
      }
      for (const p of list) {
        // A free end is closed by its cap face (and fans), so the strips reach that face's plane, leaving no hairline gap to the fans.
        const s0 = p.from - (p.capFrom ? GAP : 0), s1 = p.to + (p.capTo ? GAP : 0);
        for (const [t0, t1] of subtract(s0, s1, blocks)) {
          // The floor strip starts at the wall face itself and the wall strip at y = 0, so no unshaded sliver is left
          // at the joint (a raised floor area hides whatever lies below it).
          const fw = Math.min(FOOT_WIDTH, p.top);
          // The floor areas' own depth bias pulls the floor a few mm forward over the wall's foot, so the floor strip also
          // runs FLOOR_UNDER under the wall, at full strength.
          acc.band(at(t0, n, face - FLOOR_UNDER, fy), at(t1, n, face - FLOOR_UNDER, fy), [n.x * FLOOR_UNDER, 0, n.y * FLOOR_UNDER], FOOT_PEAK, [0, 1, 0]);
          acc.strip(at(t0, n, face, fy), at(t1, n, face, fy), [n.x * (FOOT_WIDTH + GAP), 0, n.y * (FOOT_WIDTH + GAP)], FOOT_PEAK, [0, 1, 0]);
          if (fw > 0.01) acc.strip(at(t0, n, off, 0), at(t1, n, off, 0), [0, fw, 0], FOOT_PEAK, n3);
        }
        // Under the ceiling of the room on this side.
        const probe = { x: w.a.x + n.x * (T / 2 + JOIN_EPS), y: w.a.y + n.y * (T / 2 + JOIN_EPS) };
        for (const g of ceilings) {
          if (g.height > p.top + 1e-6) continue; // the wall does not reach this ceiling
          for (const r of g.rects) {
            const iv = clipToRect(probe, d, r);
            if (!iv) continue;
            for (const [lo, hi] of subtract(Math.max(iv[0], s0), Math.min(iv[1], s1), blocks)) {
              acc.strip(at(lo, n, off, g.height), at(hi, n, off, g.height), [0, -CEILING_WIDTH, 0], CEILING_PEAK, n3);
              // the ceiling strip must not leave the rect (a low ceiling's edge, open sky)
              const q = (s: number) => { const v = at(s, n, face, 0); return { x: v[0], y: v[2] }; };
              const cw = Math.min(ceilingExtent(ceilings, q(lo), n, g.height, CEILING_WIDTH), ceilingExtent(ceilings, q(hi), n, g.height, CEILING_WIDTH));
              if (cw > 0.01) acc.strip(at(lo, n, face, g.height - GAP), at(hi, n, face, g.height - GAP), [n.x * cw, 0, n.y * cw], CEILING_PEAK, [0, -1, 0]);
            }
          }
        }
      }
      // Free ends: a rounded floor fan around the end's footprint and a strip on the cap face (the jamb).
      for (const [p, atEnd] of [[list[0], false], [list[list.length - 1], true]] as const) {
        if (!(atEnd ? p.capTo : p.capFrom)) continue;
        if (side === -1) continue; // once per end
        const e = atEnd ? 1 : -1; // direction of the end, along d
        const s = (atEnd ? p.to : p.from) + e * GAP;
        const nPlus = wallNormal(w, 1);
        const corner = (sd: 1 | -1) => ({ x: w.a.x + d.x * s + nPlus.x * off * sd, y: w.a.y + d.y * s + nPlus.y * off * sd });
        const a0 = Math.atan2(nPlus.y, nPlus.x);
        const sweep = 2 * wrapAngle(Math.atan2(d.y * e, d.x * e) - a0);
        acc.fan(corner(1), corner(-1), a0, sweep, fy, FOOT_WIDTH, FOOT_PEAK);
        const fw = Math.min(FOOT_WIDTH, p.top);
        if (fw > 0.01) acc.strip([corner(1).x, 0, corner(1).y], [corner(-1).x, 0, corner(-1).y], [0, fw, 0], FOOT_PEAK, [d.x * e, 0, d.y * e]);
        // The ceiling above the end, per side (the two rooms may differ): a quarter fan and a jamb strip hanging from the ceiling.
        // A door header that continues this end already carries the shadow.
        const mid = { x: w.a.x + d.x * s, y: w.a.y + d.y * s };
        if (headerContinues(mid, [w])) continue;
        const along = (atEnd ? p.to : p.from) - e * JOIN_EPS;
        for (const sd of [1, -1] as const) {
          const g = ceilingAt({ x: w.a.x + d.x * along + nPlus.x * sd * (T / 2 + JOIN_EPS), y: w.a.y + d.y * along + nPlus.y * sd * (T / 2 + JOIN_EPS) }, p.top);
          if (!g) continue;
          const as = Math.atan2(nPlus.y * sd, nPlus.x * sd);
          ceilingFan(corner(sd), mid, as, wrapAngle(Math.atan2(d.y * e, d.x * e) - as), g, ARC_SEGMENTS / 2);
          acc.strip([corner(sd).x, g.height, corner(sd).y], [mid.x, g.height, mid.y], [0, -Math.min(CEILING_WIDTH, g.height), 0], CEILING_PEAK, [d.x * e, 0, d.y * e]);
        }
      }
    }
  }

  // Exposed convex corners: exactly two non-collinear walls end at the same point, both with their extended corner end.
  const walls = museum.walls;
  const cornerEnd = (w: (typeof walls)[number], which: 'a' | 'b') => {
    const e = ends.get(w.id)?.[which];
    const list = pieces.get(w.id);
    if (!e || !list?.length || !e.extend || e.cap) return null;
    const p = which === 'a' ? w.a : w.b;
    const piece = which === 'a' ? list[0] : list[list.length - 1];
    const along = which === 'a' ? piece.from : piece.to;
    if (Math.abs(along - (which === 'a' ? -T / 2 : wallLength(w) + T / 2)) > 1e-6) return null; // cut by overlap handling
    const d = wallDirection(w);
    return { p, along, u: which === 'a' ? d : { x: -d.x, y: -d.y }, d, w, top: piece.top };
  };
  walls.forEach((w1, i) => {
    if (wallLength(w1) === 0) return;
    for (const which of ['a', 'b'] as const) {
      const c1 = cornerEnd(w1, which);
      if (!c1) continue;
      const touching = walls.filter((o) => o !== w1 && wallLength(o) > 0 && closestPointOnSegment(c1.p, o.a, o.b).dist <= JOIN_EPS);
      if (touching.length !== 1 || walls.indexOf(touching[0]) < i) continue;
      const w2 = touching[0];
      const which2 = Math.hypot(w2.a.x - c1.p.x, w2.a.y - c1.p.y) <= JOIN_EPS ? 'a' : Math.hypot(w2.b.x - c1.p.x, w2.b.y - c1.p.y) <= JOIN_EPS ? 'b' : null;
      const c2 = which2 && cornerEnd(w2, which2);
      if (!c2 || Math.abs(c1.u.x * c2.u.y - c1.u.y * c2.u.x) < COLLINEAR_SIN) continue;
      // outer normals: perpendicular to each wall, pointing away from the other wall
      const outer = (u: Vec2, other: Vec2): Vec2 => {
        const n = { x: -u.y, y: u.x };
        return n.x * other.x + n.y * other.y > 0 ? { x: -n.x, y: -n.y } : n;
      };
      const n1 = outer(c1.u, c2.u), n2 = outer(c2.u, c1.u);
      const A = (c: NonNullable<typeof c1>, n: Vec2): Vec2 => ({ x: c.w.a.x + c.d.x * c.along + n.x * off, y: c.w.a.y + c.d.y * c.along + n.y * off });
      const a0 = Math.atan2(n1.y, n1.x);
      const sweep = wrapAngle(Math.atan2(n2.y, n2.x) - a0);
      acc.fan(A(c1, n1), A(c2, n2), a0, sweep, fy, FOOT_WIDTH, FOOT_PEAK);
      // The ceiling over the outer wedge, found just outside the corner along the bisector.
      const bis = { x: n1.x + n2.x, y: n1.y + n2.y }, bl = Math.hypot(bis.x, bis.y);
      const A1 = A(c1, n1), A2 = A(c2, n2);
      const g = ceilingAt({ x: (A1.x + A2.x) / 2 + (bis.x / bl) * JOIN_EPS, y: (A1.y + A2.y) / 2 + (bis.y / bl) * JOIN_EPS }, Math.min(c1.top, c2.top));
      if (g && !headerContinues(c1.p, [c1.w, c2.w])) ceilingFan(A1, A2, a0, sweep, g); // a door header continuing a wall leaves no exposed ceiling corner
    }
  });

  // Door headers: the wall continues over a doorway, so its ceiling contact does too (on the header face and the tall ceiling).
  for (const { step, wall: hw } of headers) {
    const n = step.normal, n3: V3 = [n.x, 0, n.y];
    const alongX = Math.abs(step.a.y - step.b.y) < Math.abs(step.a.x - step.b.x);
    const faceAcross = (alongX ? hw.a.y : hw.a.x) + (alongX ? n.y : n.x) * T / 2;
    const pt = (q: Vec2, across: number, y: number): V3 => (alongX ? [q.x, y, across] : [across, y, q.y]);
    const wallH = Math.min(CEILING_WIDTH, step.top - step.bottom);
    acc.strip(pt(step.a, faceAcross + (alongX ? n.y : n.x) * GAP, step.top), pt(step.b, faceAcross + (alongX ? n.y : n.x) * GAP, step.top), [0, -wallH, 0], CEILING_PEAK, n3);
    let cw = CEILING_WIDTH;
    for (const q of [step.a, step.b]) {
      const v = pt(q, faceAcross, 0);
      cw = Math.min(cw, ceilingExtent(ceilings, { x: v[0], y: v[2] }, n, step.top, CEILING_WIDTH));
    }
    if (cw > 0.01) acc.strip(pt(step.a, faceAcross, step.top - GAP), pt(step.b, faceAcross, step.top - GAP), [n.x * cw, 0, n.y * cw], CEILING_PEAK, [0, -1, 0]);
  }

  // Behind each frame: a ring on the wall, peak at the frame edge, shifted down.
  for (const sl of slots) {
    const sn = Math.sin(sl.rotationY), cs = Math.cos(sl.rotationY);
    const n3: V3 = [sn, 0, cs];
    const hw = sl.w / 2 + 0.02, hh = sl.h / 2 + 0.02;
    const world = (lx: number, ly: number): V3 => [sl.position.x + cs * lx + sn * GAP, sl.position.y + ly, sl.position.z - sn * lx + cs * GAP];
    // The inner edge runs under the frame, so no gap opens at its edge; the peak holds up to the frame edge, then fades.
    const rows = FRAME_ROWS.map(([r, ,]) => {
      const s = FRAME_SHIFT * Math.max(r, 0) / FRAME_REACH;
      return [world(-hw - r, hh + r - s), world(hw + r, hh + r - s), world(hw + r, -hh - r - s), world(-hw - r, -hh - r - s)];
    });
    for (let j = 0; j < FRAME_ROWS.length - 1; j++) {
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        const v = (row: V3[], i: number, jj: number): Vert => [row[i][0], row[i][1], row[i][2], FRAME_PEAK * FRAME_ROWS[jj][1]];
        acc.quad(v(rows[j], k, j), v(rows[j], k2, j), v(rows[j + 1], k2, j + 1), v(rows[j + 1], k, j + 1), n3);
      }
    }
  }

  if (acc.pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 4));
  return g;
}

export function contactShadowMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2, // must beat the floor areas' own bias (factor -1); a smaller factor made floor strips vanish on them
    polygonOffsetUnits: -2,
  });
}
