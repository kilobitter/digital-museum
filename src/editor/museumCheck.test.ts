import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { MeasureText } from '../shared/labelLayout';
import type { AudioZone, MediaItem, Museum, Vec2, Wall, Work } from '../shared/museum';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import { checkMuseum, type CheckItem } from './museumCheck';

/** 10 px per character: a 30 character title is 348 px = 0.34 m wide. */
const ten: MeasureText = (t) => t.length * 10;
/** A fixed 300 px, so every plaque is 0.34 m wide. */
const fixed: MeasureText = () => 300;

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
let nextMedia = 0;
const image = (o: Partial<MediaItem> = {}): MediaItem => {
  const id = `m${nextMedia++}`;
  return { id, kind: 'image', file: `media/${id}.jpg`, name: id, width: 100, height: 100, artist: 'Someone', ...o };
};
const hang = (id: string, media: MediaItem, wallId: string, t: number, o: Partial<Work> = {}): Work => ({ id, mediaId: media.id, wallId, side: 1, t, centerHeight: 1.5, width: 1, ...o });

function museum(walls: Wall[], opts: { spawn?: Vec2; media?: MediaItem[]; works?: Work[]; zones?: AudioZone[] } = {}): Museum {
  const m = defaultMuseum();
  m.walls = walls;
  m.media = opts.media ?? [];
  m.works = opts.works ?? [];
  m.zones = opts.zones ?? [];
  m.settings.spawn = { x: opts.spawn?.x ?? 3, y: opts.spawn?.y ?? 3, yawDeg: 0 };
  return m;
}
/** A painting without a label (no title, no artist); `name` is what the messages call it. */
const plain = (name: string): MediaItem => image({ name, artist: undefined });
const audio = (): MediaItem => ({ id: 'au', kind: 'audio', file: 'media/au.wav', name: 'au' });
const zone = (id: string, x: number, y: number, w: number, h: number): AudioZone => ({ id, name: id, mediaId: 'au', shape: { kind: 'rect', x, y, w, h }, volume: 1, fade: 0 });

/** A 12 x 6 building (clockwise walls, so side 1 faces in) with a divider at x = 6 and a doorway of `door` metres at y = 3. */
function twoRooms(door: number | null, extra: Wall[] = []): Wall[] {
  const outer = [wall('top', 0, 0, 12, 0), wall('east', 12, 0, 12, 6), wall('bottom', 12, 6, 0, 6), wall('west', 0, 6, 0, 0)];
  if (door === null) return [...outer, wall('mid', 6, 0, 6, 6), ...extra];
  return [...outer, wall('mid1', 6, 0, 6, 3 - door / 2), wall('mid2', 6, 3 + door / 2, 6, 6), ...extra];
}
const kinds = (items: CheckItem[], severity?: string) => items.filter((i) => !severity || i.severity === severity).map((i) => i.kind);
const run = (m: Museum, measure = ten) => checkMuseum(m, measure);
const nothingAbout = (m: Museum) => run(m).items.filter((i) => i.severity !== 'info');
/** Only what the walking model decides. */
const walking = (m: Museum) => nothingAbout(m).filter((i) => !/^(label-|overlap|spawn-in-wall)/.test(i.kind));

describe('narrow doorways and reachability', () => {
  const paintings = () => {
    const ms = [image({ title: 'A' }), image({ title: 'B' }), image({ title: 'C' })];
    return { media: ms, works: ms.map((x, i) => hang(`w${i}`, x, 'east', 1.5 + 1.5 * i)) };
  };
  const rooms = (door: number | null, spawn: Vec2 = { x: 3, y: 3 }) => museum(twoRooms(door), { ...paintings(), spawn });

  it('reports nothing for two rooms joined by a 1.2 m doorway', () => {
    expect(nothingAbout(rooms(1.2))).toEqual([]);
  });

  it('reports a closed room with paintings, naming them', () => {
    const items = nothingAbout(rooms(null));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: 'problem', target: { type: 'work', id: 'w0' } });
    expect(items[0].message).toBe('3 paintings cannot be reached from the start point: "A", "B", "C"');
    expect(items[0].at!.x).toBeGreaterThan(6);
  });

  it('names one painting without a count', () => {
    const m = rooms(null);
    m.works = m.works.slice(0, 1);
    expect(nothingAbout(m)[0].message).toBe('"A" cannot be reached from the start point');
  });

  it('caps the names at five', () => {
    const ms = Array.from({ length: 7 }, (_, i) => image({ title: `P${i}` }));
    const m = museum(twoRooms(null), { media: ms, works: ms.map((x, i) => hang(`w${i}`, x, 'east', 0.6 + 0.8 * i, { width: 0.5 })) });
    expect(nothingAbout(m)[0].message).toBe('7 paintings cannot be reached from the start point: "P0", "P1", "P2", "P3", "P4" and 2 more');
  });

  it('reports a 0.5 m doorway as too narrow, and the room behind it as unreachable', () => {
    const items = nothingAbout(rooms(0.5));
    expect(kinds(items)).toEqual(['work-unreachable', 'narrow-doorway']);
    const door = items.find((i) => i.kind === 'narrow-doorway')!;
    expect(door.severity).toBe('warning');
    expect(door.message).toBe('Doorway is 0.50 m wide: too narrow to walk through (needs more than 0.70 m). Teleporting in VR may still get through.');
    expect(door.target).toEqual({ type: 'wall', id: 'mid1' });
    expect(door.at!.x).toBeCloseTo(6);
    expect(door.at!.y).toBeCloseTo(3);
  });

  it('reports a 0.70 m doorway (exactly 2R) as too narrow', () => {
    expect(kinds(nothingAbout(rooms(0.7)))).toEqual(['work-unreachable', 'narrow-doorway']);
  });

  it('accepts a 0.75 m doorway', () => {
    expect(nothingAbout(rooms(0.75))).toEqual([]);
  });

  it('does not call a gap no wider than the walls a doorway', () => {
    expect(kinds(nothingAbout(rooms(0.2)))).toEqual(['work-unreachable']);
  });

  it('accepts a 0.75 m doorway in a diagonal wall, and reports 0.5 m', () => {
    const diagonal = (door: number) => {
      const u = Math.SQRT1_2 * door / 2;
      const ms = [image({ title: 'A' })];
      return museum(
        [wall('top', 0, 0, 20, 0), wall('right', 20, 0, 20, 20), wall('bottom', 20, 20, 0, 20), wall('left', 0, 20, 0, 0), wall('d1', 0, 0, 10 - u, 10 - u), wall('d2', 10 + u, 10 + u, 20, 20)],
        { spawn: { x: 5, y: 15 }, media: ms, works: [hang('w', ms[0], 'top', 15)] },
      );
    };
    expect(nothingAbout(diagonal(0.75))).toEqual([]);
    expect(kinds(nothingAbout(diagonal(0.5)))).toEqual(['work-unreachable', 'narrow-doorway']);
  });

  it('walks along a 0.75 m corridor but not a 0.5 m one', () => {
    const corridor = (cw: number) => {
      const ms = [image({ title: 'A' })];
      return museum(
        [wall('top', 0, 0, 20, 0), wall('right', 20, 0, 20, 10), wall('bottom', 20, 10, 0, 10), wall('left', 0, 10, 0, 0),
          wall('c1', 5, 4, 15, 4), wall('c2', 5, 4 + cw, 15, 4 + cw), wall('end', 15, 4, 15, 4 + cw)],
        { spawn: { x: 2, y: 2 }, media: ms, works: [hang('w', ms[0], 'end', cw / 2, { width: 0.3 })] },
      );
    };
    expect(walking(corridor(0.75))).toEqual([]);
    expect(kinds(walking(corridor(0.5)))).toEqual(['work-no-room']); // no free cell at all inside it
  });

  it('does not see a doorway where two rooms drawn side by side have walls on the same line', () => {
    const a = [wall('a1', 0, 0, 6, 0), wall('a2', 6, 0, 6, 6), wall('a3', 6, 6, 0, 6), wall('a4', 0, 6, 0, 0)];
    const b = [wall('b1', 6, 0, 12, 0), wall('b2', 12, 0, 12, 6), wall('b3', 12, 6, 6, 6), wall('b4', 6, 6, 6, 0)];
    expect(kinds(nothingAbout(museum([...a, ...b])))).not.toContain('narrow-doorway');
    // a gap in one of the two shared walls is covered by the other
    const gapped = [wall('s1', 6, 0, 6, 2.75), wall('s2', 6, 3.25, 6, 6)];
    const m = museum([...a.filter((w) => w.id !== 'a2'), ...gapped, ...b]);
    expect(kinds(nothingAbout(m))).not.toContain('narrow-doorway');
  });

  it('does not report a sealed empty room', () => {
    const m = museum([...twoRooms(null)]);
    expect(nothingAbout(m)).toEqual([]);
  });

  it('reports a zone in a sealed room, and none that is partly reachable', () => {
    const base = { media: [audio()] };
    const sealed = museum(twoRooms(null), { ...base, zones: [zone('z', 8, 1, 3, 3)] });
    const items = nothingAbout(sealed);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'zone-unreachable', severity: 'problem', target: { type: 'zone', id: 'z' }, message: 'Audio zone "z" cannot be heard: no visitor can walk into it' });
    // straddles the divider: the left half is reachable
    expect(nothingAbout(museum(twoRooms(null), { ...base, zones: [zone('z', 4, 1, 4, 3)] }))).toEqual([]);
  });

  it('reports a gap in the outer walls', () => {
    const open = museum([wall('top1', 0, 0, 2.4, 0), wall('top2', 3.6, 0, 12, 0), wall('east', 12, 0, 12, 6), wall('bottom', 12, 6, 0, 6), wall('west', 0, 6, 0, 0)]);
    const items = nothingAbout(open);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'walk-out', severity: 'warning' });
    expect(items[0].target).toBeUndefined();
    expect(items[0].message).toContain('walk out of the building');
    expect(kinds(nothingAbout(museum(twoRooms(1.2))))).not.toContain('walk-out');
  });

  it('pushes a spawn inside a wall out, as the viewer does', () => {
    const m = rooms(1.2, { x: 6, y: 1 }); // on the solid part of the divider
    expect(walking(m)).toEqual([]);
    expect(kinds(nothingAbout(m))).toContain('spawn-in-wall'); // the Warnings panel still says so
  });

  it('copes with a museum without walls, and with an empty one', () => {
    expect(kinds(nothingAbout(museum([])))).toEqual(['walk-out']);
    expect(() => run(defaultMuseum())).not.toThrow();
  });

  it('reports a spawn with no room to stand', () => {
    // walls every half metre: no gap is wide enough anywhere near the spawn point
    const bars = Array.from({ length: 9 }, (_, k) => wall(`bar${k}`, 0, 1.5 + 0.5 * k, 6, 1.5 + 0.5 * k));
    const items = nothingAbout(museum(bars, { spawn: { x: 3, y: 3.25 } }));
    expect(items.find((i) => i.kind === 'no-start')).toMatchObject({ severity: 'problem', message: 'The start point has no room to stand' });
    expect(kinds(items)).not.toContain('walk-out');
  });

  it('reports a work with another wall right in front of it as having no room', () => {
    const ms = [image({ title: 'A' })];
    const m = museum(twoRooms(1.2, [wall('front', 11.6, 2, 11.6, 4)]), { media: ms, works: [hang('w', ms[0], 'east', 3)] });
    const items = nothingAbout(m);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'work-no-room', severity: 'problem', message: '"A" has no room in front of it', target: { type: 'work', id: 'w' } });
  });
});

describe('labels', () => {
  const labelled = (walls: Wall[], t: number, o: Partial<Work> = {}) => {
    const ms = [image({ title: 'A', artist: 'B' })]; // fixed measure: 0.34 m plaque
    return museum(walls, { media: ms, works: [hang('w', ms[0], walls[0].id, t, o)], spawn: { x: 1, y: 3 } });
  };
  const labelItems = (m: Museum) => run(m, fixed).items.filter((i) => i.kind.startsWith('label-'));

  it('reports a plaque past a free wall end', () => {
    // wall 3 m long, drawn to 3.1; the work covers 2 to 3, the plaque 3.1 to 3.44
    const items = labelItems(labelled([wall('a', 0, 0, 3, 0)], 2.5));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'label-past-wall', severity: 'warning', target: { type: 'work', id: 'w' } });
    expect(items[0].message).toBe('Label of "A" sticks out past the wall by 0.34 m');
  });

  it('reports a plaque over a doorway', () => {
    const items = labelItems(labelled([wall('a', 0, 0, 3, 0), wall('b', 4, 0, 7, 0)], 2.4));
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe('Label of "A" sticks out past the wall by 0.24 m');
  });

  it('accepts the same span continued by a collinear wall', () => {
    expect(labelItems(labelled([wall('a', 0, 0, 3, 0), wall('b', 3, 0, 7, 0)], 2.5))).toEqual([]);
    // also when the continuation is drawn on top, in the other direction
    expect(labelItems(labelled([wall('a', 0, 0, 3, 0), wall('b', 7, 0, 2, 0)], 2.5))).toEqual([]);
  });

  describe('into a wall on its side', () => {
    const cases: [string, Wall[], Partial<Work>, number][] = [
      ['wall drawn left to right', [wall('a', 0, 0, 8, 0), wall('p', 3.2, 0, 3.2, 3)], {}, 2.2],
      ['crossing wall drawn the other way', [wall('a', 0, 0, 8, 0), wall('p', 3.2, 3, 3.2, 0)], {}, 2.2],
      ['wall drawn right to left', [wall('a', 8, 0, 0, 0), wall('p', 3.2, 0, 3.2, 3)], { side: -1 }, 5.8],
    ];
    for (const [name, walls, o, t] of cases) {
      it(`reports ${name}`, () => {
        const items = labelItems(labelled(walls, t, o));
        expect(items.map((i) => i.kind)).toEqual(['label-into-wall']);
        expect(items[0].message).toBe('Label of "A" runs into a wall');
      });
    }
    it('ignores a wall that meets the work wall on the other side', () => {
      expect(labelItems(labelled([wall('a', 0, 0, 8, 0), wall('p', 3.2, 0, 3.2, -3)], 2.2))).toEqual([]);
      expect(labelItems(labelled([wall('a', 8, 0, 0, 0), wall('p', 3.2, 0, 3.2, -3)], 5.8, { side: -1 }))).toEqual([]);
    });
  });

  it('does not look at works without a label', () => {
    const ms = [image({ artist: '' })];
    const m = museum([wall('a', 0, 0, 3, 0)], { media: ms, works: [hang('w', ms[0], 'a', 2.5)] });
    expect(labelItems(m)).toEqual([]);
  });
});

describe('overlaps', () => {
  const overlaps = (m: Museum, measure = ten) => run(m, measure).items.filter((i) => i.kind === 'overlap');

  it('reports two works on two collinear walls', () => {
    const a = plain('A'), b = plain('B');
    const m = museum([wall('w1', 0, 0, 4, 0), wall('w2', 4, 0, 8, 0)], { media: [a, b], works: [hang('x', a, 'w1', 3.7, { width: 0.6 }), hang('y', b, 'w2', 0.3, { width: 0.6 })] });
    const items = overlaps(m);
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe('Works "A" and "B" overlap on one wall face (on two walls in a line)');
    expect(items[0].target).toEqual({ type: 'work', id: 'x' });
  });

  it('does so when the walls run in opposite directions', () => {
    const a = plain('A'), b = plain('B');
    const m = museum([wall('w1', 0, 0, 4, 0), wall('w2', 8, 0, 4, 0)], { media: [a, b], works: [hang('x', a, 'w1', 3.7, { width: 0.6 }), hang('y', b, 'w2', 3.7, { width: 0.6, side: -1 })] });
    expect(overlaps(m)).toHaveLength(1);
  });

  it('does not compare the two faces of a wall, or works that only touch', () => {
    const a = plain('A'), b = plain('B');
    const faces = museum([wall('w1', 0, 0, 4, 0)], { media: [a, b], works: [hang('x', a, 'w1', 2), hang('y', b, 'w1', 2, { side: -1 })] });
    expect(overlaps(faces)).toEqual([]);
    const touch = museum([wall('w1', 0, 0, 4, 0), wall('w2', 4, 0, 8, 0)], { media: [a, b], works: [hang('x', a, 'w1', 3.5, { width: 0.96 }), hang('y', b, 'w2', 0.5, { width: 0.96 })] });
    expect(overlaps(touch)).toEqual([]);
  });

  it('reports a same-wall overlap once, from the editor warnings', () => {
    const a = plain('A'), b = plain('B');
    const m = museum([wall('w1', 0, 0, 6, 0)], { media: [a, b], works: [hang('x', a, 'w1', 2), hang('y', b, 'w1', 2.5)] });
    const items = overlaps(m);
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe('Works "A" and "B" overlap on the same wall face');
  });

  it('reports a plaque over the next work', () => {
    const a = image({ title: 'A' }), b = plain('B');
    // the plaque of A covers 2.6 to 2.94 at 1.0 to 1.09 m; B is a small work low on the wall just there
    const m = museum([wall('w1', 0, 0, 10, 0)], { media: [a, b], works: [hang('x', a, 'w1', 2), hang('y', b, 'w1', 3, { width: 0.5, centerHeight: 1 })] });
    const items = overlaps(m, fixed);
    expect(items.map((i) => i.message)).toEqual(['Label of "A" overlaps the painting "B"']);
  });

  it('reports two plaques overlapping', () => {
    const a = image({ title: 'A' }), b = image({ title: 'B' });
    // plaques are 0.34 m: B (right edge 1.2) has its plaque at 1.3 to 1.64; A is a small work whose plaque starts at 1.5
    const m = museum([wall('w1', 0, 0, 10, 0)], {
      media: [a, b],
      works: [hang('x', a, 'w1', 1, { width: 0.4 }), hang('y', b, 'w1', 1.4, { width: 0.1, centerHeight: 1.3 + 0.05 })],
    });
    const msgs = overlaps(m, fixed).map((i) => i.message);
    expect(msgs).toContain('Labels of "A" and "B" overlap');
  });

  it('reports each pair once', () => {
    const a = image({ title: 'A' }), b = image({ title: 'B' });
    const m = museum([wall('w1', 0, 0, 10, 0)], { media: [a, b], works: [hang('x', a, 'w1', 2), hang('y', b, 'w1', 3, { width: 0.5, centerHeight: 1 })] });
    const msgs = overlaps(m, fixed).map((i) => i.message);
    expect(new Set(msgs).size).toBe(msgs.length);
  });

  it('passes on what the Warnings panel says, with its targets', () => {
    const a = image({ title: 'A' });
    const m = museum([wall('w1', 0, 0, 2, 0)], { media: [a], works: [hang('x', a, 'w1', 1.9)], spawn: { x: 0, y: 0 } });
    m.settings.wallFinish = { color: '#ffffff', tileSize: 1, textureId: 'gone' };
    const items = run(m).items;
    expect(items.find((i) => i.kind === 'past-wall-end')).toMatchObject({ severity: 'warning', target: { type: 'work', id: 'x' } });
    expect(items.find((i) => i.kind === 'texture-missing')!.target).toBeUndefined();
    expect(items.find((i) => i.kind === 'spawn-in-wall')!.target).toEqual({ type: 'spawn' });
  });
});

describe('missing artists', () => {
  it('reports each image once, even when hung twice; whitespace counts as empty; unhung is not reported', () => {
    const a = image({ title: 'Seen', artist: undefined });
    const b = image({ title: 'Blank', artist: '  ' });
    const c = image({ title: 'Named', artist: 'X' });
    const d = image({ title: 'Unhung', artist: '' });
    const m = museum([wall('w1', 0, 0, 20, 0)], {
      media: [a, b, c, d],
      works: [hang('x1', a, 'w1', 2), hang('x2', a, 'w1', 5), hang('y', b, 'w1', 8), hang('z', c, 'w1', 11)],
    });
    const items = run(m).items.filter((i) => i.kind === 'no-artist');
    expect(items.map((i) => i.message)).toEqual(['"Seen" has no artist', '"Blank" has no artist']);
    expect(items.every((i) => i.severity === 'info')).toBe(true);
    expect(items[0].target).toEqual({ type: 'work', id: 'x1' });
  });

  it('puts problems before warnings before info', () => {
    const a = image({ title: 'A', artist: '' });
    const m = museum(twoRooms(0.5), { media: [a], works: [hang('w', a, 'east', 3)] });
    const sev = run(m).items.map((i) => i.severity);
    expect(sev).toEqual([...sev].sort((p, q) => ['problem', 'warning', 'info'].indexOf(p) - ['problem', 'warning', 'info'].indexOf(q)));
    expect(sev).toContain('problem');
    expect(sev).toContain('info');
  });
});

describe('stress museum', () => {
  const out = mkdtempSync(join(tmpdir(), 'museum-check-stress-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('finishes quickly', () => {
    execFileSync('node', [join(__dirname, '../../scripts/make-stress.mjs'), out], { stdio: 'pipe' });
    const parsed = parseMuseum(JSON.parse(readFileSync(join(out, 'museum.json'), 'utf8')));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const t0 = performance.now();
    const report = checkMuseum(parsed.museum, ten);
    const wall = performance.now() - t0;
    console.log(`checkMuseum on the stress museum: ${Math.round(wall)} ms (report.ms ${Math.round(report.ms)}), ${report.items.length} items`);
    // 89 of the 90 closed rooms cannot be reached from the one with the spawn point
    expect(report.items.filter((i) => i.kind === 'zone-unreachable')).toHaveLength(89);
    expect(wall).toBeLessThan(2000);
  });
});
