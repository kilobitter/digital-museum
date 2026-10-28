import { describe, expect, it } from 'vitest';
import { defaultMuseum } from '../shared/validate';
import { LAYER_STEP, areaQuads, neededTextureIds, stackLevels, surfaceQuad } from './surfaces';

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
  it('stacks overlapping areas by array order, floors up and ceilings down, per surface', () => {
    const f = areaQuads(m(), 'floor');
    expect(f.map((q) => q.area.id)).toEqual(['a', 'c']);
    expect(f[0].y).toBeCloseTo(LAYER_STEP);
    expect(f[1].y).toBeCloseTo(2 * LAYER_STEP); // b is ceiling-only: does not raise c's floor
    const c = areaQuads(m(), 'ceiling');
    expect(c.map((q) => q.area.id)).toEqual(['b', 'c']);
    expect(c[0].y).toBeCloseTo(3 - LAYER_STEP);
    expect(c[1].y).toBeCloseTo(3 - 2 * LAYER_STEP);
  });
  it('many disjoint areas all stay at 1 mm', () => {
    const x = defaultMuseum();
    x.areas = Array.from({ length: 90 }, (_, i) => ({ id: `r${i}`, name: '', rect: { x: i * 14, y: 0, w: 10, h: 10 }, floor: fin }));
    expect(areaQuads(x, 'floor').every((q) => q.y === LAYER_STEP)).toBe(true);
  });
  it('LAYER_STEP is at most 1 mm', () => expect(LAYER_STEP).toBeLessThanOrEqual(0.001));
  it('ignores ceiling areas when the museum has no ceiling', () => {
    const x = m(); x.settings.ceiling = false;
    expect(areaQuads(x, 'ceiling')).toEqual([]);
  });
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
