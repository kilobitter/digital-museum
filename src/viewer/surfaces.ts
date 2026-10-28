// Floor / ceiling surfaces: world-aligned quads, floor area layers and the flat ceiling decomposition.
import * as THREE from 'three';
import type { Area, Finish, Museum } from '../shared/museum';

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
  rects: Rect[];
}
export interface CeilingPlan {
  /** Ceiling rects grouped by finish (the base finish first when it has any). All sit at wallHeight. */
  groups: CeilingGroup[];
  /** Rects with no ceiling (open sky). They produce no geometry. */
  open: Rect[];
}

const finishId = (f: Finish): string => `${f.textureId ?? ''}|${f.color.toLowerCase()}|${f.tileSize}`;
const EPS = 1e-9;

/**
 * Flat decomposition of the ceiling: the `bounds` are split into grid cells along the edges of every area that
 * has a `ceiling` or `openSky`; each cell takes the result of the top-most (last) such area covering it, else the
 * `base` finish. Cells of equal result are merged along rows and then across identical row spans, so the number of
 * rects stays small. Floor-only areas are ignored. Nothing is stacked: every quad sits at the same height.
 */
export function decomposeCeiling(bounds: Rect, base: Finish, areas: readonly Area[]): CeilingPlan {
  const rel = areas.filter((a) => a.ceiling || a.openSky);
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
  const pick = (cx: number, cy: number): string => {
    for (let i = rel.length - 1; i >= 0; i--) {
      const r = rel[i].rect;
      if (cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h) {
        const f = rel[i].ceiling;
        if (!f) return OPEN;
        const id = finishId(f);
        if (!finishes.has(id)) finishes.set(id, f);
        return id;
      }
    }
    return finishId(base);
  };

  const byKey = new Map<string, Rect[]>();
  const add = (key: string, r: Rect) => {
    const l = byKey.get(key);
    if (l) l.push(r);
    else byKey.set(key, [r]);
  };
  // Merge runs along each row, then extend a run downward while the next row has an identical span and key.
  let prev = new Map<string, Rect>();
  for (let j = 0; j + 1 < ys.length; j++) {
    const cur = new Map<string, Rect>();
    let i = 0;
    while (i + 1 < xs.length) {
      const key = pick((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
      let k = i + 1;
      while (k + 1 < xs.length && pick((xs[k] + xs[k + 1]) / 2, (ys[j] + ys[j + 1]) / 2) === key) k++;
      const span = `${i}|${k}|${key}`;
      const above = prev.get(span);
      if (above) {
        above.h = ys[j + 1] - above.y;
        cur.set(span, above);
      } else {
        const r = { x: xs[i], y: ys[j], w: xs[k] - xs[i], h: ys[j + 1] - ys[j] };
        add(key, r);
        cur.set(span, r);
      }
      i = k;
    }
    prev = cur;
  }
  const groups: CeilingGroup[] = [];
  for (const [key, f] of finishes) {
    const rects = byKey.get(key);
    if (rects?.length) groups.push({ finish: f, rects });
  }
  return { groups, open: byKey.get(OPEN) ?? [] };
}

/** Key that identifies one material: texture (when it loaded) and colour. */
export const finishKey = (f: Finish, textureLoaded: boolean): string => `${textureLoaded && f.textureId ? f.textureId : ''}|${f.color.toLowerCase()}`;

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
