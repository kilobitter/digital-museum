import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  LIB_DEFAULT_HEIGHT, LIB_HEIGHT_KEY, LIB_MIN_HEIGHT, LIB_STEP, clampLibHeight, maxLibHeight, parseLibHeight, toggleLibHeight,
} from './libraryLayout';

/** Window height taken by the top bar and the optional banner (everything above the canvas). */
const reservedHeight = () => {
  const h = (sel: string) => document.querySelector<HTMLElement>(sel)?.offsetHeight ?? 0;
  return (h('.topbar') || 44) + h('.banner');
};

/** Library panel height: remembered in localStorage, clamped to the current window. */
export function useLibraryHeight() {
  const [pref, setPref] = useState<number>(() => {
    try {
      return parseLibHeight(localStorage.getItem(LIB_HEIGHT_KEY)) ?? LIB_DEFAULT_HEIGHT;
    } catch {
      return LIB_DEFAULT_HEIGHT;
    }
  });
  const [windowH, setWindowH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setWindowH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const reserved = reservedHeight();
  const height = clampLibHeight(pref, windowH, reserved);
  const max = maxLibHeight(windowH, reserved);
  const set = useCallback((h: number) => {
    const v = clampLibHeight(h, window.innerHeight, reservedHeight());
    setPref(v);
    try {
      localStorage.setItem(LIB_HEIGHT_KEY, String(v));
    } catch {
      /* storage unavailable: the height just is not remembered */
    }
  }, []);
  const toggle = useCallback(() => set(toggleLibHeight(clampLibHeight(pref, window.innerHeight, reservedHeight()), window.innerHeight, reservedHeight())), [pref, set]);
  return { height, max, set, toggle };
}

interface Props {
  height: number;
  max: number;
  onChange(h: number): void;
  onToggle(): void;
}

/** Horizontal splitter on the top edge of the library: drag, double-click or arrow keys. */
export function LibraryResizer({ height, max, onChange, onToggle }: Props) {
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [active, setActive] = useState(false);
  const end = () => {
    drag.current = null;
    setActive(false);
    document.body.classList.remove('lib-resizing');
  };
  useEffect(() => () => document.body.classList.remove('lib-resizing'), []);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection, no focus-steal drag
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, h: height };
    setActive(true);
    document.body.classList.add('lib-resizing');
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) onChange(d.h + (d.y - e.clientY));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowUp' ? height + LIB_STEP
      : e.key === 'ArrowDown' ? height - LIB_STEP
      : e.key === 'Home' ? LIB_MIN_HEIGHT
      : e.key === 'End' ? max
      : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // arrow keys must not nudge canvas selections
    onChange(next);
  };
  return (
    <div
      className={'lib-resizer' + (active ? ' active' : '')}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize media library"
      aria-valuenow={height}
      aria-valuemin={LIB_MIN_HEIGHT}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize; double-click to toggle a large library"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onToggle}
      onKeyDown={key}
    />
  );
}
