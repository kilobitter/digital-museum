import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyWallGradient, wallGeometry } from './wallGeometry';

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

describe('applyWallGradient', () => {
  const H = 3;
  const colourAt = (geo: THREE.BufferGeometry, i: number) => {
    const c = geo.getAttribute('color');
    return new THREE.Color(c.getX(i), c.getY(i), c.getZ(i));
  };
  it('runs bottom colour at the floor to top colour at the top, top cap = top colour', () => {
    const geo = wallGeometry(4, H, 0.2, 1);
    applyWallGradient(geo, H, '#ff0000', '#0000ff');
    const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
    const bottom = new THREE.Color('#ff0000'), top = new THREE.Color('#0000ff');
    for (let i = 0; i < pos.count; i++) {
      const c = colourAt(geo, i);
      const y = pos.getY(i);
      if (Math.abs(y - H / 2) < 1e-6) expect(c.equals(top)).toBe(true);
      if (Math.abs(y + H / 2) < 1e-6) expect(c.equals(bottom)).toBe(true);
      if (nrm.getY(i) > 0.5) expect(c.equals(top)).toBe(true);
    }
  });
  it('interpolates linearly in height', () => {
    const geo = wallGeometry(4, H, 0.2, 1);
    geo.translate(0, 0, 0);
    // a mid-height probe: add a point set via a plain geometry
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    applyWallGradient(g, H, '#000000', '#ffffff');
    const c = colourAt(g, 0);
    const mid = new THREE.Color('#000000').lerp(new THREE.Color('#ffffff'), 0.5);
    expect(c.r).toBeCloseTo(mid.r, 5);
  });
  it('uses three.js sRGB -> linear conversion, so equal ends match the plain material colour', () => {
    const geo = wallGeometry(4, H, 0.2, 1);
    applyWallGradient(geo, H, '#8fb8de', '#8fb8de');
    const plain = new THREE.Color('#8fb8de');
    for (let i = 0; i < geo.getAttribute('position').count; i++) {
      const c = colourAt(geo, i);
      expect(c.r).toBeCloseTo(plain.r, 5);
      expect(c.g).toBeCloseTo(plain.g, 5);
      expect(c.b).toBeCloseTo(plain.b, 5);
    }
    expect(plain.r).not.toBeCloseTo(0x8f / 255, 2); // really linear, not raw sRGB
  });
});
