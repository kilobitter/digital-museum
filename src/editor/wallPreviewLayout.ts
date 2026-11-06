// Where things go in the small "painting on the wall" preview. Pure: metres in, SVG pixels out.

export const PREVIEW_W = 260;
export const PREVIEW_H = 150;
/** Space around the back wall, where the floor and ceiling lines run out to the window's corners. */
const SIDE = 30;
const TOP_BOTTOM = 16;
const TOL = 1e-6; // same as the above-wall and below-floor warnings

export interface WallPreviewInput {
  wallHeight: number;
  /** Painting size in metres. */
  width: number;
  height: number;
  centerHeight: number;
}

export interface WallPreviewLayout {
  /** The back wall's edges. */
  left: number;
  right: number;
  wallTop: number;
  floor: number;
  painting: { x: number; y: number; w: number; h: number };
  center: { x: number; y: number };
  /** The painting reaches above the wall top or below the floor. */
  overflow: boolean;
}

/**
 * One scale for both directions, so the proportions are true. The wall fills the window unless the painting reaches
 * past it or is too wide, in which case everything shrinks to keep it in view. The painting is centred horizontally:
 * the preview shows height on the wall, not the position along it.
 */
export function wallPreviewLayout({ wallHeight, width, height, centerHeight }: WallPreviewInput): WallPreviewLayout {
  const paintingTop = centerHeight + height / 2;
  const paintingBottom = centerHeight - height / 2;
  const lo = Math.min(0, paintingBottom);
  const hi = Math.max(wallHeight, paintingTop);
  const scale = Math.min((PREVIEW_H - 2 * TOP_BOTTOM) / (hi - lo), (PREVIEW_W - 2 * SIDE) / width);
  const yOf = (metres: number) => PREVIEW_H / 2 - (metres - (lo + hi) / 2) * scale;
  const w = width * scale;
  return {
    left: SIDE,
    right: PREVIEW_W - SIDE,
    wallTop: yOf(wallHeight),
    floor: yOf(0),
    painting: { x: (PREVIEW_W - w) / 2, y: yOf(paintingTop), w, h: height * scale },
    center: { x: PREVIEW_W / 2, y: yOf(centerHeight) },
    overflow: paintingTop > wallHeight + TOL || paintingBottom < -TOL,
  };
}
