// "Check museum": what would go wrong for visitors. Reports only; runs when the editor asks. Pure (no DOM, no three.js).
//
// Walking model, the same as the viewer's resolveMove: the head stays R = thickness / 2 + PLAYER_RADIUS away from every
// wall segment (centre line), so a straight gap between two wall ends is walkable only when it is wider than 2R.
import type { MediaItem, Museum, Vec2, Wall, Work } from '../shared/museum';
import { closestPointOnSegment, wallDirection, wallLength, workPlacement } from '../shared/geometry';
import { hasLabel, labelLayout, plaqueDirection, plaqueSpan, type LabelLayout, type MeasureText } from '../shared/labelLayout';
import { PLAYER_RADIUS, computeFloorBounds, pushOut, segmentSegmentDistance } from '../viewer/collision';
import { wallEnds, wallSpans } from '../viewer/wallJoints';
import { computeWarnings, findMedia, findWall, imageHeight, workLabel } from './model';

export type CheckSeverity = 'problem' | 'warning' | 'info';
/** `area` and `spawn` are there because the museum's own warnings (computeWarnings) can point at them. */
export type CheckTarget =
  | { type: 'work' | 'wall' | 'zone' | 'area'; id: string }
  | { type: 'spawn' }
  | { type: 'point'; x: number; y: number };
export interface CheckItem {
  kind: string;
  severity: CheckSeverity;
  message: string;
  target?: CheckTarget;
  /** Blueprint position to centre on. */
  at?: Vec2;
}
export interface CheckReport { items: CheckItem[]; ms: number }

const COLLINEAR_SIN = Math.sin(Math.PI / 180); // "parallel" means within about 1 degree
const LINE_EPS = 0.01; // metres: "on one line"
const TOL = 0.01; // metres: label tolerance
const MAX_CELLS = 20e6;
const MIN_CELL = 0.05;
const REACH = 2; // metres in front of a work that still count as viewing it
const START_SEARCH = 1; // metres around the spawn to look for a free cell

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const metres = (n: number) => n.toFixed(2);
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

// ---------- wall lines ----------

function offLine(w: Wall, p: Vec2): number {
  const d = wallDirection(w);
  return Math.abs(cross(p.x - w.a.x, p.y - w.a.y, d.x, d.y));
}

/** `o` runs along `w`'s line: parallel within about a degree and both ends within a centimetre of it. */
function onLineOf(w: Wall, o: Wall): boolean {
  if (wallLength(w) === 0 || wallLength(o) === 0) return false;
  const d = wallDirection(w), e = wallDirection(o);
  return Math.abs(cross(d.x, d.y, e.x, e.y)) < COLLINEAR_SIN && offLine(w, o.a) <= LINE_EPS && offLine(w, o.b) <= LINE_EPS;
}

// ---------- 1. narrow doorways ----------

interface Gap { wall: Wall; other: Wall; p: Vec2; q: Vec2; mid: Vec2; width: number }

/** Gaps between collinear wall ends that are wider than a wall is thick but too narrow to walk through. */
function narrowDoorways(m: Museum): Gap[] {
  const T = m.settings.wallThickness;
  const R = T / 2 + PLAYER_RADIUS;
  const walls = m.walls.filter((w) => wallLength(w) > 0);
  const out: Gap[] = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const w = walls[i], o = walls[j];
      if (!(onLineOf(w, o) && onLineOf(o, w))) continue;
      const dw = wallDirection(w), dO = wallDirection(o);
      for (const [p, uw] of [[w.a, dw], [w.b, { x: -dw.x, y: -dw.y }]] as const) {
        for (const [q, uo] of [[o.a, dO], [o.b, { x: -dO.x, y: -dO.y }]] as const) {
          const g = { x: q.x - p.x, y: q.y - p.y };
          // both walls must run away from the gap (an overlap has one running into the other)
          if (uw.x * g.x + uw.y * g.y > 1e-9 || uo.x * -g.x + uo.y * -g.y > 1e-9) continue;
          const width = Math.hypot(g.x, g.y);
          if (width <= T + 1e-6 || width > 2 * R + 1e-6) continue;
          const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          const covered = m.walls.some((x) => x !== w && x !== o && closestPointOnSegment(mid, x.a, x.b).dist <= T / 2);
          if (!covered) out.push({ wall: w, other: o, p, q, mid, width });
        }
      }
    }
  }
  return out;
}

function doorwayItems(m: Museum, gaps: Gap[]): CheckItem[] {
  const need = m.settings.wallThickness + 2 * PLAYER_RADIUS;
  return gaps.map((g) => ({
    kind: 'narrow-doorway',
    severity: 'warning',
    message: `Doorway is ${metres(g.width)} m wide: too narrow to walk through (needs more than ${metres(need)} m). Teleporting in VR may still get through.`,
    target: { type: 'wall', id: g.wall.id },
    at: g.mid,
  }));
}

// ---------- 2. reachability (grid flood fill) ----------

const BLOCKED = -1;
const FREE = 0;

interface Grid {
  minX: number; minY: number; cell: number; cols: number; rows: number;
  /** BLOCKED, FREE (not yet labelled) or a component label (1 = reached from the start point). */
  label: Int32Array;
  stack: Int32Array;
  nextLabel: number;
}

function buildGrid(m: Museum, gaps: Gap[]): Grid {
  const T = m.settings.wallThickness;
  const R = T / 2 + PLAYER_RADIUS;
  const b = computeFloorBounds(m, 2);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const cell = Math.max(MIN_CELL, Math.sqrt((w * h) / MAX_CELLS));
  const cols = Math.max(1, Math.ceil(w / cell)), rows = Math.max(1, Math.ceil(h / cell));
  const g: Grid = { minX: b.minX, minY: b.minY, cell, cols, rows, label: new Int32Array(cols * rows), stack: new Int32Array(cols * rows), nextLabel: 2 };
  // A free band narrower than sqrt(2) cells can fall between cell centres and would close a real passage, so every
  // wall blocks a little less than the true R; the too-narrow doorways are closed explicitly below.
  const r = R - 0.8 * cell;
  const block = (a: Vec2, c: Vec2) => {
    const i0 = Math.max(0, Math.floor((Math.min(a.x, c.x) - r - g.minX) / cell - 0.5));
    const i1 = Math.min(cols - 1, Math.ceil((Math.max(a.x, c.x) + r - g.minX) / cell - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, c.y) - r - g.minY) / cell - 0.5));
    const j1 = Math.min(rows - 1, Math.ceil((Math.max(a.y, c.y) + r - g.minY) / cell - 0.5));
    const dx = c.x - a.x, dy = c.y - a.y, len2 = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) {
      const y = g.minY + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = g.minX + (i + 0.5) * cell;
        let t = len2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - (a.x + dx * t), ey = y - (a.y + dy * t);
        if (ex * ex + ey * ey < r * r) g.label[j * cols + i] = BLOCKED;
      }
    }
  };
  for (const wall of m.walls) block(wall.a, wall.b);
  for (const gap of gaps) block(gap.p, gap.q);
  return g;
}

const cellIndex = (g: Grid, p: Vec2): number => {
  const i = Math.floor((p.x - g.minX) / g.cell), j = Math.floor((p.y - g.minY) / g.cell);
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? -1 : j * g.cols + i;
};
const cellCentre = (g: Grid, idx: number): Vec2 => ({ x: g.minX + ((idx % g.cols) + 0.5) * g.cell, y: g.minY + (Math.floor(idx / g.cols) + 0.5) * g.cell });

/** Gives every free cell connected (4 neighbours) to `start` the label. */
function flood(g: Grid, start: number, label: number): void {
  const { cols, rows, stack, label: lab } = g;
  let top = 0;
  stack[top++] = start;
  lab[start] = label;
  while (top > 0) {
    const idx = stack[--top];
    const i = idx % cols, j = (idx - i) / cols;
    if (i > 0 && lab[idx - 1] === FREE) { lab[idx - 1] = label; stack[top++] = idx - 1; }
    if (i < cols - 1 && lab[idx + 1] === FREE) { lab[idx + 1] = label; stack[top++] = idx + 1; }
    if (j > 0 && lab[idx - cols] === FREE) { lab[idx - cols] = label; stack[top++] = idx - cols; }
    if (j < rows - 1 && lab[idx + cols] === FREE) { lab[idx + cols] = label; stack[top++] = idx + cols; }
  }
}

/** The component of a free cell, labelling it first when nobody has looked at it yet. */
function componentOf(g: Grid, idx: number): number {
  if (g.label[idx] === FREE) flood(g, idx, g.nextLabel++);
  return g.label[idx];
}

/** The nearest free cell to `p` within START_SEARCH metres, or -1. */
function nearestFree(g: Grid, p: Vec2): number {
  const c = cellIndex(g, p);
  if (c >= 0 && g.label[c] !== BLOCKED) return c;
  const span = Math.ceil(START_SEARCH / g.cell);
  const ci = Math.floor((p.x - g.minX) / g.cell), cj = Math.floor((p.y - g.minY) / g.cell);
  let best = -1, bestD = START_SEARCH * START_SEARCH;
  for (let j = Math.max(0, cj - span); j <= Math.min(g.rows - 1, cj + span); j++) {
    for (let i = Math.max(0, ci - span); i <= Math.min(g.cols - 1, ci + span); i++) {
      const idx = j * g.cols + i;
      if (g.label[idx] === BLOCKED) continue;
      const q = cellCentre(g, idx);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d <= bestD) { bestD = d; best = idx; }
    }
  }
  return best;
}

const touchesEdge = (g: Grid, label: number): boolean => {
  for (let i = 0; i < g.cols; i++) if (g.label[i] === label || g.label[(g.rows - 1) * g.cols + i] === label) return true;
  for (let j = 0; j < g.rows; j++) if (g.label[j * g.cols] === label || g.label[j * g.cols + g.cols - 1] === label) return true;
  return false;
};

/** How far along the face normal (up to `max`) the line from the face stays clear of every other wall. */
function clearDistance(face: Vec2, normal: Vec2, max: number, T: number, own: Wall, walls: readonly Wall[]): number {
  const far = { x: face.x + normal.x * max, y: face.y + normal.y * max };
  const lo = { x: Math.min(face.x, far.x) - T, y: Math.min(face.y, far.y) - T };
  const hi = { x: Math.max(face.x, far.x) + T, y: Math.max(face.y, far.y) + T };
  let limit = max;
  for (const o of walls) {
    if (o === own) continue;
    if (Math.max(o.a.x, o.b.x) < lo.x || Math.min(o.a.x, o.b.x) > hi.x || Math.max(o.a.y, o.b.y) < lo.y || Math.min(o.a.y, o.b.y) > hi.y) continue;
    // a wall crosses when it comes within half a thickness of the line (the line starts on the face: a wall on the face's own line is at exactly T/2)
    const crosses = (s: number) => segmentSegmentDistance(face, { x: face.x + normal.x * s, y: face.y + normal.y * s }, o.a, o.b) < T / 2 - 1e-3;
    if (!crosses(limit)) continue;
    let a = 0, b = limit;
    for (let k = 0; k < 14; k++) {
      const mid = (a + b) / 2;
      if (crosses(mid)) b = mid; else a = mid;
    }
    limit = a;
  }
  return limit;
}

const quote = (names: string[]) => {
  const shown = names.slice(0, 5).map((n) => `"${n}"`).join(', ');
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
};

function reachabilityItems(m: Museum, gaps: Gap[]): CheckItem[] {
  const items: CheckItem[] = [];
  const T = m.settings.wallThickness;
  const grid = buildGrid(m, gaps);
  const spawn = m.settings.spawn;
  const start = nearestFree(grid, pushOut({ x: spawn.x, y: spawn.y }, m.walls, T, PLAYER_RADIUS));
  if (start < 0) {
    items.push({ kind: 'no-start', severity: 'problem', message: 'The start point has no room to stand', target: { type: 'spawn' }, at: { x: spawn.x, y: spawn.y } });
    return items;
  }
  flood(grid, start, 1);
  const outside = touchesEdge(grid, 1);

  // works: can a visitor stand in front of them?
  const walls = m.walls;
  type Group = { works: Work[]; sum: Vec2 };
  const groups = new Map<number, Group>(); // component label, or 0 for nowhere to stand
  for (const work of m.works) {
    const wall = findWall(m, work.wallId);
    if (!wall || !findMedia(m, work.mediaId) || wallLength(wall) === 0) continue;
    const { center, normal } = workPlacement(wall, work, T);
    const limit = clearDistance(center, normal, REACH, T, wall, walls);
    let reached = false, first = 0;
    for (let s = grid.cell; s <= limit + 1e-9 && !reached; s += grid.cell) {
      const idx = cellIndex(grid, { x: center.x + normal.x * s, y: center.y + normal.y * s });
      if (idx < 0) break;
      if (grid.label[idx] === BLOCKED) continue;
      const comp = componentOf(grid, idx);
      if (comp === 1) reached = true;
      else if (first === 0) first = comp;
    }
    if (reached) continue;
    const g = groups.get(first) ?? { works: [], sum: { x: 0, y: 0 } };
    g.works.push(work);
    g.sum.x += center.x;
    g.sum.y += center.y;
    groups.set(first, g);
  }
  for (const [comp, g] of groups) {
    const names = g.works.map((w) => workLabel(m, w));
    const n = names.length;
    const message =
      comp === 0
        ? n === 1 ? `${quote(names)} has no room in front of it` : `${n} paintings have no room in front of them: ${quote(names)}`
        : n === 1 ? `${quote(names)} cannot be reached from the start point` : `${n} paintings cannot be reached from the start point: ${quote(names)}`;
    items.push({ kind: comp === 0 ? 'work-no-room' : 'work-unreachable', severity: 'problem', message, target: { type: 'work', id: g.works[0].id }, at: { x: g.sum.x / n, y: g.sum.y / n } });
  }

  // audio zones: can anyone walk into them?
  for (const z of m.zones) {
    if (!zoneReached(grid, z.shape, outside)) {
      const c = z.shape.kind === 'rect' ? { x: z.shape.x + z.shape.w / 2, y: z.shape.y + z.shape.h / 2 } : { x: z.shape.cx, y: z.shape.cy };
      items.push({ kind: 'zone-unreachable', severity: 'problem', message: `Audio zone "${z.name || z.id}" cannot be heard: no visitor can walk into it`, target: { type: 'zone', id: z.id }, at: c });
    }
  }

  if (outside) {
    items.push({
      kind: 'walk-out',
      severity: 'warning',
      message: 'Visitors can walk out of the building through a gap in the outer walls. The floor ends 2 m past the walls, but walking does not stop there.',
    });
  }
  return items;
}

function zoneReached(g: Grid, shape: Museum['zones'][number]['shape'], outside: boolean): boolean {
  const box = shape.kind === 'rect'
    ? { x0: shape.x, y0: shape.y, x1: shape.x + shape.w, y1: shape.y + shape.h }
    : { x0: shape.cx - shape.r, y0: shape.cy - shape.r, x1: shape.cx + shape.r, y1: shape.cy + shape.r };
  const inside = (p: Vec2) => shape.kind === 'rect' ? p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1 : (p.x - shape.cx) ** 2 + (p.y - shape.cy) ** 2 <= shape.r * shape.r;
  const i0 = Math.max(0, Math.floor((box.x0 - g.minX) / g.cell)), i1 = Math.min(g.cols - 1, Math.floor((box.x1 - g.minX) / g.cell));
  const j0 = Math.max(0, Math.floor((box.y0 - g.minY) / g.cell)), j1 = Math.min(g.rows - 1, Math.floor((box.y1 - g.minY) / g.cell));
  if (i0 > i1 || j0 > j1) return outside; // wholly outside the floor: reachable only from outside the building
  let any = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const idx = j * g.cols + i;
      if (!inside(cellCentre(g, idx))) continue;
      any = true;
      if (g.label[idx] === 1) return true;
    }
  }
  if (any) return false;
  // smaller than a cell: look at the cell holding its centre
  const c = cellIndex(g, shape.kind === 'rect' ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: shape.cx, y: shape.cy });
  return c >= 0 && g.label[c] === 1;
}

// ---------- 3. labels ----------

interface Placed {
  work: Work;
  wall: Wall;
  media: MediaItem;
  /** Centre of the work on its face, and the face's outward normal. */
  center: Vec2;
  normal: Vec2;
  dir: Vec2;
  t: number;
  w: number;
  h: number;
  layout: LabelLayout | null;
  /** Along-wall range of the plaque, metres from the wall's a. */
  span: { from: number; to: number } | null;
}

function place(m: Museum, measure: MeasureText): Placed[] {
  const T = m.settings.wallThickness;
  const layouts = new Map<string, LabelLayout>();
  const out: Placed[] = [];
  for (const work of m.works) {
    const wall = findWall(m, work.wallId);
    const media = findMedia(m, work.mediaId);
    if (!wall || !media || wallLength(wall) === 0) continue;
    const { center, normal } = workPlacement(wall, work, T);
    const dir = wallDirection(wall);
    const t = Math.min(Math.max(work.t, 0), wallLength(wall));
    let layout: LabelLayout | null = null;
    if (!work.hideLabel && hasLabel(media)) {
      layout = layouts.get(media.id) ?? labelLayout(media, measure);
      layouts.set(media.id, layout);
    }
    out.push({
      work, wall, media, center, normal, dir, t, w: work.width, h: imageHeight(m, work), layout,
      span: layout ? plaqueSpan(t, work.width, layout.w, plaqueDirection(normal, dir)) : null,
    });
  }
  return out;
}

type Range = [number, number];

/** The drawn run of a wall's line, in metres along `wall` from its a: every wall on the line contributes its drawn spans. */
function wallRun(wall: Wall, m: Museum, spans: ReturnType<typeof wallSpans>): Range[] {
  const d = wallDirection(wall);
  const ranges: Range[] = [];
  for (const o of m.walls) {
    if (o !== wall && !onLineOf(wall, o)) continue;
    const od = wallDirection(o);
    const s0 = (o.a.x - wall.a.x) * d.x + (o.a.y - wall.a.y) * d.y;
    const sgn = od.x * d.x + od.y * d.y >= 0 ? 1 : -1;
    for (const sp of spans.get(o.id) ?? []) {
      const p = s0 + sgn * sp.from, q = s0 + sgn * sp.to;
      ranges.push([Math.min(p, q), Math.max(p, q)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + TOL) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** The longest stretch of [from, to] that no range covers. */
function longestUncovered(from: number, to: number, run: Range[]): number {
  let worst = 0, pos = from;
  for (const [a, b] of run) {
    if (b <= pos) continue;
    if (a >= to) break;
    worst = Math.max(worst, a - pos);
    pos = Math.max(pos, b);
  }
  return Math.max(worst, to - pos);
}

function labelItems(m: Museum, placed: Placed[]): CheckItem[] {
  const T = m.settings.wallThickness;
  const items: CheckItem[] = [];
  const spans = wallSpans(m.walls, wallEnds(m.walls), T);
  const runs = new Map<string, Range[]>();
  for (const p of placed) {
    if (!p.layout || !p.span) continue;
    const name = `"${workLabel(m, p.work)}"`;
    const target: CheckTarget = { type: 'work', id: p.work.id };
    const { from, to } = p.span;

    let run = runs.get(p.wall.id);
    if (!run) runs.set(p.wall.id, (run = wallRun(p.wall, m, spans)));
    const over = longestUncovered(from, to, run);
    if (over > TOL) items.push({ kind: 'label-past-wall', severity: 'warning', message: `Label of ${name} sticks out past the wall by ${metres(over)} m`, target, at: p.center });

    // the plaque's line on the face plane, one centimetre out from the face
    const off = T / 2 + 0.01;
    const a = { x: p.wall.a.x + p.dir.x * from + p.normal.x * off, y: p.wall.a.y + p.dir.y * from + p.normal.y * off };
    const b = { x: p.wall.a.x + p.dir.x * to + p.normal.x * off, y: p.wall.a.y + p.dir.y * to + p.normal.y * off };
    const hit = m.walls.some((o) => {
      if (o === p.wall || onLineOf(p.wall, o) || wallLength(o) === 0) return false;
      const side = Math.max((o.a.x - p.wall.a.x) * p.normal.x + (o.a.y - p.wall.a.y) * p.normal.y, (o.b.x - p.wall.a.x) * p.normal.x + (o.b.y - p.wall.a.y) * p.normal.y);
      if (side <= T / 2) return false; // does not reach the work's side
      return segmentSegmentDistance(a, b, o.a, o.b) <= T / 2;
    });
    if (hit) items.push({ kind: 'label-into-wall', severity: 'warning', message: `Label of ${name} runs into a wall`, target, at: p.center });
  }
  return items;
}

// ---------- 4. overlaps ----------

interface Rect {
  owner: Placed;
  plaque: boolean;
  c: Vec2; // centre on the face plane
  hw: number; // half width along the wall
  y0: number;
  y1: number;
}

function rectsOf(placed: Placed[]): Rect[] {
  const out: Rect[] = [];
  for (const p of placed) {
    out.push({ owner: p, plaque: false, c: p.center, hw: (p.w + 0.04) / 2, y0: p.work.centerHeight - (p.h + 0.04) / 2, y1: p.work.centerHeight + (p.h + 0.04) / 2 });
    if (p.layout && p.span) {
      const mid = (p.span.from + p.span.to) / 2 - p.t;
      const bottom = p.work.centerHeight - p.h / 2;
      out.push({ owner: p, plaque: true, c: { x: p.center.x + p.dir.x * mid, y: p.center.y + p.dir.y * mid }, hw: p.layout.w / 2, y0: bottom, y1: bottom + p.layout.h });
    }
  }
  return out;
}

function overlapItems(m: Museum, placed: Placed[]): CheckItem[] {
  const items: CheckItem[] = [];
  // everything the editor's own Warnings panel says
  for (const w of computeWarnings(m)) {
    const t = w.target;
    const target: CheckTarget | undefined = t.type === 'settings' ? undefined : t.type === 'spawn' ? { type: 'spawn' } : { type: t.type, id: t.id };
    let at: Vec2 | undefined;
    if (t.type === 'work') at = placed.find((p) => p.work.id === t.id)?.center;
    items.push({ kind: w.kind, severity: 'warning', message: w.message, target, at });
  }

  const rects = rectsOf(placed);
  const TOL_OVERLAP = 1e-6;
  const name = (r: Rect) => `"${workLabel(m, r.owner.work)}"`;
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      if (a.owner === b.owner) continue; // a plaque and its own work
      // same plane: the same outward normal, and the face centres on one line
      const n = a.owner.normal, k = b.owner.normal;
      if (n.x * k.x + n.y * k.y < 0.9998) continue;
      const dx = b.c.x - a.c.x, dy = b.c.y - a.c.y;
      if (Math.abs(dx * n.x + dy * n.y) > LINE_EPS) continue;
      const along = Math.abs(dx * a.owner.dir.x + dy * a.owner.dir.y);
      if (along >= a.hw + b.hw - TOL_OVERLAP) continue;
      if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= TOL_OVERLAP) continue;
      let message: string;
      if (!a.plaque && !b.plaque) {
        if (a.owner.wall.id === b.owner.wall.id) continue; // same wall and side: computeWarnings has it
        message = `Works ${name(a)} and ${name(b)} overlap on one wall face (on two walls in a line)`;
      } else if (a.plaque && b.plaque) message = `Labels of ${name(a)} and ${name(b)} overlap`;
      else {
        const [plaque, work] = a.plaque ? [a, b] : [b, a];
        message = `Label of ${name(plaque)} overlaps the painting ${name(work)}`;
      }
      items.push({ kind: 'overlap', severity: 'warning', message, target: { type: 'work', id: a.owner.work.id }, at: a.owner.center });
    }
  }
  return items;
}

// ---------- 5. missing artists ----------

function artistItems(m: Museum): CheckItem[] {
  const items: CheckItem[] = [];
  const seen = new Set<string>();
  for (const work of m.works) {
    if (work.hideLabel || seen.has(work.mediaId)) continue; // no label: a missing artist does not show
    seen.add(work.mediaId);
    const media = findMedia(m, work.mediaId);
    if (!media || media.kind !== 'image' || (media.artist ?? '').trim() !== '') continue;
    const wall = findWall(m, work.wallId);
    items.push({
      kind: 'no-artist',
      severity: 'info',
      message: `"${media.title || media.name}" has no artist`,
      target: { type: 'work', id: work.id },
      at: wall ? workPlacement(wall, work, m.settings.wallThickness).center : undefined,
    });
  }
  return items;
}

// ---------- all of it ----------

const ORDER: Record<CheckSeverity, number> = { problem: 0, warning: 1, info: 2 };

export function checkMuseum(m: Museum, measure: MeasureText): CheckReport {
  const t0 = nowMs();
  const placed = place(m, measure);
  const gaps = narrowDoorways(m);
  const items = [
    ...reachabilityItems(m, gaps),
    ...doorwayItems(m, gaps),
    ...labelItems(m, placed),
    ...overlapItems(m, placed),
    ...artistItems(m),
  ];
  items.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]); // stable: order of discovery within a severity
  return { items, ms: nowMs() - t0 };
}
