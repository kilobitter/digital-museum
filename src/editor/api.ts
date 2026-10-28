import type { Museum } from '../shared/museum';
import { parseMuseum, defaultMuseum } from '../shared/validate';
import type { LoadResult, SaveOutcome } from './store';

const HEADERS = { 'X-Museum-Editor': '1' };

export async function loadMuseum(): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch('./museum/museum.json', { cache: 'no-store' });
  } catch (e) {
    return { status: 'invalid', errors: [`Could not load museum.json: ${String(e)}`] };
  }
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 404 || type.includes('text/html')) return { status: 'missing', museum: defaultMuseum() };
  if (!res.ok) return { status: 'invalid', errors: [`Could not load museum.json (HTTP ${res.status})`] };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: 'invalid', errors: ['museum.json is not valid JSON'] };
  }
  const parsed = parseMuseum(json);
  return parsed.ok ? { status: 'ok', museum: parsed.museum } : { status: 'invalid', errors: parsed.errors };
}

/** Validates locally first; nothing is sent when invalid. */
export async function saveMuseum(museum: Museum): Promise<SaveOutcome> {
  const parsed = parseMuseum(museum);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  try {
    const res = await fetch('/api/museum', {
      method: 'PUT',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(museum),
    });
    const body = (await res.json().catch(() => ({}))) as { errors?: string[]; error?: string };
    if (res.ok) return { ok: true };
    return { ok: false, errors: body.errors ?? [body.error ?? `HTTP ${res.status}`] };
  } catch (e) {
    return { ok: false, errors: [`Network error: ${String(e)}`] };
  }
}

export async function uploadMedia(name: string, data: Blob): Promise<string> {
  const res = await fetch(`/api/media?name=${encodeURIComponent(name)}`, { method: 'POST', headers: HEADERS, body: data });
  const body = (await res.json().catch(() => ({}))) as { file?: string; error?: string };
  if (!res.ok || !body.file) throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
  return body.file;
}

export async function deleteMediaFile(file: string): Promise<void> {
  const res = await fetch(`/api/media?file=${encodeURIComponent(file)}`, { method: 'DELETE', headers: HEADERS });
  if (res.ok || res.status === 404) return; // already gone is fine
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `Delete failed (HTTP ${res.status})`);
}
