// One source of truth for which media files a museum may contain. Used by the validator, the dev API
// and the folder store, so all three accept exactly the same names.
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'mp3', 'm4a', 'aac', 'ogg', 'wav'] as const;
/** A media path as stored in museum.json: `media/<name>.<ext>`. */
export const MEDIA_FILE_RE = /^media\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|mp3|m4a|aac|ogg|wav)$/;
/** The bare file name inside the media folder (no slash, no dots except the extension). */
export const MEDIA_NAME_RE = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|mp3|m4a|aac|ogg|wav)$/;

/** Lower-cased extension if it is on the allowlist, else null. */
export function allowedExtension(name: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}
