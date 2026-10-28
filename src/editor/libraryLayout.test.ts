import { describe, expect, it } from 'vitest';
import {
  LIB_DEFAULT_HEIGHT, LIB_MIN_HEIGHT, clampLibHeight, gridColumns, gridWindow, largeLibHeight, maxLibHeight, parseLibHeight, toggleLibHeight,
  shouldUseGrid,
} from './libraryLayout';

describe('library height', () => {
  it('limits to 75% of the window and keeps the canvas at least 150px', () => {
    expect(maxLibHeight(1000, 44)).toBe(750);
    expect(maxLibHeight(600, 44)).toBe(406); // 600-44-150 < 450
    expect(maxLibHeight(300, 44)).toBe(LIB_MIN_HEIGHT);
  });
  it('clamps and tolerates junk', () => {
    expect(clampLibHeight(10, 1000, 44)).toBe(LIB_MIN_HEIGHT);
    expect(clampLibHeight(5000, 1000, 44)).toBe(750);
    expect(clampLibHeight(300.4, 1000, 44)).toBe(300);
    expect(clampLibHeight(NaN, 1000, 44)).toBe(LIB_DEFAULT_HEIGHT);
  });
  it('toggles between default and ~60% of the window', () => {
    expect(largeLibHeight(1000, 44)).toBe(600);
    expect(toggleLibHeight(LIB_DEFAULT_HEIGHT, 1000, 44)).toBe(600);
    expect(toggleLibHeight(600, 1000, 44)).toBe(LIB_DEFAULT_HEIGHT);
    expect(toggleLibHeight(333, 1000, 44)).toBe(LIB_DEFAULT_HEIGHT);
  });
  it('parses persisted values', () => {
    expect(parseLibHeight('320')).toBe(320);
    expect(parseLibHeight('320.4')).toBe(320);
    for (const bad of [null, undefined, '', 'abc', 'NaN', '100', '-5', '99999', 320, {}]) expect(parseLibHeight(bad)).toBeNull();
  });
});

describe('grid', () => {
  it('computes columns, at least one', () => {
    expect(gridColumns(1200, 158)).toBe(7);
    expect(gridColumns(0, 158)).toBe(1);
    expect(gridColumns(150, 158)).toBe(1);
  });
  it('windows by rows with overscan', () => {
    // 100 items, 5 cols = 20 rows of 100px; viewport rows 5..7
    expect(gridWindow(500, 200, 100, 5, 100, 1)).toEqual([20, 40]);
    expect(gridWindow(0, 200, 100, 5, 100, 0)).toEqual([0, 10]);
  });
  it('clamps at the ends and handles empties', () => {
    expect(gridWindow(99999, 200, 100, 5, 100, 2)).toEqual([100, 100]);
    expect(gridWindow(1900, 200, 100, 5, 98, 1)).toEqual([90, 98]);
    expect(gridWindow(0, 200, 100, 5, 0)).toEqual([0, 0]);
    expect(gridWindow(0, 200, 100, 0, 3, 0)).toEqual([0, 2]);
  });
  it('uses the grid only when more than one row fits', () => {
    expect(shouldUseGrid(110, 136)).toBe(false);
    expect(shouldUseGrid(300, 136)).toBe(true);
  });
});
