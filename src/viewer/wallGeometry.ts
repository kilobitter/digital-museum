// Wall box geometry with world-scale UVs: one texture tile = `tileSize` metres on every face.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A box of `length` x `height` x `thickness` (centred on the origin) whose UVs are in tiles:
 * uv = metres / tileSize, so textures are never stretched on the long faces, the ends or the top.
 * Opposite faces are mirrored so a texture reads the right way round from outside each face.
 */
export function wallGeometry(
  length: number,
  height: number,
  thickness: number,
  tileSize: number,
  caps: { start: boolean; end: boolean } = { start: true, end: true },
  /** metres added to u on the front (+z) and top faces and on the back face, so pieces of one wall tile on seamlessly */
  uOffset: { front: number; back: number } = { front: 0, back: 0 },
  /** partial end faces: world height (box bottom is 0) at which a face starts, running up to the top of the box */
  steps: { start?: number | null; end?: number | null } = {},
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(length, height, thickness);
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const hx = length / 2, hy = height / 2, hz = thickness / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + hx, y = pos.getY(i) + hy, z = pos.getZ(i) + hz; // 0..size
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    let u: number, v: number;
    if (Math.abs(nx) > 0.5) { u = nx > 0 ? thickness - z : z; v = y; } // end faces
    else if (Math.abs(ny) > 0.5) { u = x + uOffset.front; v = ny > 0 ? z : thickness - z; } // top / bottom
    else { u = nz > 0 ? x + uOffset.front : length - x + uOffset.back; v = y; } // long faces
    uv.setXY(i, u / tileSize, v / tileSize);
  }
  uv.needsUpdate = true;
  const extra: THREE.BufferGeometry[] = [];
  for (const [which, from] of [['start', steps.start], ['end', steps.end]] as const) {
    if (from === null || from === undefined || !(from < height)) continue;
    extra.push(endStepFace(which === 'end' ? 1 : -1, Math.max(from, 0), length, height, thickness, tileSize));
  }
  const body = trimCaps(geo, caps);
  if (!extra.length) return body;
  const all = mergeGeometries([body, ...extra], false);
  body.dispose();
  for (const x of extra) x.dispose();
  return all;
}

/** Face at the +x (sign 1) or -x end of the box, from world height `from` up to `height`, facing outward. */
function endStepFace(sign: 1 | -1, from: number, length: number, height: number, thickness: number, tileSize: number): THREE.BufferGeometry {
  const x = (sign * length) / 2, hz = thickness / 2, hy = height / 2;
  const y0 = from - hy, y1 = hy;
  // counter-clockwise seen from outside; for +x: (y0,z0) (y1,z0) (y1,z1) (y0,z1)
  const zs: [number, number, number][] = [[y0, -hz, 0], [y1, -hz, 0], [y1, hz, 0], [y0, hz, 0]];
  const order = sign === 1 ? [0, 1, 2, 3] : [3, 2, 1, 0];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const k of order) {
    const [y, z] = zs[k];
    pos.push(x, y, z);
    nrm.push(sign, 0, 0);
    const lz = z + hz; // 0..thickness, as in the box's end faces
    uv.push((sign > 0 ? thickness - lz : lz) / tileSize, (y + hy) / tileSize);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function trimCaps(geo: THREE.BufferGeometry, caps: { start: boolean; end: boolean }): THREE.BufferGeometry {
  if (caps.start && caps.end) return geo;
  // BoxGeometry groups: 0 = +x face (end), 1 = -x face (start), then ±y, ±z. Drop the end faces not wanted.
  const index = geo.getIndex()!;
  const keep: number[] = [];
  geo.groups.forEach((g, i) => {
    if ((i === 0 && !caps.end) || (i === 1 && !caps.start)) return;
    for (let k = g.start; k < g.start + g.count; k++) keep.push(index.getX(k));
  });
  geo.setIndex(keep);
  geo.clearGroups();
  return geo;
}

/**
 * Per-vertex colours for a vertical gradient on a wall box centred on the origin: local y = -height/2 (the floor) gets
 * `bottomHex`; the colour reaches `topHex` at `gradientHeight` above the floor (default: the box top), linear in between. Colours are
 * converted like three.js converts material colours (sRGB hex -> linear working space), so a gradient whose
 * ends are equal matches the plain-colour wall. Call before the geometry is moved into world space.
 */
export function applyWallGradient(geo: THREE.BufferGeometry, height: number, bottomHex: string, topHex: string, gradientHeight: number = height): void {
  const bottom = new THREE.Color(bottomHex), top = new THREE.Color(topHex);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) + height / 2) / gradientHeight));
    c.lerpColors(bottom, top, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
