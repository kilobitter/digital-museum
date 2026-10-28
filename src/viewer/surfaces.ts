// Floor / ceiling surfaces: world-aligned quads and the plan for area layers.
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

/**
 * Quads of every area on one surface, floor and ceiling levelled independently. Floor quads sit at
 * LAYER_STEP * level above the floor; ceiling quads at LAYER_STEP * level below the ceiling. Ceiling
 * areas are skipped when the museum has no ceiling.
 */
export function areaQuads(m: Museum, surface: 'floor' | 'ceiling'): AreaQuad[] {
  if (surface === 'ceiling' && !m.settings.ceiling) return [];
  const items: { area: Area; layer: number; finish: Finish }[] = [];
  m.areas.forEach((area, layer) => {
    const finish = surface === 'floor' ? area.floor : area.ceiling;
    if (finish) items.push({ area, layer, finish });
  });
  const levels = stackLevels(items.map((it) => it.area.rect));
  return items.map((it, i) => {
    const off = LAYER_STEP * levels[i];
    return { ...it, rect: it.area.rect, level: levels[i], y: surface === 'floor' ? off : m.settings.wallHeight - off };
  });
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
