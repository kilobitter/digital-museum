import { describe, expect, it } from 'vitest';
import { crc32, findMuseumRoot, openZip, writeZip } from './zip';

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (b: Blob) => b.text();
const buf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Hand-built single-entry zip with a chosen method/flags, for reader tests. */
async function rawZip(name: string, stored: Uint8Array, opts: { method: number; flags: number; size: number; crc: number }): Promise<Blob> {
  const n = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(6, opts.flags, true);
  lv.setUint16(8, opts.method, true);
  lv.setUint32(14, opts.crc, true);
  lv.setUint32(18, stored.length, true);
  lv.setUint32(22, opts.size, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  const cd = new Uint8Array(46 + n.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(8, opts.flags, true);
  cv.setUint16(10, opts.method, true);
  cv.setUint32(16, opts.crc, true);
  cv.setUint32(20, stored.length, true);
  cv.setUint32(24, opts.size, true);
  cv.setUint16(28, n.length, true);
  cv.setUint32(42, 0, true);
  cd.set(n, 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, local.length + stored.length, true);
  return new Blob([local, stored as BlobPart, cd, eocd]);
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('writeZip / openZip', () => {
  it('round-trips names (incl. non-ASCII), binary data and empty files', async () => {
    const bin = new Uint8Array(70000).map((_, i) => (i * 31 + 7) & 0xff);
    const zip = await writeZip([
      { name: 'museum.json', data: new Blob(['{"a":1}\n']) },
      { name: 'media/schilderij-é-日本.png', data: new Blob([bin as BlobPart]) },
      { name: 'media/empty.wav', data: new Blob([]) },
    ]);
    const z = await openZip(zip);
    expect(z.entries.map((e) => e.name)).toEqual(['museum.json', 'media/schilderij-é-日本.png', 'media/empty.wav']);
    expect(z.entries.every((e) => (e.flags & 0x800) !== 0 && e.method === 0)).toBe(true);
    expect(await text(await z.read(z.entries[0], 1e6))).toBe('{"a":1}\n');
    expect(await buf(await z.read(z.entries[1], 1e6))).toEqual(bin);
    expect((await z.read(z.entries[2], 1e6)).size).toBe(0);
  });

  it('writes valid DOS timestamps', async () => {
    const z = await openZip(await writeZip([{ name: 'a', data: new Blob(['x']) }], new Date(2026, 9, 28, 13, 45, 30)));
    const raw = new DataView(await (await writeZip([{ name: 'a', data: new Blob(['x']) }], new Date(2026, 9, 28, 13, 45, 30))).arrayBuffer());
    expect(z.entries).toHaveLength(1);
    expect(raw.getUint16(10, true)).toBe((13 << 11) | (45 << 5) | 15);
    expect(raw.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 28);
  });

  it('detects a corrupted stored entry by CRC', async () => {
    const zip = await writeZip([{ name: 'a.bin', data: new Blob([bytes(1, 2, 3, 4)]) }]);
    const raw = await buf(zip);
    raw[30 + 5] ^= 0xff; // first data byte
    const z = await openZip(new Blob([raw]));
    await expect(z.read(z.entries[0], 100)).rejects.toThrow(/checksum/);
  });

  it('enforces the size limit before reading', async () => {
    const z = await openZip(await writeZip([{ name: 'a.bin', data: new Blob([new Uint8Array(100)]) }]));
    await expect(z.read(z.entries[0], 50)).rejects.toThrow(/too large/);
  });

  it('refuses more than 65535 entries', async () => {
    const one = new Blob(['x']);
    const many = Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}`, data: one }));
    await expect(writeZip(many)).rejects.toThrow(/Too many/);
  });
});

describe('openZip reading', () => {
  it('reads a deflate entry', async () => {
    const data = new TextEncoder().encode('hello hello hello hello '.repeat(200));
    const comp = await deflate(data);
    expect(comp.length).toBeLessThan(data.length);
    const z = await openZip(await rawZip('d.txt', comp, { method: 8, flags: 0, size: data.length, crc: crc32(data) }));
    expect(await buf(await z.read(z.entries[0], 1e6))).toEqual(data);
  });

  it('stops a deflate entry that inflates beyond its declared size', async () => {
    const data = new Uint8Array(5000);
    const comp = await deflate(data);
    const z = await openZip(await rawZip('bomb.bin', comp, { method: 8, flags: 0, size: 100, crc: crc32(data) }));
    await expect(z.read(z.entries[0], 1e6)).rejects.toThrow(/larger than its header/);
  });

  it('rejects encrypted entries', async () => {
    const z = await openZip(await rawZip('s.bin', bytes(1, 2, 3), { method: 0, flags: 1, size: 3, crc: 0 }));
    await expect(z.read(z.entries[0], 100)).rejects.toThrow(/encrypted/);
  });

  it('rejects unsupported methods', async () => {
    const z = await openZip(await rawZip('s.bin', bytes(1, 2, 3), { method: 12, flags: 0, size: 3, crc: 0 }));
    await expect(z.read(z.entries[0], 100)).rejects.toThrow(/compression method/);
  });

  it('rejects zip64 markers', async () => {
    const raw = await buf(await writeZip([{ name: 'a', data: new Blob(['x']) }]));
    new DataView(raw.buffer).setUint16(raw.length - 22 + 10, 0xffff, true);
    await expect(openZip(new Blob([raw]))).rejects.toThrow(/Zip64/);
  });

  it('errors, and does not hang, on garbage and truncated files', async () => {
    await expect(openZip(new Blob(['not a zip at all, just text'.repeat(10)]))).rejects.toThrow();
    await expect(openZip(new Blob([]))).rejects.toThrow();
    const zip = await buf(await writeZip([{ name: 'a', data: new Blob(['hello world']) }]));
    await expect(openZip(new Blob([zip.subarray(0, zip.length - 10)]))).rejects.toThrow();
    await expect(openZip(new Blob([zip.subarray(0, 20)]))).rejects.toThrow();
  });

  it('errors on truncated deflate data', async () => {
    const data = new TextEncoder().encode('abcdefghij'.repeat(1000));
    const comp = (await deflate(data)).subarray(0, 8);
    const z = await openZip(await rawZip('t.txt', comp, { method: 8, flags: 0, size: data.length, crc: crc32(data) }));
    await expect(z.read(z.entries[0], 1e6)).rejects.toThrow(/damaged/);
  });

  it('survives a zip comment', async () => {
    const raw = await buf(await writeZip([{ name: 'a', data: new Blob(['x']) }]));
    new DataView(raw.buffer).setUint16(raw.length - 2, 5, true);
    const z = await openZip(new Blob([raw, 'hello']));
    expect(z.entries).toHaveLength(1);
  });
});

describe('findMuseumRoot', () => {
  it('finds museum.json at the root or in one wrapping folder', () => {
    expect(findMuseumRoot(['museum.json', 'media/a.png'])).toBe('');
    expect(findMuseumRoot(['My museum/', 'My museum/museum.json', 'My museum/media/a.png'])).toBe('My museum/');
  });
  it('takes the shallowest and ignores __MACOSX and dot-files', () => {
    expect(findMuseumRoot(['__MACOSX/My museum/._museum.json', '__MACOSX/museum.json', 'a/b/museum.json', 'a/museum.json'])).toBe('a/');
    expect(findMuseumRoot(['.hidden/museum.json', 'x/y/museum.json'])).toBe('x/y/');
    expect(findMuseumRoot(['b/museum.json', 'a/museum.json'])).toBe('a/');
  });
  it('returns null when there is none', () => {
    expect(findMuseumRoot(['media/a.png', 'notmuseum.json', 'x/old-museum.json'])).toBeNull();
    expect(findMuseumRoot([])).toBeNull();
  });
});
