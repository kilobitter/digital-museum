import { describe, expect, it } from 'vitest';
import type { Wall } from '../shared/museum';
import { wallEnds, wallSpans } from './wallJoints';

const w = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
const FREE = { extend: true, cap: true };
const CORNER = { extend: true, cap: false };
const BUTT = { extend: false, cap: false };

describe('wallEnds', () => {
  it('free-standing wall: both ends extended and capped (unchanged look)', () => {
    expect(wallEnds([w('a', 0, 0, 5, 0)]).get('a')).toEqual({ a: FREE, b: FREE });
  });

  it('L corner: both walls extend into the corner but drop the end face there', () => {
    const e = wallEnds([w('h', 0, 0, 5, 0), w('v', 5, 0, 5, 4)]);
    expect(e.get('h')).toEqual({ a: FREE, b: CORNER });
    expect(e.get('v')).toEqual({ a: CORNER, b: FREE });
  });

  it('corner found whichever way the walls were drawn, within 1 cm', () => {
    const e = wallEnds([w('h', 5, 0, 0, 0), w('v', 5, 4, 5.005, 0.004)]);
    expect(e.get('h')!.a).toEqual(CORNER);
    expect(e.get('v')!.b).toEqual(CORNER);
  });

  it('room of four walls: every end is a corner', () => {
    const e = wallEnds([w('1', 0, 0, 4, 0), w('2', 4, 0, 4, 3), w('3', 4, 3, 0, 3), w('4', 0, 3, 0, 0)]);
    for (const v of e.values()) expect(v).toEqual({ a: CORNER, b: CORNER });
  });

  it('straight continuation: the two walls butt together without overlapping', () => {
    const e = wallEnds([w('l', 0, 0, 3, 0), w('r', 3, 0, 7, 0)]);
    expect(e.get('l')!.b).toEqual(BUTT);
    expect(e.get('r')!.a).toEqual(BUTT);
  });

  it('T made of a straight pair plus a branch: the pair butts, the branch extends without a cap', () => {
    const e = wallEnds([w('l', 0, 0, 3, 0), w('r', 3, 0, 7, 0), w('s', 3, 0, 3, 4)]);
    expect(e.get('l')!.b).toEqual(BUTT);
    expect(e.get('r')!.a).toEqual(BUTT);
    expect(e.get('s')!.a).toEqual(CORNER);
  });

  it('T-junction against the middle of a wall: stops at its centre line, no cap', () => {
    const e = wallEnds([w('long', 0, 0, 10, 0), w('stub', 4, 0, 4, 3)]);
    expect(e.get('stub')!.a).toEqual(BUTT);
    expect(e.get('long')).toEqual({ a: FREE, b: FREE });
  });

  it('two rooms side by side: the walls on top of each other on the shared side still close their corners', () => {
    const e = wallEnds([w('a1', 0, 0, 4, 0), w('a2', 4, 0, 4, 3), w('a3', 4, 3, 0, 3), w('b1', 4, 0, 8, 0), w('b4', 4, 3, 4, 0), w('b3', 8, 3, 4, 3)]);
    expect(e.get('a2')).toEqual({ a: CORNER, b: CORNER });
    expect(e.get('b4')).toEqual({ a: CORNER, b: CORNER });
  });
});

describe('wallSpans', () => {
  const T = 0.2;
  const spans = (walls: Wall[]) => {
    const out = wallSpans(walls, wallEnds(walls), T);
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return (id: string) => out.get(id)!.map((s) => ({ ...s, from: r(s.from), to: r(s.to) }));
  };

  it('a wall with nothing on top of it is one whole box', () => {
    expect(spans([w('a', 0, 0, 5, 0)])('a')).toEqual([{ from: -0.1, to: 5.1, capFrom: true, capTo: true }]);
  });

  it('two identical walls (drawn either way round): only the later one is drawn', () => {
    const s = spans([w('old', 0, 0, 5, 0), w('new', 5, 0, 0, 0)]);
    expect(s('old')).toEqual([]);
    expect(s('new')).toEqual([{ from: -0.1, to: 5.1, capFrom: true, capTo: true }]);
  });

  it('a later, shorter wall on top: the earlier one keeps the parts outside it, open where it is cut', () => {
    const s = spans([w('old', 0, 0, 10, 0), w('new', 4, 0, 6, 0)]);
    expect(s('old')).toEqual([
      { from: -0.1, to: 3.9, capFrom: true, capTo: false },
      { from: 6.1, to: 10.1, capFrom: false, capTo: true },
    ]);
    expect(s('new')).toEqual([{ from: -0.1, to: 2.1, capFrom: true, capTo: true }]);
  });

  it('shared side of two rooms with a door cut through both: only the later room draws it', () => {
    const roomA = [w('a1', 0, 0, 4, 0), w('a2', 4, 0, 4, 3), w('a3', 4, 3, 0, 3), w('a4', 0, 3, 0, 0)];
    const roomB = [w('b1', 4, 0, 8, 0), w('b2', 8, 0, 8, 3), w('b3', 8, 3, 4, 3), w('b4l', 4, 3, 4, 2), w('b4r', 4, 1, 4, 0)];
    const doorInA = [w('a2l', 4, 0, 4, 1), w('a2r', 4, 2, 4, 3)];
    const s = spans([...roomA.filter((x) => x.id !== 'a2'), ...doorInA, ...roomB]);
    expect(s('a2l')).toEqual([]);
    expect(s('a2r')).toEqual([]);
    expect(s('b4l')).toHaveLength(1);
    expect(s('b4r')).toHaveLength(1);
  });

  it('walls that only touch end to end, or run parallel a little apart, are left alone', () => {
    expect(spans([w('l', 0, 0, 3, 0), w('r', 3, 0, 7, 0)])('l')).toEqual([{ from: -0.1, to: 3, capFrom: true, capTo: false }]);
    expect(spans([w('a', 0, 0, 5, 0), w('b', 0, 0.3, 5, 0.3)])('a')).toEqual([{ from: -0.1, to: 5.1, capFrom: true, capTo: true }]);
  });
});
