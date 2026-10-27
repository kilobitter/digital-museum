import { describe, expect, it } from 'vitest';
import { recentreCorrection } from './recentre';

// head heading as a rotation.y value r: forward = (-sin r, -cos r)
const fwd = (r: number) => ({ x: -Math.sin(r), y: -Math.cos(r) });

describe('recentreCorrection', () => {
  it('is 0 when already facing the spawn yaw', () => {
    expect(recentreCorrection(fwd(0), 0).dyaw).toBeCloseTo(0);
    expect(recentreCorrection(fwd(-Math.PI / 2), 90).dyaw).toBeCloseTo(0);
  });
  it('turns the head to the spawn heading; result heading matches', () => {
    for (const headR of [0.7, -2, 3]) {
      for (const yaw of [0, 90, 180, -45]) {
        const { dyaw } = recentreCorrection(fwd(headR), yaw);
        const final = headR + dyaw;
        const want = (-yaw * Math.PI) / 180;
        expect(Math.cos(final - want)).toBeCloseTo(1);
        expect(Math.abs(dyaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });
  it('is 0 for a vertical gaze and unnormalised vectors work', () => {
    expect(recentreCorrection({ x: 0, y: 0 }, 90).dyaw).toBe(0);
    expect(recentreCorrection({ x: 0, y: -5 }, 0).dyaw).toBeCloseTo(0);
  });
});
