// Builds the static museum geometry: floor, ceiling, walls (merged per material), frames and
// neutral placeholder panels (merged into one mesh each). Paintings are streamed in by PaintingStreamer.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wallDirection, wallLength, workPlacement } from '../shared/geometry';
import type { MediaItem, Museum, WallFinish } from '../shared/museum';
import { computeFloorBounds, type Bounds } from './collision';
import { MAX_WALL_TEXTURE, loadTexture } from './textures';
import { wallGeometry } from './wallGeometry';

export const FRAME_DEPTH = 0.01; // frame back is flush with the wall face
export const WORK_OFFSET = FRAME_DEPTH + 0.002; // image/label sit clearly in front of the frame front (~1.2 cm off the wall)
const PANEL_OFFSET = FRAME_DEPTH + 0.0005; // neutral panel, just behind the image
const FLOOR_MARGIN = 2;

/** Everything the streamer needs to show one work. */
export interface PaintingSlot {
  id: string;
  media: MediaItem;
  /** Displayed size, metres. */
  w: number;
  h: number;
  /** World position of the work centre and rotation.y of its plane (faces +z locally). */
  position: THREE.Vector3;
  rotationY: number;
  /** Plan coordinates of the centre (for distance tests). */
  x: number;
  y: number;
}

export interface BuiltScene {
  group: THREE.Group;
  bounds: Bounds;
  warnings: string[];
  slots: PaintingSlot[];
}

/** Wall finish in effect for a wall: its own, else the museum default. */
export const effectiveFinish = (museum: Museum, wall: { finish?: WallFinish }): WallFinish => wall.finish ?? museum.settings.wallFinish;

/** Distinct texture media ids that walls actually use. */
export function usedTextureIds(museum: Museum): string[] {
  const ids = new Set<string>();
  for (const w of museum.walls) {
    const t = effectiveFinish(museum, w).textureId;
    if (t) ids.add(t);
  }
  return [...ids];
}

function merged(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  const g = mergeGeometries(geos, false);
  for (const x of geos) x.dispose();
  return g;
}

export async function buildMuseumScene(
  museum: Museum,
  urlFor: (file: string) => string,
  anisotropy: number,
  onProgress?: () => void,
): Promise<BuiltScene> {
  const warnings: string[] = [];
  const group = new THREE.Group();
  group.name = 'museum';
  const { wallHeight: H, wallThickness: T } = museum.settings;
  const bounds = computeFloorBounds(museum, FLOOR_MARGIN);
  const bw = bounds.maxX - bounds.minX;
  const bd = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minY + bounds.maxY) / 2;

  // lights (no shadows)
  group.add(new THREE.HemisphereLight(0xffffff, 0xcfcfd4, 1.6));
  group.add(new THREE.AmbientLight(0xffffff, 0.5));

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), new THREE.MeshLambertMaterial({ color: 0xe6e3dd }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  group.add(floor);

  if (museum.settings.ceiling) {
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    ceil.rotation.x = Math.PI / 2; // faces down
    ceil.position.set(cx, H, cz);
    group.add(ceil);
  }

  // Wall textures: loaded once per media item; a failed one falls back to the plain colour.
  const mediaById = new Map(museum.media.map((m) => [m.id, m]));
  const wallTextures = new Map<string, THREE.Texture | null>();
  await Promise.all(
    usedTextureIds(museum).map(async (id) => {
      const media = mediaById.get(id);
      try {
        if (!media || media.kind !== 'texture') throw new Error('no such texture');
        wallTextures.set(id, await loadTexture(urlFor(media.file), anisotropy, MAX_WALL_TEXTURE, true));
      } catch (e) {
        const msg = `wall texture '${media?.file ?? id}' could not be loaded: ${String(e)}`;
        console.warn('[museum]', msg);
        warnings.push(msg);
        wallTextures.set(id, null);
      } finally {
        onProgress?.();
      }
    }),
  );

  // Walls: one merged mesh per material (identical texture + colour); tileSize lives in the UVs.
  const wallMats = new Map<string, { mat: THREE.MeshLambertMaterial; geos: THREE.BufferGeometry[] }>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const w of museum.walls) {
    const len = wallLength(w);
    const d = wallDirection(w);
    const f = effectiveFinish(museum, w);
    const tex = f.textureId ? wallTextures.get(f.textureId) ?? null : null;
    const key = `${tex ? f.textureId : ''}|${f.color.toLowerCase()}`;
    let entry = wallMats.get(key);
    if (!entry) {
      entry = { mat: new THREE.MeshLambertMaterial({ color: new THREE.Color(f.color), map: tex }), geos: [] };
      wallMats.set(key, entry);
    }
    // +T so corner joints have no notch (walls are centred on their segment)
    const geo = wallGeometry(len + T, H, T, f.tileSize);
    q.setFromAxisAngle(up, -Math.atan2(d.y, d.x));
    m4.compose(new THREE.Vector3((w.a.x + w.b.x) / 2, H / 2, (w.a.y + w.b.y) / 2), q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m4);
    entry.geos.push(geo);
  }
  for (const { mat, geos } of wallMats.values()) {
    const g = merged(geos);
    if (g) group.add(new THREE.Mesh(g, mat));
  }

  // Frames and placeholder panels of every work: one mesh each, always visible.
  const wallById = new Map(museum.walls.map((w) => [w.id, w]));
  const slots: PaintingSlot[] = [];
  const frameGeos: THREE.BufferGeometry[] = [];
  const panelGeos: THREE.BufferGeometry[] = [];
  const one = new THREE.Vector3(1, 1, 1);
  for (const work of museum.works) {
    const wall = wallById.get(work.wallId);
    const media = mediaById.get(work.mediaId);
    if (!wall || !media) continue;
    const aspect = (media.width ?? 1) / (media.height ?? 1);
    const w = work.width;
    const h = w / aspect;
    const { center, normal } = workPlacement(wall, work, T);
    const rotationY = Math.atan2(normal.x, normal.y); // plane faces +z by default
    const position = new THREE.Vector3(center.x, work.centerHeight, center.y);
    q.setFromAxisAngle(up, rotationY);
    m4.compose(position, q, one);
    const frame = new THREE.BoxGeometry(w + 0.04, h + 0.04, FRAME_DEPTH);
    frame.translate(0, 0, FRAME_DEPTH / 2);
    frame.applyMatrix4(m4);
    frameGeos.push(frame);
    const panel = new THREE.PlaneGeometry(w, h);
    panel.translate(0, 0, PANEL_OFFSET);
    panel.applyMatrix4(m4);
    panelGeos.push(panel);
    slots.push({ id: work.id, media, w, h, position, rotationY, x: center.x, y: center.y });
  }
  const frames = merged(frameGeos);
  if (frames) group.add(new THREE.Mesh(frames, new THREE.MeshBasicMaterial({ color: 0x1a1a1a })));
  const panels = merged(panelGeos);
  if (panels) group.add(new THREE.Mesh(panels, new THREE.MeshBasicMaterial({ color: 0xd9d9d9 })));

  return { group, bounds, warnings, slots };
}
