import {
  MUSEUM_VERSION,
  type AudioZone,
  type MediaItem,
  type Museum,
  type Wall,
  type Work,
  type ZoneShape,
} from './museum';

export function defaultMuseum(): Museum {
  return {
    version: MUSEUM_VERSION,
    name: 'Untitled museum',
    settings: {
      wallHeight: 3,
      wallThickness: 0.2,
      gridSize: 0.5,
      ceiling: true,
      spawn: { x: 0, y: 0, yawDeg: 0 },
    },
    walls: [],
    works: [],
    zones: [],
    media: [],
  };
}

const FILE_RE = /^media\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|mp3|m4a|aac|ogg|wav)$/;

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

  if (json.version !== MUSEUM_VERSION) err('version', `expected ${MUSEUM_VERSION} (got ${JSON.stringify(json.version)})`);
  const name = typeof json.name === 'string' ? json.name : (err('name', 'expected a string'), '');

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
    const w = { id: str(raw, 'id', p), a: vec(raw.a, `${p}.a`), b: vec(raw.b, `${p}.b`) };
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
    const kind = raw.kind === 'image' || raw.kind === 'audio' ? raw.kind : (err(`${p}.kind`, "expected 'image' or 'audio'"), 'image' as const);
    const file = str(raw, 'file', p);
    if (typeof raw.file === 'string' && !FILE_RE.test(raw.file))
      err(`${p}.file`, `invalid path '${raw.file}' (expected media/<name>.<jpg|jpeg|png|webp|mp3|m4a|aac|ogg|wav>)`);
    const m: MediaItem = { id, kind, file, name: typeof raw.name === 'string' ? raw.name : (err(`${p}.name`, 'expected a string'), '') };
    if (kind === 'image') {
      m.width = num(raw, 'width', p, { positive: true });
      m.height = num(raw, 'height', p, { positive: true });
    } else {
      if (isNum(raw.width)) m.width = raw.width;
      if (isNum(raw.height)) m.height = raw.height;
    }
    return m;
  });
  uniq(media, 'media');
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const wallIds = new Set(walls.map((w) => w.id));

  const works: Work[] = arr('works').map((raw, i) => {
    const p = `works[${i}]`;
    if (!isObj(raw)) {
      err(p, 'expected an object');
      return { id: '', mediaId: '', wallId: '', side: 1, t: 0, centerHeight: 1.5, width: 1, title: '', artist: '' };
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
      title: str(raw, 'title', p, false),
      artist: str(raw, 'artist', p, false),
    };
    if (raw.description !== undefined) {
      if (typeof raw.description === 'string') w.description = raw.description;
      else err(`${p}.description`, 'expected a string');
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

  if (errors.length) return { ok: false, errors };
  return { ok: true, museum: { version: MUSEUM_VERSION, name, settings, walls, works, zones, media } };
}
