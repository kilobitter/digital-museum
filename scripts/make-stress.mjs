// Generates a large v2 museum for stress-testing the viewer: a 10 x 9 grid of rooms (90), 500 works,
// 90 audio zones, with tiny generated media files (every painting is its own file, as in real use).
// Usage: node scripts/make-stress.mjs <outDir> [--force]
// Refuses to write into public/museum (your real museum).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const outArg = args.find((a) => !a.startsWith('--'));
if (!outArg) {
  console.error('Usage: node scripts/make-stress.mjs <outDir>');
  process.exit(2);
}
const root = resolve(outArg);
const publicMuseum = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'museum');
if (root === publicMuseum || root.startsWith(publicMuseum + '/')) {
  console.error('Refusing to write into public/museum: it holds your own museum. Choose another folder.');
  process.exit(1);
}
rmSync(join(root, 'media'), { recursive: true, force: true });
mkdirSync(join(root, 'media'), { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.copy(raw, y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds = 0.1, rate = 8000) {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}

const COLS = 10, ROWS = 9, SIZE = 10, PITCH = 14, WORKS = 500;
const walls = [], zones = [], works = [], media = [];
const wavBytes = wav();
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const n = r * COLS + c;
    const x0 = c * PITCH, y0 = r * PITCH, x1 = x0 + SIZE, y1 = y0 + SIZE;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4];
      walls.push({ id: `w${n}-${k}`, a: { x: ax, y: ay }, b: { x: bx, y: by } }); // clockwise: side 1 faces into the room
    }
    media.push({ id: `a${n}`, kind: 'audio', file: `media/loop${n}.wav`, name: `Loop ${n}.wav` });
    writeFileSync(join(root, 'media', `loop${n}.wav`), wavBytes);
    zones.push({ id: `z${n}`, name: `Room ${n}`, mediaId: `a${n}`, shape: { kind: 'rect', x: x0 + 1, y: y0 + 1, w: SIZE - 2, h: SIZE - 2 }, volume: 0.6, fade: 1.5 });
  }
}
for (let i = 0; i < WORKS; i++) {
  const room = i % (COLS * ROWS), k = Math.floor(i / (COLS * ROWS)); // 0..5
  const w = 1000 + (i % 7) * 100, h = 700 + (i % 5) * 150;
  const file = `media/p${i}.png`;
  writeFileSync(join(root, file), png(4, 3, Buffer.from([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256])));
  media.push({ id: `p${i}`, kind: 'image', file, name: `Painting ${i}.png`, width: w, height: h, title: `Painting ${i}`, artist: `Artist ${i % 40}` });
  works.push({ id: `work${i}`, mediaId: `p${i}`, wallId: `w${room}-${k % 4}`, side: 1, t: k < 4 ? 3 : 7, centerHeight: 1.5, width: 1.2 });
}
const museum = {
  version: 2,
  name: 'Stress museum',
  settings: { wallHeight: 3, wallThickness: 0.2, gridSize: 0.5, ceiling: true, wallFinish: { color: '#ffffff', tileSize: 1 }, spawn: { x: SIZE / 2, y: SIZE / 2, yawDeg: 0 } },
  walls, works, zones, media,
};
writeFileSync(join(root, 'museum.json'), JSON.stringify(museum, null, 1));
console.log(`Wrote ${walls.length} walls, ${works.length} works, ${zones.length} zones, ${media.length} media to ${root}`);
