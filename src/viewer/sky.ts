// Sky dome: a large inward-facing sphere that follows the camera's position (so it behaves as if at infinity)
// and ignores lights and depth. It is ordinary geometry, so it renders correctly for both eyes in WebXR.
import * as THREE from 'three';
import type { Museum, Sky } from '../shared/museum';
import { defaultSky } from '../shared/validate';
import { loadTexture } from './textures';

export const MAX_PANORAMA = 4096;
const SKY_RADIUS = 150; // inside the camera far plane (200)
const SEGMENTS = 96; // around
const RINGS = 64; // pole to pole

/**
 * Sphere with equirectangular UVs. Vertex direction: azimuth psi (clockwise seen from above, 0 = plan -y = world -z)
 * and elevation phi. u = 0.5 + psi / 2pi (so the image centre faces plan -y and the image is not mirrored seen
 * from inside), v = 0.5 + phi / pi. Optional per-vertex colour from `colorAt(elevation in -1..1)`.
 */
export function skyGeometry(colorAt?: (sinPhi: number) => THREE.Color): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const phi = -Math.PI / 2 + (Math.PI * i) / RINGS;
    const c = colorAt?.(Math.sin(phi));
    for (let j = 0; j <= SEGMENTS; j++) {
      const psi = -Math.PI + (2 * Math.PI * j) / SEGMENTS;
      pos.push(SKY_RADIUS * Math.sin(psi) * Math.cos(phi), SKY_RADIUS * Math.sin(phi), -SKY_RADIUS * Math.cos(psi) * Math.cos(phi));
      uv.push(j / SEGMENTS, i / RINGS);
      if (c) col.push(c.r, c.g, c.b);
    }
  }
  const row = SEGMENTS + 1;
  for (let i = 0; i < RINGS; i++)
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Gradient weight toward the top/bottom colour for sin(elevation) in -1..1: 0 at the horizon, 1 at the pole. */
export function gradientWeight(sinPhi: number): number {
  const t = Math.min(1, Math.abs(sinPhi));
  const s = Math.pow(t, 0.6); // the colour leaves the horizon colour quickly, like a real sky
  return s * s * (3 - 2 * s);
}

/** Texture offset that turns an equirect image clockwise (seen from above) by `rotationDeg`. */
export const panoramaOffsetX = (rotationDeg: number): number => -rotationDeg / 360;

export interface SkyDome {
  mesh: THREE.Mesh;
  /** Keep the dome centred on the viewer. Call once per frame before rendering. */
  follow(camera: THREE.Camera): void;
}

const tmp = new THREE.Vector3();
function dome(mesh: THREE.Mesh): SkyDome {
  mesh.name = 'sky';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return {
    mesh,
    follow(camera) {
      camera.getWorldPosition(tmp);
      mesh.position.copy(tmp);
    },
  };
}

function gradientDome(sky: Extract<Sky, { kind: 'gradient' }>): SkyDome {
  const top = new THREE.Color(sky.top), horizon = new THREE.Color(sky.horizon), bottom = new THREE.Color(sky.bottom);
  const geo = skyGeometry((s) => new THREE.Color().lerpColors(horizon, s >= 0 ? top : bottom, gradientWeight(s)));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: false, depthTest: false });
  return dome(new THREE.Mesh(geo, mat));
}

/** Builds the sky for a museum. A missing/unloadable panorama falls back to the default gradient and adds a warning. */
export async function buildSky(museum: Museum, urlFor: (file: string) => string, anisotropy: number, warnings: string[]): Promise<SkyDome> {
  const sky = museum.settings.sky;
  if (sky.kind === 'gradient') return gradientDome(sky);
  const media = museum.media.find((m) => m.id === sky.textureId);
  try {
    if (!media || media.kind !== 'panorama') throw new Error('no such panorama');
    const tex = await loadTexture(urlFor(media.file), anisotropy, MAX_PANORAMA);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.offset.x = panoramaOffsetX(sky.rotationDeg);
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: false, depthWrite: false, depthTest: false });
    return dome(new THREE.Mesh(skyGeometry(), mat));
  } catch (e) {
    const msg = `sky panorama '${media?.file ?? sky.textureId}' could not be loaded: ${String(e)}`;
    console.warn('[museum]', msg);
    warnings.push(msg);
    return gradientDome(defaultSky() as Extract<Sky, { kind: 'gradient' }>);
  }
}
