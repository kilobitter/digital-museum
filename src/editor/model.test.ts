import { describe, expect, it } from 'vitest';
import type { Museum } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import { wallNormal } from '../shared/geometry';
import {
  addMedia, addRoom, addWall, addZone, clampT, coincidentEndpoints, computeWarnings, deleteWall, findHangTarget, flipWork, hangWork,
  mediaUsage, moveEndpoints, removeMedia, resizeRect, setWorkT, updateWork, updateZone, snapValue, moveWall,
  pickRandomPainting, updateMedia, setWallFinish, updateSettings, hungCount,
} from './model';
import { canRedo, canUndo, commitFrom, createHistory, push, redo, replace, undo } from './history';
import { hitTest } from './hit';
import sample from '../../public/museum/museum.json';

function withImage(m: Museum, name = 'sunset.png') {
  return addMedia(m, { kind: 'image', file: 'media/a.png', name, width: 2000, height: 1000 });
}
function room() {
  const m = defaultMuseum();
  return addRoom(m, { x: 0, y: 0 }, { x: 4, y: 3 })!;
}

describe('rooms and walls', () => {
  it('addRoom makes 4 walls sharing corners', () => {
    const { museum, ids } = room();
    expect(ids).toHaveLength(4);
    const ws = museum.walls;
    for (let i = 0; i < 4; i++) expect(ws[i].b).toEqual(ws[(i + 1) % 4].a);
    expect(parseMuseum(museum).ok).toBe(true);
  });
  it('addRoom works for any drag direction and rejects degenerate', () => {
    const r = addRoom(defaultMuseum(), { x: 4, y: 3 }, { x: 0, y: 0 })!;
    expect(r.museum.walls[0].a).toEqual({ x: 0, y: 0 });
    expect(addRoom(defaultMuseum(), { x: 1, y: 1 }, { x: 1, y: 5 })).toBeNull();
  });
  it('addWall rejects zero length', () => {
    expect(addWall(defaultMuseum(), { x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
  it('moving a shared endpoint moves both walls', () => {
    const { museum } = room();
    const w0 = museum.walls[0];
    const refs = coincidentEndpoints(museum, w0.id, 'b');
    expect(refs).toHaveLength(2);
    const moved = moveEndpoints(museum, refs, { x: 5, y: 0 });
    expect(moved.walls[0].b).toEqual({ x: 5, y: 0 });
    expect(moved.walls[1].a).toEqual({ x: 5, y: 0 });
    expect(moved.walls[2]).toBe(museum.walls[2]);
  });
  it('moving an endpoint onto the other end of its wall is refused', () => {
    const m = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 2, y: 0 })!.museum;
    expect(moveEndpoints(m, [{ wallId: m.walls[0].id, end: 'a' }], { x: 2, y: 0 })).toBe(m);
  });
  it('moveWall translates both endpoints', () => {
    const m = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 2, y: 0 })!.museum;
    const r = moveWall(m, m.walls[0].id, { x: 1, y: 2 });
    expect(r.walls[0]).toMatchObject({ a: { x: 1, y: 2 }, b: { x: 3, y: 2 } });
  });
  it('deleting a wall deletes its works only', () => {
    const { museum } = room();
    const img = withImage(museum);
    const h1 = hangWork(img.museum, img.id, { wallId: museum.walls[0].id, side: 1, t: 2, point: { x: 2, y: 0 } })!;
    const h2 = hangWork(h1.museum, img.id, { wallId: museum.walls[1].id, side: 1, t: 1.5, point: { x: 4, y: 1.5 } })!;
    const r = deleteWall(h2.museum, museum.walls[0].id);
    expect(r.walls).toHaveLength(3);
    expect(r.works.map((w) => w.id)).toEqual([h2.id]);
    expect(parseMuseum(r).ok).toBe(true);
  });
});

describe('hanging works', () => {
  const horiz = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 4, y: 0 })!.museum; // dir +x, normal(+1) = (0, 1) i.e. south
  const vert = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 0, y: 4 })!.museum; // dir +y, normal(+1) = (-1, 0) i.e. west
  it('horizontal wall: south click -> side matching +normal', () => {
    const n = wallNormal(horiz.walls[0], 1);
    expect(n).toEqual({ x: 0, y: 1 });
    expect(findHangTarget(horiz, { x: 2, y: 0.2 })).toMatchObject({ side: 1, t: 2 });
    expect(findHangTarget(horiz, { x: 2.5, y: -0.2 })).toMatchObject({ side: -1, t: 2.5 });
  });
  it('vertical wall: west click -> side 1, east -> -1', () => {
    expect(wallNormal(vert.walls[0], 1)).toEqual({ x: -1, y: 0 });
    expect(findHangTarget(vert, { x: -0.2, y: 1 })).toMatchObject({ side: 1, t: 1 });
    expect(findHangTarget(vert, { x: 0.2, y: 3 })).toMatchObject({ side: -1, t: 3 });
  });
  it('misses when too far from every wall', () => {
    expect(findHangTarget(horiz, { x: 2, y: 2 })).toBeNull();
  });
  it('picks the nearest wall', () => {
    const m = addWall(horiz, { x: 0, y: 0.6 }, { x: 4, y: 0.6 })!.museum;
    expect(findHangTarget(m, { x: 1, y: 0.45 })!.wallId).toBe(m.walls[1].id);
  });
  it('defaults: width, centre height, side, t', () => {
    const img = withImage(horiz, 'My Photo.final.PNG');
    const t = findHangTarget(img.museum, { x: 2, y: 0.2 })!;
    const { museum, id } = hangWork(img.museum, img.id, t)!;
    const w = museum.works.find((x) => x.id === id)!;
    expect(w).toMatchObject({ width: 1, centerHeight: 1.5, side: 1, t: 2 });
    expect(w).not.toHaveProperty('title');
  });
  it('short wall: width = length - 0.2, t stays on the wall', () => {
    const m = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 0.8, y: 0 })!.museum;
    const img = withImage(m);
    const { museum } = hangWork(img.museum, img.id, { wallId: m.walls[0].id, side: 1, t: 0.05, point: { x: 0, y: 0 } })!;
    expect(museum.works[0].width).toBeCloseTo(0.6);
    expect(museum.works[0].t).toBeCloseTo(0.3);
  });
  it('refuses non-image media', () => {
    const a = addMedia(horiz, { kind: 'audio', file: 'media/a.mp3', name: 'a.mp3' });
    expect(hangWork(a.museum, a.id, { wallId: horiz.walls[0].id, side: 1, t: 1, point: { x: 1, y: 0 } })).toBeNull();
  });
  it('clampT keeps the whole work on the wall', () => {
    const wall = horiz.walls[0];
    expect(clampT(wall, 1, -3)).toBe(0.5);
    expect(clampT(wall, 1, 99)).toBe(3.5);
    expect(clampT(wall, 1, 2)).toBe(2);
    expect(clampT(wall, 10, 1)).toBe(2);
  });
  it('setWorkT clamps; flipWork toggles', () => {
    const img = withImage(horiz);
    const h = hangWork(img.museum, img.id, findHangTarget(img.museum, { x: 2, y: 0.2 })!)!;
    expect(setWorkT(h.museum, h.id, 100).works[0].t).toBe(3.5);
    expect(flipWork(h.museum, h.id).works[0].side).toBe(-1);
    expect(flipWork(flipWork(h.museum, h.id), h.id).works[0].side).toBe(1);
  });
});

describe('media and zones', () => {
  it('usage count and guarded removal', () => {
    const horiz = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 4, y: 0 })!.museum;
    const img = withImage(horiz);
    expect(mediaUsage(img.museum, img.id)).toBe(0);
    const h = hangWork(img.museum, img.id, findHangTarget(img.museum, { x: 2, y: 0.2 })!)!;
    expect(mediaUsage(h.museum, img.id)).toBe(1);
    expect(removeMedia(h.museum, img.id)).toBeNull();
    expect(removeMedia(img.museum, img.id)!.media).toHaveLength(0);
  });
  it('resizeRect keeps the opposite corner and min size', () => {
    const s = { kind: 'rect' as const, x: 1, y: 1, w: 2, h: 2 };
    expect(resizeRect(s, 'se', { x: 5, y: 4 })).toEqual({ kind: 'rect', x: 1, y: 1, w: 4, h: 3 });
    expect(resizeRect(s, 'nw', { x: 0, y: 0 })).toEqual({ kind: 'rect', x: 0, y: 0, w: 3, h: 3 });
    expect(resizeRect(s, 'nw', { x: 9, y: 9 })).toEqual({ kind: 'rect', x: 2.9, y: 2.9, w: 0.1, h: 0.1 });
  });
  it('snapValue rounds float noise', () => {
    expect(snapValue(0.31, 0.1)).toBe(0.3);
    expect(snapValue(1.26, 0.5)).toBe(1.5);
  });
});

describe('undo/redo', () => {
  it('round-trips through undo and redo', () => {
    const m0 = defaultMuseum();
    let h = createHistory(m0);
    const m1 = addWall(m0, { x: 0, y: 0 }, { x: 1, y: 0 })!.museum;
    const m2 = addRoom(m1, { x: 0, y: 0 }, { x: 2, y: 2 })!.museum;
    h = push(push(h, m1), m2);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(m1);
    h = undo(h);
    expect(h.present).toBe(m0);
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(h.present).toBe(m2);
    expect(canRedo(h)).toBe(false);
  });
  it('a new edit clears redo; same-key edits coalesce', () => {
    const m0 = defaultMuseum();
    let h = createHistory(m0);
    h = push(h, { ...m0, name: 'a' }, 'name');
    h = push(h, { ...m0, name: 'ab' }, 'name');
    h = push(h, { ...m0, name: 'abc' }, 'name');
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present.name).toBe(m0.name);
    expect(canRedo(h)).toBe(true);
    h = push(h, { ...m0, name: 'x' });
    expect(canRedo(h)).toBe(false);
  });
  it('drag: replace previews, commitFrom records one step', () => {
    const m0 = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 1, y: 0 })!.museum;
    let h = createHistory(m0);
    for (let i = 1; i <= 5; i++) h = replace(h, moveWall(m0, m0.walls[0].id, { x: i, y: 0 }));
    expect(h.past).toHaveLength(0);
    h = commitFrom(h, m0);
    expect(h.past).toEqual([m0]);
    expect(undo(h).present).toBe(m0);
    expect(commitFrom(createHistory(m0), m0).past).toHaveLength(0);
  });
});

describe('warnings', () => {
  const base = () => {
    const m = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 4, y: 0 })!.museum;
    const img = withImage(m); // 2:1 image
    const h = hangWork(img.museum, img.id, findHangTarget(img.museum, { x: 2, y: 0.2 })!)!;
    return { m: { ...h.museum, settings: { ...h.museum.settings, spawn: { x: 2, y: 2, yawDeg: 0 } } }, wid: h.id, imgId: img.id };
  };
  const kinds = (m: Museum) => computeWarnings(m).map((w) => w.kind);
  it('none for the sample museum and a fresh work', () => {
    expect(computeWarnings(parseMuseum(sample).ok ? (parseMuseum(sample) as { museum: Museum }).museum : defaultMuseum())).toEqual([]);
    const { m } = base();
    expect(kinds(m)).toEqual([]);
  });
  it('past-wall-end', () => {
    const { m, wid } = base();
    expect(kinds(updateWork(m, wid, { t: 3.9 }))).toEqual(['past-wall-end']);
  });
  it('overlap on the same face, not on the other face', () => {
    const { m, wid, imgId } = base();
    const second = hangWork(m, imgId, { wallId: m.walls[0].id, side: 1, t: 2.3, point: { x: 2.3, y: 0 } })!.museum;
    expect(kinds(second)).toContain('overlap');
    const flipped = flipWork(second, second.works[1].id);
    expect(kinds(flipped)).not.toContain('overlap');
    expect(kinds(updateWork(second, wid, { centerHeight: 2.9 }))).not.toContain('overlap');
  });
  it('above wall / below floor', () => {
    const { m, wid } = base();
    expect(kinds(updateWork(m, wid, { centerHeight: 2.8 }))).toEqual(['above-wall']);
    expect(kinds(updateWork(m, wid, { centerHeight: 0.1 }))).toEqual(['below-floor']);
  });
  it('zone with missing audio', () => {
    const { m, imgId } = base();
    expect(kinds(addZone(m, { kind: 'circle', cx: 5, cy: 5, r: 1 }, '').museum)).toEqual(['zone-no-audio']);
    // pointing at an image is also "no audio"
    expect(kinds(addZone(m, { kind: 'circle', cx: 5, cy: 5, r: 1 }, imgId).museum)).toEqual(['zone-no-audio']);
    const a = addMedia(m, { kind: 'audio', file: 'media/b.mp3', name: 'b.mp3' });
    const z = addZone(a.museum, { kind: 'circle', cx: 5, cy: 5, r: 1 }, a.id).museum;
    expect(kinds(z)).toEqual([]);
    expect(kinds(updateZone(z, z.zones[0].id, { mediaId: 'gone' }))).toEqual(['zone-no-audio']);
  });
  it('spawn inside a wall', () => {
    const { m } = base();
    expect(kinds({ ...m, settings: { ...m.settings, spawn: { x: 1, y: 0.05, yawDeg: 0 } } })).toEqual(['spawn-in-wall']);
  });
});

describe('hit testing', () => {
  it('prefers endpoints over walls, works over walls, zones last', () => {
    const { museum } = room();
    const img = withImage(museum);
    const h = hangWork(img.museum, img.id, findHangTarget(img.museum, { x: 2, y: -0.2 })!)!;
    const z = addZone(h.museum, { kind: 'rect', x: 0.5, y: 0.5, w: 2, h: 2 }, 'x');
    const m = { ...z.museum, settings: { ...z.museum.settings, spawn: { x: 3, y: 2, yawDeg: 0 } } };
    expect(hitTest(m, { x: 0.05, y: 0.02 }, 0.15, null)).toMatchObject({ type: 'wallEnd' });
    expect(hitTest(m, { x: 2, y: -0.1 }, 0.1, null)).toMatchObject({ type: 'work', id: h.id });
    expect(hitTest(m, { x: 1, y: 0.02 }, 0.1, null)).toMatchObject({ type: 'wall' });
    expect(hitTest(m, { x: 1.5, y: 1.5 }, 0.1, null)).toMatchObject({ type: 'zone' });
    expect(hitTest(m, { x: 3, y: 2 }, 0.1, null)).toMatchObject({ type: 'spawn' });
    expect(hitTest(m, { x: 0.5, y: 0.5 }, 0.1, z.id)).toMatchObject({ type: 'zoneHandle', handle: 'nw' });
    expect(hitTest(m, { x: 3.5, y: 2.5 }, 0.1, null)).toBeNull();
  });
});


describe('pickRandomPainting', () => {
  const add = (m: Museum, kind: 'image' | 'texture' | 'audio', name: string) =>
    addMedia(m, kind === 'audio' ? { kind, file: 'media/x.mp3', name } : { kind, file: 'media/x.png', name, width: 10, height: 10 });
  const setup = () => {
    let m = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 4, y: 0 })!.museum;
    const a = add(m, 'image', 'a'); m = a.museum;
    const b = add(m, 'image', 'b'); m = b.museum;
    const c = add(m, 'image', 'c'); m = c.museum;
    m = add(m, 'texture', 'tex').museum;
    m = add(m, 'audio', 'aud').museum;
    return { m, a: a.id, b: b.id, c: c.id };
  };
  const hang = (m: Museum, mediaId: string) =>
    hangWork(m, mediaId, { wallId: m.walls[0].id, side: 1, t: 2, point: { x: 2, y: 0 } })!.museum;
  const sweep = (m: Museum, exclude?: string) => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(pickRandomPainting(m, () => i / 20, exclude)!.id);
    return seen;
  };
  it('empty library (or only textures/audio) -> null', () => {
    expect(pickRandomPainting(defaultMuseum(), Math.random)).toBeNull();
    let m = add(defaultMuseum(), 'texture', 't').museum;
    m = add(m, 'audio', 'a').museum;
    expect(pickRandomPainting(m, Math.random)).toBeNull();
  });
  it('prefers paintings that are not hung, never textures or audio', () => {
    const { m, a, b, c } = setup();
    const h = hang(m, a);
    expect(sweep(h)).toEqual(new Set([b, c]));
    expect(sweep(m)).toEqual(new Set([a, b, c]));
  });
  it('falls back to all paintings when all are hung', () => {
    const { m, a, b, c } = setup();
    const h = hang(hang(hang(m, a), b), c);
    expect(sweep(h)).toEqual(new Set([a, b, c]));
  });
  it('excludes the given painting when another choice exists', () => {
    const { m, a, b, c } = setup();
    const h = hang(hang(hang(m, a), b), c);
    expect(sweep(h, a)).toEqual(new Set([b, c]));
    // unhung pool is just the excluded one: fall back to the others
    expect(sweep(m, a)).toEqual(new Set([b, c]));
  });
  it('returns the only painting even when it is excluded', () => {
    let m = defaultMuseum();
    const a = add(m, 'image', 'a'); m = a.museum;
    expect(pickRandomPainting(m, () => 0.5, a.id)!.id).toBe(a.id);
  });
  it('rng near 1 stays in range', () => {
    const { m } = setup();
    expect(pickRandomPainting(m, () => 0.999999)).not.toBeNull();
  });
});

describe('media labels and wall finishes', () => {
  it('updateMedia edits fields and removes empty ones', () => {
    const img = withImage(defaultMuseum());
    let m = updateMedia(img.museum, img.id, { title: 'T', artist: 'A' });
    expect(m.media[0]).toMatchObject({ title: 'T', artist: 'A' });
    m = updateMedia(m, img.id, { title: '' });
    expect(m.media[0]).not.toHaveProperty('title');
    expect(m.media[0].artist).toBe('A');
  });
  it('setWallFinish sets and clears a wall override', () => {
    const w = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 4, y: 0 })!;
    const f = { color: '#112233', tileSize: 2 };
    const m = setWallFinish(w.museum, w.id, f);
    expect(m.walls[0].finish).toEqual(f);
    expect(setWallFinish(m, w.id, undefined).walls[0]).not.toHaveProperty('finish');
  });
  it('texture references count as usage and block deletion', () => {
    const w = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 4, y: 0 })!;
    const t = addMedia(w.museum, { kind: 'texture', file: 'media/t.png', name: 't', width: 8, height: 8 });
    expect(mediaUsage(t.museum, t.id)).toBe(0);
    const viaWall = setWallFinish(t.museum, w.id, { textureId: t.id, color: '#ffffff', tileSize: 1 });
    expect(mediaUsage(viaWall, t.id)).toBe(1);
    expect(removeMedia(viaWall, t.id)).toBeNull();
    const viaSettings = updateSettings(t.museum, { wallFinish: { textureId: t.id, color: '#ffffff', tileSize: 1 } });
    expect(mediaUsage(viaSettings, t.id)).toBe(1);
    expect(removeMedia(viaSettings, t.id)).toBeNull();
    expect(hungCount(viaSettings, t.id)).toBe(0);
  });
  it('warns about a missing texture', () => {
    const w = addWall(defaultMuseum(), { x: 0, y: 0 }, { x: 4, y: 0 })!;
    const m = setWallFinish(w.museum, w.id, { textureId: 'gone', color: '#ffffff', tileSize: 1 });
    expect(computeWarnings(m).map((x) => x.kind)).toContain('texture-missing');
  });
});
