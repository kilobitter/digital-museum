import { yawToRotationY } from '../shared/geometry';
import type { Vec2 } from '../shared/museum';

/**
 * Rig yaw correction (radians, three.js rotation.y convention) that makes a head facing
 * `headForward` (world x, z components, need not be normalised) face the spawn yaw.
 * Returns 0 when the head looks (almost) straight up/down and the heading is undefined.
 */
export function recentreCorrection(headForward: Vec2, spawnYawDeg: number): { dyaw: number } {
  const len = Math.hypot(headForward.x, headForward.y);
  if (len < 1e-3) return { dyaw: 0 };
  // forward = (-sin r, -cos r) in (x, z)  =>  r = atan2(-x, -z)
  const headYaw = Math.atan2(-headForward.x, -headForward.y);
  let d = yawToRotationY(spawnYawDeg) - headYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest turn
  return { dyaw: d };
}
