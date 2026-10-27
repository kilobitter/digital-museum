import { describe, expect, it } from 'vitest';
import { fitSize, mediaKindOf, titleFromFilename } from './media';

describe('media helpers', () => {
  it('fitSize caps the longest side and never upscales', () => {
    expect(fitSize(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitSize(1000, 4000)).toEqual({ width: 512, height: 2048 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('titles come from the filename without extension', () => {
    expect(titleFromFilename('My Photo.final.PNG')).toBe('My Photo.final');
    expect(titleFromFilename('plain')).toBe('plain');
  });
  it('classifies by extension', () => {
    const f = (name: string) => ({ name }) as File;
    expect(mediaKindOf(f('a.JPG'))).toBe('image');
    expect(mediaKindOf(f('a.m4a'))).toBe('audio');
    expect(mediaKindOf(f('a.gif'))).toBeNull();
  });
});
