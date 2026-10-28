// Helpers over every Finish in a museum (walls, floor, ceiling, areas).
import type { Finish, Museum } from './museum';

/** Every finish in the museum that can reference a texture, in no particular order. */
export function allFinishes(m: Museum): Finish[] {
  const out: Finish[] = [m.settings.wallFinish, m.settings.floorFinish, m.settings.ceilingFinish];
  for (const w of m.walls) if (w.finish) out.push(w.finish);
  for (const a of m.areas) {
    if (a.floor) out.push(a.floor);
    if (a.ceiling) out.push(a.ceiling);
  }
  return out;
}

/** How many finishes (settings, walls, areas) and the sky reference this media item. */
export function textureUsage(m: Museum, mediaId: string): number {
  const sky = m.settings.sky.kind === 'panorama' && m.settings.sky.textureId === mediaId ? 1 : 0;
  return allFinishes(m).filter((f) => f.textureId === mediaId).length + sky;
}
