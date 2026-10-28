// Minimal zip reader/writer without dependencies. Writer: store-only (method 0). Reader: methods 0 and 8
// (deflate via DecompressionStream) over a Blob using slice(), so a big zip is never loaded whole.
// No zip64, no encryption. Entry names are only ever used for lookup, never as paths to write to.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

// ---- CRC-32 ----
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Running CRC: start with 0xffffffff, finish with `(crc ^ 0xffffffff) >>> 0`. */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}
export const crc32 = (bytes: Uint8Array): number => (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;

// ---- writer ----
export interface ZipInput {
  name: string;
  data: Blob;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Store-only zip. The result references the input Blobs; each input is read once, for its CRC. */
export async function writeZip(entries: readonly ZipInput[], now: Date = new Date()): Promise<Blob> {
  if (entries.length > MAX_ENTRIES) throw new Error(`Too many files for a zip (${entries.length}, max ${MAX_ENTRIES})`);
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let cdSize = 0;
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    if (name.length === 0 || name.length > 0xffff) throw new Error(`Invalid file name in zip: ${e.name.slice(0, 40)}`);
    const size = e.data.size;
    if (size >= MAX_SIZE) throw new Error(`${e.name} is too large for a zip (max 4 GB)`);
    const crc = crc32(new Uint8Array(await e.data.arrayBuffer()));
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd as BlobPart);
    cdSize += cd.length;
    parts.push(local as BlobPart, e.data);
    offset += local.length + size;
    if (offset >= MAX_SIZE) throw new Error('The zip would be larger than 4 GB');
  }
  if (offset + cdSize >= MAX_SIZE) throw new Error('The zip would be larger than 4 GB');
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, eocd as BlobPart], { type: 'application/zip' });
}

// ---- reader ----
export interface ZipEntry {
  /** Normalised: forward slashes. */
  name: string;
  method: number;
  /** General-purpose flags; bit 0 = encrypted. */
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  isDirectory: boolean;
}

export interface ZipArchive {
  entries: ZipEntry[];
  /** Reads one entry fully (checks size limit, sizes and CRC). Throws on anything odd. */
  read(entry: ZipEntry, maxBytes: number): Promise<Blob>;
}

const u32 = (b: Blob, start: number, len: number) => b.slice(start, start + len).arrayBuffer().then((x) => new DataView(x));

export async function openZip(blob: Blob): Promise<ZipArchive> {
  if (blob.size < 22) throw new Error('This is not a zip file (too small)');
  const tailLen = Math.min(blob.size, 22 + 0xffff);
  const tailStart = blob.size - tailLen;
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD && i + 22 + tail.getUint16(i + 20, true) <= tailLen) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a valid zip file (no end-of-archive record found)');
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) throw new Error('Zip64 archives are not supported');
  const disk = tail.getUint16(eocd + 4, true);
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('Zip64 archives are not supported');
  if (disk !== 0 || tail.getUint16(eocd + 6, true) !== 0) throw new Error('Multi-part zip files are not supported');
  if (cdOffset + cdSize > tailStart + eocd) throw new Error('This zip file is damaged (directory out of range)');

  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cdBytes = new Uint8Array(cd.buffer);
  const dec = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) throw new Error('This zip file is damaged (bad directory entry)');
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen > cd.byteLength) throw new Error('This zip file is damaged (directory entry out of range)');
    const compressedSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const localOffset = cd.getUint32(p + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error('Zip64 archives are not supported');
    const name = dec.decode(cdBytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    entries.push({
      name,
      method: cd.getUint16(p + 10, true),
      flags: cd.getUint16(p + 8, true),
      crc: cd.getUint32(p + 16, true),
      compressedSize,
      size,
      localOffset,
      isDirectory: name.endsWith('/'),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function read(e: ZipEntry, maxBytes: number): Promise<Blob> {
    if (e.flags & 0x41) throw new Error(`"${e.name}" is encrypted; encrypted zip files are not supported`);
    if (e.method !== 0 && e.method !== 8) throw new Error(`"${e.name}" uses an unsupported compression method (${e.method})`);
    if (e.size > maxBytes) throw new Error(`"${e.name}" is too large (${(e.size / 1048576).toFixed(1)} MB, max ${Math.round(maxBytes / 1048576)} MB)`);
    const lh = await u32(blob, e.localOffset, 30);
    if (lh.byteLength < 30 || lh.getUint32(0, true) !== SIG_LOCAL) throw new Error(`"${e.name}" is damaged (bad local header)`);
    const start = e.localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + e.compressedSize > cdOffset) throw new Error(`"${e.name}" is damaged (data out of range)`);
    const raw = blob.slice(start, start + e.compressedSize);
    let crc = 0xffffffff;
    let total = 0;
    const chunks: Uint8Array[] = [];
    if (e.method === 0) {
      if (e.compressedSize !== e.size) throw new Error(`"${e.name}" is damaged (size mismatch)`);
      const bytes = new Uint8Array(await raw.arrayBuffer());
      crc = crc32Update(crc, bytes);
      total = bytes.length;
      chunks.push(bytes);
    } else {
      try {
        const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > e.size || total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`"${e.name}" is larger than its header says`);
          }
          crc = crc32Update(crc, value);
          chunks.push(value);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith(`"${e.name}"`)) throw err;
        throw new Error(`"${e.name}" is damaged (could not decompress)`);
      }
    }
    if (total !== e.size) throw new Error(`"${e.name}" is damaged (size mismatch)`);
    if (((crc ^ 0xffffffff) >>> 0) !== e.crc) throw new Error(`"${e.name}" is damaged (checksum mismatch)`);
    return new Blob(chunks as BlobPart[]);
  }

  return { entries, read };
}

// ---- museum layout inside a zip / folder listing ----
const ignored = (path: string) => path.split('/').some((s) => s === '__MACOSX' || (s.startsWith('.') && s !== ''));

/**
 * Directory prefix ('' or 'My museum/') of the shallowest `museum.json` among `paths` (files only),
 * ignoring `__MACOSX/` and dot-files. null when there is none. Ties: alphabetical.
 */
export function findMuseumRoot(paths: readonly string[]): string | null {
  let best: string | null = null;
  const depth = (s: string) => s.split('/').length;
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/');
    if (ignored(path) || path.endsWith('/')) continue;
    if (path !== 'museum.json' && !path.endsWith('/museum.json')) continue;
    const prefix = path.slice(0, path.length - 'museum.json'.length);
    if (best === null || depth(prefix) < depth(best) || (depth(prefix) === depth(best) && prefix < best)) best = prefix;
  }
  return best;
}
