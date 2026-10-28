// Pure multi-selection model and group operations. No React, no DOM.
import type { Area, AudioZone, Museum, Vec2, Wall, WallFinish, Work, ZoneShape } from '../shared/museum';
import { wallDirection, wallLength, workPlacement } from '../shared/geometry';
import { newId, round4, snapValue } from './model';
import type { Layer, Selection } from './types';

/** A set of references. Ids are in no particular order. */
export interface MultiSel {
  walls: string[];
  works: string[];
  zones: string[];
  areas: string[];
  spawn: boolean;
}

export const EMPTY_SEL: MultiSel = { walls: [], works: [], zones: [], areas: [], spawn: false };

export const selCount = (s: MultiSel): number => s.walls.length + s.works.length + s.zones.length + s.areas.length + (s.spawn ? 1 : 0);
export const isEmptySel = (s: MultiSel): boolean => selCount(s) === 0;

export function fromSelection(s: Selection): MultiSel {
  if (!s) return EMPTY_SEL;
  if (s.type === 'spawn') return { ...EMPTY_SEL, spawn: true };
  if (s.type === 'wall') return { ...EMPTY_SEL, walls: [s.id] };
  if (s.type === 'work') return { ...EMPTY_SEL, works: [s.id] };
  if (s.type === 'zone') return { ...EMPTY_SEL, zones: [s.id] };
  return { ...EMPTY_SEL, areas: [s.id] };
}

/**
 * The single-item selection (today's inspector, handles, endpoint drag) when exactly one item is
 * selected. A lone area counts only on the Areas layer; on Build it is shown by the multi inspector.
 */
export function singleOf(s: MultiSel, layer: Layer): Selection {
  if (selCount(s) !== 1) return null;
  if (s.walls.length) return { type: 'wall', id: s.walls[0] };
  if (s.works.length) return { type: 'work', id: s.works[0] };
  if (s.zones.length) return { type: 'zone', id: s.zones[0] };
  if (s.spawn) return { type: 'spawn' };
  return layer === 'areas' ? { type: 'area', id: s.areas[0] } : null;
}

export type ItemRef = { kind: 'wall' | 'work' | 'zone' | 'area'; id: string } | { kind: 'spawn' };

const listKey = { wall: 'walls', work: 'works', zone: 'zones', area: 'areas' } as const;

export function hasItem(s: MultiSel, r: ItemRef): boolean {
  return r.kind === 'spawn' ? s.spawn : s[listKey[r.kind]].includes(r.id);
}

/** Shift+click: add the item, or remove it when it is already selected. */
export function toggleItem(s: MultiSel, r: ItemRef): MultiSel {
  if (r.kind === 'spawn') return { ...s, spawn: !s.spawn };
  const k = listKey[r.kind];
  return { ...s, [k]: s[k].includes(r.id) ? s[k].filter((x) => x !== r.id) : [...s[k], r.id] };
}

const uniq = (a: string[], b: string[]) => [...new Set([...a, ...b])];
export function unionSel(a: MultiSel, b: MultiSel): MultiSel {
  return { walls: uniq(a.walls, b.walls), works: uniq(a.works, b.works), zones: uniq(a.zones, b.zones), areas: uniq(a.areas, b.areas), spawn: a.spawn || b.spawn };
}

/** Drops ids that no longer exist and, on the Areas layer, everything but areas. Returns `s` itself when nothing changed. */
export function cleanSelection(m: Museum, s: MultiSel, layer: Layer): MultiSel {
  if (isEmptySel(s)) return s;
  const keep = (ids: string[], all: { id: string }[]) => {
    if (!ids.length) return ids;
    const have = new Set(all.map((x) => x.id));
    const out = ids.filter((i) => have.has(i));
    return out.length === ids.length ? ids : out;
  };
  const areasOnly = layer === 'areas';
  const next: MultiSel = {
    walls: areasOnly ? [] : keep(s.walls, m.walls),
    works: areasOnly ? [] : keep(s.works, m.works),
    zones: areasOnly ? [] : keep(s.zones, m.zones),
    areas: keep(s.areas, m.areas),
    spawn: areasOnly ? false : s.spawn,
  };
  const same = next.walls === s.walls && next.works === s.works && next.zones === s.zones && next.areas === s.areas && next.spawn === s.spawn;
  return same ? s : next;
}

/** "12 walls, 30 paintings, 2 zones, 3 areas, spawn point". */
export function describeSel(s: MultiSel): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (s.walls.length) parts.push(plural(s.walls.length, 'wall', 'walls'));
  if (s.works.length) parts.push(plural(s.works.length, 'painting', 'paintings'));
  if (s.zones.length) parts.push(plural(s.zones.length, 'zone', 'zones'));
  if (s.areas.length) parts.push(plural(s.areas.length, 'area', 'areas'));
  if (s.spawn) parts.push('spawn point');
  return parts.join(', ');
}

// ---------- box selection ----------

export interface Rect { x: number; y: number; w: number; h: number }

/** Which kinds a box (or select-all) may pick. Missing = true. */
export interface KindOpts { walls?: boolean; works?: boolean; zones?: boolean; areas?: boolean; spawn?: boolean }

const IN_EPS = 1e-9;

/**
 * Everything fully inside `rect`: wall = both endpoints; work = both ends of its plan segment; rect zone = its
 * rect; circle zone = its bounding square; area = its rect; spawn = its point.
 */
export function itemsInRect(m: Museum, rect: Rect, opts: KindOpts = {}): MultiSel {
  const x0 = rect.x - IN_EPS, y0 = rect.y - IN_EPS, x1 = rect.x + rect.w + IN_EPS, y1 = rect.y + rect.h + IN_EPS;
  const pin = (p: Vec2) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const boxIn = (ax: number, ay: number, bx: number, by: number) => ax >= x0 && bx <= x1 && ay >= y0 && by <= y1;
  const out: MultiSel = { walls: [], works: [], zones: [], areas: [], spawn: false };
  if (opts.walls !== false) for (const w of m.walls) if (pin(w.a) && pin(w.b)) out.walls.push(w.id);
  if (opts.works !== false && m.works.length) {
    const walls = new Map(m.walls.map((w) => [w.id, w]));
    const th = m.settings.wallThickness;
    for (const k of m.works) {
      const wall = walls.get(k.wallId);
      if (!wall) continue;
      const seg = workEnds(wall, k, th);
      if (pin(seg.a) && pin(seg.b)) out.works.push(k.id);
    }
  }
  if (opts.zones !== false)
    for (const z of m.zones) {
      const s = z.shape;
      const inside = s.kind === 'rect' ? boxIn(s.x, s.y, s.x + s.w, s.y + s.h) : boxIn(s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r);
      if (inside) out.zones.push(z.id);
    }
  if (opts.areas !== false) for (const a of m.areas) if (boxIn(a.rect.x, a.rect.y, a.rect.x + a.rect.w, a.rect.y + a.rect.h)) out.areas.push(a.id);
  if (opts.spawn !== false && pin(m.settings.spawn)) out.spawn = true;
  return out;
}

/** Same two end points as `workSegment` in hit.ts, without the per-work lookups. */
function workEnds(wall: Wall, work: Work, th: number): { a: Vec2; b: Vec2 } {
  const { center } = workPlacement(wall, work, th);
  const d = wallDirection(wall);
  const h = work.width / 2;
  return { a: { x: center.x - d.x * h, y: center.y - d.y * h }, b: { x: center.x + d.x * h, y: center.y + d.y * h } };
}

/** Ctrl/Cmd+A: every item of the allowed kinds. */
export function allItems(m: Museum, opts: KindOpts = {}): MultiSel {
  return {
    walls: opts.walls !== false ? m.walls.map((w) => w.id) : [],
    works: opts.works !== false ? m.works.map((w) => w.id) : [],
    zones: opts.zones !== false ? m.zones.map((z) => z.id) : [],
    areas: opts.areas !== false ? m.areas.map((a) => a.id) : [],
    spawn: opts.spawn !== false,
  };
}

// ---------- move ----------

/**
 * Translate the selected walls (both endpoints), zones, areas and spawn. Works ride along with their walls
 * (they are wall-relative); a selected work whose wall is not selected stays where it is. Unselected walls that
 * shared an endpoint with a moved wall are NOT dragged along: they detach.
 */
export function moveSelection(m: Museum, sel: MultiSel, delta: Vec2): Museum {
  const walls = new Set(sel.walls), zones = new Set(sel.zones), areas = new Set(sel.areas);
  const sh = (p: Vec2): Vec2 => ({ x: round4(p.x + delta.x), y: round4(p.y + delta.y) });
  const sp = m.settings.spawn;
  return {
    ...m,
    settings: sel.spawn ? { ...m.settings, spawn: { ...sp, ...sh(sp) } } : m.settings,
    walls: walls.size ? m.walls.map((w) => (walls.has(w.id) ? { ...w, a: sh(w.a), b: sh(w.b) } : w)) : m.walls,
    zones: zones.size
      ? m.zones.map((z) => {
          if (!zones.has(z.id)) return z;
          const s = z.shape;
          const shape: ZoneShape = s.kind === 'rect' ? { ...s, x: round4(s.x + delta.x), y: round4(s.y + delta.y) } : { ...s, cx: round4(s.cx + delta.x), cy: round4(s.cy + delta.y) };
          return { ...z, shape };
        })
      : m.zones,
    areas: areas.size ? m.areas.map((a) => (areas.has(a.id) ? { ...a, rect: { ...a.rect, x: round4(a.rect.x + delta.x), y: round4(a.rect.y + delta.y) } } : a)) : m.areas,
  };
}

// ---------- rotate ----------

/** Bounding box of the things rotateSelection turns (selected walls, zones, areas, spawn). Null when there are none. */
function rotatable(m: Museum, sel: MultiSel): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  };
  const walls = new Set(sel.walls), zones = new Set(sel.zones), areas = new Set(sel.areas);
  for (const w of m.walls) if (walls.has(w.id)) add(w.a.x, w.a.y), add(w.b.x, w.b.y);
  for (const z of m.zones)
    if (zones.has(z.id)) {
      const s = z.shape;
      if (s.kind === 'rect') add(s.x, s.y), add(s.x + s.w, s.y + s.h);
      else add(s.cx - s.r, s.cy - s.r), add(s.cx + s.r, s.cy + s.r);
    }
  for (const a of m.areas) if (areas.has(a.id)) add(a.rect.x, a.rect.y), add(a.rect.x + a.rect.w, a.rect.y + a.rect.h);
  if (sel.spawn) add(m.settings.spawn.x, m.settings.spawn.y);
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

const normYaw = (v: number) => round4(((v % 360) + 360) % 360);

/**
 * Turn the selection 90 degrees about its bounding-box centre, the centre snapped to the grid. dir 1 = clockwise
 * as seen on the blueprint (plan +y is down, so a point to the right of the centre ends up below it), -1 = counter-clockwise.
 * Walls rotate both points (their works keep side, t and size, so they turn with them); rect zones and areas
 * rotate their rect (w/h swap); circle zones rotate their centre; the spawn rotates its point and its facing
 * (yawDeg +90 for clockwise: yaw 0 faces plan -y, 90 faces +x, clockwise from above). Selected works alone are not rotated.
 */
export function rotateSelection(m: Museum, sel: MultiSel, dir: 1 | -1): Museum {
  const b = rotatable(m, sel);
  if (!b) return m;
  const grid = m.settings.gridSize;
  const c = { x: snapValue((b.x0 + b.x1) / 2, grid), y: snapValue((b.y0 + b.y1) / 2, grid) };
  const rot = (p: Vec2): Vec2 => {
    const dx = p.x - c.x, dy = p.y - c.y;
    return dir === 1 ? { x: round4(c.x - dy), y: round4(c.y + dx) } : { x: round4(c.x + dy), y: round4(c.y - dx) };
  };
  const rotRect = (r: { x: number; y: number; w: number; h: number }) => {
    const p = rot({ x: r.x, y: r.y }), q = rot({ x: r.x + r.w, y: r.y + r.h });
    return { x: round4(Math.min(p.x, q.x)), y: round4(Math.min(p.y, q.y)), w: round4(Math.abs(q.x - p.x)), h: round4(Math.abs(q.y - p.y)) };
  };
  const walls = new Set(sel.walls), zones = new Set(sel.zones), areas = new Set(sel.areas);
  const sp = m.settings.spawn;
  return {
    ...m,
    settings: sel.spawn ? { ...m.settings, spawn: { ...rot(sp), yawDeg: normYaw(sp.yawDeg + 90 * dir) } } : m.settings,
    walls: walls.size ? m.walls.map((w) => (walls.has(w.id) ? { ...w, a: rot(w.a), b: rot(w.b) } : w)) : m.walls,
    zones: zones.size
      ? m.zones.map((z) => {
          if (!zones.has(z.id)) return z;
          const s = z.shape;
          if (s.kind === 'rect') return { ...z, shape: { kind: 'rect' as const, ...rotRect(s) } };
          const n = rot({ x: s.cx, y: s.cy });
          return { ...z, shape: { ...s, cx: n.x, cy: n.y } };
        })
      : m.zones,
    areas: areas.size ? m.areas.map((a) => (areas.has(a.id) ? { ...a, rect: rotRect(a.rect) } : a)) : m.areas,
  };
}

// ---------- duplicate ----------

export const DUPLICATE_OFFSET_M = 1;

/**
 * Copies with fresh ids, shifted by `offset`. A duplicated wall brings every work hanging on it (selected or not).
 * Zones and areas are copied (areas on top of the stack). A selected work whose wall is not selected is copied
 * onto the same wall, shifted along it by the offset's component along the wall, and only if it still fits and
 * actually moves (a copy exactly on top of the original would be pointless); otherwise it is skipped. The
 * spawn is never duplicated. Returns the new museum and the selection of the copies (walls, zones, areas and lone work copies; the works that came along with a copied wall follow that wall).
 */
export function duplicateSelection(m: Museum, sel: MultiSel, offset: Vec2): { museum: Museum; selection: MultiSel } {
  const sh = (p: Vec2): Vec2 => ({ x: round4(p.x + offset.x), y: round4(p.y + offset.y) });
  const out: MultiSel = { walls: [], works: [], zones: [], areas: [], spawn: false };

  const wallIds = new Set(sel.walls);
  const takenWalls = new Set(m.walls.map((w) => w.id));
  const idMap = new Map<string, string>();
  const newWalls: Wall[] = [];
  for (const w of m.walls) {
    if (!wallIds.has(w.id)) continue;
    const id = newId('wall', takenWalls);
    takenWalls.add(id);
    idMap.set(w.id, id);
    newWalls.push({ ...w, id, a: sh(w.a), b: sh(w.b), ...(w.finish ? { finish: { ...w.finish } } : {}) });
    out.walls.push(id);
  }

  const takenWorks = new Set(m.works.map((w) => w.id));
  const newWorks: Work[] = [];
  const wallById = new Map(m.walls.map((w) => [w.id, w]));
  const lone = new Set(sel.works);
  for (const k of m.works) {
    const copyWall = idMap.get(k.wallId);
    let copy: Work | null = null;
    if (copyWall) copy = { ...k, wallId: copyWall };
    else if (lone.has(k.id)) {
      const wall = wallById.get(k.wallId);
      if (wall) {
        const d = wallDirection(wall);
        const shift = offset.x * d.x + offset.y * d.y;
        const t = round4(k.t + shift);
        if (Math.abs(shift) > 1e-6 && t - k.width / 2 >= -1e-6 && t + k.width / 2 <= wallLength(wall) + 1e-6) copy = { ...k, t };
      }
    }
    if (!copy) continue;
    const id = newId('work', takenWorks);
    takenWorks.add(id);
    newWorks.push({ ...copy, id });
    if (!copyWall) out.works.push(id); // works that came along with a copied wall are not part of the returned selection
  }

  const zoneIds = new Set(sel.zones);
  const takenZones = new Set(m.zones.map((z) => z.id));
  const newZones: AudioZone[] = [];
  for (const z of m.zones) {
    if (!zoneIds.has(z.id)) continue;
    const id = newId('zone', takenZones);
    takenZones.add(id);
    const s = z.shape;
    const shape: ZoneShape =
      s.kind === 'rect' ? { ...s, x: round4(s.x + offset.x), y: round4(s.y + offset.y) } : { ...s, cx: round4(s.cx + offset.x), cy: round4(s.cy + offset.y) };
    newZones.push({ ...z, id, name: z.name ? `${z.name} copy` : '', shape });
    out.zones.push(id);
  }

  const areaIds = new Set(sel.areas);
  const takenAreas = new Set(m.areas.map((a) => a.id));
  const newAreas: Area[] = [];
  for (const a of m.areas) {
    if (!areaIds.has(a.id)) continue;
    const id = newId('area', takenAreas);
    takenAreas.add(id);
    const p = sh({ x: a.rect.x, y: a.rect.y });
    newAreas.push({ ...a, id, name: a.name ? `${a.name} copy` : '', rect: { ...a.rect, x: p.x, y: p.y }, ...(a.floor ? { floor: { ...a.floor } } : {}), ...(a.ceiling ? { ceiling: { ...a.ceiling } } : {}) });
    out.areas.push(id);
  }

  return {
    museum: { ...m, walls: [...m.walls, ...newWalls], works: [...m.works, ...newWorks], zones: [...m.zones, ...newZones], areas: [...m.areas, ...newAreas] },
    selection: out,
  };
}

// ---------- delete / finish ----------

/** Delete everything selected; works on deleted walls go too. The spawn cannot be deleted and is ignored. */
export function deleteSelection(m: Museum, sel: MultiSel): Museum {
  const walls = new Set(sel.walls), works = new Set(sel.works), zones = new Set(sel.zones), areas = new Set(sel.areas);
  return {
    ...m,
    walls: m.walls.filter((w) => !walls.has(w.id)),
    works: m.works.filter((w) => !works.has(w.id) && !walls.has(w.wallId)),
    zones: m.zones.filter((z) => !zones.has(z.id)),
    areas: m.areas.filter((a) => !areas.has(a.id)),
  };
}

/** Set (or, with undefined, clear = use the default) the finish of several walls at once. */
export function setFinishForWalls(m: Museum, wallIds: string[], finish: WallFinish | undefined): Museum {
  const ids = new Set(wallIds);
  return {
    ...m,
    walls: m.walls.map((w) => {
      if (!ids.has(w.id)) return w;
      const { finish: _old, ...rest } = w;
      return finish ? { ...rest, finish: { ...finish } } : rest;
    }),
  };
}

/** Offset used by Ctrl/Cmd+D: 1 m on each axis, snapped to the grid (never zero). */
export function duplicateOffset(grid: number): Vec2 {
  const d = snapValue(DUPLICATE_OFFSET_M, grid) || grid;
  return { x: d, y: d };
}
