import { describe, expect, it } from 'vitest';
import { isDuplicate, runPool, summarizeUpload } from './uploadQueue';

describe('runPool', () => {
  it('limits concurrency, keeps order, collects errors and reports progress', async () => {
    let active = 0, peak = 0;
    const progress: number[] = [];
    const res = await runPool(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (n === 4) throw new Error('boom');
        return n * 2;
      },
      (d, t) => progress.push(d * 100 + t),
    );
    expect(peak).toBe(3);
    expect(res.map((r) => (r.ok ? r.value : 'err'))).toEqual([2, 4, 6, 'err', 10, 12, 14]);
    expect(progress.length).toBe(7);
    expect(progress[6]).toBe(707);
  });
  it('handles an empty list', async () => {
    expect(await runPool([], 3, async () => 1)).toEqual([]);
  });
});

describe('isDuplicate', () => {
  const lib = [{ name: 'a.jpg', file: 'media/a.jpg' }, { name: 'b.jpg', file: 'media/b.jpg' }];
  it('same name + same known size: skip', () => {
    expect(isDuplicate(lib, { 'media/a.jpg': 100 }, { name: 'a.jpg', size: 100 })).toBe(true);
  });
  it('same name, different known size: upload', () => {
    expect(isDuplicate(lib, { 'media/a.jpg': 100 }, { name: 'a.jpg', size: 101 })).toBe(false);
  });
  it('same name, unknown size: upload', () => {
    expect(isDuplicate(lib, {}, { name: 'b.jpg', size: 5 })).toBe(false);
  });
  it('different name: upload', () => {
    expect(isDuplicate(lib, { 'media/a.jpg': 5 }, { name: 'c.jpg', size: 5 })).toBe(false);
  });
  it('in-batch twins: identical name+size skips the second, different size uploads both', () => {
    const known = [...lib];
    const sizes: Record<string, number> = {};
    const accept = (f: { name: string; size: number }) => {
      if (isDuplicate(known, sizes, f)) return false;
      const key = `pending:${f.name}:${f.size}`;
      known.push({ name: f.name, file: key });
      sizes[key] = f.size;
      return true;
    };
    expect([accept({ name: 'IMG_1.jpg', size: 10 }), accept({ name: 'IMG_1.jpg', size: 10 }), accept({ name: 'IMG_1.jpg', size: 11 })]).toEqual([true, false, true]);
  });
});

describe('summarizeUpload', () => {
  it('summarises and truncates', () => {
    expect(summarizeUpload(3, [], [])).toBe('3 uploaded');
    const s = summarizeUpload(1, ['a', 'b', 'c', 'd', 'e', 'f'], ['x: bad']);
    expect(s).toContain('6 already in library (a; b; c; d; and 2 more)');
    expect(s).toContain('1 failed: x: bad');
  });
});
