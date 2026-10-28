// Museum data contract shared by the editor and the viewer.
// Owned by the orchestrator: change only with an explicit spec update.
//
// Units are metres. The blueprint ("plan") is a top-down 2D view:
//   plan +x  -> world +x
//   plan +y  -> world +z   (plan +y points DOWN on the editor screen, i.e. "south")
//   world +y is up; floor is at y = 0.
// So "up" on the blueprint (plan -y) is world -z, the default three.js forward.

export const MUSEUM_VERSION = 3 as const;
// v2 (2026-10-27): title/artist/description moved from Work to MediaItem; wall finishes and
// 'texture' media added.
// v3 (2026-10-28): floor/ceiling default finishes and rectangular floor/ceiling areas.
// parseMuseum migrates v1 and v2 files on load.

export interface Vec2 {
  x: number;
  y: number;
}

export interface MuseumSettings {
  /** Wall height in metres. Default 3. */
  wallHeight: number;
  /** Wall thickness in metres. Default 0.2. Walls are centred on their segment. */
  wallThickness: number;
  /** Editor snap grid in metres. Default 0.5. Viewer ignores it. */
  gridSize: number;
  /** Render a ceiling at wallHeight over the floor area. Default true. */
  ceiling: boolean;
  /** Finish for every wall without its own `finish`. Default { color: '#ffffff', tileSize: 1 }. */
  wallFinish: Finish;
  /** Floor everywhere no area overrides it. Default { color: '#e6e3dd', tileSize: 1 }. */
  floorFinish: Finish;
  /** Ceiling everywhere no area overrides it (only rendered when `ceiling` is true). Default { color: '#ffffff', tileSize: 1 }. */
  ceilingFinish: Finish;
  /** Where visitors start. yawDeg 0 faces plan -y (up on the blueprint), 90 faces plan +x; clockwise seen from above. */
  spawn: { x: number; y: number; yawDeg: number };
}

export interface Finish {
  /** MediaItem id with kind 'texture'. Omit for a plain colour. */
  textureId?: string;
  /** '#rrggbb'. Plain colour, or multiplied with the texture (use '#ffffff' for the texture as-is). */
  color: string;
  /**
   * Edge length in metres of one square texture tile. > 0.
   * Walls: tiles start at each wall's own corner, on every face.
   * Floors/ceilings (default and areas): tiles are aligned to the world origin (plan 0,0), so
   * neighbouring surfaces with the same finish continue seamlessly.
   */
  tileSize: number;
}

/** Kept for readability at wall call sites. */
export type WallFinish = Finish;

/**
 * A rectangle that overrides the floor and/or ceiling finish inside it. At least one of
 * `floor` / `ceiling` is set. Areas are independent of walls (they may run under them).
 * Stacking: later entries in `Museum.areas` are drawn on top of earlier ones.
 */
export interface Area {
  id: string;
  name: string;
  /** x,y = top-left corner in plan coords; w,h > 0. */
  rect: { x: number; y: number; w: number; h: number };
  floor?: Finish;
  ceiling?: Finish;
}

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  /** Overrides settings.wallFinish for this whole wall (both faces and ends). */
  finish?: WallFinish;
}

/**
 * Which face of a wall a work hangs on.
 * Let d = b - a and perp(d) = (-d.y, d.x) normalised.
 * side = 1 hangs on the face whose outward normal is +perp(d); side = -1 on -perp(d).
 */
export type WallSide = 1 | -1;

export interface Work {
  id: string;
  /** Must reference a MediaItem with kind 'image'. */
  mediaId: string;
  wallId: string;
  side: WallSide;
  /** Distance in metres from wall point `a` along the wall to the work's centre. */
  t: number;
  /** Height of the work's centre above the floor, metres. Default 1.5. */
  centerHeight: number;
  /** Displayed width in metres; height follows the image aspect ratio. Label text comes from the media item. */
  width: number;
}

export type ZoneShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number } // x,y = top-left corner in plan coords; w,h > 0
  | { kind: 'circle'; cx: number; cy: number; r: number };

export interface AudioZone {
  id: string;
  name: string;
  /** Must reference a MediaItem with kind 'audio'. Loops seamlessly. */
  mediaId: string;
  shape: ZoneShape;
  /** 0..1 */
  volume: number;
  /**
   * Fade band in metres, measured inward from the zone edge.
   * Gain is 0 at the edge and reaches `volume` at `fade` metres inside. 0 = hard edge.
   */
  fade: number;
}

export interface MediaItem {
  id: string;
  /** 'image' = a painting that can be hung; 'texture' = wall texture only; 'audio' = zone loop. */
  kind: 'image' | 'audio' | 'texture';
  /** Path relative to the museum folder, always under "media/", e.g. "media/k3f9a2.jpg". */
  file: string;
  /** Original filename / human label. */
  name: string;
  /** Pixel dimensions, required for images and textures. */
  width?: number;
  height?: number;
  /** Label fields, used for kind 'image' (ignored otherwise). Missing = empty. */
  title?: string;
  artist?: string;
  description?: string;
}

export interface Museum {
  version: typeof MUSEUM_VERSION;
  name: string;
  settings: MuseumSettings;
  walls: Wall[];
  works: Work[];
  zones: AudioZone[];
  /** Floor/ceiling areas, bottom to top. */
  areas: Area[];
  media: MediaItem[];
}
