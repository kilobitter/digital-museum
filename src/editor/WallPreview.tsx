import { wallSideHeight } from '../shared/roomHeights';
import type { Museum, Work } from '../shared/museum';
import { findWall, imageHeight } from './model';
import { PREVIEW_H, PREVIEW_W, wallPreviewLayout } from './wallPreviewLayout';

const m2 = (v: number) => `${v.toFixed(2)} m`;

/** A small view straight at a wall: not the real wall, just how the painting's size and height look together. */
export function WallPreview({ museum, work }: { museum: Museum; work: Work }) {
  const wall = findWall(museum, work.wallId);
  // the same height the above-wall warning uses: the room on the side the painting hangs on
  const wallHeight = wall ? wallSideHeight(museum, wall, work.side, work.t - work.width / 2, work.t + work.width / 2) : museum.settings.wallHeight;
  const height = imageHeight(museum, work);
  const l = wallPreviewLayout({ wallHeight, width: work.width, height, centerHeight: work.centerHeight });
  const caption = `Wall ${m2(wallHeight)} · Painting ${m2(height)} · Centre ${m2(work.centerHeight)}`;
  return (
    <div className="wall-preview">
      <svg viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`} width={PREVIEW_W} height={PREVIEW_H} role="img" aria-label={caption}>
        <polyline className="wall-preview-edge" points={`0,0 ${l.left},${l.wallTop} ${l.right},${l.wallTop} ${PREVIEW_W},0`} />
        <polyline className="wall-preview-edge" points={`0,${PREVIEW_H} ${l.left},${l.floor} ${l.right},${l.floor} ${PREVIEW_W},${PREVIEW_H}`} />
        <rect className={'wall-preview-painting' + (l.overflow ? ' overflow' : '')} x={l.painting.x} y={l.painting.y} width={l.painting.w} height={l.painting.h} />
        <circle className="wall-preview-center" cx={l.center.x} cy={l.center.y} r={3} />
      </svg>
      <div className="wall-preview-caption">{caption}</div>
    </div>
  );
}
