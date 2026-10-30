import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SealedError, deriveKey, openSealed, parseManifest } from '../src/viewer/sealed';

const script = join(__dirname, 'seal.mjs');
const PW = 'correct horse battery staple';
const base = mkdtempSync(join(tmpdir(), 'museum-seal-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
let src = '';
let out = '';
const jpg1 = Buffer.from([0xff, 0xd8, 1, 2, 3, 4, 5, 6, 7, 8]);
const jpg2 = Buffer.from([0xff, 0xd8, 9, 9, 9, 9, 9]);

function museumJson(files: string[]): string {
  return JSON.stringify({ version: 4, name: 'T', media: files.map((file, i) => ({ id: `m${i}`, kind: 'image', file, name: file })) });
}
function setup(files: string[] = ['media/a.jpg', 'media/b.jpg']): void {
  const d = join(base, `case${n++}`);
  src = join(d, 'museum');
  out = join(d, 'sealed');
  mkdirSync(join(src, 'media'), { recursive: true });
  writeFileSync(join(src, 'museum.json'), museumJson(files));
  writeFileSync(join(src, 'media', 'a.jpg'), jpg1);
  writeFileSync(join(src, 'media', 'b.jpg'), jpg2);
}
function run(extra: string[] = [], password: string | null = PW) {
  const env = { ...process.env };
  delete env.MUSEUM_PASSWORD;
  if (password !== null) env.MUSEUM_PASSWORD = password;
  return spawnSync('node', [script, '--src', src, '--out', out, ...extra], { encoding: 'utf8', env, input: '' });
}
function snapshot(): Record<string, string> {
  const r: Record<string, string> = {};
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}${e.name}/`);
      else r[rel + e.name] = readFileSync(join(dir, e.name)).toString('base64');
    }
  };
  walk(out, '');
  return r;
}
const manifest = () => parseManifest(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
const enc = (p: string) => new Uint8Array(readFileSync(join(out, `${p}.enc`)));

beforeEach(() => setup());

describe('seal.mjs', () => {
  it('round trip: the viewer opens what the script sealed, byte for byte', async () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Sealed 3');
    const key = await deriveKey(PW, manifest());
    expect(Buffer.from(await openSealed(key, enc('museum.json'), 'museum.json')).equals(readFileSync(join(src, 'museum.json')))).toBe(true);
    expect(Buffer.from(await openSealed(key, enc('media/a.jpg'), 'media/a.jpg')).equals(jpg1)).toBe(true);
    expect(Buffer.from(await openSealed(key, enc('media/b.jpg'), 'media/b.jpg')).equals(jpg2)).toBe(true);
  });

  it('fails with the typed error for a wrong password', async () => {
    run();
    const key = await deriveKey('some other long passphrase', manifest());
    await expect(openSealed(key, enc('museum.json'), 'museum.json')).rejects.toMatchObject({ name: 'SealedError', kind: 'wrong-key' });
    await expect(openSealed(key, enc('museum.json'), 'museum.json')).rejects.toBeInstanceOf(SealedError);
  });

  it('does not open a media file under another file name (AAD)', async () => {
    run();
    const key = await deriveKey(PW, manifest());
    await expect(openSealed(key, enc('media/a.jpg'), 'media/b.jpg')).rejects.toMatchObject({ kind: 'wrong-key' });
    await expect(openSealed(key, enc('media/b.jpg'), 'media/a.jpg')).rejects.toMatchObject({ kind: 'wrong-key' });
  });

  it('a second run leaves every file byte-identical', () => {
    run();
    const first = snapshot();
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('unchanged 3');
    expect(snapshot()).toEqual(first);
  });

  it('re-seals only the file that changed', () => {
    run();
    const first = snapshot();
    writeFileSync(join(src, 'media', 'a.jpg'), Buffer.from([0xff, 0xd8, 42]));
    expect(run().status).toBe(0);
    const second = snapshot();
    expect(second['media/a.jpg.enc']).not.toBe(first['media/a.jpg.enc']);
    expect(second['media/b.jpg.enc']).toBe(first['media/b.jpg.enc']);
    expect(second['museum.json.enc']).toBe(first['museum.json.enc']);
  });

  it('deletes the .enc of media that is no longer listed, and leaves other files alone', () => {
    run();
    writeFileSync(join(out, 'README.txt'), 'keep me');
    writeFileSync(join(src, 'museum.json'), museumJson(['media/a.jpg']));
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('removed 1');
    expect(existsSync(join(out, 'media', 'b.jpg.enc'))).toBe(false);
    expect(existsSync(join(out, 'media', 'a.jpg.enc'))).toBe(true);
    expect(existsSync(join(out, 'README.txt'))).toBe(true);
  });

  it('warns about a listed file that is missing and carries on', () => {
    setup(['media/a.jpg', 'media/gone.jpg']);
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('missing 1');
    expect(existsSync(join(out, 'media', 'gone.jpg.enc'))).toBe(false);
  });

  it('does not seal unlisted media', () => {
    setup(['media/a.jpg']);
    expect(run().status).toBe(0);
    expect(existsSync(join(out, 'media', 'b.jpg.enc'))).toBe(false);
  });

  it('a wrong password on re-seal exits 1 and changes nothing', () => {
    run();
    const first = snapshot();
    writeFileSync(join(src, 'media', 'a.jpg'), Buffer.from([0xff, 0xd8, 77]));
    const r = run([], 'a different passphrase');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Wrong password');
    expect(snapshot()).toEqual(first);
  });

  it('--rekey changes the salt and the new password opens everything', async () => {
    run();
    const oldSalt = manifest().kdf.salt;
    const r = run(['--rekey'], 'brand new passphrase!');
    expect(r.status, r.stderr).toBe(0);
    const m = manifest();
    expect(m.kdf.salt).not.toBe(oldSalt);
    const key = await deriveKey('brand new passphrase!', m);
    for (const p of ['museum.json', 'media/a.jpg', 'media/b.jpg']) await openSealed(key, enc(p), p);
    const oldKey = await deriveKey(PW, m);
    await expect(openSealed(oldKey, enc('museum.json'), 'museum.json')).rejects.toMatchObject({ kind: 'wrong-key' });
  });

  it('exits 2 without a password and without a terminal, and writes nothing', () => {
    const r = run([], null);
    expect(r.status).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it('rejects a new password shorter than 12 characters', () => {
    const r = run([], 'short');
    expect(r.status).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it('skips a file path that would escape the output folder', () => {
    setup(['media/a.jpg', 'media/../x.jpg', 'media/sub/c.jpg']);
    writeFileSync(join(src, '..', 'x.jpg'), jpg1);
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('skipped 2');
    expect(existsSync(join(out, '..', 'x.jpg.enc'))).toBe(false);
    expect(existsSync(join(out, 'media', 'x.jpg.enc'))).toBe(false);
    expect(existsSync(join(out, 'media', 'a.jpg.enc'))).toBe(true);
  });

  it('exits 1 when museum.json is not JSON', () => {
    writeFileSync(join(src, 'museum.json'), '{nope');
    expect(run().status).toBe(1);
    expect(existsSync(out)).toBe(false);
  });
});
