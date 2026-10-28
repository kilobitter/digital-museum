// Texture helpers for the viewer: image loading with downscale, placeholders, label canvases.
import * as THREE from 'three';
import type { MediaItem } from '../shared/museum';

export const MAX_TEXTURE = 1600; // paintings (the editor already downsizes uploads to this)
export const MAX_WALL_TEXTURE = 1024; // wall textures (tiled, so smaller is fine)
export const LABEL_W = 0.5; // max plaque width, metres
const LABEL_PX_PER_M = 1024; // label canvas resolution
const LABEL_MIN_PX = 200;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

/** Load an image as a texture, downscaled so no side exceeds `max`. Mipmaps on. */
export async function loadTexture(url: string, anisotropy: number, max = MAX_TEXTURE, repeat = false): Promise<THREE.Texture> {
  const img = await loadImage(url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('image has no size');
  let source: TexImageSource = img;
  const scale = Math.min(1, max / Math.max(w, h));
  if (scale < 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    source = c;
  }
  const tex = new THREE.Texture(source as HTMLImageElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function placeholderTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#999'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 256); g.moveTo(256, 0); g.lineTo(0, 256); g.stroke();
  g.fillStyle = '#666'; g.font = '24px sans-serif'; g.textAlign = 'center';
  g.fillText('image missing', 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** A label plaque: an opaque card sized to its text, so it reads on any wall colour. Size in metres. */
export function labelTexture(media: MediaItem, anisotropy: number): { texture: THREE.CanvasTexture; w: number; h: number } {
  const MAX_W = Math.round(LABEL_W * LABEL_PX_PER_M);
  const PAD = 24;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.textBaseline = 'alphabetic';
  const out: { text: string; font: string; color: string; lh: number }[] = [];
  const add = (text: string, font: string, color: string, lh: number, maxLines: number) => {
    if (!text) return;
    g.font = font;
    const ls = wrap(g, text, MAX_W - 2 * PAD);
    for (const l of ls.slice(0, maxLines)) out.push({ text: l, font, color, lh });
  };
  add(media.title ?? '', '600 40px system-ui, sans-serif', '#111', 48, 2);
  add(media.artist ?? '', '32px system-ui, sans-serif', '#444', 40, 1);
  add(media.description ?? '', '26px system-ui, sans-serif', '#666', 32, 4);
  let textW = 0;
  for (const l of out) {
    g.font = l.font;
    textW = Math.max(textW, g.measureText(l.text).width);
  }
  const W = Math.min(MAX_W, Math.max(LABEL_MIN_PX, Math.ceil(textW) + 2 * PAD));
  const H = 2 * PAD + out.reduce((s, l) => s + l.lh, 0);
  c.width = W; c.height = H; // resizing resets the context state
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, W, H);
  // thin edge, slightly darker bottom/right so the plaque reads as a raised card
  g.fillStyle = '#d8d2c4';
  g.fillRect(0, 0, W, 2); g.fillRect(0, 0, 2, H);
  g.fillStyle = '#b9b2a2';
  g.fillRect(0, H - 3, W, 3); g.fillRect(W - 3, 0, 3, H);
  let y = PAD;
  for (const l of out) {
    y += l.lh;
    g.font = l.font; g.fillStyle = l.color;
    g.fillText(l.text, PAD, y - l.lh * 0.25, W - 2 * PAD);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return { texture: t, w: W / LABEL_PX_PER_M, h: H / LABEL_PX_PER_M };
}

