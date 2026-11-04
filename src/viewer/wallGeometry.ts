// Wall box geometry with world-scale UVs: one texture tile = `tileSize` metres on every face.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2, Wall } from '../shared/museum';
import { wallDirection } from '../shared/geometry';
import type { CeilingStep } from './surfaces';

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

/** One quad from four world corners; the winding is flipped when needed so it faces `normal`. */
function orientedQuad(corners: [number, number, number][], uvs: [number, number][], normal: [number, number, number]): THREE.BufferGeometry {
  const [p0, p1, p2] = corners.map((c) => new THREE.Vector3(...c));
  const geometric = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
  const order = geometric.dot(new THREE.Vector3(...normal)) >= 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const i of order) {
    pos.push(...corners[i]);
    nrm.push(...normal);
    uv.push(...uvs[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * Door header: the strip above a doorway between rooms of different height, drawn as a continuation of `wall`.
 * A vertical face (step.bottom..step.top) flush with the wall's face on the tall side (`step.normal`), plus a small
 * underside at step.bottom reaching back to the step line. World-space, merges with wall boxes. UVs continue the
 * wall box: u from the wall's own drawn range `drawn` (metres from `wall.a`), v = world height / tileSize.
 */
export function doorHeaderGeometry(
  step: CeilingStep,
  wall: Wall,
  thickness: number,
  tileSize: number,
  /** the wall's drawn range in metres along the wall from `a`: pieces[0].from and pieces[last].to */
  drawn: { lo: number; hi: number },
): THREE.BufferGeometry {
  const d = wallDirection(wall);
  const n = step.normal;
  const alongX = Math.abs(step.a.y - step.b.y) < Math.abs(step.a.x - step.b.x);
  const nAcross = alongX ? n.y : n.x;
  const lineAcross = alongX ? step.a.y : step.a.x; // the step line
  const faceAcross = (alongX ? wall.a.y : wall.a.x) + nAcross * thickness / 2; // the wall's face on the tall side
  const perp = { x: -d.y, y: d.x };
  const plusZ = n.x * perp.x + n.y * perp.y > 0;
  const uAt = (p: Vec2): number => {
    const t = (p.x - wall.a.x) * d.x + (p.y - wall.a.y) * d.y;
    return (plusZ ? t - drawn.lo : drawn.hi - t) / tileSize;
  };
  const at = (p: Vec2, across: number): Vec2 => (alongX ? { x: p.x, y: across } : { x: across, y: p.y });
  const ends = [step.a, step.b];
  const parts: THREE.BufferGeometry[] = [];

  const f0 = at(ends[0], faceAcross), f1 = at(ends[1], faceAcross);
  parts.push(orientedQuad(
    [[f0.x, step.bottom, f0.y], [f1.x, step.bottom, f1.y], [f1.x, step.top, f1.y], [f0.x, step.top, f0.y]],
    [[uAt(f0), step.bottom / tileSize], [uAt(f1), step.bottom / tileSize], [uAt(f1), step.top / tileSize], [uAt(f0), step.top / tileSize]],
    [n.x, 0, n.y],
  ));

  const depth = Math.abs(faceAcross - lineAcross);
  if (depth >= 1e-4) {
    const s0 = at(ends[0], lineAcross), s1 = at(ends[1], lineAcross);
    const v = depth / tileSize;
    parts.push(orientedQuad(
      [[f0.x, step.bottom, f0.y], [f1.x, step.bottom, f1.y], [s1.x, step.bottom, s1.y], [s0.x, step.bottom, s0.y]],
      [[uAt(f0), 0], [uAt(f1), 0], [uAt(f1), v], [uAt(f0), v]],
      [0, -1, 0],
    ));
  }
  if (parts.length === 1) return parts[0];
  const all = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return all;
}
