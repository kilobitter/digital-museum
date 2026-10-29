import { describe, expect, it } from 'vitest';
import type { Wall } from '../shared/museum';
import { wallEnds } from './wallJoints';

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
});
