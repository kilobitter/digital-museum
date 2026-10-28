import { beforeEach, describe, expect, it } from 'vitest';
import { defaultMuseum } from '../shared/validate';
import { MAX_MEDIA_BYTES } from '../shared/mediaFiles';
import { createFolderStore, inspectFolder, type FolderFs } from './folderStore';

/** In-memory folder: "museum.json", "media/<name>" and arbitrary extra root entries. */
class FakeFs implements FolderFs {
  name = 'My museum';
  files = new Map<string, { data: Blob; lastModified: number }>();
  extraRoot: string[] = [];
  clock = 1000;
  writes: string[] = [];
  put(path: string, data: string | Blob, lastModified = ++this.clock) {
    this.files.set(path, { data: typeof data === 'string' ? new Blob([data]) : data, lastModified });
  }
  async readFile(path: string) {
    const f = this.files.get(path);
    return f ? new File([f.data], path.split('/').pop()!, { lastModified: f.lastModified }) : null;
  }
  async writeFile(path: string, data: Blob | string) {
    this.writes.push(path);
    this.put(path, data);
  }
  async removeFile(path: string) {
    this.files.delete(path);
  }
  async list(dir: '' | 'media') {
    if (dir === 'media') return [...this.files.keys()].filter((k) => k.startsWith('media/')).map((k) => k.slice(6));
    return [...new Set([...this.extraRoot, ...[...this.files.keys()].map((k) => k.split('/')[0])])];
  }
}

const urls = () => {
  const live = new Set<string>();
  let n = 0;
  return {
    live,
    createUrl: () => {
      const u = `blob:fake/${++n}`;
      live.add(u);
      return u;
    },
    revokeUrl: (u: string) => void live.delete(u),
  };
};

let fs: FakeFs;
let u: ReturnType<typeof urls>;
const make = (extra = {}) => createFolderStore(fs, { createUrl: u.createUrl, revokeUrl: u.revokeUrl, ...extra });
beforeEach(() => {
  fs = new FakeFs();
  u = urls();
});

describe('load', () => {
  it('missing museum.json gives the default museum', async () => {
    const r = await make().load();
    expect(r.status).toBe('missing');
    if (r.status === 'missing') expect(r.museum).toEqual(defaultMuseum());
  });
  it('loads and migrates an older file', async () => {
    const old = { ...defaultMuseum(), version: 1 } as Record<string, unknown>;
    fs.put('museum.json', JSON.stringify(old));
    const r = await make().load();
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.museum.version).toBe(defaultMuseum().version);
  });
  it('invalid JSON and invalid museums are reported, not thrown', async () => {
    fs.put('museum.json', '{nope');
    expect((await make().load()).status).toBe('invalid');
    fs.put('museum.json', '{"version":999}');
    const r = await make().load();
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.errors.length).toBeGreaterThan(0);
  });
  it('builds URLs only for names matching the media pattern', async () => {
    fs.put('media/abc123.png', 'x');
    fs.put('media/notes.txt', 'x');
    fs.put('media/.hidden.png', 'x');
    fs.put('media/a b.png', 'x');
    fs.put('media/a.b.png', 'x');
    const s = make();
    await s.load();
    expect(s.mediaUrl('media/abc123.png')).toBeDefined();
    for (const bad of ['media/notes.txt', 'media/.hidden.png', 'media/a b.png', 'media/a.b.png', '../museum.json', 'media/../museum.json', 'media/x/y.png'])
      expect(s.mediaUrl(bad)).toBeUndefined();
  });
  it('reloading revokes the previous URLs', async () => {
    fs.put('media/abc123.png', 'x');
    const s = make();
    await s.load();
    await s.load();
    expect(u.live.size).toBe(1);
    s.dispose();
    expect(u.live.size).toBe(0);
  });
});

describe('upload', () => {
  const seq = (...ids: string[]) => {
    let i = 0;
    return (n: number) => {
      const id = ids[Math.min(i++, ids.length - 1)];
      return Uint8Array.from({ length: n }, (_, k) => id.charCodeAt(k % id.length) % 36);
    };
  };
  it('writes media/<10 chars>.<ext>, lower-cases the extension and registers a URL', async () => {
    const s = make();
    const file = await s.upload('Photo.JPG', new Blob(['abc']));
    expect(file).toMatch(/^media\/[a-z0-9]{10}\.jpg$/);
    expect(fs.files.has(file)).toBe(true);
    expect(s.mediaUrl(file)).toBeDefined();
  });
  it('rejects bad extensions, empty files and files over 50 MB', async () => {
    const s = make();
    await expect(s.upload('a.exe', new Blob(['x']))).rejects.toThrow(/Unsupported/);
    await expect(s.upload('noext', new Blob(['x']))).rejects.toThrow(/Unsupported/);
    await expect(s.upload('a.png', new Blob([]))).rejects.toThrow(/Empty/);
    await expect(s.upload('a.png', { size: MAX_MEDIA_BYTES + 1 } as Blob)).rejects.toThrow(/too large/);
    expect(fs.writes).toEqual([]);
  });
  it('retries on an id collision', async () => {
    const s = make({ randomBytes: seq('aaaa', 'bbbb') });
    const first = await s.upload('a.png', new Blob(['1']));
    const gen = seq('aaaa', 'bbbb');
    const s2 = make({ randomBytes: gen });
    const second = await s2.upload('a.png', new Blob(['2'])); // 'aaaa' id exists -> falls to the next
    expect(second).not.toBe(first);
    expect(fs.files.size).toBe(2);
  });
});

describe('save', () => {
  it('writes pretty JSON with a trailing newline', async () => {
    const s = make();
    await s.load();
    expect(await s.save(defaultMuseum())).toEqual({ ok: true });
    const text = await (await fs.readFile('museum.json'))!.text();
    expect(text).toBe(JSON.stringify(defaultMuseum(), null, 2) + '\n');
  });
  it('refuses an invalid museum without writing', async () => {
    const s = make();
    await s.load();
    const r = await s.save({ ...defaultMuseum(), version: 99 } as never);
    expect(r.ok).toBe(false);
    expect(fs.writes).toEqual([]);
  });
  it('only ever writes museum.json and media/*', async () => {
    const s = make();
    await s.load();
    await s.save(defaultMuseum());
    await s.upload('a.png', new Blob(['x']));
    expect(fs.writes.every((p) => p === 'museum.json' || /^media\/[a-z0-9]{10}\.png$/.test(p))).toBe(true);
  });

  describe('external-change guard', () => {
    beforeEach(() => fs.put('museum.json', JSON.stringify(defaultMuseum())));
    it('saves again after our own save (no false conflict)', async () => {
      const s = make();
      await s.load();
      expect((await s.save(defaultMuseum())).ok).toBe(true);
      expect((await s.save(defaultMuseum())).ok).toBe(true);
    });
    it('blocks the write when museum.json changed, and Overwrite then writes', async () => {
      const s = make();
      await s.load();
      fs.put('museum.json', '{"external":true}');
      fs.writes.length = 0;
      const r = await s.save({ ...defaultMuseum(), name: 'Mine' });
      expect(r).toMatchObject({ ok: false, conflict: true });
      expect(fs.writes).toEqual([]);
      expect(await (await fs.readFile('museum.json'))!.text()).toBe('{"external":true}');
      expect((await s.save({ ...defaultMuseum(), name: 'Mine' }, { overwrite: true })).ok).toBe(true);
      expect(await (await fs.readFile('museum.json'))!.text()).toContain('"Mine"');
      expect((await s.save(defaultMuseum())).ok).toBe(true); // guard is re-armed after the overwrite
    });
    it('Reload path: load() accepts the external version and saving works again', async () => {
      const s = make();
      await s.load();
      fs.put('museum.json', JSON.stringify({ ...defaultMuseum(), name: 'Theirs' }));
      expect((await s.save(defaultMuseum())).ok).toBe(false);
      const r = await s.load();
      expect(r.status === 'ok' && r.museum.name).toBe('Theirs');
      expect((await s.save(defaultMuseum())).ok).toBe(true);
    });
    it('detects a museum.json that appeared after a "missing" load', async () => {
      fs.files.delete('museum.json');
      const s = make();
      expect((await s.load()).status).toBe('missing');
      fs.put('museum.json', '{}');
      expect(await s.save(defaultMuseum())).toMatchObject({ ok: false, conflict: true });
    });
    it('detects museum.json deleted after load', async () => {
      const s = make();
      await s.load();
      fs.files.delete('museum.json');
      expect(await s.save(defaultMuseum())).toMatchObject({ ok: false, conflict: true });
    });
  });

  it('reports write failures as errors', async () => {
    const s = make();
    await s.load();
    fs.writeFile = async () => {
      throw new Error('NotAllowedError');
    };
    const r = await s.save(defaultMuseum());
    expect(r.ok).toBe(false);
  });
});

describe('deleteMedia', () => {
  it('removes the file and revokes its URL', async () => {
    const s = make();
    const file = await s.upload('a.png', new Blob(['x']));
    await s.deleteMedia(file);
    expect(fs.files.has(file)).toBe(false);
    expect(s.mediaUrl(file)).toBeUndefined();
    expect(u.live.size).toBe(0);
  });
  it('a missing file is not an error; bad paths are refused', async () => {
    const s = make();
    await expect(s.deleteMedia('media/gone123456.png')).resolves.toBeUndefined();
    await expect(s.deleteMedia('media/../museum.json')).rejects.toThrow();
    await expect(s.deleteMedia('museum.json')).rejects.toThrow();
  });
});

describe('inspectFolder', () => {
  it('empty, junk-only, other files, has museum', async () => {
    expect(await inspectFolder(fs)).toBe('empty');
    fs.extraRoot = ['.DS_Store', 'Thumbs.db'];
    expect(await inspectFolder(fs)).toBe('empty');
    fs.extraRoot = ['holiday.jpg'];
    expect(await inspectFolder(fs)).toBe('other-files');
    fs.put('museum.json', '{}');
    expect(await inspectFolder(fs)).toBe('has-museum');
  });
});
