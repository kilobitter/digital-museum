import { describe, expect, it } from 'vitest';
import {
  SealedError, deriveKey, newManifest, openSealed, parseManifest, sealBytes, toBase64, fromBase64, mimeFor,
  DEFAULT_ITERATIONS,
} from './sealed';

const good = () => JSON.parse(JSON.stringify(newManifest(100_000)));
const salt16 = toBase64(new Uint8Array(16).fill(7));

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    expect(parseManifest(good()).kdf.iterations).toBe(100_000);
    expect(newManifest().kdf.iterations).toBe(DEFAULT_ITERATIONS);
  });
  const cases: [string, (m: any) => void][] = [
    ['format', (m) => (m.format = 'x')],
    ['version', (m) => (m.version = 2)],
    ['cipher', (m) => (m.cipher = 'AES-CBC')],
    ['kdf name', (m) => (m.kdf.name = 'scrypt')],
    ['kdf hash', (m) => (m.kdf.hash = 'SHA-1')],
    ['missing kdf', (m) => delete m.kdf],
    ['iterations too low', (m) => (m.kdf.iterations = 99_999)],
    ['iterations too high', (m) => (m.kdf.iterations = 10_000_001)],
    ['iterations not a number', (m) => (m.kdf.iterations = '600000')],
    ['iterations fractional', (m) => (m.kdf.iterations = 200000.5)],
    ['salt too short', (m) => (m.kdf.salt = toBase64(new Uint8Array(15)))],
    ['salt too long', (m) => (m.kdf.salt = toBase64(new Uint8Array(17)))],
    ['salt not base64', (m) => (m.kdf.salt = '!!!!')],
    ['salt not a string', (m) => (m.kdf.salt = 5)],
  ];
  it.each(cases)('rejects bad %s', (_name, mutate) => {
    const m = good();
    mutate(m);
    expect(() => parseManifest(m)).toThrowError(SealedError);
    try { parseManifest(m); } catch (e) { expect((e as SealedError).kind).toBe('malformed'); }
  });
  it.each([null, 5, 'x', [], undefined])('rejects non-object %s', (v) => {
    expect(() => parseManifest(v)).toThrowError(SealedError);
  });
  it('accepts the boundaries 100000 and 10000000', () => {
    const a = good(); a.kdf.iterations = 100_000;
    const b = good(); b.kdf.iterations = 10_000_000;
    expect(() => parseManifest(a)).not.toThrow();
    expect(() => parseManifest(b)).not.toThrow();
  });
});

describe('sealed files', () => {
  const m = parseManifest({ format: 'vr-museum-sealed', version: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000, salt: salt16 }, cipher: 'AES-GCM' });
  const plain = new TextEncoder().encode('hello museum');

  it('round trips and starts with VMS1 + 12-byte IV', async () => {
    const key = await deriveKey('pw-pw-pw-pw-pw', m);
    const s = await sealBytes(key, plain, 'museum.json');
    expect(new TextDecoder().decode(s.slice(0, 4))).toBe('VMS1');
    expect(s.length).toBe(4 + 12 + plain.length + 16);
    expect(new Uint8Array(await openSealed(key, s, 'museum.json'))).toEqual(plain);
  });
  it('rejects wrong magic and short files as malformed', async () => {
    const key = await deriveKey('pw-pw-pw-pw-pw', m);
    const s = await sealBytes(key, plain, 'museum.json');
    const badMagic = s.slice(); badMagic[0] = 0x58;
    await expect(openSealed(key, badMagic, 'museum.json')).rejects.toMatchObject({ kind: 'malformed' });
    await expect(openSealed(key, s.slice(0, 31), 'museum.json')).rejects.toMatchObject({ kind: 'malformed' });
    await expect(openSealed(key, new ArrayBuffer(0), 'museum.json')).rejects.toMatchObject({ kind: 'malformed' });
  });
  it('treats a tampered byte, wrong key or wrong path as wrong-key/damaged', async () => {
    const key = await deriveKey('pw-pw-pw-pw-pw', m);
    const s = await sealBytes(key, plain, 'media/a.jpg');
    for (const idx of [4, 20, s.length - 1]) {
      const t = s.slice(); t[idx] ^= 1;
      await expect(openSealed(key, t, 'media/a.jpg')).rejects.toMatchObject({ kind: 'wrong-key' });
    }
    await expect(openSealed(key, s, 'media/b.jpg')).rejects.toMatchObject({ kind: 'wrong-key' });
    const other = await deriveKey('another-password-1', m);
    await expect(openSealed(other, s, 'media/a.jpg')).rejects.toMatchObject({ kind: 'wrong-key' });
  });
  it('the derived key is not extractable', async () => {
    const key = await deriveKey('pw-pw-pw-pw-pw', m);
    expect(key.extractable).toBe(false);
  });
});

describe('helpers', () => {
  it('base64 round trips', () => {
    const b = new Uint8Array([0, 1, 254, 255, 128]);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });
  it('mime types by extension', () => {
    expect(mimeFor('media/a.JPG')).toBe('image/jpeg');
    expect(mimeFor('media/a.mp3')).toBe('audio/mpeg');
    expect(mimeFor('media/a.bin')).toBe('application/octet-stream');
  });
});
