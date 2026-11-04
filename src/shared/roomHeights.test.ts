import { describe, expect, it } from 'vitest';
import type { Area, Museum, Wall } from './museum';
import { roomHeightAt, wallHeightProfile, wallSideHeight, wallTopAt } from './roomHeights';
import { defaultMuseum } from './validate';

const wall = (ax: number, ay: number, bx: number, by: number): Wall => ({ id: 'w', a: { x: ax, y: ay }, b: { x: bx, y: by } });
const area = (id: string, x: number, y: number, w: number, h: number, extra: Partial<Area>): Area => ({ id, name: id, rect: { x, y, w, h }, ...extra });
const museum = (areas: Area[]): Museum => ({ ...defaultMuseum(), areas });
const fin = { color: '#ff0000', tileSize: 1 };

describe('roomHeightAt', () => {
  it('falls back to the default height', () => {
    expect(roomHeightAt(museum([]), 1, 1)).toBe(3);
  });
  it('last area with roomHeight wins; edges are outside', () => {
    const m = museum([area('a', 0, 0, 4, 4, { roomHeight: 5 }), area('b', 2, 2, 4, 4, { roomHeight: 4 })]);
    expect(roomHeightAt(m, 1, 1)).toBe(5);
    expect(roomHeightAt(m, 3, 3)).toBe(4);
    expect(roomHeightAt(m, 0, 1)).toBe(3);
  });
  it('an area with roomHeight under one with only a finish still sets the height', () => {
    const m = museum([area('a', 0, 0, 4, 4, { roomHeight: 5 }), area('b', 0, 0, 4, 4, { ceiling: fin })]);
    expect(roomHeightAt(m, 2, 2)).toBe(5);
  });
});

describe('wallHeightProfile', () => {
  it('no roomHeight anywhere: one piece at the default height', () => {
    const m = museum([area('f', 0, 0, 4, 4, { floor: fin })]);
    expect(wallHeightProfile(m, wall(0, 0, 8, 0))).toEqual([{ from: 0, to: 8, plus: 3, minus: 3, top: 3 }]);
  });
  it('axis-aligned wall leaving an area: breaks at the area edge, per-side values', () => {
    // wall along y=0 from x=0..8; +perp is (0,1) i.e. plan +y. Area covers y 0.2..5 (only the +y side), x 0..4.
    const m = museum([area('t', 0, 0.05, 4, 5, { roomHeight: 5 })]);
    const p = wallHeightProfile(m, wall(0, 0, 8, 0));
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ from: 0, plus: 5, minus: 3, top: 5 });
    expect(p[0].to).toBeCloseTo(4);
    expect(p[1]).toMatchObject({ plus: 3, minus: 3, top: 3, to: 8 });
  });
  it('wall between a 3 m and a 5 m room is 5 m tall, plus/minus per side', () => {
    const m = museum([area('low', 0, 0, 5, 5, {}), area('tall', 5, 0, 5, 5, { roomHeight: 5 })]);
    const p = wallHeightProfile(m, wall(5, 0, 5, 5)); // d = +y, perp = (-1, 0) -> plus side is x < 5
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ plus: 3, minus: 5, top: 5 });
    expect(wallSideHeight(m, wall(5, 0, 5, 5), 1, 0, 5)).toBe(3);
    expect(wallSideHeight(m, wall(5, 0, 5, 5), -1, 0, 5)).toBe(5);
  });
  it('area edge exactly on the centre line: each side sampled outside, no sliver', () => {
    const m = museum([area('tall', 5, 0, 5, 5, { roomHeight: 5 })]);
    const p = wallHeightProfile(m, wall(0, 2, 10, 2));
    // wall crosses x=5 and x=10 edge lines; sides at y=2±0.11, both inside the area for x in 5..10
    expect(p.map((q) => q.top)).toEqual([3, 5]);
    expect(p[0].to).toBeCloseTo(5);
  });
  it('area edge on the wall face (within the sample offset): the face sample stays outside the area', () => {
    // wall along y=0; area occupies y >= 0.1 (exactly the +face), so the +perp sample (y=0.11) is inside, -perp is not
    const m = museum([area('t', 0, 0.1, 10, 5, { roomHeight: 5 })]);
    const p = wallHeightProfile(m, wall(0, 0, 10, 0));
    expect(p).toEqual([{ from: 0, to: 10, plus: 5, minus: 3, top: 5 }]);
  });
  it('a diagonal wall crossing an area breaks where its sample lines cross the edges', () => {
    const m = museum([area('t', 0, 0, 4, 4, { roomHeight: 5 })]);
    const p = wallHeightProfile(m, wall(-2, -2, 6, 6));
    expect(p.map((q) => q.top)).toEqual([3, 5, 3]);
    expect(p[0].to).toBeGreaterThan(2.8 - 0.3);
    expect(p[0].to).toBeLessThan(2.83 + 0.3);
    expect(p[1].to).toBeCloseTo(Math.hypot(6, 6), 0); // leaves the area near 8.49
    expect(p[2].to).toBeCloseTo(Math.hypot(8, 8));
    for (let i = 1; i < p.length; i++) expect(p[i].from).toBe(p[i - 1].to);
  });
  it('overlapping areas: later one wins where they overlap', () => {
    const m = museum([area('a', 0, -5, 6, 10, { roomHeight: 5 }), area('b', 3, -5, 6, 10, { roomHeight: 4 })]);
    const p = wallHeightProfile(m, wall(0, 0, 10, 0));
    expect(p.map((q) => q.top)).toEqual([5, 4, 3]);
    expect(p[0].to).toBeCloseTo(3);
    expect(p[1].to).toBeCloseTo(9);
  });
  it('zero-length wall: one piece sampled at the point', () => {
    const m = museum([area('t', 0, 0, 4, 4, { roomHeight: 5 })]);
    expect(wallHeightProfile(m, wall(2, 2, 2, 2))).toEqual([{ from: 0, to: 0, plus: 5, minus: 5, top: 5 }]);
    expect(wallHeightProfile(m, wall(8, 8, 8, 8))[0].top).toBe(3);
  });
  it('wallTopAt clamps to the profile', () => {
    const p = [{ from: 0, to: 2, plus: 3, minus: 3, top: 3 }, { from: 2, to: 5, plus: 5, minus: 5, top: 5 }];
    expect(wallTopAt(p, -1)).toBe(3);
    expect(wallTopAt(p, 3)).toBe(5);
    expect(wallTopAt(p, 99)).toBe(5);
  });
  it('wallSideHeight takes the lowest over the range and clamps', () => {
    const m = museum([area('t', 4, -5, 10, 10, { roomHeight: 5 })]);
    const w = wall(0, 0, 10, 0);
    expect(wallSideHeight(m, w, 1, 0, 10)).toBe(3);
    expect(wallSideHeight(m, w, 1, 6, 9)).toBe(5);
    expect(wallSideHeight(m, w, 1, 9, 30)).toBe(5);
    expect(wallSideHeight(m, w, 1, -3, 1)).toBe(3);
  });
});
