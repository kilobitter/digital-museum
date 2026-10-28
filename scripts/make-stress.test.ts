import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { distanceInside } from '../src/shared/zones';
import { parseMuseum } from '../src/shared/validate';
import type { Museum } from '../src/shared/museum';
import { workPlacement } from '../src/shared/geometry';
import * as THREE from 'three';
import { buildMuseumScene } from '../src/viewer/scene';
import { AUDIO_LIMITS, PAINTING_LIMITS, planByDistance, planStreaming } from '../src/viewer/streaming';

const script = join(__dirname, 'make-stress.mjs');
const out = mkdtempSync(join(tmpdir(), 'museum-stress-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

function load(): Museum {
  execFileSync('node', [script, out], { stdio: 'pipe' });
  const r = parseMuseum(JSON.parse(readFileSync(join(out, 'museum.json'), 'utf8')));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.museum;
}

describe('stress museum + planStreaming', () => {
  const m = load();

  it('is a valid v4 museum of the expected size', () => {
    expect(m.version).toBe(4);
    expect(m.areas.length).toBe(33);
    expect(m.areas.filter((a) => a.openSky).length).toBe(3);
    expect(m.works.length).toBe(500);
    expect(m.zones.length).toBe(90);
    expect(m.media.filter((x) => x.kind === 'image').length).toBe(500);
  });

  it('builds the static scene in a handful of draw calls regardless of the number of works', async () => {
    const built = await buildMuseumScene(m, (f) => f, 1);
    const meshes: THREE.Mesh[] = [];
    built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    // base floor + 1 merged wall mesh (one finish) + 1 merged frames + 1 merged placeholder panels + the sky dome
    // + 3 floor-area finishes + ceiling groups (base + 2 ceiling-area colours; the 3 open courtyards are holes)
    expect(meshes.length).toBe(5 + 3 + 3);
    expect(built.slots.length).toBe(500);
    expect(built.warnings).toEqual([]);
    // images + labels only exist for streamed works: at most 2 meshes per resident work
    expect(meshes.length + 2 * PAINTING_LIMITS.maxResident).toBeLessThan(160);
  });

  it('refuses to write into public/museum', () => {
    const r = spawnSync('node', [script, join(__dirname, '..', 'public', 'museum')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
  });

  it('keeps resident paintings and audio under the caps while walking through the whole grid', () => {
    const wallById = new Map(m.walls.map((w) => [w.id, w]));
    const items = m.works.map((w) => {
      const c = workPlacement(wallById.get(w.wallId)!, w, m.settings.wallThickness).center;
      return { id: w.id, x: c.x, y: c.y };
    });
    const resident = new Set<string>();
    const zResident = new Set<string>();
    let maxP = 0, maxA = 0, sawLoad = false, sawUnload = false;
    // a serpentine walk through the grid in 1 m steps, plus a few jumps (teleports)
    const path: { x: number; y: number }[] = [];
    for (let r = 0; r < 9; r++) for (let x = 0; x <= 136; x += 1) path.push({ x: r % 2 ? 136 - x : x, y: r * 14 + 5 });
    path.push({ x: 0, y: 0 }, { x: 136, y: 120 }, { x: 70, y: 60 });
    for (const head of path) {
      const p = planStreaming(head, items, resident, new Set(), { ...PAINTING_LIMITS, maxConcurrent: 1000 });
      for (const id of p.unload) resident.delete(id);
      for (const id of p.load) resident.add(id);
      if (p.load.length) sawLoad = true;
      if (p.unload.length) sawUnload = true;
      maxP = Math.max(maxP, resident.size);
      for (const id of resident) {
        const it = items.find((i) => i.id === id)!;
        expect(Math.hypot(it.x - head.x, it.y - head.y)).toBeLessThanOrEqual(PAINTING_LIMITS.unloadRadius + 1e-9);
      }
      const ze = m.zones.map((z) => ({ id: z.id, dist: Math.max(0, -distanceInside(z.shape, head)) }));
      const a = planByDistance(ze, zResident, new Set(), { ...AUDIO_LIMITS, maxConcurrent: 1000 });
      for (const id of a.unload) zResident.delete(id);
      for (const id of a.load) zResident.add(id);
      maxA = Math.max(maxA, zResident.size);
    }
    expect(sawLoad && sawUnload).toBe(true);
    expect(maxP).toBeGreaterThan(0);
    expect(maxP).toBeLessThanOrEqual(PAINTING_LIMITS.maxResident);
    expect(maxA).toBeGreaterThan(0);
    expect(maxA).toBeLessThanOrEqual(AUDIO_LIMITS.maxResident);
    expect(zResident.size).toBeLessThanOrEqual(AUDIO_LIMITS.maxResident);
  });
});
