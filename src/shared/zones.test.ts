import { describe, expect, it } from 'vitest';
import { distanceInside, zoneGain } from './zones';
import type { AudioZone, ZoneShape } from './museum';

const rect: ZoneShape = { kind: 'rect', x: 0, y: 0, w: 10, h: 4 };
const circle: ZoneShape = { kind: 'circle', cx: 5, cy: 5, r: 3 };
const zone = (shape: ZoneShape, volume: number, fade: number): AudioZone => ({
  id: 'z', name: 'z', mediaId: 'm', shape, volume, fade,
});

describe('distanceInside', () => {
  it('rect: nearest edge when inside', () => {
    expect(distanceInside(rect, { x: 5, y: 2 })).toBe(2);
    expect(distanceInside(rect, { x: 1, y: 2 })).toBe(1);
  });
  it('rect: on the edge is 0, outside is negative', () => {
    expect(distanceInside(rect, { x: 0, y: 2 })).toBe(0);
    expect(distanceInside(rect, { x: -2, y: 2 })).toBe(-2);
    expect(distanceInside(rect, { x: 13, y: 8 })).toBeCloseTo(-5); // corner distance
  });
  it('circle', () => {
    expect(distanceInside(circle, { x: 5, y: 5 })).toBe(3);
    expect(distanceInside(circle, { x: 7, y: 5 })).toBe(1);
    expect(distanceInside(circle, { x: 8, y: 5 })).toBe(0);
    expect(distanceInside(circle, { x: 10, y: 5 })).toBe(-2);
  });
});

describe('zoneGain', () => {
  it('0 outside and on the edge', () => {
    expect(zoneGain(zone(rect, 0.8, 1), { x: -1, y: 1 })).toBe(0);
    expect(zoneGain(zone(rect, 0.8, 1), { x: 0, y: 1 })).toBe(0);
    expect(zoneGain(zone(circle, 0.8, 1), { x: 8, y: 5 })).toBe(0);
  });
  it('fade 0 -> full volume anywhere inside', () => {
    expect(zoneGain(zone(rect, 0.7, 0), { x: 0.001, y: 2 })).toBe(0.7);
    expect(zoneGain(zone(circle, 0.5, 0), { x: 7.9, y: 5 })).toBe(0.5);
  });
  it('smoothstep ramp across the fade band', () => {
    const z = zone(rect, 1, 2);
    expect(zoneGain(z, { x: 1, y: 2 })).toBeCloseTo(0.5); // d/fade = .5 -> smoothstep .5
    expect(zoneGain(z, { x: 0.5, y: 2 })).toBeCloseTo(0.15625); // x=.25
    expect(zoneGain(z, { x: 2, y: 2 })).toBeCloseTo(1); // d=2 (limited by top/bottom: 2)
    expect(zoneGain(z, { x: 5, y: 2 })).toBeCloseTo(1);
  });
  it('is monotonic and bounded by volume', () => {
    const z = zone(circle, 0.6, 1.5);
    let prev = 0;
    for (let r = 3; r >= 0; r -= 0.1) {
      const g = zoneGain(z, { x: 5 + r, y: 5 });
      expect(g).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(g).toBeLessThanOrEqual(0.6 + 1e-12);
      prev = g;
    }
  });
});
