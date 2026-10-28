import { describe, expect, it } from 'vitest';
import type { Area, Museum, Wall } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import { mergeMuseum, usedMediaIds, type MediaMapping } from './importMerge';

const wall = (id: string, ax: number, ay: number, bx: number, by: number, finish?: Wall['finish']): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, ...(finish ? { finish } : {}) });
const room = (p: string, x0: number, y0: number, x1: number, y1: number): Wall[] => [
  wall(`${p}1`, x0, y0, x1, y0), wall(`${p}2`, x1, y0, x1, y1), wall(`${p}3`, x1, y1, x0, y1), wall(`${p}4`, x0, y1, x0, y0),
];

function host(): Museum {
  const m = defaultMuseum();
  return {
    ...m,
    name: 'Host',
    walls: room('h', 0, 0, 6, 4),
    works: [{ id: 'hw', mediaId: 'hm1', wallId: 'h1', side: 1, t: 3, centerHeight: 1.5, width: 1 }],
    areas: [{ id: 'ha', name: 'Host area', rect: { x: 0, y: 0, w: 6, h: 4 }, floor: { color: '#112233', tileSize: 1 } }],
    media: [{ id: 'hm1', kind: 'image', file: 'media/h1.png', name: 'H1.png', width: 100, height: 100 }],
  };
}
function guest(): Museum {
  const m = defaultMuseum();
  return {
    ...m,
    name: 'Guest',
    walls: [...room('g', 10, 5, 14, 9), wall('gx', 14, 7, 16, 7, { color: '#ff0000', tileSize: 1 })],
    works: [
      { id: 'gw1', mediaId: 'gm1', wallId: 'g1', side: 1, t: 2, centerHeight: 1.5, width: 1 },
      { id: 'gw2', mediaId: 'gm2', wallId: 'g2', side: -1, t: 1, centerHeight: 1.5, width: 1 },
    ],
    zones: [
      { id: 'gz', name: 'Hum', mediaId: 'ga', shape: { kind: 'rect', x: 10, y: 5, w: 2, h: 2 }, volume: 1, fade: 0 },
      { id: 'gz2', name: 'Circle', mediaId: 'ga', shape: { kind: 'circle', cx: 12, cy: 7, r: 1 }, volume: 1, fade: 0 },
    ],
    areas: [{ id: 'ga1', name: 'Rug', rect: { x: 11, y: 6, w: 1, h: 1 }, floor: { textureId: 'gt', color: '#ffffff', tileSize: 2 } }],
    media: [
      { id: 'gm1', kind: 'image', file: 'media/g1.png', name: 'G1.png', width: 200, height: 100, title: 'One' },
      { id: 'gm2', kind: 'image', file: 'media/g2.png', name: 'G2.png', width: 100, height: 100 },
      { id: 'gm3', kind: 'image', file: 'media/g3.png', name: 'G3.png', width: 100, height: 100 },
      { id: 'ga', kind: 'audio', file: 'media/ga.wav', name: 'ga.wav' },
      { id: 'gt', kind: 'texture', file: 'media/gt.png', name: 'gt.png', width: 64, height: 64 },
      { id: 'gp', kind: 'panorama', file: 'media/gp.jpg', name: 'gp.jpg', width: 200, height: 100 },
    ],
  };
}
const allFiles = (g: Museum): Map<string, MediaMapping> => new Map(g.media.map((x) => [x.id, { file: `media/new-${x.id}.${x.file.split('.').pop()}` }]));
const run = (h = host(), g = guest(), media = allFiles(g), opts = {}) => mergeMuseum(h, g, media, opts);

describe('mergeMuseum basics', () => {
  it('keeps the host and appends fresh, unique, parseable guest content', () => {
    const h = host();
    const r = run(h);
    expect(parseMuseum(r.museum).ok).toBe(true);
    expect(r.museum.walls.slice(0, 4)).toEqual(h.walls);
    for (const list of [r.museum.walls, r.museum.works, r.museum.zones, r.museum.areas, r.museum.media]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    expect(r.museum.walls).toHaveLength(4 + 5);
    expect(r.museum.walls.slice(4).every((w) => !['g1', 'g2', 'gx'].includes(w.id))).toBe(true);
    expect(r.summary).toMatchObject({ walls: 5, works: 2, zones: 2, areas: 1, media: 6, reused: 0 });
  });

  it('remaps work, zone and texture references', () => {
    const r = run();
    const m = r.museum;
    const wallIds = new Set(m.walls.map((w) => w.id));
    const mediaById = new Map(m.media.map((x) => [x.id, x]));
    const newWorks = m.works.slice(1);
    for (const w of newWorks) {
      expect(wallIds.has(w.wallId)).toBe(true);
      expect(mediaById.get(w.mediaId)?.kind).toBe('image');
    }
    expect(mediaById.get(newWorks[0].mediaId)?.file).toBe('media/new-gm1.png');
    expect(newWorks[1].side).toBe(-1);
    expect(mediaById.get(m.zones[0].mediaId)?.file).toBe('media/new-ga.wav');
    const rug = m.areas.find((a) => a.name === 'Rug')!;
    expect(mediaById.get(rug.floor!.textureId!)?.file).toBe('media/new-gt.png');
    // the original library item data survives
    expect(m.media.find((x) => x.file === 'media/new-gm1.png')).toMatchObject({ title: 'One', width: 200, name: 'G1.png' });
  });

  it('is a one-time copy: importing twice gives independent copies', () => {
    const g = guest();
    const first = mergeMuseum(host(), g, allFiles(g));
    const second = mergeMuseum(first.museum, g, allFiles(g));
    expect(parseMuseum(second.museum).ok).toBe(true);
    expect(second.museum.walls).toHaveLength(4 + 5 + 5);
    const ids = second.museum.walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.selection.walls.every((id) => !first.selection.walls.includes(id))).toBe(true);
    // the second copy lands to the right of the first
    const maxX = (ids: string[]) => Math.max(...second.museum.walls.filter((w) => ids.includes(w.id)).flatMap((w) => [w.a.x, w.b.x]));
    expect(Math.min(...second.museum.walls.filter((w) => second.selection.walls.includes(w.id)).flatMap((w) => [w.a.x, w.b.x]))).toBeGreaterThanOrEqual(maxX(first.selection.walls) + 2 - 1e-9);
  });

  it('leaves host name, settings (sky, spawn, finishes) untouched', () => {
    const h = host();
    h.settings = { ...h.settings, spawn: { x: 1, y: 2, yawDeg: 90 }, sky: { kind: 'gradient', top: '#000000', horizon: '#111111', bottom: '#222222' } };
    const g = guest();
    g.settings = { ...g.settings, spawn: { x: 12, y: 7, yawDeg: 0 }, sky: { kind: 'panorama', textureId: 'gp', rotationDeg: 10 } };
    const r = mergeMuseum(h, g, allFiles(g));
    expect(r.museum.settings).toBe(h.settings);
    expect(r.museum.name).toBe('Host');
    // the panorama is a library item only
    expect(r.museum.media.some((x) => x.kind === 'panorama')).toBe(true);
  });

  it('returns walls, zones and areas as the selection (works ride along)', () => {
    const r = run();
    expect(r.selection.walls).toHaveLength(5);
    expect(r.selection.zones).toHaveLength(2);
    expect(r.selection.areas).toHaveLength(1);
    expect(r.selection.works).toEqual([]);
    expect(r.selection.spawn).toBe(false);
  });
});

describe('media handling', () => {
  it('reuse maps to the host item without adding one', () => {
    const g = guest();
    const media = allFiles(g);
    media.set('gm1', { reuse: 'hm1' });
    const r = mergeMuseum(host(), g, media);
    expect(r.museum.media).toHaveLength(1 + 5);
    expect(r.museum.works[1].mediaId).toBe('hm1');
    expect(r.summary).toMatchObject({ media: 5, reused: 1 });
  });

  it('onlyUsed brings just referenced media (and never the sky panorama)', () => {
    const g = guest();
    g.settings = { ...g.settings, sky: { kind: 'panorama', textureId: 'gp', rotationDeg: 0 } };
    const r = mergeMuseum(host(), g, allFiles(g), { onlyUsed: true });
    const files = r.museum.media.slice(1).map((x) => x.file).sort();
    expect(files).toEqual(['media/new-ga.wav', 'media/new-gm1.png', 'media/new-gm2.png', 'media/new-gt.png']);
    expect(usedMediaIds(g)).toEqual(new Set(['gm1', 'gm2', 'ga', 'gt']));
    expect(parseMuseum(r.museum).ok).toBe(true);
  });

  it('missing files drop their items and warn; textures keep the colour', () => {
    const g = guest();
    const media = allFiles(g);
    media.delete('gm1'); // painting
    media.delete('ga'); // audio
    media.delete('gt'); // texture
    const r = mergeMuseum(host(), g, media);
    expect(parseMuseum(r.museum).ok).toBe(true);
    expect(r.museum.works).toHaveLength(2); // host + gw2
    expect(r.museum.zones).toHaveLength(0);
    const rug = r.museum.areas.find((a) => a.name === 'Rug')!;
    expect(rug.floor).toEqual({ color: '#ffffff', tileSize: 2 });
    expect(r.warnings.some((w) => /3 files were not found/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /painting/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /audio zone/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /textures were missing/.test(w))).toBe(true);
  });

  it('with onlyUsed an unused missing file is not a warning', () => {
    const g = guest();
    const media = allFiles(g);
    media.delete('gm3');
    expect(mergeMuseum(host(), g, media, { onlyUsed: true }).warnings).toEqual([]);
    expect(mergeMuseum(host(), g, media).warnings.length).toBe(1);
  });
});

describe('keeping the guest look', () => {
  it('bakes the guest wall finish onto finish-less walls only when it differs from the host default', () => {
    const g = guest();
    g.settings = { ...g.settings, wallFinish: { color: '#abcdef', tileSize: 1 } };
    const r = mergeMuseum(host(), g, allFiles(g));
    const added = r.museum.walls.slice(4);
    expect(added.slice(0, 4).every((w) => w.finish?.color === '#abcdef')).toBe(true);
    expect(added[4].finish?.color).toBe('#ff0000'); // own finish stays
    const same = mergeMuseum(host(), guest(), allFiles(guest()));
    expect(same.museum.walls.slice(4, 8).every((w) => w.finish === undefined)).toBe(true);
  });

  it('compares the wall finish after texture remap (reuse to the same host texture = no bake)', () => {
    const h = host();
    h.media.push({ id: 'ht', kind: 'texture', file: 'media/shared.png', name: 's', width: 8, height: 8 });
    h.settings = { ...h.settings, wallFinish: { textureId: 'ht', color: '#ffffff', tileSize: 1 } };
    const g = guest();
    g.media.push({ id: 'gs', kind: 'texture', file: 'media/shared.png', name: 's', width: 8, height: 8 });
    g.settings = { ...g.settings, wallFinish: { textureId: 'gs', color: '#ffffff', tileSize: 1 } };
    const media = allFiles(g);
    media.set('gs', { reuse: 'ht' });
    const r = mergeMuseum(h, g, media);
    expect(r.museum.walls.slice(4, 8).every((w) => w.finish === undefined)).toBe(true);
  });

  it('adds a base area when the floor differs', () => {
    const g = guest();
    g.settings = { ...g.settings, floorFinish: { color: '#334455', tileSize: 2 } };
    const r = mergeMuseum(host(), g, allFiles(g));
    const added = r.museum.areas.slice(1);
    expect(added.map((a) => a.name)).toEqual(['Guest (base)', 'Rug']);
    expect(added[0].floor).toEqual({ color: '#334455', tileSize: 2 });
    expect(added[0].ceiling).toBeUndefined();
    expect(added[0].openSky).toBeUndefined();
    // bounding box of guest walls, shifted by the placement offset
    const gw = r.museum.walls.slice(4);
    const xs = gw.flatMap((w) => [w.a.x, w.b.x]), ys = gw.flatMap((w) => [w.a.y, w.b.y]);
    expect(added[0].rect).toEqual({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    expect(r.selection.areas).toHaveLength(2);
    expect(parseMuseum(r.museum).ok).toBe(true);
  });

  it('adds a base area with the guest ceiling when only the ceiling differs', () => {
    const g = guest();
    g.settings = { ...g.settings, ceilingFinish: { color: '#aabbcc', tileSize: 1 } };
    const base = run(host(), g, allFiles(g)).museum.areas[1];
    expect(base.name).toBe('Guest (base)');
    expect(base.ceiling).toEqual({ color: '#aabbcc', tileSize: 1 });
    expect(base.floor).toBeUndefined();
  });

  it('ceilings off: open-sky base area and the guest areas lose their ceilings; empty ones vanish', () => {
    const g = guest();
    g.settings = { ...g.settings, ceiling: false };
    g.areas = [
      ...g.areas,
      { id: 'c1', name: 'Only ceiling', rect: { x: 10, y: 5, w: 1, h: 1 }, ceiling: { color: '#00ff00', tileSize: 1 } },
      { id: 'c2', name: 'Open', rect: { x: 12, y: 5, w: 1, h: 1 }, openSky: true },
    ];
    const r = mergeMuseum(host(), g, allFiles(g));
    const added = r.museum.areas.slice(1);
    expect(added.map((a) => a.name)).toEqual(['Guest (base)', 'Rug', 'Open']);
    expect(added[0].openSky).toBe(true);
    expect(added[0].ceiling).toBeUndefined();
    expect(parseMuseum(r.museum).ok).toBe(true);
    // a guest ceiling area that also had a floor keeps the floor, loses the ceiling
    const g2 = guest();
    g2.settings = { ...g2.settings, ceiling: false };
    g2.areas = [{ id: 'c', name: 'Both', rect: { x: 10, y: 5, w: 1, h: 1 }, floor: { color: '#101010', tileSize: 1 }, ceiling: { color: '#00ff00', tileSize: 1 } }];
    const both = mergeMuseum(host(), g2, allFiles(g2)).museum.areas[2];
    expect(both.floor).toBeDefined();
    expect(both.ceiling).toBeUndefined();
  });

  it('ceilings off while the host has no ceilings: nothing to preserve', () => {
    const h = host();
    h.settings = { ...h.settings, ceiling: false };
    const g = guest();
    g.settings = { ...g.settings, ceiling: false };
    const r = mergeMuseum(h, g, allFiles(g));
    expect(r.museum.areas.map((a) => a.name)).toEqual(['Host area', 'Rug']);
  });

  it('adds no base area when nothing differs, or when the guest has no walls', () => {
    expect(run().museum.areas.map((a) => a.name)).toEqual(['Host area', 'Rug']);
    const g = guest();
    g.walls = [];
    g.works = [];
    g.settings = { ...g.settings, floorFinish: { color: '#334455', tileSize: 2 } };
    expect(mergeMuseum(host(), g, allFiles(g)).museum.areas.map((a) => a.name)).toEqual(['Host area', 'Rug']);
  });

  it('puts the base area before the guest areas, after the host areas', () => {
    const g = guest();
    g.settings = { ...g.settings, floorFinish: { color: '#334455', tileSize: 2 } };
    expect(run(host(), g, allFiles(g)).museum.areas.map((a) => a.name)).toEqual(['Host area', 'Guest (base)', 'Rug']);
  });
});

describe('placement', () => {
  const bboxOf = (m: Museum, ids: string[]) => {
    const w = m.walls.filter((x) => ids.includes(x.id));
    const xs = w.flatMap((x) => [x.a.x, x.b.x]), ys = w.flatMap((x) => [x.a.y, x.b.y]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };

  it('lands 2 m right of the host, tops aligned, on the grid', () => {
    const r = run();
    const b = bboxOf(r.museum, r.selection.walls);
    expect(b.x0).toBeGreaterThanOrEqual(6 + 2);
    expect(b.x0).toBeLessThan(6 + 2 + 0.5);
    expect(b.y0).toBe(0);
    expect(b.x1 - b.x0).toBe(6); // shape unchanged (10..16)
    // zones and areas moved by the same offset
    expect((r.museum.zones[0].shape as { x: number }).x).toBe(b.x0);
    expect(r.museum.areas.find((a) => a.name === 'Rug')!.rect.x).toBe(b.x0 + 1);
  });

  it('snaps the offset to the host grid (and keeps the gap at least 2 m)', () => {
    const h = host();
    h.settings = { ...h.settings, gridSize: 1.5 };
    const r = mergeMuseum(h, guest(), allFiles(guest()));
    const b = bboxOf(r.museum, r.selection.walls);
    const dx = b.x0 - 10;
    expect(dx % 1.5).toBeCloseTo(0, 9);
    expect(b.x0 - 6).toBeGreaterThanOrEqual(2);
  });

  it('empty host: offset 0', () => {
    const h = { ...host(), walls: [], works: [], areas: [] };
    const r = mergeMuseum(h, guest(), allFiles(guest()));
    expect(bboxOf(r.museum, r.selection.walls)).toMatchObject({ x0: 10, y0: 5 });
  });

  it('the host bounding box includes zones and areas', () => {
    const h = { ...host(), areas: [{ id: 'wide', name: 'wide', rect: { x: 0, y: -3, w: 20, h: 2 }, floor: { color: '#000000', tileSize: 1 } } as Area] };
    const r = mergeMuseum(h, guest(), allFiles(guest()));
    const b = bboxOf(r.museum, r.selection.walls);
    expect(b.x0).toBeGreaterThanOrEqual(22);
    expect(b.y0).toBe(-3 + 0); // aligned with the host's top (-3)
  });

  it('empty guest plan: only media are added', () => {
    const g = { ...guest(), walls: [], works: [], zones: [], areas: [] };
    g.settings = { ...g.settings, floorFinish: { color: '#334455', tileSize: 2 } };
    const r = mergeMuseum(host(), g, allFiles(g));
    expect(r.museum.walls).toHaveLength(4);
    expect(r.museum.areas).toHaveLength(1);
    expect(r.museum.media).toHaveLength(1 + 6);
    expect(r.selection).toEqual({ walls: [], works: [], zones: [], areas: [], spawn: false });
  });
});

describe('warnings', () => {
  it('reports differing wall height and thickness, and works that are too tall', () => {
    const g = guest();
    g.settings = { ...g.settings, wallHeight: 4.5, wallThickness: 0.3 };
    g.works[0] = { ...g.works[0], centerHeight: 3, width: 2 }; // gm1 is 2:1 -> 1 m high -> top 3.5 > 3
    const r = mergeMuseum(host(), g, allFiles(g));
    expect(r.warnings.some((w) => w.includes('Their walls were 4.5 m high, yours are 3 m'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('0.3 m thick'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('"One" reaches 3.5 m'))).toBe(true);
    expect(run().warnings).toEqual([]);
  });
});
