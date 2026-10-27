// `?debug` overlay: draw calls, triangles, GPU textures, resident paintings, decoded audio.
import type * as THREE from 'three';

export const debugEnabled = (): boolean => new URLSearchParams(window.location.search).has('debug');

export interface DebugSources {
  renderer: THREE.WebGLRenderer;
  residentPaintings(): number;
  totalPaintings: number;
  decodedAudio(): number;
  totalZones: number;
}

export function createDebugOverlay(src: DebugSources): () => void {
  const el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;top:8px;left:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.65);color:#9f9;font:12px/1.4 monospace;z-index:20;pointer-events:none;border-radius:4px';
  document.body.appendChild(el);
  let last = 0;
  let frames = 0;
  let fps = 0;
  let fpsT = performance.now();
  return () => {
    frames++;
    const now = performance.now();
    if (now - fpsT >= 1000) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
    }
    if (now - last < 250) return;
    last = now;
    const i = src.renderer.info;
    el.textContent =
      `draw calls  ${i.render.calls}\n` +
      `triangles   ${i.render.triangles}\n` +
      `textures    ${i.memory.textures} (GPU)\n` +
      `geometries  ${i.memory.geometries}\n` +
      `paintings   ${src.residentPaintings()} / ${src.totalPaintings} resident\n` +
      `audio       ${src.decodedAudio()} / ${src.totalZones} decoded\n` +
      `fps         ${fps.toFixed(0)}`;
  };
}
