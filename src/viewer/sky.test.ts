import { describe, expect, it } from 'vitest';
import { gradientWeight, panoramaOffsetX, skyGeometry } from './sky';

describe('skyGeometry', () => {
  const g = skyGeometry();
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  const find = (u: number, v: number) => {
    for (let i = 0; i < p.count; i++) if (Math.abs(uv.getX(i) - u) < 1e-6 && Math.abs(uv.getY(i) - v) < 1e-6) return [p.getX(i), p.getY(i), p.getZ(i)];
    throw new Error('no vertex');
  };
  it('image centre (u 0.5, v 0.5) faces plan -y = world -z', () => {
    const [x, y, z] = find(0.5, 0.5);
    expect(Math.abs(x)).toBeLessThan(1e-3); expect(Math.abs(y)).toBeLessThan(1e-3); expect(z).toBeLessThan(0);
  });
  it('u increases clockwise seen from above (towards +x when facing -z), so the image is not mirrored', () => {
    expect(find(0.75, 0.5)[0]).toBeGreaterThan(0);
    expect(find(0.25, 0.5)[0]).toBeLessThan(0);
  });
  it('v = 1 is up', () => expect(find(0.5, 1)[1]).toBeGreaterThan(0));
});

describe('gradientWeight', () => {
  it('0 at the horizon, 1 at the poles, monotone', () => {
    expect(gradientWeight(0)).toBe(0);
    expect(gradientWeight(1)).toBeCloseTo(1);
    expect(gradientWeight(-1)).toBeCloseTo(1);
    let last = -1;
    for (let s = 0; s <= 1; s += 0.05) { const w = gradientWeight(s); expect(w).toBeGreaterThanOrEqual(last); last = w; }
  });
});

describe('panoramaOffsetX', () => {
  it('rotating clockwise by r shifts the sampled u by -r/360', () => {
    expect(panoramaOffsetX(90)).toBeCloseTo(-0.25);
    expect(panoramaOffsetX(0)).toBeCloseTo(0);
  });
});
