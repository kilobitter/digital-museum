// Sealed mode for the published site: fetch the manifest, ask for the password, decrypt museum.json and
// install a media opener that decrypts each file just before it is used.
import { parseMuseum } from '../shared/validate';
import type { Museum } from '../shared/museum';
import { setMediaOpener } from './mediaOpener';
import { forgetKey, loadStoredKey, storeKey } from './keyStore';
import { SealedError, deriveKey, mimeFor, openSealed, parseManifest, type SealedManifest } from './sealed';
import { showLoading, showPassword } from './ui';

const SEALED_BASE = './sealed/';

export class SealedSourceError extends Error {
  constructor(
    readonly title: string,
    readonly details: string[],
  ) {
    super(title);
  }
}

export interface SealedSource {
  museum: Museum;
  urlFor: (file: string) => string;
  /** Set when a key remembered on this device was used. */
  forget: (() => void) | null;
}

async function fetchBytes(url: string, what: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new SealedSourceError(`Could not load ${what}`, [`Network error: ${String(e)}`]);
  }
  if (!res.ok) throw new SealedSourceError(`Could not load ${what}`, [`HTTP ${res.status} for ${url}`]);
  return res.arrayBuffer();
}

async function fetchManifest(): Promise<SealedManifest> {
  let res: Response;
  try {
    res = await fetch(SEALED_BASE + 'manifest.json', { cache: 'no-cache' });
  } catch (e) {
    throw new SealedSourceError('This museum has not been published yet', [`Network error: ${String(e)}`]);
  }
  if (!res.ok) {
    throw new SealedSourceError('This museum has not been published yet', [`HTTP ${res.status} for ${SEALED_BASE}manifest.json`]);
  }
  try {
    return parseManifest(await res.json());
  } catch (e) {
    throw new SealedSourceError('The sealed museum is not readable', [e instanceof Error ? e.message : String(e)]);
  }
}

function installOpener(key: CryptoKey): void {
  setMediaOpener(async (url) => {
    if (!url.startsWith(SEALED_BASE) || !url.endsWith('.enc')) return { url, release() {} };
    const path = url.slice(SEALED_BASE.length, -'.enc'.length);
    const sealed = await fetchBytes(url, path);
    const plain = await openSealed(key, sealed, path);
    const blobUrl = URL.createObjectURL(new Blob([plain], { type: mimeFor(path) }));
    let done = false;
    return {
      url: blobUrl,
      release() {
        if (done) return;
        done = true;
        URL.revokeObjectURL(blobUrl);
      },
    };
  });
}

export async function openSealedSource(): Promise<SealedSource> {
  showLoading('Reading museum…');
  const manifest = await fetchManifest();
  const salt = manifest.kdf.salt;
  const museumBytes = await fetchBytes(SEALED_BASE + 'museum.json.enc', 'the museum');

  let key: CryptoKey | null = null;
  let plain: ArrayBuffer | null = null;
  let remembered = false;

  const stored = await loadStoredKey(salt);
  if (stored) {
    try {
      plain = await openSealed(stored, museumBytes, 'museum.json');
      key = stored;
      remembered = true;
    } catch {
      await forgetKey(salt); // outdated key (password changed) or damaged entry
    }
  }

  let error: string | null = null;
  while (!key || !plain) {
    const { password, remember } = await showPassword(null, error);
    showLoading('Unlocking…');
    const derived = await deriveKey(password, manifest);
    try {
      plain = await openSealed(derived, museumBytes, 'museum.json');
    } catch (e) {
      if (e instanceof SealedError && e.kind === 'wrong-key') {
        error = 'Wrong password';
        continue;
      }
      throw new SealedSourceError('The sealed museum is not readable', [e instanceof Error ? e.message : String(e)]);
    }
    key = derived;
    if (remember) await storeKey(salt, derived);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    throw new SealedSourceError('museum.json is not valid JSON', [String(e)]);
  }
  const parsed = parseMuseum(json);
  if (!parsed.ok) throw new SealedSourceError('museum.json is invalid', parsed.errors);

  installOpener(key);
  return {
    museum: parsed.museum,
    urlFor: (file) => `${SEALED_BASE}${file}.enc`,
    forget: remembered
      ? () => {
          void forgetKey(salt).finally(() => location.reload());
        }
      : null,
  };
}
