// Undo/redo over immutable snapshots.
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Key of the last coalescable edit (e.g. typing in one inspector field). */
  lastKey: string | null;
}

export const MAX_HISTORY = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null };
}

/** New undoable state. Consecutive pushes with the same non-null key merge into one undo step. */
export function push<T>(h: History<T>, next: T, key: string | null = null): History<T> {
  if (next === h.present) return h;
  if (key !== null && key === h.lastKey) return { ...h, present: next, future: [] };
  const past = [...h.past, h.present];
  if (past.length > MAX_HISTORY) past.shift();
  return { past, present: next, future: [], lastKey: key };
}

/** Change `present` without recording history (live preview during a drag). */
export function replace<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next };
}

/** End a drag: record `base` (the state before the drag began) as the undo point if anything changed. */
export function commitFrom<T>(h: History<T>, base: T): History<T> {
  if (h.present === base) return h;
  const past = [...h.past, base];
  if (past.length > MAX_HISTORY) past.shift();
  return { past, present: h.present, future: [], lastKey: null };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const past = h.past.slice(0, -1);
  return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;

/** Forget undo/redo (used after an irreversible action such as deleting a media file). */
export function clearHistory<T>(h: History<T>): History<T> {
  return createHistory(h.present);
}
