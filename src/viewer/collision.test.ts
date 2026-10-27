import { describe, expect, it } from 'vitest';
import { computeArc, computeFloorBounds, isTeleportTargetValid, pushOut, resolveMove, segmentSegmentDistance } from './collision';
import { defaultMuseum } from '../shared/validate';
import type { Wall } from '../shared/museum';

const T = 0.2;
const R = 0.25;
const clearance = T / 2 + R; // 0.35
// Divider along x=8 with a doorway gap between y=2 and y=4.
const divider: Wall[] = [
  { id: 'n', a: { x: 8, y: 0 }, b: { x: 8, y: 2 } },
  { id: 's', a: { x: 8, y: 6 }, b: { x: 8, y: 4 } },
];

describe('pushOut / resolveMove', () => {
  it('leaves a free position alone', () => {
    expect(pushOut({ x: 3, y: 1 }, divider, T, R)).toEqual({ x: 3, y: 1 });
  });
  it('is blocked by a wall', () => {
    const p = resolveMove({ x: 7, y: 1 }, { x: 2, y: 0 }, divider, T, R);
    expect(p.x).toBeCloseTo(8 - clearance, 5);
    expect(p.y).toBeCloseTo(1, 5);
  });
  it('is blocked from the other side too', () => {
    const p = resolveMove({ x: 9, y: 5 }, { x: -2, y: 0 }, divider, T, R);
    expect(p.x).toBeCloseTo(8 + clearance, 5);
  });
  it('slides along a wall when moving diagonally', () => {
    const p = resolveMove({ x: 7, y: 1 }, { x: 1, y: 0.5 }, divider, T, R);
    expect(p.x).toBeCloseTo(8 - clearance, 5);
    expect(p.y).toBeCloseTo(1.5, 1); // tangential component retained
  });
  it('does not tunnel on a huge single-frame delta', () => {
    const p = resolveMove({ x: 7, y: 1 }, { x: 5, y: 0 }, divider, T, R);
    expect(p.x).toBeLessThanOrEqual(8 - clearance + 1e-6);
  });
  it('passes through the doorway gap', () => {
    const p = resolveMove({ x: 6, y: 3 }, { x: 4, y: 0 }, divider, T, R);
    expect(p.x).toBeCloseTo(10, 5);
    expect(p.y).toBeCloseTo(3, 5);
  });
  it('is deflected around the rounded doorway jamb (never inside the clearance)', () => {
    const p = resolveMove({ x: 6, y: 2.2 }, { x: 4, y: 0 }, divider, T, R);
    expect(p.x).toBeGreaterThan(8); // slid round the rounded end into the doorway
    expect(pushOut(p, divider, T, R)).toEqual(p);
  });
  it('is blocked by the jamb when walking straight at the wall end flank', () => {
    const p = resolveMove({ x: 6, y: 1.5 }, { x: 4, y: 0 }, divider, T, R);
    expect(p.x).toBeCloseTo(8 - clearance, 5);
  });
  it('resolves exactly-on-wall positions without NaN', () => {
    const p = pushOut({ x: 8, y: 1 }, divider, T, R);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(Math.abs(p.x - 8)).toBeGreaterThanOrEqual(clearance - 1e-6);
  });
});

describe('segmentSegmentDistance', () => {
  it('crossing -> 0, parallel -> offset, separated -> endpoint distance', () => {
    expect(segmentSegmentDistance({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(0);
    expect(segmentSegmentDistance({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 })).toBe(1);
    expect(segmentSegmentDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 })).toBe(3);
  });
});

describe('isTeleportTargetValid', () => {
  const bounds = { minX: -2, minY: -2, maxX: 18, maxY: 8 };
  it('accepts a clear floor point in the same room', () => {
    expect(isTeleportTargetValid({ x: 4, y: 3 }, { x: 6, y: 1 }, divider, T, R, bounds)).toBe(true);
  });
  it('rejects a target on the other side of a wall (line crosses it)', () => {
    expect(isTeleportTargetValid({ x: 4, y: 1 }, { x: 12, y: 1 }, divider, T, R, bounds)).toBe(false);
  });
  it('accepts a target through the doorway gap', () => {
    expect(isTeleportTargetValid({ x: 4, y: 3 }, { x: 12, y: 3 }, divider, T, R, bounds)).toBe(true);
  });
  it('rejects a target inside or too close to a wall', () => {
    expect(isTeleportTargetValid({ x: 4, y: 1 }, { x: 8, y: 1 }, divider, T, R, bounds)).toBe(false);
    expect(isTeleportTargetValid({ x: 4, y: 1 }, { x: 7.7, y: 1 }, divider, T, R, bounds)).toBe(false);
    expect(isTeleportTargetValid({ x: 4, y: 1 }, { x: 7.5, y: 1 }, divider, T, R, bounds)).toBe(true);
  });
  it('rejects targets outside the floor bounds and non-finite targets', () => {
    expect(isTeleportTargetValid({ x: 4, y: 3 }, { x: 40, y: 3 }, divider, T, R, bounds)).toBe(false);
    expect(isTeleportTargetValid({ x: 4, y: 3 }, { x: NaN, y: 3 }, divider, T, R, bounds)).toBe(false);
  });
});

describe('computeFloorBounds', () => {
  it('covers walls plus margin, and the spawn', () => {
    const m = defaultMuseum();
    m.walls = divider;
    m.settings.spawn = { x: -5, y: 3, yawDeg: 0 };
    expect(computeFloorBounds(m, 2)).toEqual({ minX: -7, minY: -2, maxX: 10, maxY: 8 });
  });
});

describe('computeArc', () => {
  it('lands on the floor ahead when aimed level-ish from 1 m high', () => {
    const r = computeArc({ x: 0, y: 1, z: 0 }, { x: 0, y: 0.3, z: -0.954 });
    expect(r.hit).not.toBeNull();
    expect(r.hit!.z).toBeLessThan(0);
    expect(r.points[r.points.length - 1].y).toBe(0);
  });
  it('returns no hit when aimed straight up with a small budget', () => {
    expect(computeArc({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, 7, 9.8, 5).hit).toBeNull();
  });
});
