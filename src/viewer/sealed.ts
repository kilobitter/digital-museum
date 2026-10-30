// Sealed museum format v1 (WebCrypto; works in browsers and in Node/vitest). See README, "Publishing with a password".
//   key  = PBKDF2-SHA256(password UTF-8, salt, iterations) -> AES-GCM 256
//   file = "VMS1" || 12-byte IV || AES-GCM ciphertext (incl. 16-byte tag), AAD = UTF-8 of the logical path
// The logical path is `museum.json` or `media/<name>.<ext>`, so renaming or swapping sealed files fails to open.

export const SEALED_FORMAT = 'vr-museum-sealed';
export const SEALED_VERSION = 1;
export const MAGIC = new Uint8Array([0x56, 0x4d, 0x53, 0x31]); // "VMS1"
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const SALT_BYTES = 16;
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 10_000_000;
export const DEFAULT_ITERATIONS = 600_000;

export interface SealedManifest {
  format: typeof SEALED_FORMAT;
  version: typeof SEALED_VERSION;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: 'AES-GCM';
}

/** `malformed`: not a sealed file / manifest we understand. `wrong-key`: GCM open failed (wrong password or damaged). */
export class SealedError extends Error {
  constructor(
    readonly kind: 'malformed' | 'wrong-key',
    message: string,
  ) {
    super(message);
    this.name = 'SealedError';
  }
}

export const WRONG_KEY_MESSAGE = 'wrong password or damaged file';

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const STRICT_B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function parseManifest(json: unknown): SealedManifest {
  const bad = (m: string): never => {
    throw new SealedError('malformed', `Invalid sealed manifest: ${m}`);
  };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return bad('not an object');
  const o = json as Record<string, unknown>;
  if (o.format !== SEALED_FORMAT) bad('unknown format');
  if (o.version !== SEALED_VERSION) bad('unknown version');
  if (o.cipher !== 'AES-GCM') bad('unknown cipher');
  const k = o.kdf;
  if (typeof k !== 'object' || k === null || Array.isArray(k)) return bad('missing kdf');
  const kdf = k as Record<string, unknown>;
  if (kdf.name !== 'PBKDF2') bad('unknown kdf');
  if (kdf.hash !== 'SHA-256') bad('unknown hash');
  const it = kdf.iterations;
  if (typeof it !== 'number' || !Number.isInteger(it) || it < MIN_ITERATIONS || it > MAX_ITERATIONS) bad('iterations out of range');
  if (typeof kdf.salt !== 'string' || !STRICT_B64.test(kdf.salt)) return bad('salt is not base64');
  let salt: Uint8Array;
  try {
    salt = fromBase64(kdf.salt);
  } catch {
    return bad('salt is not base64');
  }
  if (salt.length !== SALT_BYTES) bad('salt must be 16 bytes');
  return {
    format: SEALED_FORMAT,
    version: SEALED_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: it as number, salt: kdf.salt as string },
    cipher: 'AES-GCM',
  };
}

export function newManifest(iterations = DEFAULT_ITERATIONS, salt: Uint8Array = crypto.getRandomValues(new Uint8Array(SALT_BYTES))): SealedManifest {
  return parseManifest({
    format: SEALED_FORMAT,
    version: SEALED_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: 'AES-GCM',
  });
}

/** Non-extractable AES-GCM key (so it can be kept in IndexedDB without exposing the password). */
export async function deriveKey(password: string, manifest: SealedManifest): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: manifest.kdf.iterations, salt: fromBase64(manifest.kdf.salt) as BufferSource },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const aad = (path: string): BufferSource => new TextEncoder().encode(path) as BufferSource;

/** Decrypt a sealed file for the logical `path`. Never returns partial plaintext. */
export async function openSealed(key: CryptoKey, sealed: ArrayBuffer | Uint8Array, path: string): Promise<ArrayBuffer> {
  const b = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed);
  if (b.length < MAGIC.length + IV_BYTES + TAG_BYTES) throw new SealedError('malformed', 'Sealed file is too short');
  for (let i = 0; i < MAGIC.length; i++) if (b[i] !== MAGIC[i]) throw new SealedError('malformed', 'Not a sealed file (bad magic)');
  const iv = b.slice(MAGIC.length, MAGIC.length + IV_BYTES);
  const data = b.slice(MAGIC.length + IV_BYTES);
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(path), tagLength: 128 }, key, data);
  } catch {
    throw new SealedError('wrong-key', WRONG_KEY_MESSAGE);
  }
}

/** Encrypt `plain` for the logical `path` (the seal script does the same in plain Node; tests use this). */
export async function sealBytes(key: CryptoKey, plain: ArrayBuffer | Uint8Array, path: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(path), tagLength: 128 }, key, plain as BufferSource),
  );
  const out = new Uint8Array(MAGIC.length + IV_BYTES + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + IV_BYTES);
  return out;
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav',
};
export function mimeFor(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}
