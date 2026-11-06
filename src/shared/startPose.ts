// Where the viewer starts when the address carries `?at=x,y,yaw` (plan metres, yaw in degrees as for the spawn).

export interface StartPose { x: number; y: number; yawDeg: number }

/** `at` from a location.search string. yawDeg is undefined when left out. Null when absent or malformed. */
export function parseAt(search: string): { x: number; y: number; yawDeg?: number } | null {
  const raw = new URLSearchParams(search).get('at');
  if (raw === null) return null;
  const parts = raw.split(',');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const nums = parts.map((p) => (p.trim() === '' ? NaN : Number(p)));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  return nums.length === 3 ? { x: nums[0], y: nums[1], yawDeg: nums[2] } : { x: nums[0], y: nums[1] };
}

const round = (n: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(n * k) / k + 0; // + 0 turns -0 into 0
};

/** Adds at=x,y,yaw to a preview URL that may already have a query. Rounds x, y to 2 decimals and yaw to 1. */
export function withStartPose(url: string, pose: StartPose): string {
  const at = `at=${round(pose.x, 2)},${round(pose.y, 2)},${round(pose.yawDeg, 1)}`;
  const hash = url.indexOf('#');
  const base = hash < 0 ? url : url.slice(0, hash);
  const tail = hash < 0 ? '' : url.slice(hash);
  return `${base}${base.includes('?') ? '&' : '?'}${at}${tail}`;
}
