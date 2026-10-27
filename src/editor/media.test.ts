import { describe, expect, it } from 'vitest';
import { fitSize, mediaKindOf, parsePaintingFilename, titleFromFilename } from './media';

describe('media helpers', () => {
  it('fitSize caps the longest side and never upscales', () => {
    expect(fitSize(4096, 2048)).toEqual({ width: 1600, height: 800 });
    expect(fitSize(1000, 4000)).toEqual({ width: 400, height: 1600 });
    expect(fitSize(4096, 2048, 1024)).toEqual({ width: 1024, height: 512 });
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
  it('parses artist and title from a painting file name', () => {
    expect(parsePaintingFilename('Vincent van Gogh - Starry Night.jpg')).toEqual({ artist: 'Vincent van Gogh', title: 'Starry Night' });
    expect(parsePaintingFilename('A - B - C.png')).toEqual({ artist: 'A', title: 'B - C' });
    expect(parsePaintingFilename('Sunrise.jpg')).toEqual({ artist: '', title: 'Sunrise' });
    expect(parsePaintingFilename('Claude_Monet_-_Water_Lilies.webp')).toEqual({ artist: 'Claude Monet', title: 'Water Lilies' });
    expect(parsePaintingFilename('  Rembrandt   -    Night   Watch .JPG')).toEqual({ artist: 'Rembrandt', title: 'Night Watch' });
    expect(parsePaintingFilename('Jean-Luc - Sea.jpg')).toEqual({ artist: 'Jean-Luc', title: 'Sea' });
    expect(parsePaintingFilename('Jean-Luc Sea.jpg')).toEqual({ artist: '', title: 'Jean-Luc Sea' });
    expect(parsePaintingFilename('Hokusai \u2013 The Wave.jpg')).toEqual({ artist: 'Hokusai', title: 'The Wave' });
    expect(parsePaintingFilename('Dali \u2014 Memory.jpg')).toEqual({ artist: 'Dali', title: 'Memory' });
  });
  it('does not split on a leading or trailing separator', () => {
    expect(parsePaintingFilename('- Untitled.jpg')).toEqual({ artist: '', title: '- Untitled' });
    expect(parsePaintingFilename('Untitled -.jpg')).toEqual({ artist: '', title: 'Untitled -' });
  });
});
