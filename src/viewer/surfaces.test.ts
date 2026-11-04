import { describe, expect, it } from 'vitest';
import { defaultMuseum } from '../shared/validate';
import { LAYER_STEP, areaQuads, decomposeCeiling, neededTextureIds, stackLevels, stepQuad, surfaceQuad, uncoveredSteps, wallFinishKey } from './surfaces';
import type { Wall } from '../shared/museum';
import { wallEnds, wallSpans } from './wallJoints';

const attr = (g: ReturnType<typeof surfaceQuad>, name: string) => g.getAttribute(name);

describe('surfaceQuad', () => {
  const rect = { x: 1, y: 2, w: 4, h: 3 };
  it('floor faces up with world-aligned UVs (u = x / tile, v = -z / tile)', () => {
    const g = surfaceQuad(rect, 0.002, 0.5, 'up');
    const pos = attr(g, 'position'), uv = attr(g, 'uv'), n = attr(g, 'normal');
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(0.002);
      expect(n.getY(i)).toBe(1);
      expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / 0.5);
      expect(uv.getY(i)).toBeCloseTo(-pos.getZ(i) / 0.5);
    }
  });
  it('ceiling faces down with v = +z / tile', () => {
    const g = surfaceQuad(rect, 3, 2, 'down');
    const pos = attr(g, 'position'), uv = attr(g, 'uv'), n = attr(g, 'normal');
    for (let i = 0; i < pos.count; i++) {
      expect(n.getY(i)).toBe(-1);
      expect(uv.getY(i)).toBeCloseTo(pos.getZ(i) / 2);
    }
  });
  it('triangle winding matches the normal (front face points the stated way)', () => {
    for (const facing of ['up', 'down'] as const) {
      const g = surfaceQuad(rect, 0, 1, facing);
      const p = attr(g, 'position'), idx = g.getIndex()!;
      const v = (k: number) => [p.getX(idx.getX(k)), p.getY(idx.getX(k)), p.getZ(idx.getX(k))];
      for (let t = 0; t < 6; t += 3) {
        const a = v(t), b = v(t + 1), c = v(t + 2);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const ny = e1[2] * e2[0] - e1[0] * e2[2];
        expect(Math.sign(ny)).toBe(facing === 'up' ? 1 : -1);
      }
    }
  });
  it('adjacent rects with the same tile size share UVs along the joint', () => {
    const a = surfaceQuad({ x: 0, y: 0, w: 2, h: 2 }, 0, 1, 'up');
    const b = surfaceQuad({ x: 2, y: 0, w: 2, h: 2 }, 0, 1, 'up');
    const uOf = (g: typeof a, x: number, z: number) => {
      const p = attr(g, 'position'), uv = attr(g, 'uv');
      for (let i = 0; i < p.count; i++) if (p.getX(i) === x && p.getZ(i) === z) return [uv.getX(i), uv.getY(i)];
      return null;
    };
    expect(uOf(a, 2, 0)).toEqual(uOf(b, 2, 0));
    expect(uOf(a, 2, 2)).toEqual(uOf(b, 2, 2));
  });
});

describe('areaQuads', () => {
  const fin = { color: '#ff0000', tileSize: 1 };
  const m = () => {
    const x = defaultMuseum();
    x.areas = [
      { id: 'a', name: '', rect: { x: 0, y: 0, w: 1, h: 1 }, floor: fin },
      { id: 'b', name: '', rect: { x: 0, y: 0, w: 1, h: 1 }, ceiling: fin },
      { id: 'c', name: '', rect: { x: 0, y: 0, w: 1, h: 1 }, floor: fin, ceiling: fin },
    ];
    return x;
  };
  it('stacks overlapping floor areas by array order; ceiling-only areas are not floor quads', () => {
    const f = areaQuads(m());
    expect(f.map((q) => q.area.id)).toEqual(['a', 'c']);
    expect(f[0].y).toBeCloseTo(LAYER_STEP);
    expect(f[1].y).toBeCloseTo(2 * LAYER_STEP); // b is ceiling-only: does not raise c's floor
  });
  it('many disjoint areas all stay at 1 mm', () => {
    const x = defaultMuseum();
    x.areas = Array.from({ length: 90 }, (_, i) => ({ id: `r${i}`, name: '', rect: { x: i * 14, y: 0, w: 10, h: 10 }, floor: fin }));
    expect(areaQuads(x).every((q) => q.y === LAYER_STEP)).toBe(true);
  });
  it('LAYER_STEP is at most 1 mm', () => expect(LAYER_STEP).toBeLessThanOrEqual(0.001));
});

describe('neededTextureIds', () => {
  it('collects wall, floor, ceiling and area textures once; ceiling ones only with a ceiling', () => {
    const x = defaultMuseum();
    x.walls = [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }];
    x.settings.wallFinish = { textureId: 't1', color: '#ffffff', tileSize: 1 };
    x.settings.floorFinish = { textureId: 't1', color: '#ffffff', tileSize: 1 };
    x.settings.ceilingFinish = { textureId: 't2', color: '#ffffff', tileSize: 1 };
    x.areas = [{ id: 'a', name: '', rect: { x: 0, y: 0, w: 1, h: 1 }, floor: { textureId: 't3', color: '#ffffff', tileSize: 1 }, ceiling: { textureId: 't4', color: '#ffffff', tileSize: 1 } }];
    expect(neededTextureIds(x).sort()).toEqual(['t1', 't2', 't3', 't4']);
    x.settings.ceiling = false;
    expect(neededTextureIds(x).sort()).toEqual(['t1', 't3']);
  });
});

describe('stackLevels', () => {
  const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  it('no overlaps -> all 1', () => expect(stackLevels([R(0, 0, 1, 1), R(2, 0, 1, 1), R(4, 0, 1, 1)])).toEqual([1, 1, 1]));
  it('B over A -> 1, 2', () => expect(stackLevels([R(0, 0, 4, 4), R(1, 1, 1, 1)])).toEqual([1, 2]));
  it('A, B disjoint, C over both -> 1, 1, 2', () => expect(stackLevels([R(0, 0, 2, 2), R(3, 0, 2, 2), R(1, 0, 3, 2)])).toEqual([1, 1, 2]));
  it('chains increase', () => expect(stackLevels([R(0, 0, 4, 4), R(1, 1, 2, 2), R(1.5, 1.5, 1, 1)])).toEqual([1, 2, 3]));
  it('touching edges do not overlap', () => expect(stackLevels([R(0, 0, 2, 2), R(2, 0, 2, 2), R(0, 2, 2, 2)])).toEqual([1, 1, 1]));
  it('empty', () => expect(stackLevels([])).toEqual([]));
});

describe('decomposeCeiling', () => {
  const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const base = { color: '#ffffff', tileSize: 1 };
  const red = { color: '#ff0000', tileSize: 1 };
  const blue = { color: '#0000ff', tileSize: 2 };
  const B = R(0, 0, 10, 10);
  const area = (id: string, rect: ReturnType<typeof R>, extra: object) => ({ id, name: id, rect, ...extra }) as import('../shared/museum').Area;
  const total = (rs: ReturnType<typeof R>[]) => rs.reduce((s, r) => s + r.w * r.h, 0);
  const groupOf = (p: ReturnType<typeof decomposeCeiling>, f: typeof base) => p.groups.find((g) => g.finish.color === f.color)?.rects ?? [];

  it('no areas -> one base rect', () => {
    const p = decomposeCeiling(B, base, [], 3);
    expect(p.open).toEqual([]);
    expect(p.groups).toEqual([{ finish: base, height: 3, rects: [B] }]);
    expect(p.steps).toEqual([]);
  });
  it('open area in the middle -> base covers bounds minus the hole', () => {
    const p = decomposeCeiling(B, base, [area('o', R(3, 3, 4, 2), { openSky: true })], 3);
    expect(p.open).toEqual([R(3, 3, 4, 2)]);
    expect(total(groupOf(p, base))).toBeCloseTo(100 - 8);
    expect(p.groups).toHaveLength(1);
  });
  it('a later ceiling area over an open area re-covers it', () => {
    const p = decomposeCeiling(B, base, [area('o', R(2, 2, 6, 6), { openSky: true }), area('c', R(4, 4, 2, 2), { ceiling: red })], 3);
    expect(total(p.open)).toBeCloseTo(36 - 4);
    expect(total(groupOf(p, red))).toBeCloseTo(4);
    expect(total(groupOf(p, base))).toBeCloseTo(64);
  });
  it('a later open area over a ceiling area makes a hole', () => {
    const p = decomposeCeiling(B, base, [area('c', R(2, 2, 6, 6), { ceiling: red }), area('o', R(4, 4, 2, 2), { openSky: true })], 3);
    expect(total(p.open)).toBeCloseTo(4);
    expect(total(groupOf(p, red))).toBeCloseTo(32);
  });
  it('floor-only areas are ignored', () => {
    const p = decomposeCeiling(B, base, [area('f', R(2, 2, 3, 3), { floor: red })], 3);
    expect(p.groups).toEqual([{ finish: base, height: 3, rects: [B] }]);
    expect(p.steps).toEqual([]);
  });
  it('touching and overlapping edges leave no gaps or double cover', () => {
    const areas = [area('a', R(0, 0, 5, 10), { ceiling: red }), area('b', R(5, 0, 5, 5), { ceiling: blue }), area('c', R(4, 3, 3, 4), { openSky: true })];
    const p = decomposeCeiling(B, base, areas, 3);
    const all = [...p.groups.flatMap((g) => g.rects), ...p.open];
    expect(total(all)).toBeCloseTo(100);
    // pairwise disjoint
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 1e-9 && oy > 1e-9).toBe(false);
      }
    expect(total(p.open)).toBeCloseTo(12);
  });
  it('areas partly outside the bounds are clipped', () => {
    const p = decomposeCeiling(B, base, [area('o', R(8, 8, 10, 10), { openSky: true })], 3);
    expect(total(p.open)).toBeCloseTo(4);
    expect(total(groupOf(p, base))).toBeCloseTo(96);
  });
  it('merges equal neighbours into few rects', () => {
    const p = decomposeCeiling(B, base, [area('o', R(3, 3, 4, 4), { openSky: true })], 3);
    expect(groupOf(p, base)).toHaveLength(4); // top band, left, right, bottom band
  });
  it('30 areas stay bounded', () => {
    const areas = Array.from({ length: 30 }, (_, i) => area(`a${i}`, R((i % 6) * 1.5 + 0.3, Math.floor(i / 6) * 1.7 + 0.2, 2, 2), i % 3 === 0 ? { openSky: true } : { ceiling: i % 2 ? red : blue }));
    const p = decomposeCeiling(R(0, 0, 12, 12), base, areas, 3);
    const all = [...p.groups.flatMap((g) => g.rects), ...p.open];
    expect(total(all)).toBeCloseTo(144);
    expect(all.length).toBeLessThan(61 * 61 / 3);
    expect(p.groups.length).toBeLessThanOrEqual(3);
  });
});

describe('decomposeCeiling with room heights', () => {
  const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const base = { color: '#ffffff', tileSize: 1 };
  const red = { color: '#ff0000', tileSize: 1 };
  const B = R(0, 0, 10, 10);
  const area = (id: string, rect: ReturnType<typeof R>, extra: object) => ({ id, name: id, rect, ...extra }) as import('../shared/museum').Area;
  const total = (rs: ReturnType<typeof R>[]) => rs.reduce((s, r) => s + r.w * r.h, 0);
  const at = (p: ReturnType<typeof decomposeCeiling>, h: number, f = base) => p.groups.filter((g) => g.height === h && g.finish.color === f.color).flatMap((g) => g.rects);

  it('same finish with different heights stays separate; base finish first', () => {
    const p = decomposeCeiling(B, base, [area('t', R(0, 0, 5, 10), { roomHeight: 5 })], 3);
    expect(p.groups.map((g) => g.height)).toEqual([5, 3]);
    expect(total(at(p, 5))).toBeCloseTo(50);
    expect(total(at(p, 3))).toBeCloseTo(50);
  });
  it('height-only areas get a step with the lower finish and a normal towards the taller side', () => {
    const p = decomposeCeiling(B, base, [area('t', R(5, 0, 5, 10), { roomHeight: 5 })], 3);
    expect(p.steps).toEqual([{ a: { x: 5, y: 0 }, b: { x: 5, y: 10 }, bottom: 3, top: 5, finish: base, normal: { x: 1, y: 0 } }]);
    const q = decomposeCeiling(B, base, [area('t', R(0, 0, 5, 10), { roomHeight: 5 })], 3);
    expect(q.steps[0].normal).toEqual({ x: -1, y: 0 }); // the tall room is on the left
    const r = decomposeCeiling(B, base, [area('t', R(0, 5, 10, 5), { roomHeight: 1 })], 3);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, bottom: 1, top: 3, normal: { x: 0, y: -1 } });
  });
  it('finish and height stack independently', () => {
    const areas = [area('h', R(0, 0, 10, 10), { roomHeight: 4 }), area('c', R(0, 0, 5, 10), { ceiling: red }), area('h2', R(0, 0, 5, 5), { roomHeight: 6 })];
    const p = decomposeCeiling(B, base, areas, 3);
    expect(total(at(p, 4, base))).toBeCloseTo(50);
    expect(total(at(p, 4, red))).toBeCloseTo(25);
    expect(total(at(p, 6, red))).toBeCloseTo(25);
    expect(p.steps.length).toBeGreaterThan(0);
    for (const s of p.steps) expect(s.top).toBeGreaterThan(s.bottom);
  });
  it('a ceiling finish area on top of a height area keeps the height', () => {
    const p = decomposeCeiling(B, base, [area('h', R(0, 0, 10, 10), { roomHeight: 5 }), area('c', R(2, 2, 3, 3), { ceiling: red })], 3);
    expect(total(at(p, 5, red))).toBeCloseTo(9);
    expect(p.steps).toEqual([]);
  });
  it('no step beside open sky or on the outer edge', () => {
    const p = decomposeCeiling(B, base, [area('t', R(0, 0, 5, 10), { roomHeight: 5 }), area('o', R(5, 0, 5, 10), { openSky: true })], 3);
    expect(p.steps).toEqual([]);
    const q = decomposeCeiling(B, base, [area('t', R(0, 0, 10, 10), { roomHeight: 5 })], 3);
    expect(q.steps).toEqual([]);
  });
  it('an L-shaped boundary from overlapping areas gives steps along both legs', () => {
    const p = decomposeCeiling(B, base, [area('a', R(0, 0, 6, 4), { roomHeight: 5 }), area('b', R(0, 0, 3, 8), { roomHeight: 5 })], 3);
    const len = p.steps.reduce((s, st) => s + Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y), 0);
    expect(len).toBeCloseTo(14); // 4 + 3 + 4 + 3 around the L
    expect(p.steps.every((st) => st.bottom === 3 && st.top === 5)).toBe(true);
  });
  it('collinear touching runs merge into one step', () => {
    const p = decomposeCeiling(B, base, [area('a', R(0, 0, 5, 3), { roomHeight: 5 }), area('b', R(0, 3, 5, 3), { roomHeight: 5 }), area('c', R(0, 6, 5, 4), { roomHeight: 5 })], 3);
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ a: { x: 5, y: 0 }, b: { x: 5, y: 10 } });
  });
});

describe('stepQuad', () => {
  it('faces the normal with world-scale UVs and the surfaceQuad attributes', () => {
    for (const normal of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const vertical = normal.x !== 0;
      const g = stepQuad({ a: vertical ? { x: 2, y: 1 } : { x: 1, y: 2 }, b: vertical ? { x: 2, y: 4 } : { x: 4, y: 2 }, bottom: 3, top: 5, finish: { color: '#fff', tileSize: 2 }, normal });
      const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv'), idx = g.getIndex()!;
      expect(g.getAttribute('position').count).toBe(4);
      expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      for (let i = 0; i < 4; i++) {
        expect(n.getX(i)).toBe(normal.x); expect(n.getZ(i)).toBe(normal.y);
        expect(uv.getY(i)).toBeCloseTo(p.getY(i) / 2);
        expect(uv.getX(i)).toBeCloseTo((vertical ? p.getZ(i) : p.getX(i)) / 2);
      }
      const v = (k: number) => [p.getX(idx.getX(k)), p.getY(idx.getX(k)), p.getZ(idx.getX(k))];
      const a = v(0), b = v(1), c = v(2);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[0] * e2[1] - e1[1] * e2[0]];
      expect(Math.sign(cross[0]) || 0).toBe(normal.x || 0);
      expect(Math.sign(cross[1]) || 0).toBe(normal.y || 0);
      const ys = [0, 1, 2, 3].map((i) => p.getY(i));
      expect(Math.min(...ys)).toBe(3); expect(Math.max(...ys)).toBe(5);
    }
  });
});

describe('uncoveredSteps', () => {
  const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
  const fin = { color: '#fff', tileSize: 1 };
  const step = { a: { x: 5, y: 0 }, b: { x: 5, y: 10 }, bottom: 3, top: 5, finish: fin, normal: { x: 1, y: 0 } };
  const run = (walls: Wall[]) => uncoveredSteps([step], walls, wallSpans(walls, wallEnds(walls), 0.2), 0.2);
  it('a wall on the line hides the step', () => {
    expect(run([wall('w', 5, 0, 5, 10)])).toEqual([]);
  });
  it('a wall on the step line\'s face (within thickness/2) hides it too', () => {
    expect(run([wall('w', 5.09, 0, 5.09, 10)])).toEqual([]);
  });
  it('a wall too far away leaves it', () => {
    expect(run([wall('w', 5.2, 0, 5.2, 10)])).toEqual([step]);
  });
  it('a doorway gap leaves only the gap', () => {
    const r = run([wall('w1', 5, 0, 5, 4), wall('w2', 5, 6, 5, 10)]);
    // free ends extend by half a thickness (0.1) into the gap
    expect(r).toHaveLength(1);
    expect(r[0].a.y).toBeCloseTo(4.1);
    expect(r[0].b.y).toBeCloseTo(5.9);
    expect(r[0]).toMatchObject({ bottom: 3, top: 5, normal: { x: 1, y: 0 } });
  });
  it('a diagonal wall leaves it alone', () => {
    expect(run([wall('w', 4, 0, 6, 10)])).toEqual([step]);
  });
});

describe('wallFinishKey', () => {
  const a = { color: '#aabbcc', tileSize: 1 };
  it('equal for uniform walls, differs by colorTop (case-insensitive)', () => {
    expect(wallFinishKey(a, false)).toBe(wallFinishKey({ ...a }, false));
    expect(wallFinishKey({ ...a, colorTop: '#FFFFFF' }, false)).toBe(wallFinishKey({ ...a, colorTop: '#ffffff' }, false));
    expect(wallFinishKey({ ...a, colorTop: '#ffffff' }, false)).not.toBe(wallFinishKey(a, false));
    expect(wallFinishKey({ ...a, colorTop: '#ffffff' }, false)).not.toBe(wallFinishKey({ ...a, colorTop: '#000000' }, false));
  });
});
