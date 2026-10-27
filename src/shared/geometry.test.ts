import { describe, expect, it } from 'vitest';
import { closestPointOnSegment, wallDirection, wallLength, wallNormal, workPlacement, yawToRotationY } from './geometry';
import type { Wall, Work } from './museum';

const horiz: Wall = { id: 'h', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }; // d=(1,0), perp=(0,1)
const vert: Wall = { id: 'v', a: { x: 2, y: 0 }, b: { x: 2, y: 3 } }; // d=(0,1), perp=(-1,0)
const work = (over: Partial<Work>): Work => ({
  id: 'k', mediaId: 'm', wallId: 'h', side: 1, t: 1, centerHeight: 1.5, width: 1, title: '', artist: '', ...over,
});

describe('wall basics', () => {
  it('length and direction', () => {
    expect(wallLength(horiz)).toBe(4);
    expect(wallDirection(vert)).toEqual({ x: 0, y: 1 });
  });
  it('normals for both sides on horizontal wall', () => {
    expect(wallNormal(horiz, 1)).toEqual({ x: 0, y: 1 });
    expect(wallNormal(horiz, -1)).toEqual({ x: 0, y: -1 });
  });
  it('normals for both sides on vertical wall', () => {
    expect(wallNormal(vert, 1)).toEqual({ x: -1, y: 0 });
    expect(wallNormal(vert, -1)).toEqual({ x: 1, y: 0 });
  });
  it('normal is unit and perpendicular on a diagonal', () => {
    const d: Wall = { id: 'd', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } };
    const n = wallNormal(d, 1);
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1);
    expect(n.x * 3 + n.y * 4).toBeCloseTo(0);
    expect(n.x).toBeCloseTo(-0.8);
    expect(n.y).toBeCloseTo(0.6);
  });
});

describe('closestPointOnSegment', () => {
  it('interior projection', () => {
    const r = closestPointOnSegment({ x: 1, y: 2 }, horiz.a, horiz.b);
    expect(r.point).toEqual({ x: 1, y: 0 });
    expect(r.t).toBe(1);
    expect(r.dist).toBe(2);
  });
  it('clamps before a and after b', () => {
    const r1 = closestPointOnSegment({ x: -3, y: 4 }, horiz.a, horiz.b);
    expect(r1.t).toBe(0);
    expect(r1.dist).toBe(5);
    const r2 = closestPointOnSegment({ x: 7, y: 4 }, horiz.a, horiz.b);
    expect(r2.t).toBe(4);
    expect(r2.point).toEqual({ x: 4, y: 0 });
    expect(r2.dist).toBe(5);
  });
  it('degenerate segment', () => {
    const r = closestPointOnSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(r.dist).toBe(5);
    expect(r.t).toBe(0);
  });
});

describe('workPlacement', () => {
  it('places on the +side face', () => {
    const p = workPlacement(horiz, work({ side: 1, t: 1 }), 0.2);
    expect(p.center.x).toBeCloseTo(1);
    expect(p.center.y).toBeCloseTo(0.1);
    expect(p.normal).toEqual({ x: 0, y: 1 });
  });
  it('places on the -side face of a vertical wall', () => {
    const p = workPlacement(vert, work({ side: -1, t: 2 }), 0.4);
    expect(p.center.x).toBeCloseTo(2.2);
    expect(p.center.y).toBeCloseTo(2);
    expect(p.normal).toEqual({ x: 1, y: 0 });
  });
});

describe('yawToRotationY', () => {
  it('0 -> 0, 90 -> -pi/2 (facing +x), 180 -> -pi', () => {
    expect(yawToRotationY(0)).toBe(0);
    expect(yawToRotationY(90)).toBeCloseTo(-Math.PI / 2);
    expect(yawToRotationY(180)).toBeCloseTo(-Math.PI);
  });
  it('three.js forward (-z) rotated by the result points along the plan heading', () => {
    // forward after rotation.y = r is (-sin r, 0, -cos r) in world = (x, z) -> plan (x, y)
    const r = yawToRotationY(90);
    expect(-Math.sin(r)).toBeCloseTo(1); // plan +x
    expect(-Math.cos(r)).toBeCloseTo(0);
  });
});
