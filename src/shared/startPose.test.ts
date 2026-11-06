import { describe, expect, it } from 'vitest';
import { parseAt, withStartPose } from './startPose';

describe('parseAt', () => {
  it('reads x,y and x,y,yaw', () => {
    expect(parseAt('?at=1,2')).toEqual({ x: 1, y: 2 });
    expect(parseAt('?at=1,2,90')).toEqual({ x: 1, y: 2, yawDeg: 90 });
    expect(parseAt('?at=-1.5,-2.25,-45.5')).toEqual({ x: -1.5, y: -2.25, yawDeg: -45.5 });
    expect(parseAt('?source=folder&at=3,4&shadows=0')).toEqual({ x: 3, y: 4 });
  });
  it('is null when absent', () => {
    expect(parseAt('')).toBeNull();
    expect(parseAt('?source=folder')).toBeNull();
  });
  it.each(['1', '1,2,3,4', 'a,2', '1,,2', ',2', '1,', 'NaN,1', 'Infinity,1', '1e999,1', '1,2,-Infinity', ''])('rejects at=%s', (v) => {
    expect(parseAt(`?at=${v}`)).toBeNull();
  });
});

describe('withStartPose', () => {
  it('adds the query to a plain url', () => {
    expect(withStartPose('./index.html', { x: 1, y: 2, yawDeg: 90 })).toBe('./index.html?at=1,2,90');
  });
  it('appends to an existing query', () => {
    expect(withStartPose('./index.html?source=folder', { x: 1, y: 2, yawDeg: 0 })).toBe('./index.html?source=folder&at=1,2,0');
  });
  it('rounds x,y to 2 decimals and yaw to 1', () => {
    expect(withStartPose('./index.html', { x: 1.23456, y: -2.005, yawDeg: 12.3456 })).toBe('./index.html?at=1.23,-2,12.3');
  });
  it('does not print -0', () => {
    expect(withStartPose('./index.html', { x: -0.001, y: 0, yawDeg: -0.01 })).toBe('./index.html?at=0,0,0');
  });
  it('round-trips through parseAt', () => {
    const url = withStartPose('./index.html?source=folder', { x: -4.5, y: 7.25, yawDeg: 180 });
    expect(parseAt(url.slice(url.indexOf('?')))).toEqual({ x: -4.5, y: 7.25, yawDeg: 180 });
  });
});
