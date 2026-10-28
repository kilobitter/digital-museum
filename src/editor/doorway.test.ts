import { describe, expect, it } from 'vitest';
import type { Museum, Work } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import { addMedia, addWall } from './model';
import { cutDoorway, doorwayGap, findDoorTarget, clampDoorWidth } from './doorway';

const valid = (m: Museum) => {
  const r = parseMuseum(m);
  expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
};

/** One 10 m wall from (0,0) to (10,0) with a finish, plus a painting library. */
function base(works: { t: number; width: number; side?: 1 | -1 }[] = []) {
  let m = defaultMuseum();
  const img = addMedia(m, { kind: 'image', file: 'media/a.png', name: 'a', width: 1000, height: 1000 });
  m = img.museum;
  const w = addWall(m, { x: 0, y: 0 }, { x: 10, y: 0 })!;
  m = { ...w.museum, walls: [{ ...w.museum.walls[0], finish: { color: '#112233', tileSize: 2 } }] };
  const list: Work[] = works.map((k, i) => ({ id: `work-${i}`, mediaId: img.id, wallId: w.id, side: k.side ?? 1, t: k.t, centerHeight: 1.5, width: k.width }));
  return { m: { ...m, works: list }, id: w.id };
}

describe('doorwayGap', () => {
  it('centres, clamps and absorbs slivers', () => {
    expect(doorwayGap(10, 5, 2)).toMatchObject({ ok: true, from: 4, to: 6, hasFirst: true, hasSecond: true });
    expect(doorwayGap(10, 0.2, 2)).toMatchObject({ ok: true, from: 0, to: 2, hasFirst: false });
    expect(doorwayGap(10, 9.9, 2)).toMatchObject({ ok: true, from: 8, to: 10, hasSecond: false });
    expect(doorwayGap(10, 1.1, 2)).toMatchObject({ ok: true, from: 0, to: 2.1, hasFirst: false }); // 0.1 m sliver dropped
    expect(doorwayGap(10, 1.2, 2)).toMatchObject({ ok: true, from: 0.2, hasFirst: true }); // 0.2 m kept
    expect(doorwayGap(2, 1, 2).ok).toBe(false);
  });
  it('refuses a door that would eat the whole wall', () => {
    expect(doorwayGap(2.2, 1.1, 2).ok).toBe(false);
  });
  it('clamps the door width setting', () => {
    expect(clampDoorWidth(0.1)).toBe(0.5);
    expect(clampDoorWidth(9)).toBe(4);
    expect(clampDoorWidth(NaN)).toBe(1.2);
  });
});

describe('cutDoorway', () => {
  it('cuts a centred door into two walls and keeps the first id and the finish', () => {
    const { m, id } = base();
    const r = cutDoorway(m, id, 5, 1.2);
    if (!r.ok) throw new Error(r.reason);
    expect(r.museum.walls).toHaveLength(2);
    const [a, b] = r.museum.walls;
    expect(a.id).toBe(id);
    expect(b.id).not.toBe(id);
    expect(a.a).toEqual({ x: 0, y: 0 });
    expect(a.b).toEqual({ x: 4.4, y: 0 });
    expect(b.a).toEqual({ x: 5.6, y: 0 });
    expect(b.b).toEqual({ x: 10, y: 0 });
    expect(a.finish).toEqual(m.walls[0].finish);
    expect(b.finish).toEqual(m.walls[0].finish);
    expect(new Set(r.museum.walls.map((w) => w.id)).size).toBe(2);
    expect(r.removedWorks).toEqual([]);
    expect(r.wallIds).toEqual([a.id, b.id]);
    valid(r.museum);
  });
  it('a door near one end drops the sliver', () => {
    const { m, id } = base();
    const r = cutDoorway(m, id, 0.9, 1.2); // gap 0.3..1.5: 0.3 m piece stays
    if (!r.ok) throw new Error(r.reason);
    expect(r.museum.walls).toHaveLength(2);
    const near = cutDoorway(m, id, 0.7, 1.2); // gap 0.1..1.3: 0.1 m sliver is dropped, gap starts at the end
    if (!near.ok) throw new Error(near.reason);
    expect(near.museum.walls).toHaveLength(1);
    expect(near.museum.walls[0].id).toBe(id); // the surviving piece keeps the id
    expect(near.museum.walls[0].a).toEqual({ x: 1.3, y: 0 });
    expect(near.museum.walls[0].b).toEqual({ x: 10, y: 0 });
    const far = cutDoorway(m, id, 9.5, 1.2);
    if (!far.ok) throw new Error(far.reason);
    expect(far.museum.walls).toHaveLength(1);
    expect(far.museum.walls[0].b).toEqual({ x: 8.8, y: 0 });
    valid(near.museum);
    valid(far.museum);
  });
  it('a centre outside the wall is clamped inside', () => {
    const { m, id } = base();
    const r = cutDoorway(m, id, -3, 1.2);
    if (!r.ok) throw new Error(r.reason);
    expect(r.museum.walls).toHaveLength(1);
    expect(r.museum.walls[0].a).toEqual({ x: 1.2, y: 0 });
  });
  it('a door wider than the wall is an error', () => {
    const { m, id } = base();
    const r = cutDoorway({ ...m, walls: [{ ...m.walls[0], b: { x: 1, y: 0 } }], works: [] }, id, 0.5, 1.2);
    expect(r).toEqual({ ok: false, reason: 'This wall is shorter than the door.' });
  });
  it('works on both sides land on the right piece with the right t', () => {
    const { m, id } = base([{ t: 2, width: 1 }, { t: 8, width: 1.5, side: -1 }, { t: 9.5, width: 0.8 }]);
    const r = cutDoorway(m, id, 5, 2); // gap 4..6
    if (!r.ok) throw new Error(r.reason);
    const second = r.museum.walls[1].id;
    const w0 = r.museum.works.find((k) => k.id === 'work-0')!;
    const w1 = r.museum.works.find((k) => k.id === 'work-1')!;
    const w2 = r.museum.works.find((k) => k.id === 'work-2')!;
    expect(w0).toMatchObject({ wallId: id, t: 2 });
    expect(w1).toMatchObject({ wallId: second, t: 2, side: -1, width: 1.5 });
    expect(w2).toMatchObject({ wallId: second, t: 3.5 });
    expect(r.removedWorks).toEqual([]);
    valid(r.museum);
  });
  it('works overlapping the gap are removed and returned', () => {
    const { m, id } = base([{ t: 3.8, width: 1 }, { t: 6.4, width: 1 }, { t: 5, width: 0.4 }, { t: 2, width: 1 }]);
    const r = cutDoorway(m, id, 5, 1.2); // gap 4.4..5.6: 3.3..4.3 fits left; 5.9..6.9 fits right; 5±0.2 inside; 
    if (!r.ok) throw new Error(r.reason);
    expect(r.removedWorks.map((k) => k.id)).toEqual(['work-2']);
    expect(r.museum.works.map((k) => k.id)).toEqual(['work-0', 'work-1', 'work-3']);
    const partial = cutDoorway(m, id, 4.2, 1.2); // gap 3.6..4.8 clips work-0 (3.3..4.3)
    if (!partial.ok) throw new Error(partial.reason);
    expect(partial.removedWorks.map((k) => k.id)).toContain('work-0');
    valid(r.museum);
    valid(partial.museum);
  });
  it('works only touching the gap edge stay', () => {
    const { m, id } = base([{ t: 3.4, width: 1 }]); // 2.9..3.9 ends exactly at gap start 3.9? gap 3.9..6.1 width 2.2 centre 5
    const r = cutDoorway(m, id, 5, 2.2);
    if (!r.ok) throw new Error(r.reason);
    expect(r.removedWorks).toEqual([]);
  });
  it('leaves other walls, zones and areas untouched; ids stay unique with several walls', () => {
    let { m, id } = base();
    const extra = addWall(m, { x: 0, y: 5 }, { x: 10, y: 5 })!;
    m = extra.museum;
    const r = cutDoorway(m, id, 5, 1);
    if (!r.ok) throw new Error(r.reason);
    expect(r.museum.walls).toHaveLength(3);
    expect(r.museum.walls[2]).toBe(m.walls[1]);
    expect(new Set(r.museum.walls.map((w) => w.id)).size).toBe(3);
    expect(r.museum.zones).toBe(m.zones);
    expect(r.museum.areas).toBe(m.areas);
    valid(r.museum);
  });
  it('works on a diagonal wall keep their world position', () => {
    let m = defaultMuseum();
    const img = addMedia(m, { kind: 'image', file: 'media/a.png', name: 'a', width: 1000, height: 1000 });
    m = addWall(img.museum, { x: 0, y: 0 }, { x: 6, y: 8 })!.museum; // length 10
    const id = m.walls[0].id;
    m = { ...m, works: [{ id: 'work-x', mediaId: img.id, wallId: id, side: 1, t: 8, centerHeight: 1.5, width: 1 }] };
    const r = cutDoorway(m, id, 4, 2);
    if (!r.ok) throw new Error(r.reason);
    expect(r.museum.walls[1].a).toEqual({ x: 3, y: 4 });
    expect(r.museum.works[0]).toMatchObject({ wallId: r.museum.walls[1].id, t: 3 });
    valid(r.museum);
  });
});

describe('findDoorTarget', () => {
  it('finds the wall under the cursor, snaps the centre and previews the gap', () => {
    const { m, id } = base();
    const t = findDoorTarget(m, { x: 5.02, y: 0.2 }, 0.1, 1.2)!;
    expect(t.wallId).toBe(id);
    expect(t.centreT).toBe(5);
    expect(t.gap.ok).toBe(true);
    expect(t.line).toEqual({ a: { x: 4.4, y: 0 }, b: { x: 5.6, y: 0 } });
    expect(findDoorTarget(m, { x: 5, y: 3 }, 0.1, 1.2)).toBeNull();
  });
  it('reports an error for a wall shorter than the door', () => {
    const { m } = base();
    const short = { ...m, walls: [{ ...m.walls[0], b: { x: 1, y: 0 } }] };
    const t = findDoorTarget(short, { x: 0.5, y: 0 }, 0.1, 1.2)!;
    expect(t.gap.ok).toBe(false);
    expect(t.line).toBeNull();
  });
});
