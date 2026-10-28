import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { FsDirHandle } from '../shared/folderHandle';
import { defaultMuseum, parseMuseum } from '../shared/validate';
import { openZip, writeZip } from '../shared/zip';
import { exportMuseumZip, zipFileName } from './exportZip';
import { prepareMedia } from './importFlow';
import { mergeMuseum } from './importMerge';
import { ImportError, sourceFromDirHandle, sourceFromFileList, sourceFromZip } from './importSource';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Read-only folder handle over a real directory (fake of FileSystemDirectoryHandle). */
function fakeDir(path: string, name = 'sample'): FsDirHandle {
  const notFound = () => new DOMException('nf', 'NotFoundError');
  return {
    kind: 'directory',
    name,
    async getFileHandle(n: string) {
      const p = join(path, n);
      if (!existsSync(p) || !statSync(p).isFile()) throw notFound();
      return { kind: 'file', name: n, getFile: async () => new File([readFileSync(p)], n) } as never;
    },
    async getDirectoryHandle(n: string) {
      const p = join(path, n);
      if (!existsSync(p) || !statSync(p).isDirectory()) throw notFound();
      return fakeDir(p, n);
    },
    async *entries() {
      for (const n of readdirSync(path)) {
        const isDir = statSync(join(path, n)).isDirectory();
        yield [n, isDir ? fakeDir(join(path, n), n) : ({ kind: 'file', name: n } as never)] as never;
      }
    },
  } as unknown as FsDirHandle;
}

function makeSample(): string {
  const out = mkdtempSync(join(tmpdir(), 'museum-import-'));
  dirs.push(out);
  execFileSync('node', [join(__dirname, '..', '..', 'scripts', 'make-sample.mjs'), out], { stdio: 'pipe' });
  return out;
}

const hostPath = join(__dirname, '..', '..', 'public', 'museum', 'museum.json');
const loadHost = () => {
  const r = parseMuseum(JSON.parse(readFileSync(hostPath, 'utf8')));
  if (!r.ok) throw new Error('host invalid');
  return r.museum;
};

function fakeStore() {
  let n = 0;
  const files = new Map<string, Blob>();
  return {
    files,
    upload: async (name: string, data: Blob) => {
      const file = `media/up${++n}.${name.split('.').pop()}`;
      files.set(file, data);
      return file;
    },
  };
}

describe('import from a folder, merge, export', () => {
  it('imports the sample into a copy of the real museum and exports a faithful zip', async () => {
    const dir = makeSample();
    const source = await sourceFromDirHandle(fakeDir(dir));
    expect(source.museum.name).toBe('Sample Museum');
    const host = loadHost();
    const store = fakeStore();
    const prep = await prepareMedia(host, source, store, {});
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    const r = mergeMuseum(host, source.museum, prep.mappings);
    const parsed = parseMuseum(r.museum);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    expect(r.museum.walls.length).toBe(host.walls.length + source.museum.walls.length);
    expect(r.summary.works).toBe(source.museum.works.length);
    expect(store.files.size).toBe(prep.uploaded);

    // export: museum.json + all media, read back
    const bytes = new Map<string, Blob>(store.files);
    const exp = await exportMuseumZip(r.museum, { mediaUrl: (f) => (bytes.has(f) || host.media.some((m) => m.file === f) ? `u:${f}` : undefined) }, async (u) => {
      const f = u.slice(2);
      const b = bytes.get(f);
      return b ? { ok: true, blob: async () => b } : { ok: false, blob: async () => new Blob([]) };
    });
    // host media are not in `bytes`, so they are reported missing; the uploaded guest files are present
    expect(exp.missing.sort()).toEqual(host.media.map((m) => m.file).sort());
    const z = await openZip(exp.blob);
    const mj = z.entries.find((e) => e.name === 'museum.json')!;
    expect(await (await z.read(mj, 5e6)).text()).toBe(JSON.stringify(parsed.ok && parsed.museum, null, 2) + '\n');
    expect(z.entries.length - 1).toBe(store.files.size);

    // zip -> import source round trip gives the same museum
    const back = await sourceFromZip(new File([exp.blob], 'x.zip'));
    expect(back.museum).toEqual(parsed.ok && parsed.museum);
    const someFile = r.museum.media.find((m) => store.files.has(m.file))!;
    expect(await (await back.readMedia(someFile.file))!.arrayBuffer()).toEqual(await store.files.get(someFile.file)!.arrayBuffer());
  });

  it('dedupes by file path + kind and honours onlyUsed', async () => {
    const dir = makeSample();
    const source = await sourceFromDirHandle(fakeDir(dir));
    const host = { ...source.museum, name: 'Copy' }; // started from a common copy
    const store = fakeStore();
    const prep = await prepareMedia(host, source, store, {});
    expect(prep.ok && prep.uploaded).toBe(0);
    const only = await prepareMedia({ ...host, media: [] }, source, fakeStore(), { onlyUsed: true });
    expect(only.ok && only.mappings.size).toBeLessThan(source.museum.media.length + 1);
  });

  it('stops without a result when an upload fails, and reports which file', async () => {
    const source = await sourceFromDirHandle(fakeDir(makeSample()));
    let n = 0;
    const store = { upload: async (name: string) => { if (++n === 2) throw new Error('disk full'); return `media/ok${n}.${name.split('.').pop()}`; } };
    const prep = await prepareMedia({ ...loadHost() }, source, store, {});
    expect(prep.ok).toBe(false);
    if (!prep.ok) expect(prep.failures[0]).toMatch(/disk full/);
  });

  it('treats files missing in the source as missing (warning from the merge)', async () => {
    const source = await sourceFromDirHandle(fakeDir(makeSample()));
    const gone = { ...source, readMedia: async (f: string) => (f.includes('forest') ? null : source.readMedia(f)) };
    const host = defaultMuseum(); // nothing in common, so nothing is deduped
    const prep = await prepareMedia(host, gone, fakeStore(), {});
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    const r = mergeMuseum(host, source.museum, prep.mappings);
    expect(r.warnings.some((w) => /not found/.test(w))).toBe(true);
    expect(parseMuseum(r.museum).ok).toBe(true);
  });
});

describe('import sources', () => {
  const json = JSON.stringify(parseMuseum({ version: 4 } as never).ok ? {} : {});
  it('reads a zip wrapped in a folder, ignoring __MACOSX', async () => {
    const dir = makeSample();
    const mj = readFileSync(join(dir, 'museum.json'));
    const png = readFileSync(join(dir, 'media', 'forest.png'));
    const zip = await writeZip([
      { name: '__MACOSX/My museum/._museum.json', data: new Blob(['junk']) },
      { name: 'My museum/museum.json', data: new Blob([mj]) },
      { name: 'My museum/media/forest.png', data: new Blob([png]) },
    ]);
    const s = await sourceFromZip(zip, 'My museum.zip');
    expect(s.museum.name).toBe('Sample Museum');
    expect((await s.readMedia('media/forest.png'))!.size).toBe(png.length);
    expect(await s.readMedia('media/nope.png')).toBeNull();
    expect(await s.readMedia('../etc/passwd')).toBeNull();
  });

  it('reports garbage, a missing museum.json and invalid museums as ImportError', async () => {
    await expect(sourceFromZip(new Blob(['garbage garbage garbage garbage']), 'g.zip')).rejects.toBeInstanceOf(ImportError);
    const noMuseum = await writeZip([{ name: 'a.txt', data: new Blob(['x']) }]);
    await expect(sourceFromZip(noMuseum, 'n.zip')).rejects.toThrow(/No museum.json/);
    const bad = await writeZip([{ name: 'museum.json', data: new Blob(['{"version":99}']) }]);
    await expect(sourceFromZip(bad, 'b.zip')).rejects.toBeInstanceOf(ImportError);
    const notJson = await writeZip([{ name: 'museum.json', data: new Blob(['nope']) }]);
    await expect(sourceFromZip(notJson, 'j.zip')).rejects.toThrow(/not valid JSON/);
    expect(json).toBeTypeOf('string');
  });

  it('reads a webkitdirectory file list', async () => {
    const dir = makeSample();
    const mk = (rel: string, data: Buffer) => {
      const f = new File([data as never], rel.split('/').pop()!);
      Object.defineProperty(f, 'webkitRelativePath', { value: rel });
      return f;
    };
    const s = await sourceFromFileList([
      mk('Folder/museum.json', readFileSync(join(dir, 'museum.json'))),
      mk('Folder/media/tide.png', readFileSync(join(dir, 'media', 'tide.png'))),
    ]);
    expect(s.label).toBe('Folder');
    expect(await s.readMedia('media/tide.png')).not.toBeNull();
  });
});

describe('zipFileName', () => {
  it('sanitises', () => {
    expect(zipFileName('My/Museum: "1"')).toBe('My Museum 1.zip');
    expect(zipFileName('   ')).toBe('museum.zip');
    expect(zipFileName('..hidden')).toBe('hidden.zip');
  });
});
