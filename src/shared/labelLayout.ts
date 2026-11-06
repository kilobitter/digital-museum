// How a work's label plaque is laid out: the text lines and the card size. Pure (no three.js, no DOM): the viewer draws
// it on a canvas, the editor uses the same numbers to know how far a plaque reaches along the wall.
import type { MediaItem } from './museum';

export type MeasureText = (text: string, font: string) => number;
export interface LabelLine { text: string; font: string; color: string; lh: number }
export interface LabelLayout { lines: LabelLine[]; pxW: number; pxH: number; /** metres */ w: number; h: number }

export const LABEL_W = 0.5; // max plaque width, metres
export const LABEL_PX_PER_M = 1024; // label canvas resolution
export const LABEL_MIN_PX = 200;
export const LABEL_PAD = 24;

export const TITLE_FONT = '600 40px system-ui, sans-serif';
export const ARTIST_FONT = '32px system-ui, sans-serif';
export const DESCRIPTION_FONT = '26px system-ui, sans-serif';

/** Title, artist or description present: the work gets a plaque. */
export function hasLabel(media: MediaItem): boolean {
  return !!(media.title || media.artist || media.description);
}

function wrap(measure: MeasureText, font: string, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (measure(test, font) > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function labelLayout(media: MediaItem, measure: MeasureText): LabelLayout {
  const maxW = Math.round(LABEL_W * LABEL_PX_PER_M);
  const lines: LabelLine[] = [];
  const add = (text: string, font: string, color: string, lh: number, maxLines: number) => {
    if (!text) return;
    for (const l of wrap(measure, font, text, maxW - 2 * LABEL_PAD).slice(0, maxLines)) lines.push({ text: l, font, color, lh });
  };
  add(media.title ?? '', TITLE_FONT, '#111', 48, 2);
  add(media.artist ?? '', ARTIST_FONT, '#444', 40, 1);
  add(media.description ?? '', DESCRIPTION_FONT, '#666', 32, 4);
  let textW = 0;
  for (const l of lines) textW = Math.max(textW, measure(l.text, l.font));
  const pxW = Math.min(maxW, Math.max(LABEL_MIN_PX, Math.ceil(textW) + 2 * LABEL_PAD));
  const pxH = 2 * LABEL_PAD + lines.reduce((s, l) => s + l.lh, 0);
  return { lines, pxW, pxH, w: pxW / LABEL_PX_PER_M, h: pxH / LABEL_PX_PER_M };
}

/**
 * Which way along the wall (+1 towards b, -1 towards a) a plaque sits from its work. The viewer puts the plaque at
 * local +x, which is plan (normal.y, -normal.x) (rotationY = atan2(normal.x, normal.y)).
 */
export function plaqueDirection(normal: { x: number; y: number }, wallDir: { x: number; y: number }): 1 | -1 {
  return normal.y * wallDir.x - normal.x * wallDir.y >= 0 ? 1 : -1;
}

/** Where the plaque of a work of `workWidth` reaches along its wall (metres from the wall's `a`), `t` being the work's centre. */
export function plaqueSpan(t: number, workWidth: number, plaqueWidth: number, dir: 1 | -1): { from: number; to: number } {
  const centre = t + dir * (workWidth / 2 + 0.1 + plaqueWidth / 2);
  return { from: centre - plaqueWidth / 2, to: centre + plaqueWidth / 2 };
}
