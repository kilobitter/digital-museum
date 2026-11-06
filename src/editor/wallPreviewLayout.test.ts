import { describe, expect, it } from 'vitest';
import { PREVIEW_H, PREVIEW_W, wallPreviewLayout } from './wallPreviewLayout';

const base = { wallHeight: 3, width: 1.2, height: 0.9, centerHeight: 1.5 };

describe('wallPreviewLayout', () => {
  it('keeps the proportions of wall and painting', () => {
    const l = wallPreviewLayout(base);
    const scale = (l.floor - l.wallTop) / 3;
    expect(l.painting.w).toBeCloseTo(1.2 * scale);
    expect(l.painting.h).toBeCloseTo(0.9 * scale);
  });

  it('puts the centre point at the centre height, in the middle of the painting', () => {
    const l = wallPreviewLayout({ ...base, centerHeight: 1 });
    const scale = (l.floor - l.wallTop) / 3;
    expect(l.center.y).toBeCloseTo(l.floor - 1 * scale);
    expect(l.center.y).toBeCloseTo(l.painting.y + l.painting.h / 2);
    expect(l.center.x).toBe(PREVIEW_W / 2);
    expect(l.painting.x + l.painting.w / 2).toBeCloseTo(PREVIEW_W / 2);
  });

  it('does not change the wall when the painting fits on it', () => {
    const a = wallPreviewLayout(base);
    const b = wallPreviewLayout({ ...base, width: 2, height: 2, centerHeight: 1.2 });
    expect(b.wallTop).toBeCloseTo(a.wallTop);
    expect(b.floor).toBeCloseTo(a.floor);
  });

  it('flags and keeps in view a painting above the wall top', () => {
    const l = wallPreviewLayout({ ...base, height: 2, centerHeight: 3 });
    expect(l.overflow).toBe(true);
    expect(l.painting.y).toBeLessThan(l.wallTop);
    expect(l.painting.y).toBeGreaterThanOrEqual(0);
  });

  it('flags and keeps in view a painting below the floor', () => {
    const l = wallPreviewLayout({ ...base, height: 2, centerHeight: 0.5 });
    expect(l.overflow).toBe(true);
    expect(l.painting.y + l.painting.h).toBeGreaterThan(l.floor);
    expect(l.painting.y + l.painting.h).toBeLessThanOrEqual(PREVIEW_H);
  });

  it('does not flag a painting that exactly reaches the wall top and the floor', () => {
    expect(wallPreviewLayout({ ...base, height: 3, centerHeight: 1.5 }).overflow).toBe(false);
  });

  it('shrinks everything to fit a very wide painting between the wall edges', () => {
    const l = wallPreviewLayout({ ...base, width: 20, height: 1 });
    expect(l.painting.x).toBeCloseTo(l.left);
    expect(l.painting.x + l.painting.w).toBeCloseTo(l.right);
    expect(l.overflow).toBe(false);
    expect(l.floor - l.wallTop).toBeCloseTo((3 / 20) * l.painting.w);
  });
});
