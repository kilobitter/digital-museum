import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { defaultMuseum } from '../shared/validate';
import {
  BodyTooLarge,
  allowedExtension,
  checkGuards,
  deleteMedia,
  generateId,
  isLoopback,
  isValidMediaFile,
  resolveMuseumFile,
  readBody,
  resolveMediaPath,
  saveMedia,
  saveMuseum,
  writeFileAtomic,
  MAX_MEDIA_BYTES,
} from './museumApi';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'museum-api-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('guards', () => {
  const ok = { 'x-museum-editor': '1', host: 'localhost:5173' };
  it('accepts loopback addresses only', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(a)).toBe(true);
    for (const a of ['192.168.1.5', '::ffff:192.168.1.5', '10.0.0.1', '', undefined, '127.0.0.2']) expect(isLoopback(a)).toBe(false);
  });
  it('passes a proper request', () => {
    expect(checkGuards({ remoteAddress: '::1', headers: ok })).toBeNull();
  });
  it('403 for non-loopback before anything else', () => {
    expect(checkGuards({ remoteAddress: '192.168.1.9', headers: ok })?.status).toBe(403);
  });
  it('403 without the editor header or with a wrong value', () => {
    expect(checkGuards({ remoteAddress: '::1', headers: { host: 'x' } })?.status).toBe(403);
    expect(checkGuards({ remoteAddress: '::1', headers: { host: 'x', 'x-museum-editor': '0' } })?.status).toBe(403);
  });
  it('origin must match host when present', () => {
    expect(checkGuards({ remoteAddress: '::1', headers: { ...ok, origin: 'https://localhost:5173' } })).toBeNull();
    expect(checkGuards({ remoteAddress: '::1', headers: { ...ok, origin: 'https://evil.example' } })?.status).toBe(403);
    expect(checkGuards({ remoteAddress: '::1', headers: { ...ok, origin: 'null' } })?.status).toBe(403);
    // HTTP/2: no Host header, only :authority
    const h2 = { 'x-museum-editor': '1', ':authority': 'localhost:5173' };
    expect(checkGuards({ remoteAddress: '::1', headers: { ...h2, origin: 'https://localhost:5173' } })).toBeNull();
    expect(checkGuards({ remoteAddress: '::1', headers: { ...h2, origin: 'https://evil.example' } })?.status).toBe(403);
    expect(checkGuards({ remoteAddress: '::1', headers: { ...h2, origin: 'https://localhost:5173' } })).toBeNull();
    expect(checkGuards({ remoteAddress: '::1', headers: { 'x-museum-editor': '1', origin: 'https://localhost:5173' } })?.status).toBe(403);
    expect(checkGuards({ remoteAddress: '::1', headers: { ...ok, origin: 'https://localhost:5174' } })?.status).toBe(403);
  });
});

describe('host check', () => {
  const g = (host?: string) => checkGuards({ remoteAddress: '::1', headers: { 'x-museum-editor': '1', ...(host ? { host } : {}) } });
  it('accepts loopback hostnames with any port', () => {
    for (const h of ['localhost:5173', '127.0.0.1:5173', '[::1]:5173', 'localhost']) expect(g(h)).toBeNull();
  });
  it('rejects foreign or missing host', () => {
    for (const h of ['evil.example:5173', 'localhost.evil.example', '192.168.1.5:5173', 'a@b', undefined]) expect(g(h)?.status).toBe(403);
  });
});

describe('names and paths', () => {
  it('extension allowlist, case-insensitive', () => {
    expect(allowedExtension('A.PNG')).toBe('png');
    expect(allowedExtension('x.tar.wav')).toBe('wav');
    for (const n of ['x.exe', 'x', 'x.svg', 'x.jpg.sh', '.', 'png']) expect(allowedExtension(n)).toBeNull();
  });
  it('generates [a-z0-9]{10} ids', () => {
    for (let i = 0; i < 20; i++) expect(generateId()).toMatch(/^[a-z0-9]{10}$/);
  });
  it('file pattern is strict', () => {
    expect(isValidMediaFile('media/abc_-1.jpg')).toBe(true);
    for (const f of ['media/../museum.json', 'media/a/b.jpg', '../media/a.jpg', 'media/a.exe', '/etc/passwd', 'media/a.jpg\n', 'media/.jpg', 'museum.json', 'media/a.JPG'])
      expect(isValidMediaFile(f)).toBe(false);
  });
  it('resolveMediaPath stays inside <root>/media', () => {
    expect(resolveMediaPath(root, 'media/a.jpg')).toBe(path.join(root, 'media', 'a.jpg'));
    expect(resolveMediaPath(root, 'media/../museum.json')).toBeNull();
    expect(resolveMediaPath(root, '../x.jpg')).toBeNull();
  });
});

describe('resolveMuseumFile', () => {
  const root = '/srv/museum';
  it('serves museum.json and valid media files', () => {
    expect(resolveMuseumFile(root, 'museum.json')).toBe(path.join(root, 'museum.json'));
    expect(resolveMuseumFile(root, 'media/ab12cd34ef.jpg')).toBe(path.join(root, 'media/ab12cd34ef.jpg'));
  });
  it('refuses anything else so it falls through to Vite', () => {
    for (const rel of ['', 'museum.json.tmp-x', 'media/../museum.json', 'media/%2e%2e/x.jpg', 'media/a.exe', 'other.json', 'media/sub/a.jpg']) {
      expect(resolveMuseumFile(root, rel)).toBeNull();
    }
  });
});

describe('file operations', () => {
  it('atomic write leaves no tmp file and replaces content', async () => {
    const f = path.join(root, 'a.json');
    await writeFileAtomic(f, 'one');
    await writeFileAtomic(f, 'two');
    expect(await fs.readFile(f, 'utf8')).toBe('two');
    expect(await fs.readdir(root)).toEqual(['a.json']);
  });
  it('atomic write cleans up when the rename fails', async () => {
    await fs.mkdir(path.join(root, 'dir'));
    await expect(writeFileAtomic(path.join(root, 'dir'), 'x')).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual(['dir']);
  });
  it('saveMuseum validates and writes', async () => {
    const m = defaultMuseum();
    const r = await saveMuseum(root, m);
    expect(r.status).toBe(200);
    expect(JSON.parse(await fs.readFile(path.join(root, 'museum.json'), 'utf8'))).toEqual(m);
    expect(await fs.readdir(root)).toEqual(['museum.json']);
  });
  it('saveMuseum rejects invalid data without touching the file', async () => {
    await saveMuseum(root, defaultMuseum());
    const r = await saveMuseum(root, { version: 4 }); // right version, nothing else: invalid
    expect(r.status).toBe(400);
    expect(r.status === 400 && r.body.errors.length).toBeGreaterThan(0);
    expect(JSON.parse(await fs.readFile(path.join(root, 'museum.json'), 'utf8')).version).toBe(4);
  });
  it('saveMedia picks id and extension server-side', async () => {
    const r = await saveMedia(root, '../../evil name.PNG', Buffer.from([1, 2, 3]));
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.file).toMatch(/^media\/[a-z0-9]{10}\.png$/);
    expect([...(await fs.readFile(path.join(root, r.body.file)))]).toEqual([1, 2, 3]);
    expect(await fs.readdir(path.join(root, 'media'))).toHaveLength(1);
  });
  it('saveMedia rejects bad extension, empty, oversize', async () => {
    expect((await saveMedia(root, 'x.exe', Buffer.from([1]))).status).toBe(400);
    expect((await saveMedia(root, 'x.png', Buffer.alloc(0))).status).toBe(400);
    expect((await saveMedia(root, 'x.png', { byteLength: MAX_MEDIA_BYTES + 1 } as Uint8Array)).status).toBe(413);
  });
  it('deleteMedia: ok, 404, 400 for traversal', async () => {
    const r = await saveMedia(root, 'a.mp3', Buffer.from([1]));
    if (r.status !== 200) throw new Error('setup');
    await fs.writeFile(path.join(root, 'museum.json'), '{}');
    expect((await deleteMedia(root, 'media/../museum.json')).status).toBe(400);
    expect(await fs.readFile(path.join(root, 'museum.json'), 'utf8')).toBe('{}');
    expect((await deleteMedia(root, r.body.file)).status).toBe(200);
    expect((await deleteMedia(root, r.body.file)).status).toBe(404);
    expect(await fs.readdir(path.join(root, 'media'))).toEqual([]);
  });
});

describe('readBody', () => {
  const fake = (chunks: Buffer[], headers: Record<string, string> = {}) => Object.assign(Readable.from(chunks), { headers }) as unknown as IncomingMessage;
  it('reads under the limit', async () => {
    expect((await readBody(fake([Buffer.from('ab'), Buffer.from('cd')]), 10)).toString()).toBe('abcd');
  });
  it('rejects over the limit while streaming', async () => {
    await expect(readBody(fake([Buffer.alloc(6), Buffer.alloc(6)]), 10)).rejects.toBeInstanceOf(BodyTooLarge);
  });
  it('rejects on declared content-length without reading', async () => {
    await expect(readBody(fake([], { 'content-length': '11' }), 10)).rejects.toBeInstanceOf(BodyTooLarge);
  });
});
