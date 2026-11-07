import { describe, expect, it } from 'vitest';
import type { Museum } from '../shared/museum';
import { defaultMuseum } from '../shared/validate';
import { hitTest, workSegment, worksAt } from './hit';
import { addMedia, addRoom, hangWork } from './model';

/** A room with works on its first wall, given as [t along the wall, centre height]. */
function room(works: [number, number][]): { m: Museum; ids: string[] } {
  const img = addMedia(defaultMuseum(), { kind: 'image', file: 'media/a.png', name: 'a', width: 1000, height: 500 });
  const r = addRoom(img.museum, { x: 0, y: 0 }, { x: 8, y: 6 })!;
  let m = r.museum;
  const ids: string[] = [];
  for (const [t, centerHeight] of works) {
    const h = hangWork(m, img.id, { wallId: r.ids[0], side: 1, t, point: { x: t, y: 0 } })!;
    m = { ...h.museum, works: h.museum.works.map((w) => (w.id === h.id ? { ...w, t, width: 1, centerHeight } : w)) };
    ids.push(h.id);
  }
  return { m, ids };
}

const TOL = 0.1;

describe('worksAt', () => {
  it('lists every work on the spot, highest first, whatever order they were hung in', () => {
    const { m, ids } = room([[3, 1], [3, 2.2], [3, 1.6]]);
    const p = workSegment(m, ids[0])!.centre;
    expect(worksAt(m, p, TOL)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it('has a stable order for works at the same height', () => {
    const { m, ids } = room([[3, 1.5], [3, 1.5]]);
    const p = workSegment(m, ids[0])!.centre;
    expect(worksAt(m, p, TOL)).toEqual([...ids].sort());
  });

  it('leaves out works further along the wall, and is empty away from any work', () => {
    const { m, ids } = room([[2, 1.5], [6, 1.5]]);
    expect(worksAt(m, workSegment(m, ids[0])!.centre, TOL)).toEqual([ids[0]]);
    expect(worksAt(m, { x: 4, y: 3 }, TOL)).toEqual([]);
  });

  it('counts paintings that overlap only in part when the click is on both', () => {
    const { m, ids } = room([[3, 1.5], [3.6, 1.5]]);
    const s = workSegment(m, ids[0])!;
    const d = workSegment(m, ids[1])!.centre.x > s.centre.x ? 1 : -1;
    expect(worksAt(m, { x: s.centre.x + d * 0.3, y: s.centre.y }, TOL).sort()).toEqual([...ids].sort());
    expect(worksAt(m, { x: s.centre.x - d * 0.4, y: s.centre.y }, TOL)).toEqual([ids[0]]);
  });

  it('agrees with hitTest: whatever hitTest picks is in the list', () => {
    const { m, ids } = room([[3, 1], [3, 2]]);
    const p = workSegment(m, ids[0])!.centre;
    const hit = hitTest(m, p, TOL, null);
    expect(hit?.type).toBe('work');
    expect(worksAt(m, p, TOL)).toContain((hit as { id: string }).id);
  });
});
