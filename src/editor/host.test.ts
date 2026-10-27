import { describe, expect, it } from 'vitest';
import { isLoopbackHost, localEditorUrl } from './host';

describe('host helpers', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', 'LOCALHOST'])('%s is loopback', (h) => expect(isLoopbackHost(h)).toBe(true));
  it.each(['192.168.1.20', 'museum.local', 'example.github.io', '127.0.0.2'])('%s is not', (h) => expect(isLoopbackHost(h)).toBe(false));
  it('builds the local editor link with the current port', () => {
    expect(localEditorUrl('5317')).toBe('https://localhost:5317/editor.html');
    expect(localEditorUrl('')).toBe('https://localhost/editor.html');
  });
});
