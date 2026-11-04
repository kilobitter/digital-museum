import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Wall } from '../shared/museum';
import { wallDirection } from '../shared/geometry';
import type { CeilingStep } from './surfaces';
import { applyWallGradient, doorHeaderGeometry, wallGeometry } from './wallGeometry';

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

describe('wallGeometry end caps', () => {
  const count = (geo: ReturnType<typeof wallGeometry>, pick: (nx: number) => boolean) => {
    const nrm = geo.getAttribute('normal');
    const idx = geo.getIndex()!;
    let n = 0;
    for (let k = 0; k < idx.count; k++) if (pick(nrm.getX(idx.getX(k)))) n++;
    return n;
  };
  it('keeps all 12 triangles by default', () => {
    expect(wallGeometry(4, 3, 0.2, 1).getIndex()!.count).toBe(36);
  });
  it('drops only the requested end faces (+x = end, -x = start)', () => {
    const noEnd = wallGeometry(4, 3, 0.2, 1, { start: true, end: false });
    expect(noEnd.getIndex()!.count).toBe(30);
    expect(count(noEnd, (nx) => nx > 0.5)).toBe(0);
    expect(count(noEnd, (nx) => nx < -0.5)).toBe(6);
    const none = wallGeometry(4, 3, 0.2, 1, { start: false, end: false });
    expect(none.getIndex()!.count).toBe(24);
    expect(count(none, (nx) => Math.abs(nx) > 0.5)).toBe(0);
  });
});

describe('wallGeometry partial end faces', () => {
  const L = 4, H = 5, T = 0.2, tile = 0.5;
  const trianglesFacing = (geo: THREE.BufferGeometry, nx: number) => {
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), idx = geo.getIndex()!;
    const out: number[][] = [];
    for (let k = 0; k < idx.count; k += 3) {
      const ids = [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)];
      if (ids.every((i) => Math.abs(n.getX(i) - nx) < 1e-6)) out.push(ids);
    }
    return { p, n, uvs: geo.getAttribute('uv'), tris: out };
  };

  it('without steps the output is identical to before', () => {
    const a = wallGeometry(L, H, T, tile, { start: false, end: true }, { front: 1, back: 2 });
    const b = wallGeometry(L, H, T, tile, { start: false, end: true }, { front: 1, back: 2 }, {});
    const c = wallGeometry(L, H, T, tile, { start: false, end: true }, { front: 1, back: 2 }, { start: null, end: null });
    for (const g of [b, c]) {
      expect(Array.from(g.getAttribute('position').array)).toEqual(Array.from(a.getAttribute('position').array));
      expect(Array.from(g.getIndex()!.array)).toEqual(Array.from(a.getIndex()!.array));
    }
  });

  it('end step: a face at +x from the step height up to the top, facing outward, with world UVs', () => {
    const g = wallGeometry(L, H, T, tile, { start: false, end: false }, undefined, { end: 3 });
    const { p, uvs, tris } = trianglesFacing(g, 1);
    expect(tris).toHaveLength(2);
    const ids = new Set(tris.flat());
    for (const i of ids) {
      expect(p.getX(i)).toBeCloseTo(L / 2);
      expect(p.getY(i) + H / 2).toBeGreaterThanOrEqual(3 - 1e-6);
      expect(uvs.getY(i)).toBeCloseTo((p.getY(i) + H / 2) / tile);
    }
    const ys = [...ids].map((i) => p.getY(i) + H / 2);
    expect(Math.min(...ys)).toBeCloseTo(3);
    expect(Math.max(...ys)).toBeCloseTo(H);
    // winding: geometric normal points +x
    for (const t of tris) {
      const [a, b, c] = t.map((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      expect(e1[1] * e2[2] - e1[2] * e2[1]).toBeGreaterThan(0);
    }
  });

  it('start step faces -x with winding to match', () => {
    const g = wallGeometry(L, H, T, tile, { start: false, end: false }, undefined, { start: 2 });
    const { p, tris } = trianglesFacing(g, -1);
    expect(tris).toHaveLength(2);
    for (const t of tris) {
      const [a, b, c] = t.map((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      expect(e1[1] * e2[2] - e1[2] * e2[1]).toBeLessThan(0);
      expect(a[0]).toBeCloseTo(-L / 2);
    }
  });

  it('merges with plain wall boxes with and without steps', () => {
    const plain = wallGeometry(L, 3, T, tile);
    const stepped = wallGeometry(L, H, T, tile, { start: true, end: false }, undefined, { end: 3 });
    const m = mergeGeometries([plain, stepped], false);
    expect(m).not.toBeNull();
    expect(m.getAttribute('position').count).toBe(plain.getAttribute('position').count + stepped.getAttribute('position').count);
    expect(m.getAttribute('color')).toBeUndefined();
    expect(mergeGeometries([wallGeometry(L, 3, T, tile), wallGeometry(L, H, T, tile)], false)).not.toBeNull();
  });

  it('gradient: gradientHeight sets the ramp, partial faces get colours too', () => {
    const g = wallGeometry(L, 3, T, tile, undefined, undefined, { end: 2 });
    applyWallGradient(g, 3, '#000000', '#ffffff', 6);
    const col = g.getAttribute('color'), pos = g.getAttribute('position');
    expect(col.count).toBe(pos.count);
    const white = new THREE.Color('#ffffff').r;
    for (let i = 0; i < pos.count; i++) {
      const world = pos.getY(i) + 1.5;
      expect(col.getX(i)).toBeCloseTo(white * (world / 6));
    }
    const def = wallGeometry(L, 3, T, tile);
    applyWallGradient(def, 3, '#000000', '#ffffff');
    const topIdx = Array.from({ length: def.getAttribute('position').count }, (_, i) => i).find((i) => def.getAttribute('position').getY(i) > 1.4)!;
    expect(def.getAttribute('color').getX(topIdx)).toBeCloseTo(white);
  });
});

describe('doorHeaderGeometry', () => {
  const T = 0.2, tile = 0.5, bottom = 3, top = 5;
  const fin = { color: '#fff', tileSize: tile };
  interface Case { name: string; n: { x: number; y: number }; alongX: boolean }
  const cases: Case[] = [
    { name: '+x', n: { x: 1, y: 0 }, alongX: false },
    { name: '-x', n: { x: -1, y: 0 }, alongX: false },
    { name: '+y', n: { x: 0, y: 1 }, alongX: true },
    { name: '-y', n: { x: 0, y: -1 }, alongX: true },
  ];
  /** A wall along the step line (offset `off` across), from 0 to 10 along the axis, drawn a to b or reversed. */
  const build = (c: Case, reversed: boolean, off: number) => {
    const line = 5;
    const mk = (along: number, across: number) => (c.alongX ? { x: along, y: across } : { x: across, y: along });
    const wall: Wall = reversed
      ? { id: 'w', a: mk(10, line + off), b: mk(0, line + off) }
      : { id: 'w', a: mk(0, line + off), b: mk(10, line + off) };
    const step: CeilingStep = { a: mk(4.1, line), b: mk(5.9, line), bottom, top, finish: fin, normal: c.n };
    const drawn = { lo: -T / 2, hi: 10 + T / 2 };
    return { wall, step, drawn, line };
  };
  const across = (c: Case, x: number, z: number) => (c.alongX ? z : x);
  const along = (c: Case, x: number, z: number) => (c.alongX ? x : z);
  const nAcross = (c: Case) => (c.alongX ? c.n.y : c.n.x);

  const verts = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    return Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), y: p.getY(i), z: p.getZ(i), nx: n.getX(i), ny: n.getY(i), nz: n.getZ(i), u: uv.getX(i), v: uv.getY(i) }));
  };
  const facing = (g: THREE.BufferGeometry, pick: (v: ReturnType<typeof verts>[number]) => boolean) =>
    verts(g).filter(pick);
  /** geometric normal of every triangle of g that has all three vertices matching `pick` */
  const tris = (g: THREE.BufferGeometry, pick: (v: ReturnType<typeof verts>[number]) => boolean) => {
    const v = verts(g), idx = g.getIndex()!;
    const out: THREE.Vector3[] = [];
    for (let k = 0; k < idx.count; k += 3) {
      const t = [v[idx.getX(k)], v[idx.getX(k + 1)], v[idx.getX(k + 2)]];
      if (!t.every(pick)) continue;
      const [a, b, c] = t.map((q) => new THREE.Vector3(q.x, q.y, q.z));
      out.push(b.clone().sub(a).cross(c.clone().sub(a)));
    }
    return out;
  };

  for (const c of cases) {
    for (const reversed of [false, true]) {
      for (const off of [0, 0.09, -0.09]) {
        const label = `normal ${c.name}, ${reversed ? 'b to a' : 'a to b'}, wall off by ${off}`;
        it(`face is flush with the wall face, spans bottom..top, winds towards n (${label})`, () => {
          const { wall, step, drawn, line } = build(c, reversed, off);
          const g = doorHeaderGeometry(step, wall, T, tile, drawn);
          const faceVerts = facing(g, (v) => Math.abs(v.ny) < 1e-6);
          expect(faceVerts).toHaveLength(4);
          const plane = line + off + nAcross(c) * T / 2;
          for (const v of faceVerts) {
            expect(across(c, v.x, v.z)).toBeCloseTo(plane, 6);
            expect(v.nx).toBeCloseTo(c.n.x); expect(v.nz).toBeCloseTo(c.n.y);
          }
          expect(Math.min(...faceVerts.map((v) => v.y))).toBeCloseTo(bottom);
          expect(Math.max(...faceVerts.map((v) => v.y))).toBeCloseTo(top);
          const al = faceVerts.map((v) => along(c, v.x, v.z));
          expect(Math.min(...al)).toBeCloseTo(4.1); expect(Math.max(...al)).toBeCloseTo(5.9);
          const ts = tris(g, (v) => Math.abs(v.ny) < 1e-6);
          expect(ts).toHaveLength(2);
          for (const t of ts) expect(t.x * c.n.x + t.z * c.n.y).toBeGreaterThan(0);
        });

        it(`underside sits at bottom, faces down, reaches the step line (${label})`, () => {
          const { wall, step, drawn, line } = build(c, reversed, off);
          const g = doorHeaderGeometry(step, wall, T, tile, drawn);
          const under = facing(g, (v) => Math.abs(v.ny) > 0.5);
          const depth = Math.abs(off + nAcross(c) * T / 2);
          if (depth < 1e-4) { expect(under).toHaveLength(0); return; }
          expect(under).toHaveLength(4);
          const plane = line + off + nAcross(c) * T / 2;
          const ac = under.map((v) => across(c, v.x, v.z));
          for (const v of under) { expect(v.y).toBeCloseTo(bottom); expect(v.ny).toBe(-1); }
          expect(Math.min(...ac)).toBeCloseTo(Math.min(plane, line));
          expect(Math.max(...ac)).toBeCloseTo(Math.max(plane, line));
          const ts = tris(g, (v) => Math.abs(v.ny) > 0.5);
          expect(ts).toHaveLength(2);
          for (const t of ts) expect(t.y).toBeLessThan(0);
        });

        it(`u continues the wall box, v = y / tileSize (${label})`, () => {
          const { wall, step, drawn } = build(c, reversed, off);
          const g = doorHeaderGeometry(step, wall, T, tile, drawn);
          const d = wallDirection(wall);
          const perp = { x: -d.y, y: d.x };
          const plusZ = c.n.x * perp.x + c.n.y * perp.y > 0;
          // The wall box's own u on the matching face at the point at distance t from a.
          const L = 10 + T, from = -T / 2;
          const box = wallGeometry(L, top, T, tile, undefined, { front: from - drawn.lo, back: drawn.hi - (from + L) });
          const bp = box.getAttribute('position'), bn = box.getAttribute('normal'), bu = box.getAttribute('uv');
          const boxU = (t: number) => {
            const x = t - from; // local 0..L
            for (let i = 0; i < bp.count; i++) {
              if (Math.abs(bn.getZ(i) - (plusZ ? 1 : -1)) > 1e-6) continue;
              if (Math.abs(bp.getX(i) + L / 2 - x) < 1e-6) return bu.getX(i);
            }
            // the face only has vertices at its ends: interpolate
            const ends = [0, L].map((e) => {
              for (let i = 0; i < bp.count; i++) {
                if (Math.abs(bn.getZ(i) - (plusZ ? 1 : -1)) < 1e-6 && Math.abs(bp.getX(i) + L / 2 - e) < 1e-6) return bu.getX(i);
              }
              throw new Error('no vertex');
            });
            return ends[0] + (ends[1] - ends[0]) * (x / L);
          };
          for (const v of facing(g, (q) => Math.abs(q.ny) < 1e-6)) {
            const t = (along(c, v.x, v.z) - along(c, wall.a.x, wall.a.y)) * (c.alongX ? d.x : d.y);
            expect(v.u).toBeCloseTo(boxU(t), 5);
            expect(v.v).toBeCloseTo(v.y / tile, 6);
          }
        });
      }
    }
  }

  it('merges with a wall box, also with gradient colours matching the wall at the same height', () => {
    const c = cases[0];
    const { wall, step, drawn } = build(c, false, 0.05);
    const H = 5;
    const header = doorHeaderGeometry(step, wall, T, tile, drawn);
    const box = wallGeometry(10, H, T, tile);
    expect(mergeGeometries([box, header], false)).not.toBeNull();
    applyWallGradient(box, H, '#ff0000', '#0000ff', 5);
    applyWallGradient(header, 0, '#ff0000', '#0000ff', 5); // header is in world space
    const m = mergeGeometries([box, header], false);
    expect(m).not.toBeNull();
    expect(m.getAttribute('color').count).toBe(m.getAttribute('position').count);
    const hp = header.getAttribute('position'), hc = header.getAttribute('color');
    const bp = box.getAttribute('position'), bc = box.getAttribute('color');
    for (let i = 0; i < hp.count; i++) {
      const worldY = hp.getY(i);
      const j = Array.from({ length: bp.count }, (_, k) => k).find((k) => Math.abs(bp.getY(k) + H / 2 - worldY) < 1e-6);
      if (j === undefined) {
        const t = worldY / 5;
        const want = new THREE.Color('#ff0000').lerp(new THREE.Color('#0000ff'), t);
        expect(hc.getX(i)).toBeCloseTo(want.r, 5);
        continue;
      }
      expect(hc.getX(i)).toBeCloseTo(bc.getX(j), 5);
      expect(hc.getZ(i)).toBeCloseTo(bc.getZ(j), 5);
    }
  });
});
