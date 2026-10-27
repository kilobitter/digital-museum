import { describe, expect, it } from 'vitest';
import type { Museum } from '../shared/museum';
import { defaultMuseum } from '../shared/validate';
import { countLabel, filterPaintings, paintingCounts, visibleWindow } from './libraryFilter';

const img = (id: string, name: string, title = '', artist = '') => ({ id, kind: 'image' as const, file: `media/${id}.jpg`, name, width: 10, height: 10, title, artist });
const m: Museum = {
  ...defaultMuseum(),
  media: [img('a', 'IMG_001.jpg', 'Sunrise', 'Monet'), img('b', 'wave.jpg', 'The Wave', 'Hokusai'), img('c', 'x.jpg', 'Poppies', 'Monet'),
    { id: 't', kind: 'texture', file: 'media/t.jpg', name: 'plaster.jpg', width: 4, height: 4 }, { id: 'au', kind: 'audio', file: 'media/au.mp3', name: 'monet.mp3' }],
  walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }],
  works: [{ id: 'k', mediaId: 'a', wallId: 'w', side: 1, t: 2, centerHeight: 1.5, width: 1 }],
};

describe('library filter', () => {
  it('searches title, artist and filename, only paintings', () => {
    expect(filterPaintings(m, 'monet', 'all').map((x) => x.id)).toEqual(['a', 'c']);
    expect(filterPaintings(m, 'img_00', 'all').map((x) => x.id)).toEqual(['a']);
    expect(filterPaintings(m, 'the wave', 'all').map((x) => x.id)).toEqual(['b']);
    expect(filterPaintings(m, 'plaster', 'all')).toEqual([]);
  });
  it('filters hung / unhung', () => {
    expect(filterPaintings(m, '', 'hung').map((x) => x.id)).toEqual(['a']);
    expect(filterPaintings(m, '', 'unhung').map((x) => x.id)).toEqual(['b', 'c']);
    expect(filterPaintings(m, 'monet', 'unhung').map((x) => x.id)).toEqual(['c']);
  });
  it('counts', () => {
    expect(paintingCounts(m)).toEqual({ total: 3, unhung: 2 });
    expect(countLabel({ total: 312, unhung: 120 })).toBe('312 paintings · 120 unhung');
    expect(countLabel({ total: 1, unhung: 0 })).toBe('1 painting · 0 unhung');
  });
});

describe('visibleWindow', () => {
  it('returns a bounded slice', () => {
    expect(visibleWindow(0, 800, 100, 500, 2)).toEqual([0, 10]);
    expect(visibleWindow(5000, 800, 100, 500, 2)).toEqual([48, 60]);
    expect(visibleWindow(99999, 800, 100, 500, 2)[1]).toBe(500);
    expect(visibleWindow(0, 800, 100, 0)).toEqual([0, 0]);
  });
});
