import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseMuseum } from '../src/shared/validate';

const script = join(__dirname, 'make-sample.mjs');
const publicMuseum = join(__dirname, '..', 'public', 'museum');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('make-sample.mjs', () => {
  it('writes a valid v3 museum with textures, a custom wall finish and floor/ceiling areas into the given folder', () => {
    const out = mkdtempSync(join(tmpdir(), 'museum-sample-'));
    dirs.push(out);
    execFileSync('node', [script, out], { stdio: 'pipe' });
    const json = JSON.parse(readFileSync(join(out, 'museum.json'), 'utf8'));
    const r = parseMuseum(json);
    expect(r.ok ? [] : r.errors).toEqual([]);
    if (!r.ok) return;
    expect(json.version).toBe(3);
    expect(r.museum.areas.some((a) => a.floor?.textureId)).toBe(true);
    expect(r.museum.areas.some((a) => a.ceiling)).toBe(true);
    expect(r.museum.media.some((m) => m.kind === 'texture')).toBe(true);
    expect(r.museum.walls.some((w) => w.finish?.textureId)).toBe(true);
    expect(r.museum.media.find((m) => m.id === 'img1')?.title).toBe('Sunrise');
    for (const m of r.museum.media) expect(existsSync(join(out, m.file))).toBe(true);
    expect(readdirSync(join(out, 'media')).length).toBe(r.museum.media.length);
  });

  it('requires an output folder', () => {
    const r = spawnSync('node', [script], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
  });

  // Only meaningful (and only safe) when a museum exists there; the script exits before touching anything.
  it.skipIf(!existsSync(join(publicMuseum, 'museum.json')))('refuses to overwrite public/museum without --force', () => {
    const before = readFileSync(join(publicMuseum, 'museum.json'), 'utf8');
    const r = spawnSync('node', [script, publicMuseum], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--force');
    expect(readFileSync(join(publicMuseum, 'museum.json'), 'utf8')).toBe(before);
  });
});
