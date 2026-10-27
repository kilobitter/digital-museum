// Generates the sample museum into public/museum/ (no dependencies).
// Usage: node scripts/make-sample.mjs
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'museum');
rmSync(join(root, 'media'), { recursive: true, force: true });
mkdirSync(join(root, 'media'), { recursive: true });

// ---- PNG encoder ----
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
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x / (w - 1), y / (h - 1), x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const images = [
  { id: 'img1', file: 'sunrise', w: 800, h: 500, name: 'Sunrise.png', c1: [255, 140, 66], c2: [90, 40, 120] },
  { id: 'img2', file: 'forest', w: 500, h: 700, name: 'Forest.png', c1: [20, 90, 60], c2: [190, 230, 150] },
  { id: 'img3', file: 'tide', w: 600, h: 600, name: 'Tide.png', c1: [10, 40, 110], c2: [120, 210, 230] },
  { id: 'img4', file: 'ember', w: 700, h: 400, name: 'Ember.png', c1: [200, 30, 40], c2: [250, 220, 90] },
  { id: 'img5', file: 'dusk', w: 1000, h: 500, name: 'Dusk.png', c1: [40, 30, 80], c2: [240, 120, 160] },
  { id: 'img6', file: 'meadow', w: 480, h: 720, name: 'Meadow.png', c1: [120, 200, 90], c2: [250, 240, 170] },
];
images.forEach((im, i) => {
  const buf = png(im.w, im.h, (u, v, x, y) => {
    const base = mix(im.c1, im.c2, i % 2 ? u : v);
    const stripe = ((Math.floor(x / 40) + Math.floor(y / 40)) & 1) ? 0 : 14; // checker so scale/orientation is visible
    return base.map((c) => Math.min(255, c + stripe));
  });
  writeFileSync(join(root, 'media', `${im.file}.png`), buf);
});

// ---- WAV generator (integer cycles over the duration => seamless loop) ----
function wav(freqs, seconds = 4, rate = 22050) {
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let s = 0;
    freqs.forEach((f, k) => { s += Math.sin((2 * Math.PI * f * i) / rate) / (k + 1.5); });
    s *= 0.3 * (0.75 + 0.25 * Math.sin((2 * Math.PI * i) / n)); // slow swell, periodic
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
writeFileSync(join(root, 'media', 'hum.wav'), wav([220, 277, 330]));
writeFileSync(join(root, 'media', 'chime.wav'), wav([440, 660, 880, 1100]));

// ---- museum ----
const media = [
  ...images.map((im) => ({ id: im.id, kind: 'image', file: `media/${im.file}.png`, name: im.name, width: im.w, height: im.h })),
  { id: 'aud1', kind: 'audio', file: 'media/hum.wav', name: 'Hum.wav' },
  { id: 'aud2', kind: 'audio', file: 'media/chime.wav', name: 'Chime.wav' },
];
// Room A: x 0..8, y 0..6. Room B: x 8..16, y 0..6. Doorway in the shared wall at y 2..4.
const walls = [
  { id: 'wA-top', a: { x: 0, y: 0 }, b: { x: 8, y: 0 } },     // perp = +y (into the room)
  { id: 'wA-bottom', a: { x: 8, y: 6 }, b: { x: 0, y: 6 } },  // perp = -y (into the room)
  { id: 'wA-left', a: { x: 0, y: 6 }, b: { x: 0, y: 0 } },    // perp = +x (into the room)
  { id: 'wD-north', a: { x: 8, y: 0 }, b: { x: 8, y: 2 } },   // perp = -x (room A); side -1 = room B
  { id: 'wD-south', a: { x: 8, y: 6 }, b: { x: 8, y: 4 } },   // perp = +x (room B); side -1 = room A
  { id: 'wB-top', a: { x: 8, y: 0 }, b: { x: 16, y: 0 } },
  { id: 'wB-bottom', a: { x: 16, y: 6 }, b: { x: 8, y: 6 } },
  { id: 'wB-right', a: { x: 16, y: 0 }, b: { x: 16, y: 6 } }, // perp = -x (into the room)
];
const work = (id, mediaId, wallId, side, t, width, title, artist, description) => ({
  id, mediaId, wallId, side, t, centerHeight: 1.5, width, title, artist, ...(description ? { description } : {}),
});
const museum = {
  version: 1,
  name: 'Sample Museum',
  settings: { wallHeight: 3, wallThickness: 0.2, gridSize: 0.5, ceiling: true, spawn: { x: 4, y: 5, yawDeg: 0 } },
  walls,
  works: [
    work('wk1', 'img1', 'wA-top', 1, 4, 2.4, 'Sunrise', 'A. Student', 'Gradient study, 2026'),
    work('wk2', 'img2', 'wA-left', 1, 3, 1.2, 'Forest', 'B. Student'),
    work('wk3', 'img3', 'wA-bottom', 1, 4, 1.5, 'Tide', 'C. Student', 'Square format.'),
    work('wk4', 'img4', 'wD-south', -1, 1, 1.2, 'Ember', 'D. Student'),
    work('wk5', 'img5', 'wB-top', 1, 4, 2.8, 'Dusk', 'E. Student', 'Panoramic.'),
    work('wk6', 'img6', 'wB-right', 1, 3, 1.3, 'Meadow', 'F. Student', 'Hangs on the far wall of room B.'),
  ],
  zones: [
    { id: 'z1', name: 'Hum (room A)', mediaId: 'aud1', shape: { kind: 'rect', x: 1.5, y: 1.5, w: 4, h: 3 }, volume: 0.8, fade: 1 },
    { id: 'z2', name: 'Chime (doorway and room B)', mediaId: 'aud2', shape: { kind: 'circle', cx: 11, cy: 3, r: 3.5 }, volume: 0.6, fade: 1.5 },
  ],
  media,
};
writeFileSync(join(root, 'museum.json'), JSON.stringify(museum, null, 2) + '\n');
console.log('Sample museum written to', root);
