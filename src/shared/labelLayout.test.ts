import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hasLabel, labelLayout, plaqueDirection, plaqueSpan, LABEL_MIN_PX, LABEL_PX_PER_M, LABEL_W, type MeasureText } from './labelLayout';
import type { MediaItem } from './museum';

const media = (m: Partial<MediaItem>): MediaItem => ({ id: 'm', kind: 'image', file: 'media/m.jpg', name: 'm', width: 100, height: 100, ...m });
/** 10 px per character, whatever the font. */
const ten: MeasureText = (t) => t.length * 10;

describe('hasLabel', () => {
  it('is true for any of title, artist, description', () => {
    expect(hasLabel(media({}))).toBe(false);
    expect(hasLabel(media({ title: '' }))).toBe(false);
    expect(hasLabel(media({ title: 'A' }))).toBe(true);
    expect(hasLabel(media({ artist: 'A' }))).toBe(true);
    expect(hasLabel(media({ description: 'A' }))).toBe(true);
  });
});

describe('labelLayout', () => {
  it('sizes the card from the widest line plus padding, and the lines from their heights', () => {
    const l = labelLayout(media({ title: 'Hello', artist: 'Someone Rather Long Indeed' }), ten);
    expect(l.pxW).toBe(26 * 10 + 48);
    expect(l.pxH).toBe(48 + 48 + 40);
    expect(l.w).toBeCloseTo(l.pxW / LABEL_PX_PER_M);
    expect(l.h).toBeCloseTo(l.pxH / LABEL_PX_PER_M);
    expect(l.lines.map((x) => x.text)).toEqual(['Hello', 'Someone Rather Long Indeed']);
  });
  it('has a minimum width', () => {
    expect(labelLayout(media({ title: 'A' }), ten).pxW).toBe(LABEL_MIN_PX);
  });
  it('wraps at the maximum width and never gets wider', () => {
    const words = Array.from({ length: 12 }, () => 'abcdefgh').join(' '); // 12 words of 80 px
    const l = labelLayout(media({ description: words }), ten);
    const max = Math.round(LABEL_W * LABEL_PX_PER_M);
    expect(l.pxW).toBeLessThanOrEqual(max);
    expect(l.lines.length).toBeGreaterThan(1);
    for (const line of l.lines) expect(ten(line.text, '')).toBeLessThanOrEqual(max - 48);
  });
  it('limits lines: 2 for the title, 1 for the artist, 4 for the description', () => {
    const long = Array.from({ length: 60 }, () => 'abcdefgh').join(' ');
    const l = labelLayout(media({ title: long, artist: long, description: long }), ten);
    const count = (font: RegExp) => l.lines.filter((x) => font.test(x.font)).length;
    expect(count(/^600 40px/)).toBe(2);
    expect(count(/^32px/)).toBe(1);
    expect(count(/^26px/)).toBe(4);
  });
  it('keeps paragraph breaks', () => {
    expect(labelLayout(media({ description: 'a\nb' }), ten).lines.map((x) => x.text)).toEqual(['a', 'b']);
  });
});

describe('plaque placement along the wall', () => {
  // The streamer puts the plaque at local +x of a group rotated by rotationY = atan2(normal.x, normal.y).
  const streamerDir = (n: { x: number; y: number }) => {
    const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(n.x, n.y));
    return { x: v.x, y: v.z }; // plan (x, y) = world (x, z)
  };
  const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, { x: -Math.SQRT1_2, y: Math.SQRT1_2 }];
  for (const d of dirs) {
    for (const side of [1, -1] as const) {
      it(`matches the viewer for wall direction (${d.x.toFixed(2)}, ${d.y.toFixed(2)}) side ${side}`, () => {
        const normal = { x: -d.y * side + 0, y: d.x * side + 0 };
        const local = streamerDir(normal);
        const along = plaqueDirection(normal, d);
        expect(local.x).toBeCloseTo(along * d.x, 9);
        expect(local.y).toBeCloseTo(along * d.y, 9);
      });
    }
  }
  it('plaqueSpan sits 0.1 m beyond the work edge, towards the direction', () => {
    const right = plaqueSpan(2, 1, 0.4, 1);
    expect(right.from).toBeCloseTo(2.6);
    expect(right.to).toBeCloseTo(3);
    const left = plaqueSpan(2, 1, 0.4, -1);
    expect(left.from).toBeCloseTo(1);
    expect(left.to).toBeCloseTo(1.4);
  });
});
