import { describe, expect, it } from 'vitest';
import { wallGeometry } from './wallGeometry';

/** Extent of the uv range of all vertices whose normal matches the predicate. */
function extent(geo: ReturnType<typeof wallGeometry>, pick: (nx: number, ny: number, nz: number) => boolean) {
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < nrm.count; i++) {
    if (!pick(nrm.getX(i), nrm.getY(i), nrm.getZ(i))) continue;
    u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i));
    v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i));
  }
  return { du: u1 - u0, dv: v1 - v0 };
}

describe('wallGeometry UVs', () => {
  const L = 5.2, H = 3, T = 0.2, tile = 0.5;
  const geo = wallGeometry(L, H, T, tile);
  it('long faces span length x height in tiles', () => {
    for (const s of [1, -1]) {
      const e = extent(geo, (_x, _y, z) => z * s > 0.5);
      expect(e.du).toBeCloseTo(L / tile);
      expect(e.dv).toBeCloseTo(H / tile);
    }
  });
  it('end faces span thickness x height in tiles', () => {
    for (const s of [1, -1]) {
      const e = extent(geo, (x) => x * s > 0.5);
      expect(e.du).toBeCloseTo(T / tile);
      expect(e.dv).toBeCloseTo(H / tile);
    }
  });
  it('top and bottom span length x thickness in tiles', () => {
    for (const s of [1, -1]) {
      const e = extent(geo, (_x, y) => y * s > 0.5);
      expect(e.du).toBeCloseTo(L / tile);
      expect(e.dv).toBeCloseTo(T / tile);
    }
  });
});
