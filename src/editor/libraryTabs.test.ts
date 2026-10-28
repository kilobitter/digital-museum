import { describe, expect, it } from 'vitest';
import { parseTab, tabForKey } from './libraryTabs';

describe('libraryTabs', () => {
  it('parses persisted values with a Paintings default', () => {
    expect(parseTab('audio')).toBe('audio');
    expect(parseTab('texture')).toBe('texture');
    expect(parseTab(null)).toBe('image');
    expect(parseTab('bogus')).toBe('image');
  });
  it('navigates with arrows (wrapping), Home and End', () => {
    expect(tabForKey('image', 'ArrowRight')).toBe('texture');
    expect(tabForKey('audio', 'ArrowRight')).toBe('image');
    expect(tabForKey('image', 'ArrowLeft')).toBe('audio');
    expect(tabForKey('texture', 'Home')).toBe('image');
    expect(tabForKey('texture', 'End')).toBe('audio');
    expect(tabForKey('texture', 'a')).toBeNull();
  });
});
