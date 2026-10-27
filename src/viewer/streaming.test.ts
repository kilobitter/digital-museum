import { describe, expect, it } from 'vitest';
import { planStreaming, planByDistance, type StreamLimits } from './streaming';

const L: StreamLimits = { loadRadius: 15, unloadRadius: 20, maxResident: 5, maxConcurrent: 3 };
const at = (id: string, x: number) => ({ id, x, y: 0 });
const none = new Set<string>();
const head = { x: 0, y: 0 };

describe('planStreaming', () => {
  it('loads items inside the load radius nearest first, limited by concurrency', () => {
    const items = [at('far', 30), at('c', 12), at('a', 2), at('b', 7), at('d', 14)];
    const p = planStreaming(head, items, none, none, L);
    expect(p.load).toEqual(['a', 'b', 'c']);
    expect(p.unload).toEqual([]);
  });

  it('counts in-flight loads against the concurrency slots', () => {
    const items = [at('a', 2), at('b', 3), at('c', 4)];
    const p = planStreaming(head, items, none, new Set(['x1', 'x2']), L);
    expect(p.load).toEqual(['a']);
  });

  it('hysteresis: resident items between load and unload radius stay; beyond unload they go', () => {
    const items = [at('mid', 17), at('out', 21), at('newMid', 17.5)];
    const p = planStreaming(head, items, new Set(['mid', 'out']), none, L);
    expect(p.unload).toEqual(['out']);
    expect(p.load).toEqual([]); // newMid is outside the load radius
  });

  it('cancels in-flight requests that drift beyond the unload radius', () => {
    const p = planStreaming(head, [at('a', 25)], none, new Set(['a']), L);
    expect(p.unload).toEqual(['a']);
  });

  it('hard cap evicts the farthest resident items, never loads over the cap', () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map((n) => at('i' + n, n * 2.5));
    const resident = new Set(['i4', 'i5', 'i6', 'i7']);
    const p = planStreaming(head, items, resident, none, { ...L, maxConcurrent: 10 });
    // nearest 5 of (resident + wanted within 15 m): i1..i5 -> i6,i7 evicted, i1..i3 loaded
    expect(p.unload).toEqual(['i7', 'i6']);
    expect(p.load).toEqual(['i1', 'i2', 'i3']);
  });

  it('does not thrash when everything fits', () => {
    const items = [at('a', 3), at('b', 16)];
    const p = planStreaming(head, items, new Set(['a', 'b']), none, L);
    expect(p).toEqual({ load: [], unload: [] });
  });

  it('planByDistance works with precomputed distances (audio zones)', () => {
    const p = planByDistance([{ id: 'z', dist: 9 }, { id: 'y', dist: 11 }], none, none, { loadRadius: 10, unloadRadius: 15, maxResident: 8, maxConcurrent: 2 });
    expect(p.load).toEqual(['z']);
  });
});
