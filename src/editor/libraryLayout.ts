// Library panel sizing and grid windowing (pure, unit-tested).

export const LIB_MIN_HEIGHT = 176; // tab bar + header + one row of cards (the original fixed height)
export const LIB_DEFAULT_HEIGHT = 176;
export const LIB_STEP = 24;
export const LIB_MAX_FRACTION = 0.75;
export const LIB_LARGE_FRACTION = 0.6;
export const CANVAS_MIN_HEIGHT = 150;
export const LIB_HEIGHT_KEY = 'museum-editor-library-height';

/** Largest allowed library height. `reserved` is the window height used by everything else except the canvas (top bar, banner). */
export function maxLibHeight(windowH: number, reserved: number): number {
  const byFraction = windowH * LIB_MAX_FRACTION;
  const byCanvas = windowH - reserved - CANVAS_MIN_HEIGHT;
  return Math.max(LIB_MIN_HEIGHT, Math.floor(Math.min(byFraction, byCanvas)));
}

export function clampLibHeight(h: number, windowH: number, reserved: number): number {
  const max = maxLibHeight(windowH, reserved);
  const v = Number.isFinite(h) ? h : LIB_DEFAULT_HEIGHT;
  return Math.round(Math.min(max, Math.max(LIB_MIN_HEIGHT, v)));
}

/** Height for the double-click "large" state (about 60% of the window, still clamped). */
export function largeLibHeight(windowH: number, reserved: number): number {
  return clampLibHeight(windowH * LIB_LARGE_FRACTION, windowH, reserved);
}

/** Double-click: default -> large; anything else (including large) -> default. */
export function toggleLibHeight(current: number, windowH: number, reserved: number): number {
  const large = largeLibHeight(windowH, reserved);
  return Math.abs(current - LIB_DEFAULT_HEIGHT) <= 1 && large > LIB_DEFAULT_HEIGHT ? large : LIB_DEFAULT_HEIGHT;
}

/** Persisted value -> a finite number >= the minimum, or null when missing/invalid (the caller then uses the default). */
export function parseLibHeight(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < LIB_MIN_HEIGHT || n > 10000) return null;
  return Math.round(n);
}

/** Card columns that fit a width (at least 1). */
export function gridColumns(width: number, itemWidth: number): number {
  return Math.max(1, Math.floor((width + 8) / itemWidth));
}

/** Item index window [start, end) of a row-major grid visible in a vertical scroller; always row-aligned, `overscan` extra rows each side. */
export function gridWindow(
  scrollTop: number, viewHeight: number, rowHeight: number, columns: number, count: number, overscan = 2,
): [number, number] {
  const cols = Math.max(1, Math.floor(columns));
  const rows = Math.ceil(count / cols);
  const firstRow = Math.min(rows, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const lastRow = Math.min(rows, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);
  const start = Math.min(count, firstRow * cols);
  return [start, Math.max(start, Math.min(count, lastRow * cols))];
}

/** The scroller is tall enough for more than one row of cards, so a vertical grid is used. */
export const shouldUseGrid = (viewHeight: number, rowHeight: number): boolean => viewHeight >= rowHeight + 24;
