// Wall box geometry with world-scale UVs: one texture tile = `tileSize` metres on every face.
import * as THREE from 'three';

/**
 * A box of `length` x `height` x `thickness` (centred on the origin) whose UVs are in tiles:
 * uv = metres / tileSize, so textures are never stretched on the long faces, the ends or the top.
 * Opposite faces are mirrored so a texture reads the right way round from outside each face.
 */
export function wallGeometry(length: number, height: number, thickness: number, tileSize: number): THREE.BoxGeometry {
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
    else if (Math.abs(ny) > 0.5) { u = x; v = ny > 0 ? z : thickness - z; } // top / bottom
    else { u = nz > 0 ? x : length - x; v = y; } // long faces
    uv.setXY(i, u / tileSize, v / tileSize);
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Per-vertex colours for a vertical gradient on a wall box centred on the origin: local y = -height/2 gets
 * `bottomHex`, y = +height/2 gets `topHex` (so the top cap is the top colour), linear in between. Colours are
 * converted like three.js converts material colours (sRGB hex -> linear working space), so a gradient whose
 * ends are equal matches the plain-colour wall. Call before the geometry is moved into world space.
 */
export function applyWallGradient(geo: THREE.BufferGeometry, height: number, bottomHex: string, topHex: string): void {
  const bottom = new THREE.Color(bottomHex), top = new THREE.Color(topHex);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / height + 0.5));
    c.lerpColors(bottom, top, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
