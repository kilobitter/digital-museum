// Library tab helpers: persisted selection and keyboard navigation (pure, unit-tested).
export type LibraryTab = 'image' | 'texture' | 'audio';

export const TAB_ORDER: readonly LibraryTab[] = ['image', 'texture', 'audio'];
export const TAB_STORAGE_KEY = 'museum-editor-library-tab';

/** Anything that is not a known tab falls back to Paintings. */
export function parseTab(raw: unknown): LibraryTab {
  return TAB_ORDER.find((t) => t === raw) ?? 'image';
}

/** Tab to move to for an arrow/Home/End key, or null if the key is not a navigation key. */
export function tabForKey(current: LibraryTab, key: string): LibraryTab | null {
  const i = TAB_ORDER.indexOf(current);
  const n = TAB_ORDER.length;
  if (key === 'ArrowRight') return TAB_ORDER[(i + 1) % n];
  if (key === 'ArrowLeft') return TAB_ORDER[(i + n - 1) % n];
  if (key === 'Home') return TAB_ORDER[0];
  if (key === 'End') return TAB_ORDER[n - 1];
  return null;
}
