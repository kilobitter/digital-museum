// Builds the static museum geometry: floor, ceiling, walls, framed works and labels.
import * as THREE from 'three';
import { wallDirection, wallLength, workPlacement } from '../shared/geometry';
import type { MediaItem, Museum, WallFinish } from '../shared/museum';
import { computeFloorBounds, type Bounds } from './collision';
import { wallGeometry } from './wallGeometry';

const MAX_TEXTURE = 2048; // paintings
const MAX_WALL_TEXTURE = 1024; // wall textures (tiled, so smaller is fine)
const FRAME_DEPTH = 0.01; // frame back is flush with the wall face
const WORK_OFFSET = FRAME_DEPTH + 0.002; // image/label sit clearly in front of the frame front (~1.2 cm off the wall)
const FLOOR_MARGIN = 2;

export interface BuiltScene {
  group: THREE.Group;
  bounds: Bounds;
  warnings: string[];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
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

/** Load an image as a texture, downscaled so no side exceeds `max`. Mipmaps on. */
async function loadTexture(url: string, anisotropy: number, max = MAX_TEXTURE, repeat = false): Promise<THREE.Texture> {
  const img = await loadImage(url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('image has no size');
  let source: TexImageSource = img;
  const scale = Math.min(1, max / Math.max(w, h));
  if (scale < 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    source = c;
  }
  const tex = new THREE.Texture(source as HTMLImageElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function placeholderTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#999'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 256); g.moveTo(256, 0); g.lineTo(0, 256); g.stroke();
  g.fillStyle = '#666'; g.font = '24px sans-serif'; g.textAlign = 'center';
  g.fillText('image missing', 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

const LABEL_W = 0.5; // metres
const LABEL_H = 0.3;

function labelTexture(media: MediaItem, anisotropy: number): THREE.CanvasTexture {
  const W = 512;
  const H = Math.round((W * LABEL_H) / LABEL_W);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#222';
  g.textBaseline = 'alphabetic';
  const out: { text: string; font: string; color: string; lh: number }[] = [];
  const add = (text: string, font: string, color: string, lh: number, maxLines: number) => {
    if (!text) return;
    g.font = font;
    const ls = wrap(g, text, W - 16);
    for (const l of ls.slice(0, maxLines)) out.push({ text: l, font, color, lh });
  };
  add(media.title ?? '', '600 40px system-ui, sans-serif', '#111', 48, 2);
  add(media.artist ?? '', '32px system-ui, sans-serif', '#444', 40, 1);
  add(media.description ?? '', '26px system-ui, sans-serif', '#666', 32, 4);
  // bottom-anchored so the label hugs the bottom edge of the work
  let y = H - 8 - out.reduce((s, l) => s + l.lh, 0);
  y = Math.max(y, 0);
  for (const l of out) {
    y += l.lh;
    g.font = l.font; g.fillStyle = l.color;
    g.fillText(l.text, 8, y - l.lh * 0.25, W - 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
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

  // Walls with an identical finish (texture + colour) share one material; tileSize lives in the UVs.
  const wallMats = new Map<string, THREE.MeshLambertMaterial>();
  const wallMaterial = (f: WallFinish) => {
    const tex = f.textureId ? wallTextures.get(f.textureId) ?? null : null;
    const key = `${tex ? f.textureId : ''}|${f.color.toLowerCase()}`;
    let m = wallMats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: new THREE.Color(f.color), map: tex });
      wallMats.set(key, m);
    }
    return m;
  };
  for (const w of museum.walls) {
    const len = wallLength(w);
    const d = wallDirection(w);
    const f = effectiveFinish(museum, w);
    // +T so corner joints have no notch (walls are centred on their segment)
    const mesh = new THREE.Mesh(wallGeometry(len + T, H, T, f.tileSize), wallMaterial(f));
    mesh.position.set((w.a.x + w.b.x) / 2, H / 2, (w.a.y + w.b.y) / 2);
    mesh.rotation.y = -Math.atan2(d.y, d.x);
    group.add(mesh);
  }

  const frameMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const wallById = new Map(museum.walls.map((w) => [w.id, w]));
  let placeholder: THREE.Texture | null = null;

  await Promise.all(
    museum.works.map(async (work) => {
      const wall = wallById.get(work.wallId);
      const media = mediaById.get(work.mediaId);
      if (!wall || !media) { onProgress?.(); return; }
      const aspect = (media.width ?? 1) / (media.height ?? 1);
      const w = work.width;
      const h = w / aspect;

      let tex: THREE.Texture;
      try {
        tex = await loadTexture(urlFor(media.file), anisotropy);
      } catch (e) {
        const msg = `image '${media.file}' for work '${media.title || work.id}' could not be loaded: ${String(e)}`;
        console.warn('[museum]', msg);
        warnings.push(msg);
        tex = placeholder ??= placeholderTexture();
      }

      const { center, normal } = workPlacement(wall, work, T);
      const g = new THREE.Group();
      g.position.set(center.x, work.centerHeight, center.y);
      g.rotation.y = Math.atan2(normal.x, normal.y); // plane faces +z by default
      const img = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
      img.position.z = WORK_OFFSET;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, FRAME_DEPTH), frameMat);
      frame.position.z = FRAME_DEPTH / 2;
      g.add(frame, img);

      if (media.title || media.artist || media.description) {
        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(LABEL_W, LABEL_H),
          new THREE.MeshBasicMaterial({ map: labelTexture(media, anisotropy), transparent: true }),
        );
        // local +x is the viewer's right while facing the wall (plane faces +z)
        label.position.set(w / 2 + 0.1 + LABEL_W / 2, -h / 2 + LABEL_H / 2, WORK_OFFSET);
        g.add(label);
      }
      group.add(g);
      onProgress?.();
    }),
  );

  return { group, bounds, warnings };
}
