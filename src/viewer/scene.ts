// Builds the static museum geometry: floor, ceiling, walls (merged per material) and frames
// (merged into one mesh). Paintings are streamed in by PaintingStreamer.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wallDirection, workPlacement } from '../shared/geometry';
import type { Finish, MediaItem, Museum, Wall, WallFinish } from '../shared/museum';
import { computeFloorBounds, type Bounds } from './collision';
import { MAX_WALL_TEXTURE, loadTexture } from './textures';
import { areaQuads, decomposeCeiling, type CeilingStep, finishKey, neededTextureIds, stepQuad, surfaceQuad, uncoveredSteps, wallFinishKey } from './surfaces';
import { buildSky, type SkyDome } from './sky';
import { applyWallGradient, doorHeaderGeometry, wallGeometry } from './wallGeometry';
import { wallEnds, wallPieces, wallSpans } from './wallJoints';
import { wallHeightProfile } from '../shared/roomHeights';

export const FRAME_DEPTH = 0.01; // frame back is flush with the wall face
export const WORK_OFFSET = FRAME_DEPTH + 0.002; // image/label sit clearly in front of the frame front (~1.2 cm off the wall)
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
  /** The sky dome (already in `group`); call `sky.follow(camera)` every frame. */
  sky: SkyDome;
}

/** Wall finish in effect for a wall: its own, else the museum default. */
export const effectiveFinish = (museum: Museum, wall: { finish?: WallFinish }): WallFinish => wall.finish ?? museum.settings.wallFinish;

/** Distinct texture media ids the viewer loads (walls, floor, ceiling, areas); each is loaded once and shared. */
export const usedTextureIds = neededTextureIds;

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
  // Wall pieces (heights follow the rooms on both sides) are needed by the walls and by the ceiling steps.
  const ends = wallEnds(museum.walls);
  const spans = wallSpans(museum.walls, ends, T);
  const profiles = new Map(museum.walls.map((w) => [w.id, wallHeightProfile(museum, w)]));
  const wallPieceMap = wallPieces(museum.walls, spans, profiles, T);

  // lights (no shadows)
  group.add(new THREE.HemisphereLight(0xffffff, 0xcfcfd4, 1.6));
  group.add(new THREE.AmbientLight(0xffffff, 0.5));

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
        const msg = `texture '${media?.file ?? id}' could not be loaded: ${String(e)}`;
        console.warn('[museum]', msg);
        warnings.push(msg);
        wallTextures.set(id, null);
      } finally {
        onProgress?.();
      }
    }),
  );

  // Floor: base quad plus area quads (T7 overlap levels, 1 mm apart). Ceiling: a flat decomposition (see
  // decomposeCeiling) so every ceiling quad sits at its room's height and open-sky areas are simply holes; height steps
  // between neighbouring ceilings get a vertical strip unless a wall already covers them.
  // Quads carry world-aligned UVs, so every quad with the same finish merges into ONE mesh per surface.
  // Draw calls: 1 (base floor) + one per distinct floor-area finish + one per distinct ceiling finish.
  const surfaceMats = new Map<string, THREE.MeshLambertMaterial>();
  const surfaceMat = (surface: string, f: Finish, polygonOffset: number) => {
    const tex = f.textureId ? wallTextures.get(f.textureId) ?? null : null;
    const key = `${surface}|${polygonOffset}|${finishKey(f, !!tex)}`;
    let mat = surfaceMats.get(key);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(f.color), map: tex });
      mat.polygonOffset = polygonOffset !== 0;
      mat.polygonOffsetFactor = mat.polygonOffsetUnits = polygonOffset;
      surfaceMats.set(key, mat);
    }
    return mat;
  };
  const baseRect = { x: bounds.minX, y: bounds.minY, w: bw, h: bd };
  group.add(new THREE.Mesh(surfaceQuad(baseRect, 0, museum.settings.floorFinish.tileSize, 'up'), surfaceMat('floor', museum.settings.floorFinish, 1)));
  {
    // Floor areas are pulled forward so they never fight the base floor.
    const byMat = new Map<THREE.MeshLambertMaterial, THREE.BufferGeometry[]>();
    for (const q of areaQuads(museum)) {
      const mat = surfaceMat('floor', q.finish, -1);
      const list = byMat.get(mat) ?? [];
      list.push(surfaceQuad(q.rect, q.y, q.finish.tileSize, 'up'));
      byMat.set(mat, list);
    }
    for (const [mat, geos] of byMat) {
      const g = merged(geos);
      if (g) group.add(new THREE.Mesh(g, mat));
    }
  }
  // Steps beside a wall (a doorway between rooms of different height) become door headers in the wall meshes.
  const headers: { step: CeilingStep; wall: Wall }[] = [];
  if (museum.settings.ceiling) {
    const plan = decomposeCeiling(baseRect, museum.settings.ceilingFinish, museum.areas, H);
    const byMat = new Map<THREE.MeshLambertMaterial, THREE.BufferGeometry[]>();
    for (const grp of plan.groups) {
      const mat = surfaceMat('ceiling', grp.finish, 0); // same finish => same material, whatever the tile size
      const list = byMat.get(mat) ?? [];
      for (const r of grp.rects) list.push(surfaceQuad(r, grp.height, grp.finish.tileSize, 'down'));
      byMat.set(mat, list);
    }
    for (const st of uncoveredSteps(plan.steps, museum.walls, spans, T)) {
      if (st.wall) {
        headers.push({ step: st, wall: st.wall });
        continue;
      }
      const mat = surfaceMat('ceiling', st.finish, 0);
      const list = byMat.get(mat) ?? [];
      list.push(stepQuad(st));
      byMat.set(mat, list);
    }
    for (const [mat, geos] of byMat) {
      const g = merged(geos);
      if (g) group.add(new THREE.Mesh(g, mat));
    }
  }

  const sky = await buildSky(museum, urlFor, anisotropy, warnings);
  group.add(sky.mesh);

  // Walls: one merged mesh per material (identical texture + colour); tileSize lives in the UVs.
  const wallMats = new Map<string, { mat: THREE.MeshLambertMaterial; geos: THREE.BufferGeometry[] }>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const wallEntry = (f: WallFinish) => {
    const tex = f.textureId ? wallTextures.get(f.textureId) ?? null : null;
    const key = wallFinishKey(f, !!tex);
    let entry = wallMats.get(key);
    if (!entry) {
      entry = { mat: new THREE.MeshLambertMaterial(f.colorTop ? { color: 0xffffff, vertexColors: true, map: tex } : { color: new THREE.Color(f.color), map: tex }), geos: [] };
      wallMats.set(key, entry);
    }
    return entry;
  };
  const gradientHeightOf = (pieces: { top: number }[]) => Math.max(...pieces.map((p) => p.top)); // one colour ramp along the whole wall
  for (const w of museum.walls) {
    const d = wallDirection(w);
    const f = effectiveFinish(museum, w);
    const entry = wallEntry(f);
    // Ends at corners and free ends reach T/2 past the end point so corners have no notch; end faces that would
    // sit in another wall's face plane are left out, and where a later wall lies on top of this one only the later
    // wall is drawn (see wallJoints.ts), so nothing z-fights.
    const pieces = wallPieceMap.get(w.id)!;
    if (!pieces.length) continue;
    const lo = pieces[0].from, hi = pieces[pieces.length - 1].to;
    const gradientHeight = gradientHeightOf(pieces);
    q.setFromAxisAngle(up, -Math.atan2(d.y, d.x));
    for (const sp of pieces) {
      const geo = wallGeometry(sp.to - sp.from, sp.top, T, f.tileSize, { start: sp.capFrom, end: sp.capTo }, { front: sp.from - lo, back: hi - sp.to }, { start: sp.stepFrom, end: sp.stepTo });
      if (f.colorTop) applyWallGradient(geo, sp.top, f.color, f.colorTop, gradientHeight);
      const mid = (sp.from + sp.to) / 2;
      m4.compose(new THREE.Vector3(w.a.x + d.x * mid, sp.top / 2, w.a.y + d.y * mid), q, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m4);
      entry.geos.push(geo);
    }
  }
  for (const { step, wall } of headers) {
    const pieces = wallPieceMap.get(wall.id);
    if (!pieces?.length) continue;
    const f = effectiveFinish(museum, wall);
    const geo = doorHeaderGeometry(step, wall, T, f.tileSize, { lo: pieces[0].from, hi: pieces[pieces.length - 1].to });
    // The header is already in world space, so the gradient's reference height is 0 (not the box's centre offset).
    if (f.colorTop) applyWallGradient(geo, 0, f.color, f.colorTop, gradientHeightOf(pieces));
    wallEntry(f).geos.push(geo);
  }
  for (const { mat, geos } of wallMats.values()) {
    const g = merged(geos);
    if (g) group.add(new THREE.Mesh(g, mat));
  }

  // Frames of every work: one mesh, always visible. Each is a solid box the full size of the work, so a painting
  // that isn't loaded is a plain dark rectangle (no second surface a hair in front of it to flicker at a distance).
  const wallById = new Map(museum.walls.map((w) => [w.id, w]));
  const slots: PaintingSlot[] = [];
  const frameGeos: THREE.BufferGeometry[] = [];
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
    slots.push({ id: work.id, media, w, h, position, rotationY, x: center.x, y: center.y });
  }
  const frames = merged(frameGeos);
  // The bias is in depth-buffer steps: it keeps a distant frame (1 cm off the wall) from flickering against the wall, and
  // stays well under WORK_OFFSET's 2 mm image gap at the distances where paintings are loaded (under 1 mm at 20 m).
  if (frames) group.add(new THREE.Mesh(frames, new THREE.MeshBasicMaterial({ color: 0x1a1a1a, polygonOffset: true, polygonOffsetUnits: -2 })));

  return { group, bounds, warnings, slots, sky };
}
