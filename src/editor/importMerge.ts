// Pure merge of a guest museum into the host museum (one-time copy). No React, no DOM.
import type { Area, AudioZone, Finish, MediaItem, Museum, Vec2, Wall, Work } from '../shared/museum';
import { newId, round4, snapValue } from './model';
import { EMPTY_SEL, type MultiSel } from './multiSelect';

/** What happened to one guest media item: reuse a host item, or it was uploaded as `file`. Absent = file missing. */
export type MediaMapping = { reuse: string } | { file: string };

export interface MergeOptions {
  /** Bring only media referenced by guest works, zones, finishes and areas. Default: the whole library. */
  onlyUsed?: boolean;
  /** For tests. */
  rand?: () => number;
}

export interface MergeSummary {
  walls: number;
  works: number;
  zones: number;
  areas: number;
  /** Media items added to the library (reused host items not counted). */
  media: number;
  /** Guest media items that were matched to an item the host already had. */
  reused: number;
}

export interface MergeResult {
  museum: Museum;
  selection: MultiSel;
  summary: MergeSummary;
  warnings: string[];
}

const GAP_M = 2;
const MIN_BASE_SIDE = 0.2;

export function sameFinish(a: Finish, b: Finish): boolean {
  return a.textureId === b.textureId && a.color.toLowerCase() === b.color.toLowerCase() && a.tileSize === b.tileSize;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function planBounds(m: Museum): Bounds | null {
  let b: Bounds | null = null;
  const add = (x: number, y: number) => {
    b = b ? { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
  };
  for (const w of m.walls) add(w.a.x, w.a.y), add(w.b.x, w.b.y);
  for (const a of m.areas) add(a.rect.x, a.rect.y), add(a.rect.x + a.rect.w, a.rect.y + a.rect.h);
  for (const z of m.zones) {
    if (z.shape.kind === 'rect') add(z.shape.x, z.shape.y), add(z.shape.x + z.shape.w, z.shape.y + z.shape.h);
    else add(z.shape.cx - z.shape.r, z.shape.cy - z.shape.r), add(z.shape.cx + z.shape.r, z.shape.cy + z.shape.r);
  }
  return b;
}

/** Guest media ids the plan refers to (works, zones, finishes incl. the defaults and areas). The guest sky is not used. */
export function usedMediaIds(guest: Museum): Set<string> {
  const used = new Set<string>();
  for (const w of guest.works) used.add(w.mediaId);
  for (const z of guest.zones) used.add(z.mediaId);
  const fin = (f?: Finish) => f?.textureId && used.add(f.textureId);
  fin(guest.settings.wallFinish);
  fin(guest.settings.floorFinish);
  if (guest.settings.ceiling) fin(guest.settings.ceilingFinish);
  for (const w of guest.walls) fin(w.finish);
  for (const a of guest.areas) {
    fin(a.floor);
    fin(a.ceiling);
  }
  return used;
}

const mm = (n: number) => `${round4(n)} m`;

export function mergeMuseum(host: Museum, guest: Museum, media: ReadonlyMap<string, MediaMapping>, opts: MergeOptions = {}): MergeResult {
  const rand = opts.rand ?? Math.random;
  const warnings: string[] = [];
  const grid = host.settings.gridSize;
  const guestName = guest.name || 'Imported museum';

  // ---- media ----
  const used = usedMediaIds(guest);
  const takenMedia = new Set(host.media.map((x) => x.id));
  const idMap = new Map<string, string>(); // guest media id -> host media id
  const newMedia: MediaItem[] = [];
  const missing: string[] = [];
  let reused = 0;
  for (const item of guest.media) {
    if (opts.onlyUsed && !used.has(item.id)) continue;
    const map = media.get(item.id);
    if (!map) {
      missing.push(item.name || item.file);
      continue;
    }
    if ('reuse' in map) {
      idMap.set(item.id, map.reuse);
      reused++;
      continue;
    }
    const id = newId('media', takenMedia, rand);
    takenMedia.add(id);
    idMap.set(item.id, id);
    newMedia.push({ ...item, id, file: map.file });
  }
  if (missing.length) {
    const list = missing.slice(0, 4).join(', ') + (missing.length > 4 ? `, and ${missing.length - 4} more` : '');
    warnings.push(`${missing.length} file${missing.length === 1 ? ' was' : 's were'} not found in "${guestName}" and left out (${list}). Anything that used them was dropped or lost its texture.`);
  }

  const lostTextures = new Set<string>();
  const remapFinish = (f: Finish): Finish => {
    const { textureId, ...rest } = f;
    if (textureId === undefined) return { ...rest };
    const mapped = idMap.get(textureId);
    if (mapped === undefined) {
      lostTextures.add(textureId);
      return { ...rest };
    }
    return { ...rest, textureId: mapped };
  };

  // ---- placement ----
  const hostB = planBounds(host);
  const guestB = planBounds(guest);
  let dx = 0, dy = 0;
  if (hostB && guestB) {
    dx = round4(Math.ceil((hostB.maxX + GAP_M - guestB.minX) / grid - 1e-9) * grid);
    dy = snapValue(hostB.minY - guestB.minY, grid);
  }
  const sh = (p: Vec2): Vec2 => ({ x: round4(p.x + dx), y: round4(p.y + dy) });

  // ---- finishes: what the guest looked like ----
  const gWall = remapFinish(guest.settings.wallFinish);
  const gFloor = remapFinish(guest.settings.floorFinish);
  const gCeil = remapFinish(guest.settings.ceilingFinish);
  const bakeWall = !sameFinish(gWall, host.settings.wallFinish);
  const ceilingsOff = guest.settings.ceiling === false && host.settings.ceiling;
  const bakeFloor = !sameFinish(gFloor, host.settings.floorFinish);
  const bakeCeil = !ceilingsOff && host.settings.ceiling && guest.settings.ceiling && !sameFinish(gCeil, host.settings.ceilingFinish);

  const out: MultiSel = { ...EMPTY_SEL, walls: [], works: [], zones: [], areas: [] };
  const takenIds = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));

  // ---- walls and works ----
  const takenWalls = takenIds(host.walls);
  const wallMap = new Map<string, string>();
  const walls: Wall[] = [];
  const planEmpty = !guestB;
  if (!planEmpty) {
    for (const w of guest.walls) {
      const id = newId('wall', takenWalls, rand);
      takenWalls.add(id);
      wallMap.set(w.id, id);
      const finish = w.finish ? remapFinish(w.finish) : bakeWall ? { ...gWall } : undefined;
      walls.push({ id, a: sh(w.a), b: sh(w.b), ...(finish ? { finish } : {}) });
      out.walls.push(id);
    }
  }
  const takenWorks = takenIds(host.works);
  const works: Work[] = [];
  const guestMediaById = new Map(guest.media.map((x) => [x.id, x]));
  const droppedWorks: string[] = [];
  for (const k of guest.works) {
    const wallId = wallMap.get(k.wallId);
    const mediaId = idMap.get(k.mediaId);
    if (!wallId) continue;
    const item = guestMediaById.get(k.mediaId);
    if (!mediaId) {
      droppedWorks.push(item?.title || item?.name || k.id);
      continue;
    }
    const id = newId('work', takenWorks, rand);
    takenWorks.add(id);
    works.push({ ...k, id, wallId, mediaId });
    const h = item?.width && item.height ? (k.width * item.height) / item.width : k.width;
    const top = k.centerHeight + h / 2;
    if (top > host.settings.wallHeight + 1e-6)
      warnings.push(`"${item?.title || item?.name || k.id}" reaches ${mm(top)}, above your ${mm(host.settings.wallHeight)} walls.`);
  }
  if (droppedWorks.length) warnings.push(`${droppedWorks.length} painting${droppedWorks.length === 1 ? '' : 's'} left out because the image file is missing: ${droppedWorks.slice(0, 4).join(', ')}${droppedWorks.length > 4 ? ', …' : ''}.`);

  // ---- zones ----
  const takenZones = takenIds(host.zones);
  const zones: AudioZone[] = [];
  const droppedZones: string[] = [];
  if (!planEmpty) {
    for (const z of guest.zones) {
      const mediaId = idMap.get(z.mediaId);
      if (!mediaId) {
        droppedZones.push(z.name || z.id);
        continue;
      }
      const id = newId('zone', takenZones, rand);
      takenZones.add(id);
      const s = z.shape;
      let shape: AudioZone['shape'];
      if (s.kind === 'rect') {
        const p = sh({ x: s.x, y: s.y });
        shape = { ...s, x: p.x, y: p.y };
      } else {
        const p = sh({ x: s.cx, y: s.cy });
        shape = { ...s, cx: p.x, cy: p.y };
      }
      zones.push({ ...z, id, mediaId, shape });
      out.zones.push(id);
    }
  }
  if (droppedZones.length) warnings.push(`${droppedZones.length} audio zone${droppedZones.length === 1 ? '' : 's'} left out because the sound file is missing: ${droppedZones.slice(0, 4).join(', ')}.`);

  // ---- areas ----
  const takenAreas = takenIds(host.areas);
  const areas: Area[] = [];
  if (!planEmpty) {
    const base: Area | null = (() => {
      if (!guest.walls.length || !(bakeFloor || bakeCeil || ceilingsOff)) return null;
      const xs = guest.walls.flatMap((w) => [w.a.x, w.b.x]);
      const ys = guest.walls.flatMap((w) => [w.a.y, w.b.y]);
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (x1 - x0 < MIN_BASE_SIDE) (x0 -= MIN_BASE_SIDE / 2), (x1 += MIN_BASE_SIDE / 2);
      if (y1 - y0 < MIN_BASE_SIDE) (y0 -= MIN_BASE_SIDE / 2), (y1 += MIN_BASE_SIDE / 2);
      const p = sh({ x: x0, y: y0 });
      const a: Area = { id: '', name: `${guestName} (base)`, rect: { x: p.x, y: p.y, w: round4(x1 - x0), h: round4(y1 - y0) } };
      if (bakeFloor) a.floor = { ...gFloor };
      if (ceilingsOff) a.openSky = true;
      else if (bakeCeil) a.ceiling = { ...gCeil };
      return a;
    })();
    const list: Area[] = [];
    if (base) list.push(base);
    for (const a of guest.areas) {
      const next: Area = { id: '', name: a.name, rect: { ...a.rect, ...sh({ x: a.rect.x, y: a.rect.y }) } };
      if (a.floor) next.floor = remapFinish(a.floor);
      if (a.ceiling && !ceilingsOff) next.ceiling = remapFinish(a.ceiling);
      if (a.openSky) next.openSky = true;
      if (!next.floor && !next.ceiling && !next.openSky) continue; // only had an (invisible) ceiling
      list.push(next);
    }
    for (const a of list) {
      a.id = newId('area', takenAreas, rand);
      takenAreas.add(a.id);
      out.areas.push(a.id);
      areas.push(a);
    }
  }

  if (lostTextures.size) warnings.push('Some textures were missing; the affected walls, floors and ceilings keep their colour only.');

  // ---- warnings about differing settings ----
  if (guest.walls.length) {
    if (Math.abs(guest.settings.wallHeight - host.settings.wallHeight) > 1e-6)
      warnings.push(`Their walls were ${mm(guest.settings.wallHeight)} high, yours are ${mm(host.settings.wallHeight)}. The imported walls now use yours.`);
    if (Math.abs(guest.settings.wallThickness - host.settings.wallThickness) > 1e-6)
      warnings.push(`Info: their walls were ${mm(guest.settings.wallThickness)} thick, yours are ${mm(host.settings.wallThickness)}.`);
  }

  const museum: Museum = {
    ...host,
    walls: [...host.walls, ...walls],
    works: [...host.works, ...works],
    zones: [...host.zones, ...zones],
    areas: [...host.areas, ...areas],
    media: [...host.media, ...newMedia],
  };
  return {
    museum,
    selection: out,
    summary: { walls: walls.length, works: works.length, zones: zones.length, areas: areas.length, media: newMedia.length, reused },
    warnings,
  };
}
