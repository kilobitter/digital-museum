// Floor / ceiling surfaces: world-aligned quads, floor area layers and the flat ceiling decomposition.
import * as THREE from 'three';
import type { Area, Finish, Museum, Vec2, Wall, WallFinish } from '../shared/museum';
import type { WallSpan } from './wallJoints';

/** Height difference between two stacked areas (1 mm). Later entries in `Museum.areas` sit higher. */
export const LAYER_STEP = 0.001;

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * A horizontal quad over `rect` (plan coords; world x = plan x, world z = plan y) at height `y`.
 * UVs are world-aligned: u = x / tileSize; v = -z / tileSize for a floor (facing up) and
 * v = +z / tileSize for a ceiling (facing down). That keeps textures unmirrored when seen from above
 * (floor) or from below (ceiling), and tiles start at the world origin so neighbours join seamlessly.
 */
export function surfaceQuad(rect: Rect, y: number, tileSize: number, facing: 'up' | 'down'): THREE.BufferGeometry {
  const x0 = rect.x, x1 = rect.x + rect.w, z0 = rect.y, z1 = rect.y + rect.h;
  const corners = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]; // counter-clockwise seen from above => normal +y
  const order = facing === 'up' ? [0, 1, 2, 3] : [3, 2, 1, 0];
  const sv = facing === 'up' ? -1 : 1;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const i of order) {
    const [x, z] = corners[i];
    pos.push(x, y, z);
    nrm.push(0, facing === 'up' ? 1 : -1, 0);
    uv.push(x / tileSize, (sv * z) / tileSize);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export interface AreaQuad {
  area: Area;
  rect: Rect;
  /** Position in `Museum.areas` (stacking order). */
  layer: number;
  /** Stacking level on this surface (1 = nothing below it overlaps). */
  level: number;
  finish: Finish;
  /** World height of the quad. */
  y: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9;

/**
 * Stacking level of each rect, in array order: 1 + the highest level among earlier rects that overlap it
 * with positive area, or 1 when none do. Edge-touching rects do not overlap. Non-overlapping areas
 * therefore all sit at the same height no matter how many areas exist.
 */
export function stackLevels(rects: readonly Rect[]): number[] {
  const levels: number[] = [];
  rects.forEach((r, i) => {
    let level = 1;
    for (let j = 0; j < i; j++) if (overlaps(rects[j], r)) level = Math.max(level, levels[j] + 1);
    levels.push(level);
  });
  return levels;
}

/** Quads of every floor area. Floors keep the overlap-level approach: floor quads sit at LAYER_STEP * level above the floor. */
export function areaQuads(m: Museum): AreaQuad[] {
  const items: { area: Area; layer: number; finish: Finish }[] = [];
  m.areas.forEach((area, layer) => {
    if (area.floor) items.push({ area, layer, finish: area.floor });
  });
  const levels = stackLevels(items.map((it) => it.area.rect));
  return items.map((it, i) => ({ ...it, rect: it.area.rect, level: levels[i], y: LAYER_STEP * levels[i] }));
}

export interface CeilingGroup {
  finish: Finish;
  /** World height of these rects. */
  height: number;
  rects: Rect[];
}

/** A vertical strip closing the gap between two neighbouring ceilings of different height. */
export interface CeilingStep {
  /** Plan end points on the shared cell edge, axis-aligned (a before b along the edge). */
  a: Vec2;
  b: Vec2;
  /** The two ceiling heights. */
  bottom: number;
  top: number;
  /** Finish of the LOWER ceiling. */
  finish: Finish;
  /** Unit plan normal pointing at the TALLER side. */
  normal: Vec2;
}

export interface CeilingPlan {
  /** Ceiling rects grouped by finish and height (the base finish first when it has any). */
  groups: CeilingGroup[];
  /** Rects with no ceiling (open sky). They produce no geometry. */
  open: Rect[];
  /** Strips that close height differences between neighbouring ceilings (none beside open sky or on the outer edge). */
  steps: CeilingStep[];
}

const finishId = (f: Finish): string => `${f.textureId ?? ''}|${f.color.toLowerCase()}|${f.tileSize}`;
const EPS = 1e-9;
const STEP_EPS = 1e-6;

/**
 * Flat decomposition of the ceiling: the `bounds` are split into grid cells along the edges of every area that
 * has a `ceiling`, `openSky` or `roomHeight`. Each cell resolves its finish (or open sky) from the top-most (last)
 * area with `ceiling`/`openSky` covering it, else the `base` finish, and independently its height from the top-most
 * area with `roomHeight`, else `baseHeight`. Cells of equal finish and height are merged along rows and then across
 * identical row spans, so the number of rects stays small. Floor-only areas are ignored. Where neighbouring cells
 * both have a ceiling at different heights a `step` closes the gap.
 */
export function decomposeCeiling(bounds: Rect, base: Finish, areas: readonly Area[], baseHeight: number): CeilingPlan {
  const rel = areas.filter((a) => a.ceiling || a.openSky || a.roomHeight !== undefined);
  const edges = (lo: number, hi: number, get: (a: Area) => [number, number]): number[] => {
    const v = [lo, hi];
    for (const a of rel) for (const e of get(a)) if (e > lo + EPS && e < hi - EPS) v.push(e);
    v.sort((p, q) => p - q);
    return v.filter((e, i) => i === 0 || e - v[i - 1] > EPS);
  };
  const xs = edges(bounds.x, bounds.x + bounds.w, (a) => [a.rect.x, a.rect.x + a.rect.w]);
  const ys = edges(bounds.y, bounds.y + bounds.h, (a) => [a.rect.y, a.rect.y + a.rect.h]);

  const finishes = new Map<string, Finish>([[finishId(base), base]]);
  const OPEN = 'open';
  const inside = (r: Rect, cx: number, cy: number) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
  interface Cell { key: string; fid: string; height: number }
  const pick = (cx: number, cy: number): Cell => {
    let fid: string | null = null;
    for (let i = rel.length - 1; i >= 0 && fid === null; i--) {
      const a = rel[i];
      if (!(a.ceiling || a.openSky) || !inside(a.rect, cx, cy)) continue;
      if (!a.ceiling) fid = OPEN;
      else {
        fid = finishId(a.ceiling);
        if (!finishes.has(fid)) finishes.set(fid, a.ceiling);
      }
    }
    if (fid === OPEN) return { key: OPEN, fid: OPEN, height: baseHeight };
    fid ??= finishId(base);
    let height = baseHeight;
    for (let i = rel.length - 1; i >= 0; i--) {
      const a = rel[i];
      if (a.roomHeight !== undefined && inside(a.rect, cx, cy)) {
        height = a.roomHeight;
        break;
      }
    }
    return { key: `${fid}@${height}`, fid, height };
  };

  const cells: Cell[][] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    const row: Cell[] = [];
    for (let i = 0; i + 1 < xs.length; i++) row.push(pick((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2));
    cells.push(row);
  }

  const byKey = new Map<string, { fid: string; height: number; rects: Rect[] }>();
  const add = (c: Cell, r: Rect) => {
    const l = byKey.get(c.key);
    if (l) l.rects.push(r);
    else byKey.set(c.key, { fid: c.fid, height: c.height, rects: [r] });
  };
  // Merge runs along each row, then extend a run downward while the next row has an identical span and key.
  let prev = new Map<string, Rect>();
  for (let j = 0; j + 1 < ys.length; j++) {
    const cur = new Map<string, Rect>();
    let i = 0;
    while (i + 1 < xs.length) {
      const cell = cells[j][i];
      let k = i + 1;
      while (k + 1 < xs.length && cells[j][k].key === cell.key) k++;
      const span = `${i}|${k}|${cell.key}`;
      const above = prev.get(span);
      if (above) {
        above.h = ys[j + 1] - above.y;
        cur.set(span, above);
      } else {
        const r = { x: xs[i], y: ys[j], w: xs[k] - xs[i], h: ys[j + 1] - ys[j] };
        add(cell, r);
        cur.set(span, r);
      }
      i = k;
    }
    prev = cur;
  }
  const groups: CeilingGroup[] = [];
  for (const [fid, f] of finishes) {
    for (const e of byKey.values()) if (e.fid === fid && e.rects.length) groups.push({ finish: f, height: e.height, rects: e.rects });
  }

  // Steps: across every shared cell edge where both cells have a ceiling and the heights differ.
  const stepBetween = (c1: Cell, c2: Cell, a: Vec2, b: Vec2, n2: Vec2): CeilingStep | null => {
    if (c1.fid === OPEN || c2.fid === OPEN || Math.abs(c1.height - c2.height) <= STEP_EPS) return null;
    const second = c2.height > c1.height; // normal points at the taller side
    const lower = second ? c1 : c2;
    return {
      a, b,
      bottom: Math.min(c1.height, c2.height),
      top: Math.max(c1.height, c2.height),
      finish: finishes.get(lower.fid)!,
      normal: second ? n2 : { x: -n2.x + 0, y: -n2.y + 0 },
    };
  };
  const vertical: CeilingStep[] = [], horizontal: CeilingStep[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      if (i + 2 < xs.length) {
        const s = stepBetween(cells[j][i], cells[j][i + 1], { x: xs[i + 1], y: ys[j] }, { x: xs[i + 1], y: ys[j + 1] }, { x: 1, y: 0 });
        if (s) vertical.push(s);
      }
      if (j + 2 < ys.length) {
        const s = stepBetween(cells[j][i], cells[j + 1][i], { x: xs[i], y: ys[j + 1] }, { x: xs[i + 1], y: ys[j + 1] }, { x: 0, y: 1 });
        if (s) horizontal.push(s);
      }
    }
  }
  const steps = [...mergeSteps(vertical, 'y'), ...mergeSteps(horizontal, 'x')];
  return { groups, open: byKey.get(OPEN)?.rects ?? [], steps };
}

/** Merge touching collinear steps with equal heights, finish and normal. `axis` is the coordinate that runs along the edge. */
function mergeSteps(steps: CeilingStep[], axis: 'x' | 'y'): CeilingStep[] {
  const across = axis === 'y' ? 'x' : 'y';
  const sorted = steps.slice().sort((p, q) => p.a[across] - q.a[across] || p.a[axis] - q.a[axis]);
  const out: CeilingStep[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (
      last && Math.abs(last.a[across] - s.a[across]) <= EPS && Math.abs(last.b[axis] - s.a[axis]) <= EPS &&
      last.bottom === s.bottom && last.top === s.top && last.normal.x === s.normal.x && last.normal.y === s.normal.y &&
      finishId(last.finish) === finishId(s.finish)
    ) last.b = s.b;
    else out.push({ ...s, a: { ...s.a }, b: { ...s.b } });
  }
  return out;
}

/**
 * A single-sided vertical quad over a ceiling step, facing `step.normal` (the taller side). Same attributes and index
 * as `surfaceQuad`, so it merges with ceiling quads. World-scale UVs: u = coordinate along the edge / tileSize,
 * v = height / tileSize.
 */
export function stepQuad(step: CeilingStep): THREE.BufferGeometry {
  const tile = step.finish.tileSize;
  // geometric normal of (a_bottom, b_bottom, b_top) in (x, z) is (-ez, ex); swap the ends when it points the wrong way
  let { a, b } = step;
  if (-(b.y - a.y) * step.normal.x + (b.x - a.x) * step.normal.y < 0) [a, b] = [b, a];
  const alongX = Math.abs(step.a.y - step.b.y) < Math.abs(step.a.x - step.b.x);
  const corners: [Vec2, number][] = [[a, step.bottom], [b, step.bottom], [b, step.top], [a, step.top]];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const [p, y] of corners) {
    pos.push(p.x, y, p.y);
    nrm.push(step.normal.x, 0, step.normal.y);
    uv.push((alongX ? p.x : p.y) / tile, y / tile);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const MIN_STEP_PIECE = 1e-4;

/**
 * Cuts away the parts of each step that a wall already covers: a parallel, axis-aligned wall whose centre line lies
 * within thickness/2 of the step's line hides it, using the wall's drawn spans (extensions included). Walls that
 * do not cover it, or run diagonally, leave the step alone. Remainders under 1e-4 m are dropped.
 */
export function uncoveredSteps(steps: CeilingStep[], walls: readonly Wall[], spans: Map<string, WallSpan[]>, thickness: number): CeilingStep[] {
  const out: CeilingStep[] = [];
  for (const step of steps) {
    const vertical = Math.abs(step.a.x - step.b.x) < Math.abs(step.a.y - step.b.y); // runs along plan y
    const along: 'x' | 'y' = vertical ? 'y' : 'x';
    const across: 'x' | 'y' = vertical ? 'x' : 'y';
    const lineAt = step.a[across];
    let free: [number, number][] = [[Math.min(step.a[along], step.b[along]), Math.max(step.a[along], step.b[along])]];
    for (const w of walls) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (len === 0 || Math.abs(w.a[across] - w.b[across]) > 1e-9) continue; // diagonal or perpendicular
      if (Math.abs(w.a[across] - lineAt) > thickness / 2 + 1e-6) continue;
      const dir = (w.b[along] - w.a[along]) / len;
      for (const sp of spans.get(w.id) ?? []) {
        const p = w.a[along] + dir * sp.from, q = w.a[along] + dir * sp.to;
        const lo = Math.min(p, q), hi = Math.max(p, q);
        free = free.flatMap(([f0, f1]) => {
          if (hi <= f0 || lo >= f1) return [[f0, f1] as [number, number]];
          const keep: [number, number][] = [];
          if (lo > f0) keep.push([f0, lo]);
          if (hi < f1) keep.push([hi, f1]);
          return keep;
        });
      }
    }
    const reversed = step.a[along] > step.b[along];
    for (const [f0, f1] of free) {
      if (f1 - f0 < MIN_STEP_PIECE) continue;
      const mk = (v: number): Vec2 => (vertical ? { x: lineAt, y: v } : { x: v, y: lineAt });
      out.push({ ...step, a: mk(reversed ? f1 : f0), b: mk(reversed ? f0 : f1), normal: { ...step.normal } });
    }
  }
  return out;
}

/** Key that identifies one material: texture (when it loaded) and colour. */
export const finishKey = (f: Finish, textureLoaded: boolean): string => `${textureLoaded && f.textureId ? f.textureId : ''}|${f.color.toLowerCase()}`;

/** Merge key of a wall finish: like finishKey plus the gradient's top colour (walls with equal keys share one mesh). */
export const wallFinishKey = (f: WallFinish, textureLoaded: boolean): string => `${finishKey(f, textureLoaded)}|${f.colorTop ? f.colorTop.toLowerCase() : ''}`;

/** Distinct texture ids the viewer needs: walls (effective finish), floor, and (when a ceiling exists) ceiling and areas. */
export function neededTextureIds(m: Museum): string[] {
  const ids = new Set<string>();
  const add = (f?: Finish) => f?.textureId && ids.add(f.textureId);
  for (const w of m.walls) add(w.finish ?? m.settings.wallFinish);
  add(m.settings.floorFinish);
  if (m.settings.ceiling) add(m.settings.ceilingFinish);
  for (const a of m.areas) {
    add(a.floor);
    if (m.settings.ceiling) add(a.ceiling);
  }
  return [...ids];
}
