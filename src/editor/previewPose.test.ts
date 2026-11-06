import { describe, expect, it } from 'vitest';
import type { Museum, Work } from '../shared/museum';
import { defaultMuseum } from '../shared/validate';
import { parseAt, withStartPose } from '../shared/startPose';
import { previewHere, workPreviewPose } from './previewPose';

function museumWith(walls: Museum['walls'], work: Partial<Work> = {}, mediaSize = { width: 100, height: 100 }): { m: Museum; work: Work } {
  const m = defaultMuseum();
  m.media = [{ id: 'm1', kind: 'image', file: 'media/m1.jpg', name: 'm1', ...mediaSize }];
  m.walls = walls;
  const w: Work = { id: 'w1', mediaId: 'm1', wallId: walls[0]?.id ?? 'x', side: 1, t: 2, centerHeight: 1.5, width: 1, ...work };
  m.works = [w];
  return { m, work: w };
}
const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('workPreviewPose yaw and position', () => {
  // wall direction d, side 1 = perp(d) = (-d.y, d.x)
  it.each([
    ['east-running wall, side 1 faces +y (down)', wall('a', 0, 0, 4, 0), 1, 0, { x: 2, y: 0.1 + 1.5 }],
    ['east-running wall, side -1 faces -y (up)', wall('a', 0, 0, 4, 0), -1, 180, { x: 2, y: -0.1 - 1.5 }],
    ['south-running wall, side 1 faces -x (left)', wall('a', 0, 0, 0, 4), 1, 90, { x: -0.1 - 1.5, y: 2 }],
    ['south-running wall, side -1 faces +x (right)', wall('a', 0, 0, 0, 4), -1, 270, { x: 0.1 + 1.5, y: 2 }],
  ] as const)('%s', (_n, w, side, yaw, pos) => {
    const { m, work } = museumWith([w], { side });
    const p = workPreviewPose(m, work)!;
    expect(((p.yawDeg % 360) + 360) % 360).toBeCloseTo(yaw, 6);
    expect(p.x).toBeCloseTo(pos.x, 2);
    expect(p.y).toBeCloseTo(pos.y, 2);
  });

  it('is reversed with the wall direction', () => {
    const { m, work } = museumWith([wall('a', 4, 0, 0, 0)], { side: 1, t: 2 }); // d = (-1,0): side 1 faces -y
    const p = workPreviewPose(m, work)!;
    expect(p.y).toBeCloseTo(-1.6, 2);
    expect(((p.yawDeg % 360) + 360) % 360).toBeCloseTo(180, 6);
  });

  it('faces the work on a diagonal wall', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 4, 4)], { side: 1, t: Math.SQRT2 * 2 });
    // d = (1,1)/sqrt2, normal = (-1,1)/sqrt2: the viewer is down-left of the work, looking up-right
    const p = workPreviewPose(m, work)!;
    const c = { x: 2 + (-0.1 / Math.SQRT2), y: 2 + 0.1 / Math.SQRT2 };
    const f = { x: Math.sin((p.yawDeg * Math.PI) / 180), y: -Math.cos((p.yawDeg * Math.PI) / 180) };
    const toWork = { x: c.x - p.x, y: c.y - p.y };
    const len = Math.hypot(toWork.x, toWork.y);
    expect(f.x).toBeCloseTo(toWork.x / len, 6);
    expect(f.y).toBeCloseTo(toWork.y / len, 6);
    expect(len).toBeCloseTo(1.5, 2);
  });
});

describe('workPreviewPose distance', () => {
  it('is 1.5 m for a small work', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 8, 0)], { width: 0.3, t: 4 });
    expect(workPreviewPose(m, work)!.y).toBeCloseTo(0.1 + 1.5, 2);
  });
  it('is 1.2 times the larger side', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 8, 0)], { width: 2, t: 4 }, { width: 100, height: 100 });
    expect(workPreviewPose(m, work)!.y).toBeCloseTo(0.1 + 2.4, 2);
    const tall = museumWith([wall('a', 0, 0, 8, 0)], { width: 1, t: 4 }, { width: 100, height: 300 });
    expect(workPreviewPose(tall.m, tall.work)!.y).toBeCloseTo(0.1 + 3.5, 2); // 1.2 * 3 = 3.6, clamped
  });
  it('is at most 3.5 m', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 12, 0)], { width: 6, t: 6 });
    expect(workPreviewPose(m, work)!.y).toBeCloseTo(0.1 + 3.5, 2);
  });
  it('stops short of a wall in the way', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 8, 0), wall('b', -2, 1.7, 8, 1.7)], { t: 4, width: 1 });
    const p = workPreviewPose(m, work)!;
    // clearance from the other wall's centre line: T/2 + radius + 0.05 = 0.4
    expect(p.y).toBeCloseTo(1.7 - 0.4, 1);
    expect(p.x).toBeCloseTo(4, 3);
  });
  it('never gets closer than the clearance to its own wall', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 8, 0), wall('b', -2, 0.5, 8, 0.5)], { t: 4, width: 1 });
    const p = workPreviewPose(m, work)!;
    expect(p.y).toBeCloseTo(0.1 + 0.4, 2);
  });
  it('ignores a wall drawn on top of its own line', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 8, 0), wall('b', 2, 0, 12, 0)], { t: 4, width: 1 });
    expect(workPreviewPose(m, work)!.y).toBeCloseTo(0.1 + 1.5, 2);
  });
});

describe('workPreviewPose missing parts', () => {
  it('is null without its wall or media', () => {
    const { m, work } = museumWith([wall('a', 0, 0, 4, 0)]);
    expect(workPreviewPose(m, { ...work, wallId: 'nope' })).toBeNull();
    expect(workPreviewPose(m, { ...work, mediaId: 'nope' })).toBeNull();
  });
});

describe('previewHere', () => {
  const { m, work } = museumWith([wall('a', 0, 0, 8, 0)], { t: 4 });
  m.zones = [
    { id: 'zr', name: 'r', mediaId: 'x', shape: { kind: 'rect', x: 2, y: 4, w: 4, h: 2 }, volume: 1, fade: 0 },
    { id: 'zc', name: 'c', mediaId: 'x', shape: { kind: 'circle', cx: 7, cy: 8, r: 2 }, volume: 1, fade: 0 },
  ];
  m.areas = [{ id: 'ar', name: 'a', rect: { x: 10, y: 20, w: 4, h: 6 }, openSky: true }];
  const view = { x: -3, y: 9 };
  it('work, zone, area', () => {
    expect(previewHere(m, { type: 'work', id: work.id }, view).pose).toEqual(workPreviewPose(m, work));
    expect(previewHere(m, { type: 'zone', id: 'zr' }, view).pose).toEqual({ x: 4, y: 5, yawDeg: 0 });
    expect(previewHere(m, { type: 'zone', id: 'zc' }, view).pose).toEqual({ x: 7, y: 8, yawDeg: 0 });
    expect(previewHere(m, { type: 'area', id: 'ar' }, view).pose).toEqual({ x: 12, y: 23, yawDeg: 0 });
  });
  it('spawn has no pose', () => {
    expect(previewHere(m, { type: 'spawn' }, view).pose).toBeNull();
  });
  it('nothing, a wall, or a missing item means the view centre', () => {
    for (const s of [null, { type: 'wall', id: 'a' }, { type: 'zone', id: 'gone' }] as const)
      expect(previewHere(m, s, view).pose).toEqual({ x: -3, y: 9, yawDeg: 0 });
  });
});

describe('folder flow url', () => {
  it('keeps ?source=folder and adds the pose', () => {
    const url = withStartPose('./index.html?source=folder', { x: 1.5, y: 2, yawDeg: 90 });
    expect(url).toBe('./index.html?source=folder&at=1.5,2,90');
    expect(new URLSearchParams(url.slice(url.indexOf('?'))).get('source')).toBe('folder');
    expect(parseAt(url.slice(url.indexOf('?')))).toEqual({ x: 1.5, y: 2, yawDeg: 90 });
  });
});
