import { describe, expect, it } from 'vitest';
import type { Museum } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import { addMedia, addRoom, addZone, hangWork, setWallFinish, snapValue } from './model';
import { addArea } from './areaModel';
import { workSegment } from './hit';
import {
  EMPTY_SEL, allItems, cleanSelection, deleteSelection, describeSel, duplicateOffset, duplicateSelection, fromSelection, itemsInRect, moveSelection,
  rotateSelection, selCount, setFinishForWalls, singleOf, toggleItem, unionSel, type MultiSel,
} from './multiSelect';

const valid = (m: Museum) => {
  const r = parseMuseum(m);
  expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
};

/** Room 0..4 x 0..3 with two paintings on its first wall, a rect zone, a circle zone, an area, spawn at (2, 1.5). */
function scene() {
  let m = defaultMuseum();
  const img = addMedia(m, { kind: 'image', file: 'media/a.png', name: 'a', width: 1000, height: 500 });
  const au = addMedia(img.museum, { kind: 'audio', file: 'media/s.mp3', name: 's' });
  m = au.museum;
  const room = addRoom(m, { x: 0, y: 0 }, { x: 4, y: 3 })!;
  m = room.museum;
  const w0 = room.ids[0];
  m = hangWork(m, img.id, { wallId: w0, side: 1, t: 1, point: { x: 1, y: 0 } })!.museum;
  m = hangWork(m, img.id, { wallId: w0, side: -1, t: 3, point: { x: 3, y: 0 } })!.museum;
  m = addZone(m, { kind: 'rect', x: 1, y: 1, w: 2, h: 1 }, au.id).museum;
  m = addZone(m, { kind: 'circle', cx: 3, cy: 2, r: 0.5 }, au.id).museum;
  m = addArea(m, { x: 0, y: 0, w: 4, h: 3 })!.museum;
  m = { ...m, settings: { ...m.settings, spawn: { x: 2, y: 1.5, yawDeg: 0 } } };
  return { m, wallIds: room.ids, img: img.id, au: au.id };
}

describe('selection helpers', () => {
  it('counts, converts and toggles', () => {
    expect(selCount(EMPTY_SEL)).toBe(0);
    const s = fromSelection({ type: 'wall', id: 'w' });
    expect(selCount(s)).toBe(1);
    expect(singleOf(s, 'build')).toEqual({ type: 'wall', id: 'w' });
    const t = toggleItem(s, { kind: 'work', id: 'k' });
    expect(singleOf(t, 'build')).toBeNull();
    expect(toggleItem(t, { kind: 'wall', id: 'w' }).walls).toEqual([]);
    expect(toggleItem(EMPTY_SEL, { kind: 'spawn' }).spawn).toBe(true);
    expect(unionSel(s, fromSelection({ type: 'wall', id: 'w' })).walls).toEqual(['w']);
    expect(singleOf(fromSelection({ type: 'area', id: 'a' }), 'build')).toBeNull();
    expect(singleOf(fromSelection({ type: 'area', id: 'a' }), 'areas')).toEqual({ type: 'area', id: 'a' });
  });
  it('describes counts', () => {
    expect(describeSel({ walls: ['a', 'b'], works: ['c'], zones: [], areas: ['d', 'e', 'f'], spawn: true })).toBe('2 walls, 1 painting, 3 areas, spawn point');
  });
  it('cleanSelection drops stale ids and non-areas on the Areas layer, keeping identity when unchanged', () => {
    const { m, wallIds } = scene();
    const s: MultiSel = { ...allItems(m), walls: [...wallIds, 'gone'] };
    const c = cleanSelection(m, s, 'build');
    expect(c.walls).toEqual(wallIds);
    expect(cleanSelection(m, c, 'build')).toBe(c);
    const a = cleanSelection(m, s, 'areas');
    expect(a.walls).toEqual([]);
    expect(a.spawn).toBe(false);
    expect(a.areas).toHaveLength(1);
  });
});

describe('itemsInRect', () => {
  const { m, wallIds } = scene();
  it('selects everything fully inside, per kind', () => {
    const r = itemsInRect(m, { x: -1, y: -1, w: 6, h: 5 });
    expect(r.walls).toHaveLength(4);
    expect(r.works).toHaveLength(2);
    expect(r.zones).toHaveLength(2);
    expect(r.areas).toHaveLength(1);
    expect(r.spawn).toBe(true);
  });
  it('excludes partial overlaps', () => {
    // covers the top wall and the spawn only partly: the wall (0,0)-(4,0) sticks out on the right
    const r = itemsInRect(m, { x: -0.5, y: -0.5, w: 3, h: 2.5 });
    expect(r.walls).toEqual([]);
    expect(r.areas).toEqual([]);
    expect(r.zones).toEqual([]); // rect zone 1..3 sticks out past x=2.5
  });
  it('does not select a rect zone that only partly overlaps', () => {
    const r = itemsInRect(m, { x: 0.9, y: 0.9, w: 1.5, h: 1.5 });
    expect(r.zones).toEqual([]);
  });
  it('wall needs both endpoints', () => {
    const r = itemsInRect(m, { x: -0.1, y: -0.1, w: 4.2, h: 0.2 });
    expect(r.walls).toEqual([wallIds[0]]);
  });
  it('work needs both ends of its plan segment', () => {
    const k = m.works[0];
    const seg = workSegment(m, k.id)!;
    const x0 = Math.min(seg.a.x, seg.b.x), x1 = Math.max(seg.a.x, seg.b.x);
    const y = seg.a.y;
    const fit = itemsInRect(m, { x: x0 - 0.01, y: y - 0.1, w: x1 - x0 + 0.02, h: 0.2 }, { walls: false });
    expect(fit.works).toContain(k.id);
    const cut = itemsInRect(m, { x: x0 - 0.01, y: y - 0.1, w: (x1 - x0) / 2, h: 0.2 }, { walls: false });
    expect(cut.works).not.toContain(k.id);
  });
  it('circle zone uses its bounding square', () => {
    const circ = m.zones[1];
    expect(itemsInRect(m, { x: 2.5, y: 1.5, w: 1, h: 1 }).zones).toContain(circ.id);
    expect(itemsInRect(m, { x: 2.6, y: 1.5, w: 1, h: 1 }).zones).not.toContain(circ.id);
  });
  it('spawn is a point', () => {
    expect(itemsInRect(m, { x: 1.9, y: 1.4, w: 0.2, h: 0.2 }).spawn).toBe(true);
    expect(itemsInRect(m, { x: 2.1, y: 1.4, w: 0.2, h: 0.2 }).spawn).toBe(false);
  });
  it('opts choose eligible kinds', () => {
    const r = itemsInRect(m, { x: -1, y: -1, w: 6, h: 5 }, { areas: false, spawn: false, works: false });
    expect(r.areas).toEqual([]);
    expect(r.spawn).toBe(false);
    expect(r.works).toEqual([]);
    expect(r.walls).toHaveLength(4);
    const onlyAreas = itemsInRect(m, { x: -1, y: -1, w: 6, h: 5 }, { walls: false, works: false, zones: false, spawn: false });
    expect(selCount(onlyAreas)).toBe(1);
  });
  it('allItems follows the same opts', () => {
    expect(selCount(allItems(m, { areas: false }))).toBe(selCount(allItems(m)) - 1);
    expect(allItems(m, { spawn: false }).spawn).toBe(false);
  });
});

describe('moveSelection', () => {
  it('moves walls, zones, areas and spawn; works ride along with their walls', () => {
    const { m } = scene();
    const sel = allItems(m);
    const moved = moveSelection(m, sel, { x: 2, y: -1 });
    expect(moved.walls[0].a).toEqual({ x: 2, y: -1 });
    expect(moved.walls[0].b).toEqual({ x: 6, y: -1 });
    expect(moved.works).toEqual(m.works); // wall-relative: untouched data
    expect(workSegment(moved, m.works[0].id)!.centre).toEqual({ x: workSegment(m, m.works[0].id)!.centre.x + 2, y: workSegment(m, m.works[0].id)!.centre.y - 1 });
    const z = moved.zones[0].shape;
    expect(z.kind === 'rect' && [z.x, z.y]).toEqual([3, 0]);
    const c = moved.zones[1].shape;
    expect(c.kind === 'circle' && [c.cx, c.cy]).toEqual([5, 1]);
    expect(moved.areas[0].rect).toMatchObject({ x: 2, y: -1, w: 4, h: 3 });
    expect(moved.settings.spawn).toEqual({ x: 4, y: 0.5, yawDeg: 0 });
    valid(moved);
  });
  it('a selected work whose wall is not selected stays put; unselected walls detach', () => {
    const { m, wallIds } = scene();
    const moved = moveSelection(m, { ...EMPTY_SEL, works: [m.works[0].id], walls: [wallIds[1]] }, { x: 1, y: 1 });
    expect(moved.works).toEqual(m.works);
    expect(moved.walls[0]).toBe(m.walls[0]);
    expect(moved.walls[1].a).toEqual({ x: 5, y: 1 });
    expect(moved.walls[2].a).toEqual(m.walls[2].a); // the neighbour that shared the corner did not follow
    valid(moved);
  });
});

describe('rotateSelection', () => {
  it('four rotations return the identical museum (both directions)', () => {
    const { m } = scene();
    const sel = allItems(m);
    for (const dir of [1, -1] as const) {
      let r = m;
      for (let i = 0; i < 4; i++) r = rotateSelection(r, sel, dir);
      expect(r).toEqual(m);
    }
  });
  it('clockwise matches the screen: a point to the right of the centre ends up below it', () => {
    let m = defaultMuseum();
    m = { ...m, walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }] };
    const cw = rotateSelection(m, { ...EMPTY_SEL, walls: ['w1'] }, 1);
    // centre (2,0): (4,0) is to the right and goes to (2,2) (below); (0,0) goes to (2,-2) (above)
    expect(cw.walls[0].b).toEqual({ x: 2, y: 2 });
    expect(cw.walls[0].a).toEqual({ x: 2, y: -2 });
    const ccw = rotateSelection(m, { ...EMPTY_SEL, walls: ['w1'] }, -1);
    expect(ccw.walls[0].b).toEqual({ x: 2, y: -2 });
  });
  it('works keep side, t and size and turn with their wall', () => {
    const { m, wallIds } = scene();
    const r = rotateSelection(m, { ...EMPTY_SEL, walls: wallIds }, 1);
    expect(r.works).toEqual(m.works);
    const before = workSegment(m, m.works[1].id)!.centre; // side -1: the outside face of the top wall
    const after = workSegment(r, m.works[1].id)!.centre;
    // room centre (2,1.5); the top wall's face point (1,-0.1) turns clockwise to the right edge
    expect(before.y).toBeLessThan(0);
    expect(after.x).toBeGreaterThan(3.5); // the room is now 3 m wide (0.5..3.5): outside face on the right
    valid(r);
  });
  it('rect zones and areas swap w/h; circle zones rotate their centre', () => {
    const { m } = scene();
    const r = rotateSelection(m, { ...EMPTY_SEL, zones: m.zones.map((z) => z.id), areas: m.areas.map((a) => a.id) }, 1);
    // bounds x 0..4, y 0..3 -> centre (2, 1.5)
    expect(r.areas[0].rect).toEqual({ x: 0.5, y: -0.5, w: 3, h: 4 });
    const z = r.zones[0].shape;
    expect(z.kind === 'rect' && [z.x, z.y, z.w, z.h]).toEqual([1.5, 0.5, 1, 2]);
    const c = r.zones[1].shape; // (3,2) -> (2 - 0.5, 1.5 + 1) = (1.5, 2.5)
    expect(c.kind === 'circle' && [c.cx, c.cy, c.r]).toEqual([1.5, 2.5, 0.5]);
    valid(r);
  });
  it('rotates the spawn point and its facing consistently', () => {
    let { m } = scene();
    m = { ...m, walls: [], works: [], zones: [], areas: [], settings: { ...m.settings, spawn: { x: 3, y: 0, yawDeg: 0 } } };
    // single point: centre = the point itself (snapped), so only the facing changes
    const cw = rotateSelection(m, { ...EMPTY_SEL, spawn: true }, 1);
    expect(cw.settings.spawn.yawDeg).toBe(90);
    expect(rotateSelection(m, { ...EMPTY_SEL, spawn: true }, -1).settings.spawn.yawDeg).toBe(270);
    // with a wall: spawn on the right of the centre, facing up. Clockwise: below the centre, facing right (+x = 90).
    const w = { ...m, walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }], settings: { ...m.settings, spawn: { x: 2, y: 0, yawDeg: 0 } } };
    const r = rotateSelection(w, { ...EMPTY_SEL, walls: ['w1'], spawn: true }, 1);
    expect(r.settings.spawn).toEqual({ x: 1, y: 1, yawDeg: 90 });
    let q = w;
    for (let i = 0; i < 4; i++) q = rotateSelection(q, { ...EMPTY_SEL, walls: ['w1'], spawn: true }, 1);
    expect(q).toEqual(w);
  });
  it('the facing arrow follows the rotated position (yaw 90 faces +x on the plan)', () => {
    const m0 = defaultMuseum();
    const m = { ...m0, settings: { ...m0.settings, spawn: { x: 0, y: 0, yawDeg: 90 } } };
    const r = rotateSelection(m, { ...EMPTY_SEL, spawn: true }, 1);
    // +x rotated clockwise on screen points down the plan (+y), i.e. yaw 180
    expect(r.settings.spawn.yawDeg).toBe(180);
  });
  it('does nothing when only works are selected', () => {
    const { m } = scene();
    expect(rotateSelection(m, { ...EMPTY_SEL, works: [m.works[0].id] }, 1)).toBe(m);
  });
});

describe('duplicateSelection', () => {
  it('copies walls with all their works, zones and areas under fresh unique ids; never the spawn', () => {
    const { m, wallIds } = scene();
    const sel: MultiSel = { ...EMPTY_SEL, walls: [wallIds[0]], zones: m.zones.map((z) => z.id), areas: [m.areas[0].id], spawn: true, works: [] };
    const r = duplicateSelection(m, sel, { x: 1, y: 1 });
    expect(r.museum.walls).toHaveLength(5);
    expect(r.museum.works).toHaveLength(4); // both works on the wall, though neither was selected
    expect(r.museum.zones).toHaveLength(4);
    expect(r.museum.areas).toHaveLength(2);
    expect(r.selection.spawn).toBe(false);
    expect(r.selection.walls).toHaveLength(1);
    expect(r.selection.works).toEqual([]); // they follow their copied wall
    const newWall = r.museum.walls.find((w) => w.id === r.selection.walls[0])!;
    expect(newWall.a).toEqual({ x: 1, y: 1 });
    expect(r.museum.works.filter((k) => k.wallId === newWall.id)).toHaveLength(2);
    for (const list of [r.museum.walls, r.museum.works, r.museum.zones, r.museum.areas]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    expect(r.museum.settings.spawn).toEqual(m.settings.spawn);
    valid(r.museum);
  });
  it('a lone work on an unselected wall is offset along the wall if it fits, else skipped', () => {
    const { m } = scene();
    const k = m.works[0]; // t=1 on the 4 m top wall, direction +x
    const ok = duplicateSelection(m, { ...EMPTY_SEL, works: [k.id] }, { x: 1, y: 1 });
    expect(ok.museum.works).toHaveLength(3);
    const copy = ok.museum.works.find((w) => w.id === ok.selection.works[0])!;
    expect(copy.t).toBe(2);
    expect(copy.wallId).toBe(k.wallId);
    const skipped = duplicateSelection(m, { ...EMPTY_SEL, works: [k.id] }, { x: 10, y: 0 });
    expect(skipped.museum.works).toHaveLength(2);
    expect(skipped.selection.works).toEqual([]);
    const noShift = duplicateSelection(m, { ...EMPTY_SEL, works: [k.id] }, { x: 0, y: 1 });
    expect(noShift.selection.works).toEqual([]);
  });
  it('a selected work on a selected wall is not copied twice', () => {
    const { m, wallIds } = scene();
    const r = duplicateSelection(m, { ...EMPTY_SEL, walls: [wallIds[0]], works: m.works.map((w) => w.id) }, { x: 1, y: 1 });
    expect(r.museum.works).toHaveLength(4);
  });
  it('the result passes parseMuseum (ids across a bigger copy)', () => {
    const { m } = scene();
    const r = duplicateSelection(m, allItems(m), duplicateOffset(m.settings.gridSize));
    expect(r.museum.walls).toHaveLength(8);
    valid(r.museum);
  });
  it('duplicateOffset is 1 m snapped to the grid', () => {
    expect(duplicateOffset(0.5)).toEqual({ x: 1, y: 1 });
    expect(duplicateOffset(0.75)).toEqual({ x: 0.75, y: 0.75 });
    expect(duplicateOffset(2)).toEqual({ x: snapValue(1, 2) || 2, y: snapValue(1, 2) || 2 });
  });
});

describe('deleteSelection', () => {
  it('removes everything selected; works on deleted walls go too; spawn stays', () => {
    const { m, wallIds } = scene();
    const r = deleteSelection(m, { ...EMPTY_SEL, walls: [wallIds[0]], zones: [m.zones[0].id], areas: [m.areas[0].id], spawn: true });
    expect(r.walls).toHaveLength(3);
    expect(r.works).toHaveLength(0);
    expect(r.zones).toHaveLength(1);
    expect(r.areas).toHaveLength(0);
    expect(r.settings.spawn).toEqual(m.settings.spawn);
    valid(r);
  });
  it('removes selected works alone', () => {
    const { m } = scene();
    const r = deleteSelection(m, { ...EMPTY_SEL, works: [m.works[0].id] });
    expect(r.works.map((w) => w.id)).toEqual([m.works[1].id]);
    expect(r.walls).toHaveLength(4);
  });
});

describe('setFinishForWalls', () => {
  it('sets and clears the finish on the chosen walls only', () => {
    const { m, wallIds } = scene();
    const f = { color: '#ff0000', tileSize: 2 };
    const a = setFinishForWalls(m, [wallIds[0], wallIds[2]], f);
    expect(a.walls.map((w) => w.finish)).toEqual([f, undefined, f, undefined]);
    expect(a.walls[0].finish).not.toBe(a.walls[2].finish);
    valid(a);
    const b = setFinishForWalls(setWallFinish(a, wallIds[1], f), wallIds, undefined);
    expect(b.walls.every((w) => !('finish' in w))).toBe(true);
    valid(b);
  });
});
