// Where "Preview from here" starts the viewer. Pure.
import type { Museum, Vec2, Work } from '../shared/museum';
import { closestPointOnSegment, workPlacement } from '../shared/geometry';
import type { StartPose } from '../shared/startPose';
import { PLAYER_RADIUS } from '../viewer/collision';
import { findMedia, findWall, findZone, imageHeight } from './model';
import type { Selection } from './types';

const SAFETY = 0.05;
const STEP = 0.01;

/** Stand in front of the work, facing it. Null when its wall or media is missing. */
export function workPreviewPose(m: Museum, work: Work): StartPose | null {
  const wall = findWall(m, work.wallId);
  const media = findMedia(m, work.mediaId);
  if (!wall || !media) return null;
  const T = m.settings.wallThickness;
  const { center, normal } = workPlacement(wall, work, T);
  const clearance = T / 2 + PLAYER_RADIUS + SAFETY;
  const wanted = Math.min(3.5, Math.max(1.5, 1.2 * Math.max(work.width, imageHeight(m, work))));
  // walk away from the wall until something else is in the way; never closer than the clearance to the work's own wall
  let dist = clearance;
  const others = m.walls.filter((w) => w.id !== wall.id);
  const free = (s: number) => {
    const p = { x: center.x + normal.x * s, y: center.y + normal.y * s };
    return others.every((o) => closestPointOnSegment(p, o.a, o.b).dist >= clearance - 1e-9);
  };
  if (free(dist)) {
    while (dist + STEP <= wanted + 1e-9 && free(dist + STEP)) dist += STEP;
  }
  dist = Math.min(dist, wanted);
  let yawDeg = (Math.atan2(-normal.x, normal.y) * 180) / Math.PI + 0; // facing -normal: forward f, yaw = atan2(f.x, -f.y)
  if (yawDeg <= -180) yawDeg += 360;
  return { x: center.x + normal.x * dist, y: center.y + normal.y * dist, yawDeg };
}

export interface PreviewHere {
  /** Null: start at the spawn (no `at` in the address). */
  pose: StartPose | null;
  /** For the button's tooltip. */
  what: string;
}

/** What "from here" means for the single selection (or none), given the centre of the blueprint view. */
export function previewHere(m: Museum, sel: Selection, viewCenter: Vec2): PreviewHere {
  const view: PreviewHere = { pose: { x: viewCenter.x, y: viewCenter.y, yawDeg: 0 }, what: 'at the centre of the blueprint view, facing up' };
  if (!sel) return view;
  if (sel.type === 'work') {
    const work = m.works.find((w) => w.id === sel.id);
    const pose = work ? workPreviewPose(m, work) : null;
    return pose ? { pose, what: 'in front of the selected painting' } : view;
  }
  if (sel.type === 'zone') {
    const z = findZone(m, sel.id);
    if (!z) return view;
    const s = z.shape;
    const c = s.kind === 'rect' ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: s.cx, y: s.cy };
    return { pose: { ...c, yawDeg: 0 }, what: 'at the centre of the selected audio zone' };
  }
  if (sel.type === 'area') {
    const a = m.areas.find((x) => x.id === sel.id);
    if (!a) return view;
    return { pose: { x: a.rect.x + a.rect.w / 2, y: a.rect.y + a.rect.h / 2, yawDeg: 0 }, what: 'at the centre of the selected area' };
  }
  if (sel.type === 'spawn') return { pose: null, what: 'at the spawn point (the same as Preview)' };
  return view;
}
