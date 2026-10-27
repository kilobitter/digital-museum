// Client-side media preparation.
export const MAX_IMAGE_SIDE = 2048;
export const JPEG_QUALITY = 0.85;
export const AUDIO_WARN_BYTES = 15 * 1024 * 1024;

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav)$/i;

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
export async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitSize(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.fillStyle = '#fff'; // JPEG has no alpha
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Could not encode image');
    return { blob, width, height };
  } finally {
    bmp.close();
  }
}
