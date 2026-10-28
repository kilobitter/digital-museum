// Dev-only write API for the editor. Registered with `apply: 'serve'`, so it never ends up in a build.
// All request-independent logic is exported as plain functions taking the museum root dir.
import { randomBytes } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parseMuseum } from '../shared/validate';

export const MAX_MUSEUM_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'mp3', 'm4a', 'aac', 'ogg', 'wav'] as const;
export const MEDIA_FILE_RE = /^media\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|mp3|m4a|aac|ogg|wav)$/;

// ---------- pure helpers ----------

export function isLoopback(addr: string | undefined | null): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export interface GuardInput {
  remoteAddress: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function isLoopbackHost(host: string): boolean {
  try {
    const h = new URL(`http://${host}`).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
}

/** Returns null when the request may proceed, else an error with HTTP status. Order: loopback, header, origin. */
export function checkGuards(input: GuardInput): { status: number; error: string } | null {
  if (!isLoopback(input.remoteAddress)) return { status: 403, error: 'Forbidden: editor API is loopback-only' };
  if (first(input.headers['x-museum-editor']) !== '1') return { status: 403, error: 'Forbidden: missing X-Museum-Editor header' };
  // Host must be a loopback name (blocks DNS-rebinding: loopback connection, foreign Host). HTTP/2 uses :authority.
  const host = first(input.headers['host']) ?? first(input.headers[':authority']);
  if (!host || !isLoopbackHost(host)) return { status: 403, error: 'Forbidden: unexpected Host' };
  const origin = first(input.headers['origin']);
  if (origin !== undefined) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || originHost !== host) return { status: 403, error: 'Forbidden: cross-origin request' };
  }
  return null;
}

/** Lower-cased extension if it is on the allowlist, else null. */
export function allowedExtension(name: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

export function generateId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(10);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

export function isValidMediaFile(file: string): boolean {
  return MEDIA_FILE_RE.test(file);
}

/** Absolute path of a media file inside <root>/media, or null if the pattern or containment check fails. */
export function resolveMediaPath(root: string, file: string): string | null {
  if (!isValidMediaFile(file)) return null;
  const mediaDir = path.resolve(root, 'media');
  const abs = path.resolve(root, file);
  if (path.dirname(abs) !== mediaDir) return null;
  return abs;
}

export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${target}.tmp-${generateId()}`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

export type SaveResult = { status: 200; body: { ok: true } } | { status: 400; body: { ok: false; errors: string[] } };

export async function saveMuseum(root: string, json: unknown): Promise<SaveResult> {
  const parsed = parseMuseum(json);
  if (!parsed.ok) return { status: 400, body: { ok: false, errors: parsed.errors } };
  await fs.mkdir(root, { recursive: true });
  await writeFileAtomic(path.join(root, 'museum.json'), JSON.stringify(parsed.museum, null, 2) + '\n');
  return { status: 200, body: { ok: true } };
}

export async function saveMedia(
  root: string,
  originalName: string,
  data: Uint8Array,
): Promise<{ status: 200; body: { file: string } } | { status: 400 | 413; body: { error: string } }> {
  const ext = allowedExtension(originalName);
  if (!ext) return { status: 400, body: { error: `Unsupported file type (allowed: ${ALLOWED_EXTENSIONS.join(', ')})` } };
  if (data.byteLength === 0) return { status: 400, body: { error: 'Empty file' } };
  if (data.byteLength > MAX_MEDIA_BYTES) return { status: 413, body: { error: 'File too large (max 50 MB)' } };
  const dir = path.join(root, 'media');
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < 5; i++) {
    const id = generateId();
    const file = `media/${id}.${ext}`;
    const abs = path.join(root, file);
    try {
      await fs.access(abs);
      continue; // id collision, try another
    } catch {
      /* free */
    }
    await writeFileAtomic(abs, data);
    return { status: 200, body: { file } };
  }
  return { status: 400, body: { error: 'Could not allocate an id' } };
}

export async function deleteMedia(
  root: string,
  file: string,
): Promise<{ status: 200; body: { ok: true } } | { status: 400 | 404; body: { error: string } }> {
  const abs = resolveMediaPath(root, file);
  if (!abs) return { status: 400, body: { error: 'Invalid media path' } };
  try {
    await fs.unlink(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { status: 404, body: { error: 'No such file' } };
    throw e;
  }
  return { status: 200, body: { ok: true } };
}

export class BodyTooLarge extends Error {}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

/**
 * Absolute path for a museum URL path (the part after "/museum/"): "museum.json" or a valid media file.
 * Null for anything else, so other requests fall through to Vite.
 */
export function resolveMuseumFile(root: string, rel: string): string | null {
  if (rel === 'museum.json') return path.join(root, 'museum.json');
  return resolveMediaPath(root, rel);
}

// ---------- request handling ----------

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

export async function handleApi(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const guard = checkGuards({ remoteAddress: req.socket.remoteAddress, headers: req.headers });
  if (guard) return send(res, guard.status, { ok: false, error: guard.error });

  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const tooLarge = (limit: number) => {
    send(res, 413, { error: `Body too large (max ${Math.round(limit / 1024 / 1024)} MB)` });
    req.resume();
  };

  try {
    if (url.pathname === '/api/museum') {
      if (method !== 'PUT') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'PUT' });
      let body: Buffer;
      try {
        body = await readBody(req, MAX_MUSEUM_BYTES);
      } catch (e) {
        if (e instanceof BodyTooLarge) return tooLarge(MAX_MUSEUM_BYTES);
        throw e;
      }
      let json: unknown;
      try {
        json = JSON.parse(body.toString('utf8'));
      } catch {
        return send(res, 400, { ok: false, errors: ['body: not valid JSON'] });
      }
      const r = await saveMuseum(root, json);
      return send(res, r.status, r.body);
    }
    if (url.pathname === '/api/media') {
      if (method === 'POST') {
        const name = url.searchParams.get('name') ?? '';
        if (!allowedExtension(name)) return send(res, 400, { error: `Unsupported file type (allowed: ${ALLOWED_EXTENSIONS.join(', ')})` });
        let body: Buffer;
        try {
          body = await readBody(req, MAX_MEDIA_BYTES);
        } catch (e) {
          if (e instanceof BodyTooLarge) return tooLarge(MAX_MEDIA_BYTES);
          throw e;
        }
        const r = await saveMedia(root, name, body);
        return send(res, r.status, r.body);
      }
      if (method === 'DELETE') {
        const r = await deleteMedia(root, url.searchParams.get('file') ?? '');
        return send(res, r.status, r.body);
      }
      return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST, DELETE' });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e instanceof Error ? e.message : 'Internal error' });
  }
}

export function museumApi(projectRoot: string): Plugin {
  const root = path.resolve(projectRoot, 'public/museum');
  return {
    name: 'museum-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = (req.url ?? '').split('?')[0];
        if (p === '/api' || p.startsWith('/api/')) {
          void handleApi(root, req, res);
          return;
        }
        // Serve museum content from disk ourselves: public/museum is excluded from the watcher (so saves
        // don't reload pages), which also means Vite's public middleware never learns about new uploads.
        const abs = p.startsWith('/museum/') && (req.method === 'GET' || req.method === 'HEAD')
          ? resolveMuseumFile(root, p.slice('/museum/'.length))
          : null;
        if (!abs) return next();
        fs.stat(abs).then(
          (st) => {
            if (!st.isFile()) return next();
            res.writeHead(200, {
              'Content-Type': CONTENT_TYPES[path.extname(abs).slice(1).toLowerCase()] ?? 'application/octet-stream',
              'Content-Length': String(st.size),
              'Cache-Control': 'no-cache',
            });
            if (req.method === 'HEAD') return void res.end();
            createReadStream(abs).on('error', () => res.destroy()).pipe(res);
          },
          () => next(),
        );
      });
    },
  };
}
