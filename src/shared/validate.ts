import {
  MUSEUM_VERSION,
  type Area,
  type AudioZone,
  type MediaItem,
  type Museum,
  type Sky,
  type Wall,
  type WallFinish,
  type Work,
  type ZoneShape,
} from './museum';
import { MEDIA_FILE_RE } from './mediaFiles';

export function defaultSky(): Sky {
  return { kind: 'gradient', top: '#8fb8de', horizon: '#eef2f5', bottom: '#d8d4cc' };
}

export function defaultMuseum(): Museum {
  return {
    version: MUSEUM_VERSION,
    name: 'Untitled museum',
    settings: {
      wallHeight: 3,
      wallThickness: 0.2,
      gridSize: 0.5,
      ceiling: true,
      wallFinish: { color: '#ffffff', tileSize: 1 },
      floorFinish: { color: '#e6e3dd', tileSize: 1 },
      ceilingFinish: { color: '#ffffff', tileSize: 1 },
      sky: defaultSky(),
      spawn: { x: 0, y: 0, yawDeg: 0 },
    },
    walls: [],
    works: [],
    zones: [],
    areas: [],
    media: [],
  };
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseMuseum(
  json: unknown,
): { ok: true; museum: Museum } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(json)) return { ok: false, errors: ['(root): expected an object'] };

  const num = (o: Obj, k: string, path: string, opts: { positive?: boolean; min?: number; max?: number } = {}): number => {
    const v = o[k];
    if (!isNum(v)) {
      err(`${path}.${k}`, 'expected a finite number');
      return 0;
    }
    if (opts.positive && !(v > 0)) err(`${path}.${k}`, `must be > 0 (got ${v})`);
    if (opts.min !== undefined && v < opts.min) err(`${path}.${k}`, `must be >= ${opts.min} (got ${v})`);
    if (opts.max !== undefined && v > opts.max) err(`${path}.${k}`, `must be <= ${opts.max} (got ${v})`);
    return v;
  };
  const str = (o: Obj, k: string, path: string, required = true): string => {
    const v = o[k];
    if (typeof v !== 'string') {
      err(`${path}.${k}`, 'expected a string');
      return '';
    }
    if (required && v === '') err(`${path}.${k}`, 'must not be empty');
    return v;
  };
  const arr = (k: string): unknown[] => {
    const v = json[k];
    if (!Array.isArray(v)) {
      err(k, 'expected an array');
      return [];
    }
    return v;
  };
  const vec = (v: unknown, path: string) => {
    if (!isObj(v)) {
      err(path, 'expected {x, y}');
      return { x: 0, y: 0 };
    }
    return { x: num(v, 'x', path), y: num(v, 'y', path) };
  };

  // v1 files are validated with the v1 rules and then migrated (see the end of this function).
  const legacy = json.version === 1;
  // v1 and v2 files are migrated to v3 (floor/ceiling finishes default, no areas).
  const preV3 = legacy || json.version === 2;
  // v3 files lack the sky; it is filled with the default.
  const preV4 = preV3 || json.version === 3;
  if (json.version !== MUSEUM_VERSION && !preV4) err('version', `expected ${MUSEUM_VERSION} (got ${JSON.stringify(json.version)})`);
  const name = typeof json.name === 'string' ? json.name : (err('name', 'expected a string'), '');

  /** Collected after media is parsed; needs the media ids, so it is validated lazily. */
  const finishes: { f: WallFinish; path: string }[] = [];
  const finish = (v: unknown, path: string): WallFinish => {
    if (!isObj(v)) {
      err(path, 'expected {color, tileSize}');
      return { color: '#ffffff', tileSize: 1 };
    }
    const f: WallFinish = { color: '#ffffff', tileSize: num(v, 'tileSize', path, { positive: true }) };
    if (typeof v.color !== 'string' || !COLOR_RE.test(v.color)) err(`${path}.color`, "expected a colour like '#rrggbb'");
    else f.color = v.color;
    if (v.textureId !== undefined) {
      if (typeof v.textureId === 'string') f.textureId = v.textureId;
      else err(`${path}.textureId`, 'expected a string');
    }
    if (f.textureId !== undefined) finishes.push({ f, path });
    return f;
  };

  // settings
  const def = defaultMuseum().settings;
  let settings = def;
  if (!isObj(json.settings)) err('settings', 'expected an object');
  else {
    const s = json.settings;
    const sp = isObj(s.spawn) ? s.spawn : (err('settings.spawn', 'expected an object'), {} as Obj);
    if (typeof s.ceiling !== 'boolean') err('settings.ceiling', 'expected a boolean');
    settings = {
      wallHeight: num(s, 'wallHeight', 'settings', { positive: true }),
      wallThickness: num(s, 'wallThickness', 'settings', { positive: true }),
      gridSize: num(s, 'gridSize', 'settings', { positive: true }),
      ceiling: s.ceiling === true,
      wallFinish: legacy ? { ...def.wallFinish } : finish(s.wallFinish, 'settings.wallFinish'),
      floorFinish: preV3 ? { ...def.floorFinish } : finish(s.floorFinish, 'settings.floorFinish'),
      ceilingFinish: preV3 ? { ...def.ceilingFinish } : finish(s.ceilingFinish, 'settings.ceilingFinish'),
      sky: defaultSky(),
      spawn: {
        x: num(sp, 'x', 'settings.spawn'),
        y: num(sp, 'y', 'settings.spawn'),
        yawDeg: num(sp, 'yawDeg', 'settings.spawn'),
      },
    };
  }

  const uniq = (items: { id: string }[], coll: string) => {
    const seen = new Set<string>();
    items.forEach((it, i) => {
      if (seen.has(it.id)) err(`${coll}[${i}].id`, `duplicate id '${it.id}'`);
      seen.add(it.id);
    });
  };

  const walls: Wall[] = arr('walls').map((raw, i) => {
    const p = `walls[${i}]`;
    if (!isObj(raw)) {
      err(p, 'expected an object');
      return { id: '', a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
    }
    const w: Wall = { id: str(raw, 'id', p), a: vec(raw.a, `${p}.a`), b: vec(raw.b, `${p}.b`) };
    if (!legacy && raw.finish !== undefined) w.finish = finish(raw.finish, `${p}.finish`);
    if (isObj(raw.a) && isObj(raw.b) && isNum(raw.a.x) && isNum(raw.a.y) && isNum(raw.b.x) && isNum(raw.b.y) && w.a.x === w.b.x && w.a.y === w.b.y)
      err(p, 'zero-length wall (a and b are identical)');
    return w;
  });
  uniq(walls, 'walls');

  const media: MediaItem[] = arr('media').map((raw, i) => {
    const p = `media[${i}]`;
    if (!isObj(raw)) {
      err(p, 'expected an object');
      return { id: '', kind: 'image', file: '', name: '' };
    }
    const id = str(raw, 'id', p);
    const kind =
      raw.kind === 'image' || raw.kind === 'audio' || (!legacy && raw.kind === 'texture') || (!preV4 && raw.kind === 'panorama')
        ? raw.kind
        : (err(
            `${p}.kind`,
            legacy ? "expected 'image' or 'audio'" : preV4 ? "expected 'image', 'audio' or 'texture'" : "expected 'image', 'audio', 'texture' or 'panorama'",
          ),
          'image' as const);
    const file = str(raw, 'file', p);
    if (typeof raw.file === 'string' && !MEDIA_FILE_RE.test(raw.file))
      err(`${p}.file`, `invalid path '${raw.file}' (expected media/<name>.<jpg|jpeg|png|webp|mp3|m4a|aac|ogg|wav>)`);
    const m: MediaItem = { id, kind, file, name: typeof raw.name === 'string' ? raw.name : (err(`${p}.name`, 'expected a string'), '') };
    if (kind === 'image' || kind === 'texture' || kind === 'panorama') {
      m.width = num(raw, 'width', p, { positive: true });
      m.height = num(raw, 'height', p, { positive: true });
    } else {
      if (isNum(raw.width)) m.width = raw.width;
      if (isNum(raw.height)) m.height = raw.height;
    }
    if (!legacy) {
      for (const k of ['title', 'artist', 'description'] as const) {
        if (raw[k] === undefined) continue;
        if (typeof raw[k] === 'string') m[k] = raw[k];
        else err(`${p}.${k}`, 'expected a string');
      }
    }
    return m;
  });
  uniq(media, 'media');
  const mediaById = new Map(media.map((m) => [m.id, m]));
  if (!preV4 && isObj(json.settings)) {
    const sk = json.settings.sky;
    const sp = 'settings.sky';
    if (!isObj(sk)) err(sp, 'expected an object');
    else if (sk.kind === 'gradient') {
      const c = (k: 'top' | 'horizon' | 'bottom'): string => {
        const v = sk[k];
        if (typeof v !== 'string' || !COLOR_RE.test(v)) {
          err(`${sp}.${k}`, "expected a colour like '#rrggbb'");
          return '#ffffff';
        }
        return v;
      };
      settings.sky = { kind: 'gradient', top: c('top'), horizon: c('horizon'), bottom: c('bottom') };
    } else if (sk.kind === 'panorama') {
      const rotationDeg = num(sk, 'rotationDeg', sp);
      let textureId = '';
      if (typeof sk.textureId !== 'string' || sk.textureId === '') err(`${sp}.textureId`, 'expected a media id');
      else {
        textureId = sk.textureId;
        const m = mediaById.get(textureId);
        if (!m) err(`${sp}.textureId`, `no media with id '${textureId}'`);
        else if (m.kind !== 'panorama') err(`${sp}.textureId`, `media '${textureId}' is not a panorama`);
      }
      settings.sky = { kind: 'panorama', textureId, rotationDeg };
    } else err(`${sp}.kind`, "expected 'gradient' or 'panorama'");
  }
  const wallIds = new Set(walls.map((w) => w.id));
  for (const { f, path } of finishes.splice(0)) {
    const m = mediaById.get(f.textureId!);
    if (!m) err(`${path}.textureId`, `no media with id '${f.textureId}'`);
    else if (m.kind !== 'texture') err(`${path}.textureId`, `media '${f.textureId}' is not a texture`);
  }

  type LegacyLabel = { title: string; artist: string; description: string };
  const legacyLabels: { mediaId: string; label: LegacyLabel }[] = [];
  const works: Work[] = arr('works').map((raw, i) => {
    const p = `works[${i}]`;
    if (!isObj(raw)) {
      err(p, 'expected an object');
      return { id: '', mediaId: '', wallId: '', side: 1, t: 0, centerHeight: 1.5, width: 1 };
    }
    const id = str(raw, 'id', p);
    const mediaId = str(raw, 'mediaId', p);
    const wallId = str(raw, 'wallId', p);
    if (typeof raw.wallId === 'string' && !wallIds.has(raw.wallId)) err(`${p}.wallId`, `no wall with id '${raw.wallId}'`);
    if (typeof raw.mediaId === 'string') {
      const m = mediaById.get(raw.mediaId);
      if (!m) err(`${p}.mediaId`, `no media with id '${raw.mediaId}'`);
      else if (m.kind !== 'image') err(`${p}.mediaId`, `media '${raw.mediaId}' is not an image`);
    }
    if (raw.side !== 1 && raw.side !== -1) err(`${p}.side`, 'must be 1 or -1');
    const w: Work = {
      id,
      mediaId,
      wallId,
      side: raw.side === -1 ? -1 : 1,
      t: num(raw, 't', p),
      centerHeight: num(raw, 'centerHeight', p),
      width: num(raw, 'width', p, { positive: true }),
    };
    if (legacy) {
      // v1 label fields: validated as before, then moved onto the media item below.
      const l: LegacyLabel = { title: str(raw, 'title', p, false), artist: str(raw, 'artist', p, false), description: '' };
      if (raw.description !== undefined) {
        if (typeof raw.description === 'string') l.description = raw.description;
        else err(`${p}.description`, 'expected a string');
      }
      legacyLabels.push({ mediaId, label: l });
    }
    return w;
  });
  uniq(works, 'works');

  const zones: AudioZone[] = arr('zones').map((raw, i) => {
    const p = `zones[${i}]`;
    const blank: AudioZone = { id: '', name: '', mediaId: '', shape: { kind: 'circle', cx: 0, cy: 0, r: 1 }, volume: 0, fade: 0 };
    if (!isObj(raw)) {
      err(p, 'expected an object');
      return blank;
    }
    const id = str(raw, 'id', p);
    const nm = str(raw, 'name', p, false);
    const mediaId = str(raw, 'mediaId', p);
    if (typeof raw.mediaId === 'string') {
      const m = mediaById.get(raw.mediaId);
      if (!m) err(`${p}.mediaId`, `no media with id '${raw.mediaId}'`);
      else if (m.kind !== 'audio') err(`${p}.mediaId`, `media '${raw.mediaId}' is not audio`);
    }
    let shape: ZoneShape = blank.shape;
    const sh = raw.shape;
    if (!isObj(sh)) err(`${p}.shape`, 'expected an object');
    else if (sh.kind === 'rect') {
      shape = {
        kind: 'rect',
        x: num(sh, 'x', `${p}.shape`),
        y: num(sh, 'y', `${p}.shape`),
        w: num(sh, 'w', `${p}.shape`, { positive: true }),
        h: num(sh, 'h', `${p}.shape`, { positive: true }),
      };
    } else if (sh.kind === 'circle') {
      shape = {
        kind: 'circle',
        cx: num(sh, 'cx', `${p}.shape`),
        cy: num(sh, 'cy', `${p}.shape`),
        r: num(sh, 'r', `${p}.shape`, { positive: true }),
      };
    } else err(`${p}.shape.kind`, "expected 'rect' or 'circle'");
    return {
      id,
      name: nm,
      mediaId,
      shape,
      volume: num(raw, 'volume', p, { min: 0, max: 1 }),
      fade: num(raw, 'fade', p, { min: 0 }),
    };
  });
  uniq(zones, 'zones');

  const areas: Area[] = preV3
    ? []
    : arr('areas').map((raw, i) => {
        const p = `areas[${i}]`;
        const blank: Area = { id: '', name: '', rect: { x: 0, y: 0, w: 1, h: 1 } };
        if (!isObj(raw)) {
          err(p, 'expected an object');
          return blank;
        }
        const id = str(raw, 'id', p);
        const nm = str(raw, 'name', p, false);
        let rect = blank.rect;
        if (!isObj(raw.rect)) err(`${p}.rect`, 'expected {x, y, w, h}');
        else {
          const r = raw.rect;
          rect = {
            x: num(r, 'x', `${p}.rect`),
            y: num(r, 'y', `${p}.rect`),
            w: num(r, 'w', `${p}.rect`, { positive: true }),
            h: num(r, 'h', `${p}.rect`, { positive: true }),
          };
        }
        const a: Area = { id, name: nm, rect };
        if (raw.floor !== undefined) a.floor = finish(raw.floor, `${p}.floor`);
        if (raw.ceiling !== undefined) a.ceiling = finish(raw.ceiling, `${p}.ceiling`);
        if (raw.openSky !== undefined) {
          if (raw.openSky === true) a.openSky = true;
          else err(`${p}.openSky`, 'must be true when present');
        }
        if (a.ceiling !== undefined && raw.openSky !== undefined) err(p, "'ceiling' and 'openSky' are mutually exclusive");
        if (a.floor === undefined && a.ceiling === undefined && raw.openSky === undefined)
          err(p, "needs a 'floor' finish, a 'ceiling' finish and/or 'openSky'");
        return a;
      });
  uniq(areas, 'areas');
  // Texture references of the area finishes (the settings/wall ones were checked above and removed from the list).
  for (const { f, path } of finishes) {
    const m = mediaById.get(f.textureId!);
    if (!m) err(`${path}.textureId`, `no media with id '${f.textureId}'`);
    else if (m.kind !== 'texture') err(`${path}.textureId`, `media '${f.textureId}' is not a texture`);
  }

  if (errors.length) return { ok: false, errors };
  if (legacy) {
    // First work (array order) with a non-empty value wins, per field.
    for (const { mediaId, label } of legacyLabels) {
      const m = mediaById.get(mediaId);
      if (!m) continue;
      for (const k of ['title', 'artist', 'description'] as const) if (!m[k] && label[k]) m[k] = label[k];
    }
  }
  return { ok: true, museum: { version: MUSEUM_VERSION, name, settings, walls, works, zones, areas, media } };
}
