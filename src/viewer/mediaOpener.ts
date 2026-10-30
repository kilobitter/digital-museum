// Hook between "a media URL" and "something an <img> or fetch can read". By default the URL is used as is.
// In sealed mode (see main.ts) the opener fetches the encrypted file, decrypts it and hands out a blob: URL.
// textures.ts and audio.ts call openMedia() so scene.ts, streamer.ts and sky.ts need no changes.
export interface OpenedMedia {
  url: string;
  /** Call as soon as the bytes have been read (also on error). Safe to call more than once. */
  release(): void;
}
export type MediaOpener = (url: string) => Promise<OpenedMedia>;

const plain: MediaOpener = async (url) => ({ url, release() {} });
let opener: MediaOpener = plain;

export function setMediaOpener(fn: MediaOpener | null): void {
  opener = fn ?? plain;
}

export function openMedia(url: string): Promise<OpenedMedia> {
  return opener(url);
}
