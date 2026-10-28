import { describe, expect, it } from 'vitest';
import type { Museum } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import {
  addArea, areaTag, ceilingModeOf, deleteArea, duplicateArea, fillRoom, moveArea, reorderArea, resizeAreaRect, snapAreaMove, snapAreaPoint, setCeilingMode, updateArea,
} from './areaModel';
import { addMedia, addRoom, computeWarnings, mediaUsage, removeMedia, updateSettings } from './model';
import { hitTestAreas } from './hit';
import { canUndo, commitFrom, createHistory, push, replace, undo } from './history';

const wall = (m: Museum, id: string, ax: number, ay: number, bx: number, by: number): Museum => ({ ...m, walls: [...m.walls, { id, a: { x: ax, y: ay }, b: { x: bx, y: by } }] });
const withAreas = () => {
  let m = defaultMuseum();
  for (const x of [0, 2, 4]) m = addArea(m, { x, y: 0, w: 2, h: 2 })!.museum;
  return m;
};

describe('area operations', () => {
  it('addArea creates a floor-only area, rejects degenerate rects, produces a valid museum', () => {
    const r = addArea(defaultMuseum(), { x: 1, y: 1, w: 3, h: 2 })!;
    expect(r.museum.areas).toHaveLength(1);
    expect(r.museum.areas[0].floor).toBeDefined();
    expect(r.museum.areas[0].ceiling).toBeUndefined();
    expect(parseMuseum(r.museum).ok).toBe(true);
    expect(addArea(defaultMuseum(), { x: 0, y: 0, w: 0, h: 1 })).toBeNull();
  });
  it('update, move, resize, delete', () => {
    const m = withAreas();
    const id = m.areas[1].id;
    expect(moveArea(m, id, { x: 1, y: -1 }).areas[1].rect).toEqual({ x: 3, y: -1, w: 2, h: 2 });
    expect(updateArea(m, id, { ceiling: { color: '#000000', tileSize: 1 } }).areas[1].ceiling).toBeDefined();
    expect('ceiling' in updateArea(updateArea(m, id, { ceiling: { color: '#000000', tileSize: 1 } }), id, { ceiling: undefined }).areas[1]).toBe(false);
    expect(resizeAreaRect({ x: 0, y: 0, w: 2, h: 2 }, 'se', { x: 5, y: 4 })).toEqual({ x: 0, y: 0, w: 5, h: 4 });
    expect(resizeAreaRect({ x: 0, y: 0, w: 2, h: 2 }, 'nw', { x: -1, y: -1 })).toEqual({ x: -1, y: -1, w: 3, h: 3 });
    expect(resizeAreaRect({ x: 0, y: 0, w: 2, h: 2 }, 'nw', { x: 9, y: 9 }, 0.1)).toEqual({ x: 1.9, y: 1.9, w: 0.1, h: 0.1 });
    expect(deleteArea(m, id).areas.map((a) => a.id)).toEqual([m.areas[0].id, m.areas[2].id]);
  });
  it('duplicate puts a copy on top with its own id and independent finishes', () => {
    const m = withAreas();
    const r = duplicateArea(m, m.areas[0].id)!;
    expect(r.museum.areas).toHaveLength(4);
    expect(r.museum.areas[3].id).toBe(r.id);
    expect(r.museum.areas[3].id).not.toBe(m.areas[0].id);
    expect(r.museum.areas[3].floor).toEqual(m.areas[0].floor);
    expect(r.museum.areas[3].floor).not.toBe(m.areas[0].floor);
    expect(parseMuseum(r.museum).ok).toBe(true);
  });
  it('reorder: forward/backward/front/back, no-ops return the same museum', () => {
    const m = withAreas();
    const [a, b, c] = m.areas.map((x) => x.id);
    const ids = (x: Museum) => x.areas.map((y) => y.id);
    expect(ids(reorderArea(m, a, 'forward'))).toEqual([b, a, c]);
    expect(ids(reorderArea(m, c, 'backward'))).toEqual([a, c, b]);
    expect(ids(reorderArea(m, a, 'front'))).toEqual([b, c, a]);
    expect(ids(reorderArea(m, c, 'back'))).toEqual([c, a, b]);
    expect(reorderArea(m, c, 'forward')).toBe(m);
    expect(reorderArea(m, a, 'back')).toBe(m);
    expect(reorderArea(m, 'nope', 'front')).toBe(m);
  });
  it('undo: a drag (preview x N then commit) is one step; add/delete/reorder are steps', () => {
    const m0 = withAreas();
    let h = createHistory(m0);
    const id = m0.areas[0].id;
    for (let i = 1; i <= 5; i++) h = replace(h, moveArea(m0, id, { x: i, y: 0 }));
    h = commitFrom(h, m0);
    expect(h.past).toHaveLength(1);
    h = push(h, reorderArea(h.present, id, 'front'));
    h = push(h, deleteArea(h.present, id));
    expect(h.past).toHaveLength(3);
    h = undo(undo(h));
    expect(h.present.areas[0].rect.x).toBe(5);
    h = undo(h);
    expect(h.present).toBe(m0);
    expect(canUndo(h)).toBe(false);
  });
});

describe('snapping', () => {
  const m = wall(wall(defaultMuseum(), 'v', 3.1, 0, 3.1, 5), 'h', 0, 4.9, 6, 4.9);
  it('snaps points to wall centre lines within 0.3 m, else to the grid', () => {
    expect(snapAreaPoint(m, { x: 3.3, y: 2.1 }, 0.5)).toEqual({ x: 3.1, y: 2 });
    expect(snapAreaPoint(m, { x: 3.45, y: 4.7 }, 0.5)).toEqual({ x: 3.5, y: 4.9 });
  });
  it('snaps a moved rect edge (either side) to a wall line', () => {
    expect(snapAreaMove(m, { x: 0, y: 0, w: 3, h: 2 }, { x: 0.2, y: 0 })).toEqual({ x: 0.1, y: 0 });
    expect(snapAreaMove(m, { x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 3 })).toEqual({ x: 1.1, y: 2.9 });
    expect(snapAreaMove(m, { x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('fillRoom', () => {
  const closed = addRoom(defaultMuseum(), { x: 0, y: 0 }, { x: 6, y: 4 })!.museum;
  it('closed rectangular room: rect at the wall centre lines', () => {
    expect(fillRoom(closed, { x: 2, y: 1 })).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(fillRoom(closed, { x: 5.85, y: 3.85 })).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });
  it('a doorway gap on the ray path: the ray continues to the next wall', () => {
    // room A x 0..4, room B x 4..8, shared wall x=4 has a gap at y 1.5..2.5
    let m = defaultMuseum();
    m = addRoom(m, { x: 0, y: 0 }, { x: 8, y: 4 })!.museum;
    m = wall(wall(m, 'd1', 4, 0, 4, 1.5), 'd2', 4, 2.5, 4, 4);
    expect(fillRoom(m, { x: 2, y: 1 })).toEqual({ x: 0, y: 0, w: 4, h: 4 }); // right ray hits d1
    expect(fillRoom(m, { x: 2, y: 2 })).toEqual({ x: 0, y: 0, w: 8, h: 4 }); // right ray goes through the gap
  });
  it('open side: null', () => {
    const open = { ...closed, walls: closed.walls.filter((w) => w.id !== closed.walls[3].id) }; // remove left wall
    expect(fillRoom(open, { x: 2, y: 1 })).toBeNull();
    expect(fillRoom(defaultMuseum(), { x: 0, y: 0 })).toBeNull();
  });
  it('click outside the room: null', () => {
    expect(fillRoom(closed, { x: -2, y: 1 })).toBeNull();
    expect(fillRoom(closed, { x: 9, y: 1 })).toBeNull();
    expect(fillRoom(closed, { x: 3, y: -1 })).toBeNull();
  });
  it('click inside a wall: null', () => {
    expect(fillRoom(closed, { x: 3, y: 0.05 })).toBeNull();
    expect(fillRoom(closed, { x: 0.09, y: 2 })).toBeNull();
  });
  it('an inner partition shortens the rect', () => {
    const m = wall(closed, 'p', 3, 0, 3, 4);
    expect(fillRoom(m, { x: 1, y: 1 })).toEqual({ x: 0, y: 0, w: 3, h: 4 });
    expect(fillRoom(m, { x: 4, y: 1 })).toEqual({ x: 3, y: 0, w: 3, h: 4 });
  });
  it('result can be added as a valid area', () => {
    const r = addArea(closed, fillRoom(closed, { x: 1, y: 1 })!)!;
    expect(parseMuseum(r.museum).ok).toBe(true);
  });
});

describe('hitTestAreas', () => {
  it('picks the top-most area, ignores walls, handles of the selected area win', () => {
    let m = defaultMuseum();
    m = addRoom(m, { x: 0, y: 0 }, { x: 4, y: 4 })!.museum;
    m = addArea(m, { x: 0, y: 0, w: 4, h: 4 })!.museum;
    m = addArea(m, { x: 1, y: 1, w: 2, h: 2 })!.museum;
    const [a, b] = m.areas.map((x) => x.id);
    expect(hitTestAreas(m, { x: 2, y: 2 }, 0.1, null)).toEqual({ type: 'area', id: b });
    expect(hitTestAreas(m, { x: 0.5, y: 0.5 }, 0.1, null)).toEqual({ type: 'area', id: a });
    expect(hitTestAreas(m, { x: 0, y: 0 }, 0.1, a)).toEqual({ type: 'areaHandle', id: a, handle: 'nw' }); // wall end there, but only areas count
    expect(hitTestAreas(m, { x: 9, y: 9 }, 0.1, null)).toBeNull();
  });
});

describe('texture usage and warnings with floor/ceiling/areas', () => {
  it('counts floor, ceiling and area finishes as usage; warns when missing', () => {
    let m = defaultMuseum();
    const t = addMedia(m, { kind: 'texture', file: 'media/t.png', name: 't', width: 8, height: 8 });
    m = t.museum;
    expect(removeMedia(m, t.id)).not.toBeNull();
    const f = { textureId: t.id, color: '#ffffff', tileSize: 1 };
    expect(mediaUsage(updateSettings(m, { floorFinish: f }), t.id)).toBe(1);
    expect(mediaUsage(updateSettings(m, { ceilingFinish: f }), t.id)).toBe(1);
    const a = addArea(m, { x: 0, y: 0, w: 1, h: 1 })!;
    const used = updateArea(a.museum, a.id, { floor: f, ceiling: f });
    expect(mediaUsage(used, t.id)).toBe(2);
    expect(removeMedia(used, t.id)).toBeNull();
    // missing
    const broken = { ...used, media: [] };
    const w = computeWarnings(broken).filter((x) => x.kind === 'texture-missing');
    expect(w.filter((x) => x.target.type === 'area')).toHaveLength(2);
    expect(computeWarnings(updateSettings({ ...m, media: [] }, { floorFinish: f })).some((x) => x.kind === 'texture-missing')).toBe(true);
    expect(computeWarnings(used).filter((x) => x.kind === 'texture-missing')).toEqual([]);
  });
});

describe('ceiling modes and sky', () => {
  const fin = { color: '#112233', tileSize: 2 };
  const one = () => {
    const r = addArea(defaultMuseum(), { x: 0, y: 0, w: 2, h: 2 })!;
    return { m: r.museum, id: r.id };
  };
  it('None / Finish / Open sky switch the area and stay valid', () => {
    const { m, id } = one();
    expect(ceilingModeOf(m.areas[0])).toBe('none');
    const fm = setCeilingMode(m, id, 'finish', fin);
    expect(fm.areas[0].ceiling).toEqual(fin);
    expect(ceilingModeOf(fm.areas[0])).toBe('finish');
    const om = setCeilingMode(fm, id, 'open', fin);
    expect(om.areas[0].openSky).toBe(true);
    expect(om.areas[0]).not.toHaveProperty('ceiling');
    expect(areaTag(om.areas[0])).toBe('F+O');
    const back = setCeilingMode(om, id, 'finish', fin);
    expect(back.areas[0]).not.toHaveProperty('openSky');
    expect(back.areas[0].ceiling).toEqual(fin);
    const none = setCeilingMode(back, id, 'none', fin);
    expect(none.areas[0]).not.toHaveProperty('ceiling');
    for (const x of [fm, om, back, none]) expect(parseMuseum(JSON.parse(JSON.stringify(x))).ok).toBe(true);
  });
  it('keeps at least one of floor / ceiling / open sky', () => {
    const { m, id } = one();
    const ceilingOnly = updateArea(setCeilingMode(m, id, 'finish', fin), id, { floor: undefined });
    expect(setCeilingMode(ceilingOnly, id, 'none', fin)).toBe(ceilingOnly);
    const openOnly = updateArea(setCeilingMode(m, id, 'open', fin), id, { floor: undefined });
    expect(setCeilingMode(openOnly, id, 'none', fin)).toBe(openOnly);
    expect(areaTag(openOnly.areas[0])).toBe('O');
    expect(areaTag(ceilingOnly.areas[0])).toBe('C');
  });
  it('duplicating keeps openSky', () => {
    const { m, id } = one();
    const o = setCeilingMode(m, id, 'open', fin);
    expect(duplicateArea(o, id)!.museum.areas[1].openSky).toBe(true);
  });
  it('the sky panorama counts as usage and a missing one warns', () => {
    let m = defaultMuseum();
    const p = addMedia(m, { kind: 'panorama', file: 'media/p.jpg', name: 'p', width: 4096, height: 2048 });
    m = updateSettings(p.museum, { sky: { kind: 'panorama', textureId: p.id, rotationDeg: 10 } });
    expect(mediaUsage(m, p.id)).toBe(1);
    expect(removeMedia(m, p.id)).toBeNull();
    expect(computeWarnings(m).filter((x) => x.kind === 'texture-missing')).toEqual([]);
    expect(computeWarnings({ ...m, media: [] }).some((x) => x.kind === 'texture-missing')).toBe(true);
    const free = updateSettings(m, { sky: defaultMuseum().settings.sky });
    expect(removeMedia(free, p.id)).not.toBeNull();
  });
});
