import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultMuseum } from '../shared/validate';
import type { Museum } from '../shared/museum';
import { computeFloorBounds } from './collision';
import { Player } from './player';

function museum(): Museum {
  const m = defaultMuseum();
  m.settings.spawn = { x: 1, y: 2, yawDeg: 30 };
  m.walls = [{ id: 'w', a: { x: 5, y: -5 }, b: { x: 5, y: 5 } }];
  return m;
}
const make = (m: Museum, start?: { x: number; y: number; yawDeg: number }) =>
  new Player(new THREE.PerspectiveCamera(), m, computeFloorBounds(m, 2), start);

describe('Player start', () => {
  it('starts at the spawn without a start pose, and exposes it', () => {
    const p = make(museum());
    expect(p.start).toEqual({ x: 1, y: 2, yawDeg: 30 });
    expect(p.headPlan().x).toBeCloseTo(1);
    expect(p.headPlan().y).toBeCloseTo(2);
  });
  it('uses the given pose, position and yaw', () => {
    const p = make(museum(), { x: -3, y: 4, yawDeg: 90 });
    expect(p.start).toEqual({ x: -3, y: 4, yawDeg: 90 });
    expect(p.headPlan().x).toBeCloseTo(-3);
    expect(p.headPlan().y).toBeCloseTo(4);
    // yaw 90 faces plan +x
    const dir = p.camera.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeCloseTo(1);
    expect(dir.z).toBeCloseTo(0);
  });
  it('pushes a start pose out of a wall, as it does the spawn', () => {
    const p = make(museum(), { x: 5.02, y: 0, yawDeg: 0 });
    expect(p.start.x).toBeCloseTo(5 + 0.1 + 0.25);
    expect(p.start.y).toBeCloseTo(0);
    expect(p.headPlan().x).toBeCloseTo(p.start.x);
    const s = museum();
    s.settings.spawn = { x: 4.99, y: 0, yawDeg: 0 };
    expect(make(s).start.x).toBeCloseTo(5 - 0.35);
  });
  it('resetToSpawn returns to the start pose', () => {
    const p = make(museum(), { x: -3, y: 4, yawDeg: 90 });
    p.placeHeadAt({ x: 0, y: 0 });
    p.turn(1);
    p.resetToSpawn();
    expect(p.headPlan().x).toBeCloseTo(-3);
    expect(p.headPlan().y).toBeCloseTo(4);
    expect(p.camera.getWorldDirection(new THREE.Vector3()).x).toBeCloseTo(1);
  });
});
