import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { Museum, Vec2, ZoneShape } from '../shared/museum';
import { closestPointOnSegment, wallDirection, wallLength, workPlacement } from '../shared/geometry';
import {
  addRoom, addWall, addZone, coincidentEndpoints, defaultWorkWidth, findHangTarget, findWork, findZone, hangWork, moveEndpoints, pickRandomPainting,
  moveWall, moveZone, resizeCircle, resizeRect, round4, setSpawn, setWorkT, snapPoint, snapValue, updateZone, type EndpointRef,
} from './model';
import { hitTest, workSegment, zoneHandles } from './hit';
import { areaHandles, hitTestAreas } from './hit';
import {
  addArea, fillRoom, findArea, MIN_AREA_SIZE, moveArea, rectFromDrag, resizeAreaRect, snapAreaMove, snapAreaPoint, updateArea,
} from './areaModel';
import type { Layer, Selection, Tool } from './types';

export interface CanvasHandle {
  /** Cancels an in-progress wall chain / draft. Returns true if something was cancelled. */
  cancelDraft(): boolean;
  fit(): void;
}

interface Props {
  museum: Museum;
  tool: Tool;
  layer: Layer;
  selection: Selection;
  selectedMediaId: string | null;
  /** Hang a randomly chosen painting on each click instead of the selected one. */
  randomHang: boolean;
  /** Audio media to give new zones (selected in the library, or the first one). */
  audioMediaId: string | null;
  onSelect(s: Selection): void;
  /** Live change during a drag (not undoable on its own). */
  onPreview(m: Museum): void;
  /** Finish a drag: `base` is the state before it began. */
  onCommit(base: Museum): void;
  /** A discrete undoable change. */
  onChange(m: Museum): void;
  onNotice(msg: string): void;
  /** True from the pointerdown that starts an edit gesture until it ends (commit or cancel). */
  onInteraction(active: boolean): void;
  handleRef: Ref<CanvasHandle>;
}

interface View { cx: number; cy: number; scale: number }

type Drag =
  | { kind: 'end'; base: Museum; refs: EndpointRef[]; moved: boolean }
  | { kind: 'wall'; base: Museum; id: string; start: Vec2; moved: boolean }
  | { kind: 'work'; base: Museum; id: string; moved: boolean }
  | { kind: 'zone'; base: Museum; id: string; start: Vec2; moved: boolean }
  | { kind: 'handle'; base: Museum; id: string; handle: 'nw' | 'ne' | 'se' | 'sw' | 'radius'; moved: boolean }
  | { kind: 'spawn'; base: Museum; start: Vec2; moved: boolean }
  | { kind: 'spawnTool'; base: Museum; start: Vec2; moved: boolean }
  | { kind: 'area'; base: Museum; id: string; start: Vec2; moved: boolean }
  | { kind: 'areaHandle'; base: Museum; id: string; handle: 'nw' | 'ne' | 'se' | 'sw'; moved: boolean };

type Draft =
  | { kind: 'room'; start: Vec2 }
  | { kind: 'zoneRect'; start: Vec2 }
  | { kind: 'zoneCircle'; start: Vec2 }
  | { kind: 'areaRect'; start: Vec2 };

const ENDPOINT_SNAP_M = 0.3;
const PICK_PX = 9;

function niceStep(minM: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  return steps.find((s) => s >= minM) ?? 1000;
}

function boundsOf(m: Museum): { x0: number; y0: number; x1: number; y1: number } {
  const xs: number[] = [m.settings.spawn.x], ys: number[] = [m.settings.spawn.y];
  for (const w of m.walls) xs.push(w.a.x, w.b.x), ys.push(w.a.y, w.b.y);
  for (const a of m.areas) xs.push(a.rect.x, a.rect.x + a.rect.w), ys.push(a.rect.y, a.rect.y + a.rect.h);
  for (const z of m.zones) {
    if (z.shape.kind === 'rect') xs.push(z.shape.x, z.shape.x + z.shape.w), ys.push(z.shape.y, z.shape.y + z.shape.h);
    else xs.push(z.shape.cx - z.shape.r, z.shape.cx + z.shape.r), ys.push(z.shape.cy - z.shape.r, z.shape.cy + z.shape.r);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

export function Canvas(p: Props) {
  const { museum: m, tool, selection, layer } = p;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 60 });
  const [space, setSpace] = useState(false);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [cursorPx, setCursorPx] = useState<Vec2>({ x: 0, y: 0 });
  const [chain, setChain] = useState<Vec2 | null>(null); // last point of the wall being drawn
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panning, setPanning] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const fitted = useRef(false);

  const grid = m.settings.gridSize;

  const fit = useCallback(() => {
    const b = boundsOf(m);
    const w = Math.max(b.x1 - b.x0, 4) + 4;
    const h = Math.max(b.y1 - b.y0, 4) + 4;
    const scale = Math.min(size.w / w, size.h / h, 200);
    setView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Math.max(scale, 8) });
  }, [m, size.w, size.h]);

  useImperativeHandle(
    p.handleRef,
    () => ({
      cancelDraft() {
        const had = chain !== null || draft !== null || drag.current !== null;
        if (drag.current) {
          p.onPreview(drag.current.base);
          drag.current = null;
        }
        setChain(null);
        setDraft(null);
        p.onInteraction(false);
        return had;
      },
      fit,
    }),
    [chain, draft, fit, p],
  );

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!fitted.current && size.w > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, size.w]);

  // tool switch cancels drafts
  useEffect(() => {
    setChain(null);
    setDraft(null);
    p.onInteraction(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // space = pan modifier
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target)) {
        setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const vb = useMemo(() => {
    const w = size.w / view.scale, h = size.h / view.scale;
    return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
  }, [view, size]);

  const toPlan = useCallback(
    (e: { clientX: number; clientY: number }): Vec2 => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: vb.x + (e.clientX - r.left) / view.scale, y: vb.y + (e.clientY - r.top) / view.scale };
    },
    [vb, view.scale],
  );

  // wheel zoom around cursor (needs a non-passive listener)
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setView((v) => {
        const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const scale = Math.min(Math.max(v.scale * k, 4), 600);
        const w0 = size.w / v.scale, h0 = size.h / v.scale;
        const wx = v.cx - w0 / 2 + px / v.scale, wy = v.cy - h0 / 2 + py / v.scale; // plan point under cursor
        const w1 = size.w / scale, h1 = size.h / scale;
        return { scale, cx: wx - px / scale + w1 / 2, cy: wy - py / scale + h1 / 2 };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size]);

  const tol = PICK_PX / view.scale;

  /** Grid snap, plus snapping to existing wall endpoints within ~0.3 m (optionally excluding some). */
  const snap = (pt: Vec2, endpoints: boolean, exclude: EndpointRef[] = []): Vec2 => {
    if (endpoints) {
      let best: Vec2 | null = null, bd = ENDPOINT_SNAP_M;
      for (const w of m.walls)
        for (const end of ['a', 'b'] as const) {
          if (exclude.some((r) => r.wallId === w.id && r.end === end)) continue;
          const d = Math.hypot(pt.x - w[end].x, pt.y - w[end].y);
          if (d <= bd) (bd = d), (best = w[end]);
        }
      if (best) return { ...best };
    }
    return snapPoint(pt, grid);
  };

  const finishDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) p.onCommit(d.base);
    p.onInteraction(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && space)) {
      pan.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
      setPanning(true);
      svgRef.current!.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      if (tool === 'wall') setChain(null);
      return;
    }
    if (e.button !== 0) return;
    const pt = toPlan(e);
    svgRef.current!.setPointerCapture(e.pointerId);

    switch (tool) {
      case 'select': {
        if (layer === 'areas') {
          const ah = hitTestAreas(m, pt, tol, selection?.type === 'area' ? selection.id : null);
          if (!ah) return p.onSelect(null);
          if (ah.type === 'area') {
            p.onSelect({ type: 'area', id: ah.id });
            drag.current = { kind: 'area', base: m, id: ah.id, start: snapPoint(pt, grid), moved: false };
          } else drag.current = { kind: 'areaHandle', base: m, id: ah.id, handle: ah.handle, moved: false };
          break;
        }
        const hit = hitTest(m, pt, tol, selection?.type === 'zone' ? selection.id : null);
        if (!hit) return p.onSelect(null);
        switch (hit.type) {
          case 'wallEnd':
            p.onSelect({ type: 'wall', id: hit.id });
            drag.current = { kind: 'end', base: m, refs: coincidentEndpoints(m, hit.id, hit.end), moved: false };
            break;
          case 'wall':
            p.onSelect({ type: 'wall', id: hit.id });
            drag.current = { kind: 'wall', base: m, id: hit.id, start: snapPoint(pt, grid), moved: false };
            break;
          case 'work':
            p.onSelect({ type: 'work', id: hit.id });
            drag.current = { kind: 'work', base: m, id: hit.id, moved: false };
            break;
          case 'zone':
            p.onSelect({ type: 'zone', id: hit.id });
            drag.current = { kind: 'zone', base: m, id: hit.id, start: snapPoint(pt, grid), moved: false };
            break;
          case 'zoneHandle':
            drag.current = { kind: 'handle', base: m, id: hit.id, handle: hit.handle, moved: false };
            break;
          case 'spawn':
            p.onSelect({ type: 'spawn' });
            drag.current = { kind: 'spawn', base: m, start: snapPoint(pt, grid), moved: false };
            break;
        }
        break;
      }
      case 'wall': {
        const s = snap(pt, true);
        if (chain) {
          const r = addWall(m, chain, s);
          if (r) {
            p.onChange(r.museum);
            p.onSelect({ type: 'wall', id: r.id });
            setChain(s);
          }
        } else setChain(s);
        break;
      }
      case 'room':
        setDraft({ kind: 'room', start: snap(pt, true) });
        p.onInteraction(true);
        break;
      case 'zoneRect':
      case 'zoneCircle':
        if (!p.audioMediaId) {
          p.onNotice('Upload an audio file to the media library first; zones play one audio file.');
          return;
        }
        setDraft({ kind: tool, start: snapPoint(pt, grid) });
        p.onInteraction(true);
        break;
      case 'areaRect':
        setDraft({ kind: 'areaRect', start: snapAreaPoint(m, pt, grid) });
        p.onInteraction(true);
        break;
      case 'areaFill': {
        const rect = fillRoom(m, pt);
        const r = rect && addArea(m, rect);
        if (!r) {
          p.onNotice('Click inside a room closed on all four sides (walls to the left, right, above and below).');
          return;
        }
        p.onChange(r.museum);
        p.onSelect({ type: 'area', id: r.id });
        break;
      }
      case 'work': {
        let mediaId = p.selectedMediaId;
        if (p.randomHang) {
          const pick = pickRandomPainting(m, Math.random);
          if (!pick) {
            p.onNotice('Add a painting to the media library first.');
            return;
          }
          mediaId = pick.id;
        } else if (!mediaId) {
          p.onNotice('Select a painting in the media library first, or switch on Random painting.');
          return;
        }
        const target = findHangTarget(m, pt, Math.max(0.4, tol));
        if (!target) {
          p.onNotice('Click close to a wall face to hang the work.');
          return;
        }
        const r = hangWork(m, mediaId, { ...target, t: round4(snapValue(target.t, 0.05)) });
        if (r) {
          p.onChange(r.museum);
          p.onSelect({ type: 'work', id: r.id });
        }
        break;
      }
      case 'spawn': {
        const s = snapPoint(pt, grid);
        drag.current = { kind: 'spawnTool', base: m, start: s, moved: true };
        p.onPreview(setSpawn(m, { x: s.x, y: s.y }));
        p.onSelect({ type: 'spawn' });
        break;
      }
    }
    if (drag.current) p.onInteraction(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    setCursorPx({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (pan.current) {
      const dx = (e.clientX - pan.current.x) / view.scale, dy = (e.clientY - pan.current.y) / view.scale;
      setView((v) => ({ ...v, cx: pan.current!.cx - dx, cy: pan.current!.cy - dy }));
      return;
    }
    const pt = toPlan(e);
    setCursor(tool === 'wall' || tool === 'room' ? snap(pt, true) : tool === 'areaRect' ? snapAreaPoint(m, pt, grid) : pt);
    const d = drag.current;
    if (!d) return;
    const base = d.base;
    switch (d.kind) {
      case 'end': {
        const s = snap(pt, true, d.refs);
        d.moved = true;
        p.onPreview(moveEndpoints(base, d.refs, s));
        break;
      }
      case 'wall': {
        const s = snapPoint(pt, grid);
        d.moved = true;
        p.onPreview(moveWall(base, d.id, { x: s.x - d.start.x, y: s.y - d.start.y }));
        break;
      }
      case 'work': {
        const w = findWork(base, d.id);
        const wall = w && base.walls.find((x) => x.id === w.wallId);
        if (!w || !wall) return;
        const t = closestPointOnSegment(pt, wall.a, wall.b).t;
        d.moved = true;
        p.onPreview(setWorkT(base, d.id, snapValue(t, 0.05)));
        break;
      }
      case 'zone': {
        const s = snapPoint(pt, grid);
        d.moved = true;
        p.onPreview(moveZone(base, d.id, { x: s.x - d.start.x, y: s.y - d.start.y }));
        break;
      }
      case 'handle': {
        const z = findZone(base, d.id);
        if (!z) return;
        const s = snapPoint(pt, grid);
        d.moved = true;
        const shape: ZoneShape =
          z.shape.kind === 'rect' && d.handle !== 'radius'
            ? resizeRect(z.shape, d.handle, s, grid)
            : z.shape.kind === 'circle'
              ? resizeCircle(z.shape, s, grid)
              : z.shape;
        p.onPreview(updateZone(base, d.id, { shape }));
        break;
      }
      case 'spawn': {
        const s = snapPoint(pt, grid);
        d.moved = true;
        p.onPreview(setSpawn(base, { x: s.x, y: s.y }));
        break;
      }
      case 'area': {
        const a = findArea(base, d.id);
        if (!a) return;
        const s = snapPoint(pt, grid);
        d.moved = true;
        p.onPreview(moveArea(base, d.id, snapAreaMove(base, a.rect, { x: s.x - d.start.x, y: s.y - d.start.y })));
        break;
      }
      case 'areaHandle': {
        const a = findArea(base, d.id);
        if (!a) return;
        d.moved = true;
        p.onPreview(updateArea(base, d.id, { rect: resizeAreaRect(a.rect, d.handle, snapAreaPoint(base, pt, grid), MIN_AREA_SIZE) }));
        break;
      }
      case 'spawnTool': {
        const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
        if (Math.hypot(dx, dy) > 0.15) {
          const yaw = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
          p.onPreview(setSpawn(base, { x: d.start.x, y: d.start.y, yawDeg: (yaw + 360) % 360 }));
        }
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pan.current) {
      pan.current = null;
      setPanning(false);
      return;
    }
    if (draft) {
      const pt = toPlan(e);
      if (draft.kind === 'room') {
        const s = snap(pt, true);
        const r = addRoom(m, draft.start, s);
        if (r) {
          p.onChange(r.museum);
          p.onSelect({ type: 'wall', id: r.ids[0] });
        }
      } else if (draft.kind === 'areaRect') {
        const r = addArea(m, rectFromDrag(draft.start, snapAreaPoint(m, pt, grid)));
        if (r) {
          p.onChange(r.museum);
          p.onSelect({ type: 'area', id: r.id });
        }
      } else if (p.audioMediaId) {
        const s = snapPoint(pt, grid);
        if (draft.kind === 'zoneRect') {
          const x0 = Math.min(draft.start.x, s.x), y0 = Math.min(draft.start.y, s.y);
          const w = Math.abs(s.x - draft.start.x), h = Math.abs(s.y - draft.start.y);
          if (w > 0 && h > 0) {
            const r = addZone(m, { kind: 'rect', x: x0, y: y0, w, h }, p.audioMediaId);
            p.onChange(r.museum);
            p.onSelect({ type: 'zone', id: r.id });
          }
        } else {
          const rad = round4(Math.hypot(s.x - draft.start.x, s.y - draft.start.y));
          if (rad > 0) {
            const r = addZone(m, { kind: 'circle', cx: draft.start.x, cy: draft.start.y, r: rad }, p.audioMediaId);
            p.onChange(r.museum);
            p.onSelect({ type: 'zone', id: r.id });
          }
        }
      }
      setDraft(null);
    }
    finishDrag();
  };

  const onPointerLeave = () => setCursor(null);

  // ---------- rendering ----------
  const px = 1 / view.scale;
  const fs = 11 * px;

  const gridEls = useMemo(() => {
    const minor = grid * 2 ** Math.max(0, Math.ceil(Math.log2(10 / view.scale / grid)));
    const major = niceStep(70 / view.scale);
    const els: React.ReactNode[] = [];
    const lines = (step: number, cls: string) => {
      for (let x = Math.ceil(vb.x / step) * step; x <= vb.x + vb.w; x += step)
        els.push(<line key={`${cls}vx${x}`} className={cls} x1={x} x2={x} y1={vb.y} y2={vb.y + vb.h} />);
      for (let y = Math.ceil(vb.y / step) * step; y <= vb.y + vb.h; y += step)
        els.push(<line key={`${cls}hy${y}`} className={cls} x1={vb.x} x2={vb.x + vb.w} y1={y} y2={y} />);
    };
    lines(minor, 'grid-minor');
    lines(major, 'grid-major');
    for (let x = Math.ceil(vb.x / major) * major; x <= vb.x + vb.w; x += major)
      els.push(<text key={`tx${x}`} className="grid-label" x={x + 3 * px} y={vb.y + 12 * px} fontSize={fs}>{round4(x)} m</text>);
    for (let y = Math.ceil(vb.y / major) * major; y <= vb.y + vb.h; y += major)
      els.push(<text key={`ty${y}`} className="grid-label" x={vb.x + 4 * px} y={y - 3 * px} fontSize={fs}>{round4(y)} m</text>);
    return els;
  }, [vb, view.scale, grid, px, fs]);

  const scaleBar = useMemo(() => {
    const len = niceStep(100 / view.scale);
    return { len, px: len * view.scale };
  }, [view.scale]);

  const th = m.settings.wallThickness;
  const selWall = selection?.type === 'wall' ? m.walls.find((w) => w.id === selection.id) : undefined;
  const selZone = selection?.type === 'zone' ? findZone(m, selection.id) : undefined;
  const ghostMediaId = p.randomHang ? m.media.find((x) => x.kind === 'image')?.id ?? null : p.selectedMediaId;
  const ghost = tool === 'work' && cursor && ghostMediaId ? findHangTarget(m, cursor, Math.max(0.4, tol)) : null;

  const shapeEl = (shape: ZoneShape, cls: string, key?: string) =>
    shape.kind === 'rect' ? (
      <rect key={key} className={cls} x={shape.x} y={shape.y} width={shape.w} height={shape.h} />
    ) : (
      <circle key={key} className={cls} cx={shape.cx} cy={shape.cy} r={shape.r} />
    );
  const insetShape = (shape: ZoneShape, inset: number): ZoneShape | null => {
    if (inset <= 0) return null;
    if (shape.kind === 'rect') return shape.w > 2 * inset && shape.h > 2 * inset ? { ...shape, x: shape.x + inset, y: shape.y + inset, w: shape.w - 2 * inset, h: shape.h - 2 * inset } : null;
    return shape.r > inset ? { ...shape, r: shape.r - inset } : null;
  };

  const draftShape: ZoneShape | null = (() => {
    if (!draft || !cursor || draft.kind === 'areaRect') return null;
    const s = draft.kind === 'room' ? cursor : snapPoint(cursor, grid);
    if (draft.kind === 'zoneCircle') return { kind: 'circle', cx: draft.start.x, cy: draft.start.y, r: Math.hypot(s.x - draft.start.x, s.y - draft.start.y) };
    return { kind: 'rect', x: Math.min(draft.start.x, s.x), y: Math.min(draft.start.y, s.y), w: Math.abs(s.x - draft.start.x), h: Math.abs(s.y - draft.start.y) };
  })();

  const areaDraft = draft?.kind === 'areaRect' && cursor ? rectFromDrag(draft.start, cursor) : null;
  const readout = (() => {
    if (tool === 'wall' && chain && cursor) {
      const len = Math.hypot(cursor.x - chain.x, cursor.y - chain.y);
      const ang = ((Math.atan2(cursor.y - chain.y, cursor.x - chain.x) * 180) / Math.PI + 360) % 360;
      return `${len.toFixed(2)} m  ${Math.round(ang)}°`;
    }
    if (areaDraft) return `${areaDraft.w.toFixed(2)} × ${areaDraft.h.toFixed(2)} m`;
    if (draftShape?.kind === 'rect') return `${draftShape.w.toFixed(2)} × ${draftShape.h.toFixed(2)} m`;
    if (draftShape?.kind === 'circle') return `r ${draftShape.r.toFixed(2)} m`;
    return null;
  })();

  const fillPreview = layer === 'areas' && tool === 'areaFill' && cursor ? fillRoom(m, cursor) : null;
  const selArea = selection?.type === 'area' ? findArea(m, selection.id) : undefined;
  const patterns = new Map<string, { id: string; href: string; tile: number }>();
  const areaFace = (a: (typeof m.areas)[number]) => a.floor ?? a.ceiling!;
  for (const a of m.areas) {
    const f = areaFace(a);
    const media = f.textureId ? m.media.find((x) => x.id === f.textureId && x.kind === 'texture') : undefined;
    if (media) patterns.set(`${f.textureId}|${f.tileSize}`, { id: `ap-${patterns.size}`, href: `./museum/${media.file}`, tile: f.tileSize });
  }
  const dim = layer === 'areas' ? 'layer-dim' : '';

  const spawn = m.settings.spawn;
  const yaw = (spawn.yawDeg * Math.PI) / 180;
  const sdx = Math.sin(yaw), sdy = -Math.cos(yaw);

  const cls = ['canvas-wrap', panning ? 'panning' : space ? 'space' : `tool-${tool}`].join(' ');

  return (
    <div className={cls} ref={wrapRef}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g>{gridEls}</g>
        <line className="origin" x1={-0.3} x2={0.3} y1={0} y2={0} />
        <line className="origin" x1={0} x2={0} y1={-0.3} y2={0.3} />

        <defs>
          {[...patterns.values()].map((pt) => (
            <pattern key={pt.id} id={pt.id} x={0} y={0} width={pt.tile} height={pt.tile} patternUnits="userSpaceOnUse">
              <image href={pt.href} x={0} y={0} width={pt.tile} height={pt.tile} preserveAspectRatio="none" />
            </pattern>
          ))}
        </defs>

        <g className={layer === 'areas' ? 'areas-layer' : 'areas-layer faint'}>
          {m.areas.map((a) => {
            const f = areaFace(a);
            const pat = f.textureId ? patterns.get(`${f.textureId}|${f.tileSize}`) : undefined;
            const sel = selection?.type === 'area' && selection.id === a.id;
            const r = a.rect;
            const tag = a.floor && a.ceiling ? 'F+C' : a.floor ? 'F' : 'C';
            return (
              <g key={a.id} className={'area' + (sel ? ' selected' : '') + (a.floor ? '' : ' ceiling-only')}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={f.color} fillOpacity={0.55} />
                {pat && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${pat.id})`} fillOpacity={0.6} />}
                <rect className="area-outline" x={r.x} y={r.y} width={r.w} height={r.h} />
                {layer === 'areas' && (
                  <text className="area-label" x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={fs} strokeWidth={3 * px} textAnchor="middle" dominantBaseline="middle">
                    {a.name || a.id} · {tag}
                  </text>
                )}
              </g>
            );
          })}
          {selArea && layer === 'areas' && areaHandles(selArea.rect).map((h) => (
            <rect key={h.handle} className="handle" x={h.p.x - 5 * px} y={h.p.y - 5 * px} width={10 * px} height={10 * px} />
          ))}
          {areaDraft && <rect className="area-outline draft" x={areaDraft.x} y={areaDraft.y} width={areaDraft.w} height={areaDraft.h} />}
          {fillPreview && <rect className="area-outline draft" x={fillPreview.x} y={fillPreview.y} width={fillPreview.w} height={fillPreview.h} />}
        </g>

        <g className={dim}>
        {m.zones.map((z) => {
          const inner = selection?.type === 'zone' && selection.id === z.id ? insetShape(z.shape, z.fade) : null;
          const c = z.shape.kind === 'rect' ? { x: z.shape.x + z.shape.w / 2, y: z.shape.y + z.shape.h / 2 } : { x: z.shape.cx, y: z.shape.cy };
          return (
            <g key={z.id} className={selection?.type === 'zone' && selection.id === z.id ? 'zone selected' : 'zone'}>
              {shapeEl(z.shape, 'zone-shape')}
              {inner && shapeEl(inner, 'zone-fade')}
              <text className="zone-label" x={c.x} y={c.y} fontSize={fs * 1.1} textAnchor="middle" dominantBaseline="middle">♪ {z.name}</text>
            </g>
          );
        })}

        {m.walls.map((w) => (
          <g key={w.id}>
            <line className={'wall' + (w.finish ? ' custom' : '') + (selection?.type === 'wall' && selection.id === w.id ? ' selected' : '')} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} strokeWidth={th} />
          </g>
        ))}
        {m.walls.map((w) =>
          (['a', 'b'] as const).map((end) => <circle key={`${w.id}${end}`} className="endpoint" cx={w[end].x} cy={w[end].y} r={3 * px} />),
        )}

        {m.works.map((w) => {
          const wall = m.walls.find((x) => x.id === w.wallId);
          if (!wall) return null;
          const { center, normal } = workPlacement(wall, w, th);
          const d = wallDirection(wall);
          const h = w.width / 2, off = 0.05;
          const ox = normal.x * off, oy = normal.y * off;
          const sel = selection?.type === 'work' && selection.id === w.id;
          return (
            <line
              key={w.id}
              className={sel ? 'work selected' : 'work'}
              x1={center.x - d.x * h + ox}
              y1={center.y - d.y * h + oy}
              x2={center.x + d.x * h + ox}
              y2={center.y + d.y * h + oy}
              strokeWidth={0.1}
            />
          );
        })}

        {selWall && (
          <g className="sel-overlay">
            {(['a', 'b'] as const).map((end) => (
              <rect key={end} className="handle" x={selWall[end].x - 5 * px} y={selWall[end].y - 5 * px} width={10 * px} height={10 * px} />
            ))}
            <text className="dim-label" fontSize={fs} textAnchor="middle" x={(selWall.a.x + selWall.b.x) / 2} y={(selWall.a.y + selWall.b.y) / 2 - (th / 2 + 6 * px)}>
              {wallLength(selWall).toFixed(2)} m
            </text>
          </g>
        )}
        {selZone &&
          zoneHandles(selZone.shape).map((h) => (
            <rect key={h.handle} className="handle" x={h.p.x - 5 * px} y={h.p.y - 5 * px} width={10 * px} height={10 * px} />
          ))}

        <g className={selection?.type === 'spawn' ? 'spawn selected' : 'spawn'}>
          <circle cx={spawn.x} cy={spawn.y} r={0.25} />
          <line x1={spawn.x} y1={spawn.y} x2={spawn.x + sdx * 0.8} y2={spawn.y + sdy * 0.8} />
          <polygon points={`${spawn.x + sdx * 0.95},${spawn.y + sdy * 0.95} ${spawn.x + sdx * 0.6 - sdy * 0.18},${spawn.y + sdy * 0.6 + sdx * 0.18} ${spawn.x + sdx * 0.6 + sdy * 0.18},${spawn.y + sdy * 0.6 - sdx * 0.18}`} />
        </g>

        </g>

        {/* in-progress drawing */}
        {tool === 'wall' && cursor && (
          <g className="draft">
            {chain && <line className="wall draft-wall" x1={chain.x} y1={chain.y} x2={cursor.x} y2={cursor.y} strokeWidth={th} />}
            <circle className="snap-dot" cx={cursor.x} cy={cursor.y} r={5 * px} />
          </g>
        )}
        {draft?.kind === 'room' && draftShape?.kind === 'rect' && <rect className="draft-room" x={draftShape.x} y={draftShape.y} width={draftShape.w} height={draftShape.h} strokeWidth={th} />}
        {draft && draft.kind !== 'room' && draftShape && shapeEl(draftShape, 'zone-shape draft')}
        {ghost && (() => {
          const wall = m.walls.find((w) => w.id === ghost.wallId)!;
          const width = defaultWorkWidth(wallLength(wall));
          const seg = workSegment(
            { ...m, works: [{ id: '_', mediaId: ghostMediaId!, wallId: wall.id, side: ghost.side, t: ghost.t, centerHeight: 1.5, width }] },
            '_',
          );
          if (!seg) return null;
          const n = { x: -(wall.b.y - wall.a.y), y: wall.b.x - wall.a.x };
          const nl = Math.hypot(n.x, n.y) || 1;
          const ox = (n.x / nl) * ghost.side * 0.05, oy = (n.y / nl) * ghost.side * 0.05;
          return <line className="work ghost" x1={seg.a.x + ox} y1={seg.a.y + oy} x2={seg.b.x + ox} y2={seg.b.y + oy} strokeWidth={0.1} />;
        })()}
        {tool === 'spawn' && cursor && !drag.current && <circle className="snap-dot" cx={snapPoint(cursor, grid).x} cy={snapPoint(cursor, grid).y} r={5 * px} />}
      </svg>

      {readout && cursor && (
        <div className="readout" style={{ left: cursorPx.x + 16, top: cursorPx.y + 16 }}>{readout}</div>
      )}
      <div className={'layer-badge ' + layer}>{layer === 'areas' ? 'Areas layer: walls and works are locked' : 'Build layer'}</div>
      <div className="scalebar">
        <div className="scalebar-line" style={{ width: scaleBar.px }} />
        <span>{scaleBar.len} m</span>
      </div>
      <div className="zoombox">
        <button title="Fit to museum" onClick={fit}>Fit</button>
        <span>{Math.round(view.scale)} px/m</span>
      </div>
    </div>
  );
}
