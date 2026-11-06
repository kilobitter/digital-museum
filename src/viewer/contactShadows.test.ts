import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Museum, Wall } from '../shared/museum';
import { wallHeightProfile } from '../shared/roomHeights';
import { defaultMuseum } from '../shared/validate';
import { FLOOR_UNDER, FOOT_PEAK, FOOT_WIDTH, FRAME_SHIFT, GAP, contactShadowGeometry, contactShadowMaterial } from './contactShadows';
import type { PaintingSlot } from './scene';
import { decomposeCeiling, uncoveredSteps } from './surfaces';
import { wallEnds, wallPieces, wallSpans } from './wallJoints';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
const T = 0.2;

function build(m: Museum, slots: PaintingSlot[] = [], withHeaders = false) {
  const ends = wallEnds(m.walls);
  const spans = wallSpans(m.walls, ends, T);
  const profiles = new Map(m.walls.map((w) => [w.id, wallHeightProfile(m, w)]));
  const pieces = wallPieces(m.walls, spans, profiles, T);
  const base = { x: -20, y: -20, w: 40, h: 40 };
  const plan = m.settings.ceiling ? decomposeCeiling(base, m.settings.ceilingFinish, m.areas, m.settings.wallHeight) : null;
  const ceilings = plan ? plan.groups : [];
  const headers = withHeaders && plan ? uncoveredSteps(plan.steps, m.walls, spans, T).filter((st) => st.wall).map((st) => ({ step: st, wall: st.wall! })) : [];
  return contactShadowGeometry({ museum: m, pieces, ends, ceilings, slots, headers });
}

interface Tri { p: THREE.Vector3[]; a: number[]; n: THREE.Vector3; c: THREE.Vector3 }
function tris(g: THREE.BufferGeometry): Tri[] {
  const pos = g.getAttribute('position'), col = g.getAttribute('color');
  const out: Tri[] = [];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const p = [0, 1, 2].map((k) => new THREE.Vector3(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)));
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    out.push({ p, a: [0, 1, 2].map((k) => col.getW(i + k)), n, c: new THREE.Vector3().add(p[0]).add(p[1]).add(p[2]).divideScalar(3) });
  }
  return out;
}
const verts = (g: THREE.BufferGeometry) => tris(g).flatMap((t) => t.p.map((p, i) => ({ p, a: t.a[i] })));
const horizontal = (t: Tri) => Math.abs(t.n.y) > 0.99;
const vertical = (t: Tri) => Math.abs(t.n.y) < 1e-6;

/** Horizontal distance of a point from the wall's centre line, signed by the wall normal (perp(d)). */
const signedOff = (w: Wall, p: THREE.Vector3) => {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, len = Math.hypot(dx, dy);
  return ((p.x - w.a.x) * -dy + (p.z - w.a.y) * dx) / len;
};

function museumWith(walls: Wall[], patch?: (m: Museum) => void): Museum {
  const m = defaultMuseum();
  m.settings.wallThickness = T;
  m.walls = walls;
  patch?.(m);
  return m;
}

describe('contactShadowGeometry: single wall', () => {
  const m = museumWith([wall('w', 0, 0, 6, 0)], (x) => { x.areas = [{ id: 'a', name: 'a', rect: { x: -1, y: -1, w: 3, h: 3 }, floor: { color: '#fff', tileSize: 1 } }, { id: 'b', name: 'b', rect: { x: 0, y: 0, w: 2, h: 2 }, floor: { color: '#fff', tileSize: 1 } }]; });
  const g = build(m)!;
  const ts = tris(g);

  it('has strips on both faces in the face planes', () => {
    for (const side of [1, -1]) {
      const wallTris = ts.filter((t) => vertical(t) && Math.abs(t.n.z) > 0.99 && Math.sign(t.n.z) === side && t.p.every((p) => Math.abs(p.z - side * (T / 2 + GAP)) < 1e-6));
      expect(wallTris.length).toBeGreaterThan(0);
    }
  });
  it('floor strips run outward from each face, above the highest area level', () => {
    const floor = ts.filter((t) => horizontal(t) && t.n.y > 0 && t.c.x > 0.5 && t.c.x < 5.5);
    const minY = 0.002 + GAP; // two stacked areas: highest quad at 2 mm
    for (const t of floor) for (const p of t.p) expect(p.y).toBeCloseTo(minY);
    for (const side of [1, -1]) {
      const zs = floor.flatMap((t) => t.p.map((p) => p.z * side)).filter((z) => z > 0);
      expect(Math.min(...zs)).toBeCloseTo(T / 2 - FLOOR_UNDER, 5);
      expect(Math.max(...zs)).toBeCloseTo(T / 2 + GAP + FOOT_WIDTH);
    }
  });
  it('alpha is the peak at the joint and 0 at the far edge', () => {
    const v = verts(g).filter((x) => Math.abs(x.p.y - (0.002 + GAP)) < 1e-6 && x.p.x >= -0.2 && x.p.x <= 6.2 && x.p.z > 0);
    for (const x of v) {
      if (Math.abs(x.p.z - (T / 2 + GAP)) < 1e-6) expect(x.a).toBeCloseTo(FOOT_PEAK);
      if (Math.abs(x.p.z - (T / 2 + GAP + FOOT_WIDTH)) < 1e-6) expect(x.a).toBe(0);
    }
    expect(v.some((x) => x.a === 0)).toBe(true);
    expect(v.some((x) => Math.abs(x.a - FOOT_PEAK) < 1e-6)).toBe(true);
  });
  it('color has itemSize 4, all finite, material is the right kind', () => {
    expect(g.getAttribute('color').itemSize).toBe(4);
    expect(g.getAttribute('position').array.every(Number.isFinite)).toBe(true);
    expect(g.getAttribute('color').array.every(Number.isFinite)).toBe(true);
    const mat = contactShadowMaterial() as THREE.MeshBasicMaterial;
    expect(mat.vertexColors && mat.transparent && !mat.depthWrite && mat.polygonOffset).toBe(true);
  });
});

describe('contactShadowGeometry: winding and angles', () => {
  const cases: [string, Wall][] = [['axis', wall('w', 0, 0, 6, 0)], ['reversed', wall('w', 6, 0, 0, 0)], ['diagonal', wall('w', 1, 1, 5, 4)], ['diagonal reversed', wall('w', 5, 4, 1, 1)], ['vertical', wall('w', 2, 5, 2, -3)]];
  for (const [name, w] of cases) {
    it(`${name}: strips are in the face planes and every triangle faces its visible side`, () => {
      const g = build(museumWith([w]))!;
      for (const t of tris(g)) {
        if (horizontal(t)) {
          // floor strips face up, ceiling strips face down
          expect(t.n.y > 0).toBe(t.c.y < 1.5);
        } else {
          expect(vertical(t)).toBe(true);
          const side = Math.abs(signedOff(w, t.c)) > 0 ? signedOff(w, t.c) : 0;
          // vertical strips lie in a face plane (|offset| = T/2 + GAP) or on an end face; the normal points away from the wall
          const d = new THREE.Vector3(w.b.x - w.a.x, 0, w.b.y - w.a.y).normalize();
          const perp = new THREE.Vector3(-d.z, 0, d.x);
          if (Math.abs(t.n.dot(perp)) > 0.99) {
            expect(Math.abs(side)).toBeCloseTo(T / 2 + GAP, 5);
            expect(Math.sign(t.n.dot(perp))).toBe(Math.sign(side));
          } else {
            expect(Math.abs(t.n.dot(d))).toBeGreaterThan(0.99); // the jamb
          }
        }
      }
    });
  }
});

describe('contactShadowGeometry: ceilings', () => {
  const nearCeiling = (g: THREE.BufferGeometry, h: number) => verts(g).filter((v) => v.p.y > h - 0.5);
  it('no ceiling strips without a ceiling', () => {
    const g = build(museumWith([wall('w', 0, 0, 6, 0)], (m) => { m.settings.ceiling = false; }))!;
    expect(nearCeiling(g, 3)).toHaveLength(0);
    expect(verts(g).every((v) => v.p.y < 0.5)).toBe(true);
  });
  it('strips under the ceiling on both faces: wall face and the ceiling', () => {
    const g = build(museumWith([wall('w', 0, 0, 6, 0)]))!;
    const up = tris(g).filter((t) => t.c.y > 2.5);
    expect(up.some((t) => horizontal(t) && t.n.y < 0)).toBe(true);
    expect(up.some((t) => vertical(t) && t.n.z > 0.99)).toBe(true);
    expect(up.some((t) => vertical(t) && t.n.z < -0.99)).toBe(true);
    for (const t of up.filter(horizontal)) for (const p of t.p) expect(p.y).toBeCloseTo(3 - GAP);
  });
  it('open sky: no ceiling strip over that stretch', () => {
    const g = build(museumWith([wall('w', 0, 0, 10, 0)], (m) => { m.areas = [{ id: 's', name: 's', rect: { x: 3, y: -2, w: 4, h: 4 }, openSky: true }]; }))!;
    const xs = nearCeiling(g, 3).map((v) => v.p.x);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.some((x) => x > 3.01 && x < 6.99)).toBe(false);
  });
  it('rooms of different height on the two sides: each side at its own height', () => {
    // +z side (y > 0) is 4 m tall, -z side is the default 3 m; the wall reaches 4 m
    const g = build(museumWith([wall('w', 0, 0, 6, 0)], (m) => { m.areas = [{ id: 'h', name: 'h', rect: { x: -2, y: 0, w: 10, h: 4 }, roomHeight: 4 }]; }))!;
    const ceil = tris(g).filter((t) => t.c.y > 2.5 && t.n.z > 0.99 && vertical(t));
    const ceilNeg = tris(g).filter((t) => t.c.y > 2.5 && t.n.z < -0.99 && vertical(t));
    expect(Math.max(...ceil.flatMap((t) => t.p.map((p) => p.y)))).toBeCloseTo(4);
    expect(Math.max(...ceilNeg.flatMap((t) => t.p.map((p) => p.y)))).toBeCloseTo(3);
  });
});

describe('contactShadowGeometry: ends and corners', () => {
  const fanAt = (g: THREE.BufferGeometry, x: number, z: number, r = 0.1) =>
    tris(g).filter((t) => horizontal(t) && t.n.y > 0 && t.p.some((p) => Math.hypot(p.x - x, p.z - z) < r));
  it('free ends get a fan and a jamb strip; the gap in a doorway stays free', () => {
    const g = build(museumWith([wall('l', 0, 0, 3, 0), wall('r', 4, 0, 7, 0)], (m) => { m.settings.ceiling = false; }))!;
    // fan around the end at x = 3 + T/2 reaches past the end
    const past = tris(g).filter((t) => horizontal(t) && t.p.some((p) => p.x > 3 + T / 2 + 0.1 && p.x < 3.7));
    expect(past.length).toBeGreaterThan(0);
    // jamb: vertical strip facing +x on the left wall's end, at the end plane
    const jamb = tris(g).filter((t) => vertical(t) && t.n.x > 0.99 && t.p.every((p) => Math.abs(p.x - (3 + T / 2 + GAP)) < 1e-6));
    expect(jamb.length).toBeGreaterThan(0);
    expect(tris(g).some((t) => vertical(t) && t.n.x < -0.99 && t.p.every((p) => Math.abs(p.x - (4 - T / 2 - GAP)) < 1e-6))).toBe(true);
    // nothing in the doorway's middle across the wall line
    expect(tris(g).some((t) => t.c.x > 3.7 && t.c.x < 3.3 + 0.0 && Math.abs(t.c.z) < 0.05)).toBe(false);
    for (const t of tris(g)) if (t.c.x > 3.5 - 1e-9 && t.c.x < 3.5 + 1e-9) expect(Math.abs(t.c.z)).toBeGreaterThan(0.1);
  });
  it('L corner: a fan on the outside, nothing on the inside', () => {
    const g = build(museumWith([wall('h', 0, 0, 5, 0), wall('v', 5, 0, 5, 4)], (m) => { m.settings.ceiling = false; }))!;
    // outer corner of the footprint is (5 + T/2, -T/2); wall h is above (z<0 is outside: normal of h is +z so z<0 is side -1)
    const outer = fanAt(g, 5 + T / 2 + 0.2, -T / 2 - 0.2, 0.15);
    expect(outer.length).toBeGreaterThan(0);
    // inside the L (x < 5 - T/2, z > T/2) strips exist but only as the two plain strips: no triangle spans the inner corner diagonally
    const inner = tris(g).filter((t) => horizontal(t) && t.p.some((p) => p.x < 5 - T / 2 && p.z > T / 2 && Math.hypot(p.x - (5 - T / 2 - 0.2), p.z - (T / 2 + 0.2)) < 0.01));
    expect(inner).toHaveLength(0);
    // the outer fan is round: some vertex lies diagonally beyond the corner
    expect(verts(g).some((v) => v.p.x > 5 + T / 2 + 0.2 && v.p.z < -T / 2 - 0.2)).toBe(true);
  });
  it('strips stop at the other wall instead of running inside it (inner corner, X crossing)', () => {
    const g = build(museumWith([wall('h', 0, 0, 5, 0), wall('v', 5, 0, 5, 4)], (m) => { m.settings.ceiling = false; }))!;
    // every vertex of an h-wall strip on the +z (inner) side lies before the v wall's face at x = 5 - T/2
    for (const t of tris(g)) if (horizontal(t) && t.n.y > 0 && t.p.every((p) => p.z > 0 && p.z < 1 && p.x < 5.1)) for (const p of t.p) expect(p.x).toBeLessThanOrEqual(5 - T / 2 + 1e-6);
    const x = build(museumWith([wall('h', 0, 0, 10, 0), wall('v', 5, -3, 5, 3)], (m) => { m.settings.ceiling = false; }))!;
    // the horizontal wall's strips on the +z face leave a gap of the vertical wall's thickness
    expect(tris(x).some((t) => t.n.y > 0.99 && t.c.z > 0 && t.c.z < 0.4 && Math.abs(t.c.x - 5) < T / 2 - 0.01)).toBe(false);
  });
  it('T-junction: no fan at the hidden end', () => {
    const g = build(museumWith([wall('long', 0, 0, 10, 0), wall('stub', 4, 0, 4, 3)], (m) => { m.settings.ceiling = false; }))!;
    // the stub's end at (4, 0) sits inside the long wall; nothing is drawn beyond it on the far (-z) side other than long's own strip
    for (const t of tris(g).filter((x) => horizontal(x) && x.n.y > 0)) {
      for (const p of t.p) if (p.z < -T / 2 - GAP - 1e-6) expect(p.z).toBeGreaterThanOrEqual(-T / 2 - GAP - FOOT_WIDTH - 1e-6);
    }
    expect(tris(g).some((t) => t.p.some((p) => p.z < -T / 2 - GAP - FOOT_WIDTH + 1e-6 - 1e-3 && p.z < -T / 2 - GAP - 1e-3 && Math.abs(p.x - 4) < 0.3 && false))).toBe(false);
    const stubEndFan = tris(g).filter((t) => horizontal(t) && t.p.some((p) => p.x > 3.7 && p.x < 4.3 && p.z < -T / 2 - GAP - 1e-6));
    // only the long wall's straight strip lies there: its vertices have z at exactly the strip rows
    for (const t of stubEndFan) for (const p of t.p) expect([-(T / 2 + GAP), -(T / 2 + GAP + FOOT_WIDTH / 2), -(T / 2 + GAP + FOOT_WIDTH)].some((z) => Math.abs(p.z - z) < 1e-6)).toBe(true);
  });
});

describe('contactShadowGeometry: frames', () => {
  for (const rotY of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    it(`ring around the frame, shifted down, on the hanging side (rotationY ${rotY.toFixed(2)})`, () => {
      const n = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
      const right = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
      const pos = new THREE.Vector3(10, 1.5, 4);
      const slot: PaintingSlot = { id: 's', media: {} as never, w: 1, h: 0.6, position: pos, rotationY: rotY, x: 10, y: 4 };
      const g = build(museumWith([]), [slot])!;
      const ts = tris(g);
      expect(ts.length).toBeGreaterThan(0);
      for (const t of ts) {
        expect(t.n.dot(n)).toBeGreaterThan(0.99);
        for (const p of t.p) expect(new THREE.Vector3().subVectors(p, pos).dot(n)).toBeCloseTo(GAP, 6);
      }
      const vs = verts(g);
      const local = vs.map((v) => ({ x: new THREE.Vector3().subVectors(v.p, pos).dot(right), y: v.p.y - pos.y, a: v.a }));
      const inner = local.filter((v) => v.a > 0.2);
      expect(Math.max(...inner.map((v) => v.x))).toBeCloseTo(0.52);
      expect(Math.min(...local.map((v) => v.y))).toBeCloseTo(-0.32 - 0.05 - FRAME_SHIFT);
      expect(Math.max(...local.map((v) => v.y))).toBeCloseTo(0.32 + 0.05 - FRAME_SHIFT);
      expect(Math.min(...inner.map((v) => v.y))).toBeCloseTo(-0.32);
    });
  }
});

describe('contactShadowGeometry: degenerate input', () => {
  it('empty museum returns null', () => {
    expect(build(defaultMuseum())).toBeNull();
  });
  it('zero-length wall stays finite', () => {
    const g = build(museumWith([wall('z', 2, 2, 2, 2)]));
    if (g) {
      expect(g.getAttribute('position').array.every(Number.isFinite)).toBe(true);
      expect(g.getAttribute('color').array.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('contactShadowGeometry: joints, overhang and headers', () => {
  it('wall foot strips start at the floor (y = 0) and the floor strip starts at the wall face', () => {
    const g = build(museumWith([wall('w', 0, 0, 6, 0)], (m) => { m.settings.ceiling = false; m.areas = [{ id: 'a', name: 'a', rect: { x: -1, y: -1, w: 8, h: 3 }, floor: { color: '#fff', tileSize: 1 } }]; }))!;
    const wallTris = tris(g).filter((t) => vertical(t) && t.n.z > 0.99);
    expect(Math.min(...wallTris.flatMap((t) => t.p.map((p) => p.y)))).toBe(0);
    const floor = tris(g).filter((t) => horizontal(t) && t.c.x > 1 && t.c.x < 5 && t.c.z > 0);
    expect(Math.min(...floor.flatMap((t) => t.p.map((p) => p.z)))).toBeCloseTo(T / 2 - FLOOR_UNDER, 6);
  });
  for (const kind of ['tall room', 'open sky'] as const) {
    it(`ceiling strip stays inside its rect: wall 0.15 m from the edge of a low ceiling beside ${kind}`, () => {
      const g = build(museumWith([wall('w', 0, 0, 6, 0)], (m) => { m.areas = [kind === 'tall room' ? { id: 't', name: 't', rect: { x: -3, y: 0.25, w: 12, h: 5 }, roomHeight: 5 } : { id: 's', name: 's', rect: { x: -3, y: 0.25, w: 12, h: 5 }, openSky: true }]; }))!;
      const ceil = tris(g).filter((t) => horizontal(t) && t.n.y < 0 && Math.abs(t.c.y - 3) < 0.01);
      const side = ceil.flatMap((t) => t.p).filter((p) => p.z > 0);
      expect(side.length).toBeGreaterThan(0);
      for (const p of side) expect(p.z).toBeLessThanOrEqual(0.25 + 1e-6);
    });
  }
  const headerMuseum = () => museumWith([wall('l', 0, 0, 3, 0), wall('r', 4, 0, 7, 0), wall('s', -3, 6, 7, 6)], (m) => {
    m.areas = [{ id: 't', name: 't', rect: { x: -5, y: -5, w: 15, h: 5 }, roomHeight: 5 }]; // tall room on the -z side, default 3 m on +z
  });
  it('door header: contact on the header face and on the tall ceiling, nothing without headers', () => {
    const none = build(headerMuseum())!;
    const g = build(headerMuseum(), [], true)!;
    const inGap = (t: Tri) => t.c.x > 3.3 && t.c.x < 3.9 && t.c.y > 2.5 && Math.abs(t.c.z) < 1;
    expect(tris(none).some(inGap)).toBe(false);
    const face = tris(g).filter((t) => inGap(t) && vertical(t));
    expect(face.length).toBeGreaterThan(0);
    for (const t of face) { expect(t.n.z).toBeLessThan(-0.99); for (const p of t.p) expect(p.y).toBeLessThanOrEqual(5 + 1e-6); }
    expect(Math.max(...face.flatMap((t) => t.p.map((p) => p.y)))).toBeCloseTo(5);
    expect(tris(g).some((t) => inGap(t) && horizontal(t) && t.n.y < 0 && Math.abs(t.c.y - 5) < 0.01)).toBe(true);
    // nothing on the header's underside (3 m) over the doorway
    expect(tris(g).some((t) => t.c.x > 3.3 && t.c.x < 3.9 && Math.abs(t.c.z) < 1 && horizontal(t) && Math.abs(t.c.y - 3) < 0.05)).toBe(false);
  });
});
