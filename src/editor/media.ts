// Client-side media preparation.
export const MAX_IMAGE_SIDE = 1600;
export const MAX_TEXTURE_SIDE = 1024;
export const MAX_PANORAMA_SIDE = 4096;
export const JPEG_QUALITY = 0.82;
export const PANORAMA_JPEG_QUALITY = 0.85;
export const AUDIO_WARN_BYTES = 15 * 1024 * 1024;

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav)$/i;

/** Filename without its extension, used as the default painting title. */
export const titleFromFilename = (name: string) => name.replace(/\.[^./\\]+$/, '');

/**
 * Title and artist from a painting's file name: extension dropped, `_` read as a space, whitespace
 * collapsed, then split on the first " - " (also en/em dash with spaces around it): left = artist,
 * right = title. Without such a separator the whole name is the title. A hyphen without spaces
 * ("Jean-Luc") never splits.
 */
export function parsePaintingFilename(name: string): { title: string; artist: string } {
  const base = titleFromFilename(name).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.*?) [-\u2013\u2014] (.*)$/.exec(base);
  if (m && m[1].trim() && m[2].trim()) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base, artist: '' };
}

export function mediaKindOf(file: File): 'image' | 'audio' | null {
  if (IMAGE_EXT.test(file.name)) return 'image';
  if (AUDIO_EXT.test(file.name)) return 'audio';
  return null;
}

/** Size to fit within `max` on the longest side, never upscaling. */
export function fitSize(w: number, h: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Decode (EXIF orientation applied), downscale, and re-encode as JPEG. */
export async function prepareImage(file: File, maxSide = MAX_IMAGE_SIDE, quality = JPEG_QUALITY): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitSize(bmp.width, bmp.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.fillStyle = '#fff'; // JPEG has no alpha
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode image');
    return { blob, width, height };
  } finally {
    bmp.close();
  }
}

/** True when width:height is close to the 2:1 an equirectangular panorama has (10 % tolerance). */
export const isRoughlyEquirect = (w: number, h: number): boolean => h > 0 && Math.abs(w / h - 2) <= 0.2;
