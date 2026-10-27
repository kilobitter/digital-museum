import { describe, expect, it } from 'vitest';
import { defaultMuseum, parseMuseum } from './validate';
import sample from '../../public/museum/museum.json';

type Any = Record<string, any>;
const base = (): Any => ({
  version: 2,
  name: 'T',
  settings: { wallHeight: 3, wallThickness: 0.2, gridSize: 0.5, ceiling: true, wallFinish: { color: '#ffffff', tileSize: 1 }, spawn: { x: 0, y: 0, yawDeg: 0 } },
  walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }],
  works: [{ id: 'k1', mediaId: 'i1', wallId: 'w1', side: 1, t: 1, centerHeight: 1.5, width: 1 }],
  zones: [{ id: 'z1', name: 'z', mediaId: 'a1', shape: { kind: 'rect', x: 0, y: 0, w: 2, h: 2 }, volume: 0.5, fade: 1 }],
  media: [
    { id: 'i1', kind: 'image', file: 'media/a.jpg', name: 'a.jpg', width: 100, height: 50, title: 'a', artist: 'b' },
    { id: 't1', kind: 'texture', file: 'media/t.png', name: 't.png', width: 64, height: 64 },
    { id: 'a1', kind: 'audio', file: 'media/b.mp3', name: 'b.mp3' },
  ],
});
const errorsOf = (m: unknown): string[] => {
  const r = parseMuseum(m);
  return r.ok ? [] : r.errors;
};
const expectError = (m: unknown, fragment: string) => {
  const errs = errorsOf(m);
  expect(errs.some((e) => e.includes(fragment)), `${fragment} in ${JSON.stringify(errs)}`).toBe(true);
};

describe('defaultMuseum', () => {
  it('is valid and empty', () => {
    const d = defaultMuseum();
    expect(d.version).toBe(2);
    expect(d.settings).toEqual({ wallHeight: 3, wallThickness: 0.2, gridSize: 0.5, ceiling: true, wallFinish: { color: '#ffffff', tileSize: 1 }, spawn: { x: 0, y: 0, yawDeg: 0 } });
    expect(parseMuseum(d).ok).toBe(true);
  });
});

describe('parseMuseum', () => {
  it('accepts the museum in public/museum (migrated if v1)', () => {
    const r = parseMuseum(sample);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('accepts a minimal valid museum and ignores unknown fields', () => {
    const m = base();
    m.extra = 1;
    m.walls[0].colour = 'red';
    expect(parseMuseum(m).ok).toBe(true);
  });
  it.each([null, 5, 'x', [], undefined])('rejects non-object root %s', (v) => {
    expect(parseMuseum(v).ok).toBe(false);
  });
  it('rejects wrong version', () => {
    for (const v of [0, 3, '2', undefined]) {
      const m = base(); m.version = v;
      expectError(m, 'version');
    }
  });
  it('rejects missing arrays', () => {
    const m = base(); delete m.walls;
    expectError(m, 'walls: expected an array');
  });
  it('rejects non-finite / non-number values', () => {
    let m = base(); m.settings.wallHeight = NaN;
    expectError(m, 'settings.wallHeight');
    m = base(); m.walls[0].a.x = '1';
    expectError(m, 'walls[0].a.x');
    m = base(); m.walls[0].b.y = Infinity;
    expectError(m, 'walls[0].b.y');
  });
  it.each(['wallHeight', 'wallThickness', 'gridSize'])('rejects non-positive settings.%s', (k) => {
    const m = base(); m.settings[k] = 0;
    expectError(m, `settings.${k}`);
  });
  it('rejects zero-length walls', () => {
    const m = base(); m.walls[0].b = { x: 0, y: 0 };
    expectError(m, 'zero-length');
  });
  it('rejects non-positive work width and bad side', () => {
    let m = base(); m.works[0].width = 0;
    expectError(m, 'works[0].width');
    m = base(); m.works[0].side = 0;
    expectError(m, 'works[0].side');
    m = base(); m.works[0].side = 2;
    expectError(m, 'works[0].side');
  });
  it('rejects dangling wallId with a path', () => {
    const m = base(); m.works[0].wallId = 'w9';
    expectError(m, "works[0].wallId: no wall with id 'w9'");
  });
  it('rejects work media that is missing or not an image', () => {
    let m = base(); m.works[0].mediaId = 'nope';
    expectError(m, 'works[0].mediaId');
    m = base(); m.works[0].mediaId = 'a1';
    expectError(m, 'not an image');
  });
  it('rejects zone media that is missing or not audio', () => {
    let m = base(); m.zones[0].mediaId = 'nope';
    expectError(m, 'zones[0].mediaId');
    m = base(); m.zones[0].mediaId = 'i1';
    expectError(m, 'not audio');
  });
  it('rejects duplicate ids per collection', () => {
    const m = base(); m.walls.push({ id: 'w1', a: { x: 0, y: 1 }, b: { x: 1, y: 1 } });
    expectError(m, "walls[1].id: duplicate id 'w1'");
  });
  it('allows the same id across different collections', () => {
    const m = base(); m.walls[0].id = 'x'; m.works[0].wallId = 'x'; m.works[0].id = 'x';
    expect(parseMuseum(m).ok).toBe(true);
  });
  it('rejects images without dimensions', () => {
    const m = base(); delete m.media[0].width;
    expectError(m, 'media[0].width');
  });
  it.each([
    'media/../x.jpg', '/media/a.jpg', 'a.jpg', 'media/a.gif', 'media/sub/a.jpg', 'media/a b.jpg', 'media/a.JPG', 'media/.jpg', 'http://x/media/a.jpg', 'media/a.jpg\n',
  ])('rejects bad media file path %j', (file) => {
    const m = base(); m.media[0].file = file;
    expectError(m, 'media[0].file');
  });
  it.each(['media/a.jpg', 'media/a-b_C1.jpeg', 'media/a.png', 'media/a.webp', 'media/a.mp3', 'media/a.m4a', 'media/a.aac', 'media/a.ogg', 'media/a.wav'])(
    'accepts media file path %s', (file) => {
      const m = base(); m.media[1].file = file; m.media[0].file = file;
      expect(errorsOf(m)).toEqual([]);
    });
  it('rejects bad zone numbers and shapes', () => {
    let m = base(); m.zones[0].volume = 1.5;
    expectError(m, 'zones[0].volume');
    m = base(); m.zones[0].volume = -0.1;
    expectError(m, 'zones[0].volume');
    m = base(); m.zones[0].fade = -1;
    expectError(m, 'zones[0].fade');
    m = base(); m.zones[0].shape = { kind: 'rect', x: 0, y: 0, w: 0, h: 2 };
    expectError(m, 'zones[0].shape.w');
    m = base(); m.zones[0].shape = { kind: 'circle', cx: 0, cy: 0, r: -1 };
    expectError(m, 'zones[0].shape.r');
    m = base(); m.zones[0].shape = { kind: 'blob' };
    expectError(m, 'zones[0].shape.kind');
  });
  it('accepts fade 0 and volume 0/1', () => {
    const m = base(); m.zones[0].fade = 0; m.zones[0].volume = 1;
    expect(parseMuseum(m).ok).toBe(true);
  });
  it('reports several errors at once', () => {
    const m = base(); m.works[0].wallId = 'w9'; m.zones[0].volume = 3;
    expect(errorsOf(m).length).toBeGreaterThanOrEqual(2);
  });
});

describe('format v2', () => {
  it('accepts textures, wall finishes and media labels', () => {
    const m = base();
    m.settings.wallFinish = { textureId: 't1', color: '#aabbcc', tileSize: 0.5 };
    m.walls[0].finish = { color: '#FF00ff', tileSize: 2 };
    const r = parseMuseum(m);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.museum.version).toBe(2);
      expect(r.museum.settings.wallFinish.textureId).toBe('t1');
      expect(r.museum.media[0].title).toBe('a');
      expect(r.museum.walls[0].finish).toEqual({ color: '#FF00ff', tileSize: 2 });
    }
  });
  it('requires settings.wallFinish', () => {
    const m = base(); delete m.settings.wallFinish;
    expectError(m, 'settings.wallFinish');
  });
  it('rejects unknown media kinds', () => {
    const m = base(); m.media[0].kind = 'video';
    expectError(m, 'media[0].kind');
  });
  it('requires dimensions for textures', () => {
    const m = base(); delete m.media[1].height;
    expectError(m, 'media[1].height');
  });
  it('rejects non-string labels', () => {
    for (const k of ['title', 'artist', 'description']) {
      const m = base(); m.media[0][k] = 5;
      expectError(m, `media[0].${k}`);
    }
  });
  it.each(['red', '#fff', '#12345g', '#1234567', 5, undefined])('rejects bad finish colour %j', (c) => {
    const m = base(); m.walls[0].finish = { color: c, tileSize: 1 };
    expectError(m, 'walls[0].finish.color');
  });
  it.each([0, -1, NaN, Infinity, '1'])('rejects bad tileSize %j', (t) => {
    const m = base(); m.settings.wallFinish.tileSize = t;
    expectError(m, 'settings.wallFinish.tileSize');
  });
  it('rejects a textureId that is missing or not a texture (settings and wall)', () => {
    let m = base(); m.settings.wallFinish.textureId = 'nope';
    expectError(m, "settings.wallFinish.textureId: no media with id 'nope'");
    m = base(); m.walls[0].finish = { textureId: 'i1', color: '#ffffff', tileSize: 1 };
    expectError(m, 'walls[0].finish.textureId: media');
    m = base(); m.walls[0].finish = { textureId: 3, color: '#ffffff', tileSize: 1 };
    expectError(m, 'walls[0].finish.textureId');
  });
  it('rejects hanging a texture', () => {
    const m = base(); m.works[0].mediaId = 't1';
    expectError(m, 'not an image');
  });
  it('drops label fields on works', () => {
    const m = base(); m.works[0].title = 'old';
    const r = parseMuseum(m);
    expect(r.ok && 'title' in r.museum.works[0]).toBe(false);
  });
});

describe('v1 migration', () => {
  const v1 = (): Any => {
    const m = base();
    m.version = 1;
    delete m.settings.wallFinish;
    m.media = m.media.filter((x: Any) => x.kind !== 'texture').map((x: Any) => ({ id: x.id, kind: x.kind, file: x.file, name: x.name, width: x.width, height: x.height }));
    m.works = [{ id: 'k1', mediaId: 'i1', wallId: 'w1', side: 1, t: 1, centerHeight: 1.5, width: 1, title: 'First', artist: 'A' }];
    return m;
  };
  it('moves labels to media, adds default finish, sets version 2', () => {
    const m = v1();
    m.works[0].description = 'desc';
    const r = parseMuseum(m);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.museum.version).toBe(2);
    expect(r.museum.settings.wallFinish).toEqual({ color: '#ffffff', tileSize: 1 });
    const img = r.museum.media.find((x) => x.id === 'i1')!;
    expect(img).toMatchObject({ title: 'First', artist: 'A', description: 'desc' });
    expect(r.museum.works[0]).not.toHaveProperty('title');
    expect(r.museum.works[0]).not.toHaveProperty('artist');
    expect(r.museum.works[0]).not.toHaveProperty('description');
  });
  it('first work wins when two works share a media item', () => {
    const m = v1();
    m.works.push({ id: 'k2', mediaId: 'i1', wallId: 'w1', side: -1, t: 2, centerHeight: 1.5, width: 1, title: 'Second', artist: 'B' });
    const r = parseMuseum(m);
    expect(r.ok && r.museum.media[0].title).toBe('First');
    expect(r.ok && r.museum.media[0].artist).toBe('A');
  });
  it('an empty value does not override a later non-empty one', () => {
    const m = v1();
    m.works[0].title = '';
    m.works.push({ id: 'k2', mediaId: 'i1', wallId: 'w1', side: -1, t: 2, centerHeight: 1.5, width: 1, title: 'Later', artist: '' });
    const r = parseMuseum(m);
    expect(r.ok && r.museum.media[0].title).toBe('Later');
    expect(r.ok && r.museum.media[0].artist).toBe('A');
  });
  it('omits label fields that are empty everywhere', () => {
    const m = v1();
    m.works[0].title = ''; m.works[0].artist = '';
    const r = parseMuseum(m);
    expect(r.ok && r.museum.media[0]).not.toHaveProperty('title');
  });
  it('keeps v1 files that were invalid under v1 rules invalid', () => {
    let m = v1(); delete m.works[0].artist;
    expectError(m, 'works[0].artist');
    m = v1(); m.works[0].wallId = 'nope';
    expectError(m, 'works[0].wallId');
    m = v1(); m.media[0].kind = 'texture';
    expectError(m, 'media[0].kind');
  });
  it('migrates a copy of the real public/museum/museum.json', () => {
    const copy = JSON.parse(JSON.stringify(sample));
    const r = parseMuseum(copy);
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(r.ok && r.museum.version).toBe(2);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(sample)); // input not mutated
  });
});
