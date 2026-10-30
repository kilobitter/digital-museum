// Encrypts the plaintext museum (public/museum) into public/sealed, the only copy that is committed and published.
// Usage: node scripts/seal.mjs [--src <dir>] [--out <dir>] [--rekey]
// Password: env MUSEUM_PASSWORD, else a hidden prompt. Format: see src/viewer/sealed.ts and the README.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const subtle = globalThis.crypto.subtle;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Same rule as MEDIA_FILE_RE in src/shared/mediaFiles.ts
const MEDIA_FILE_RE = /^media\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|mp3|m4a|aac|ogg|wav)$/;
const MAGIC = Buffer.from('VMS1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ITERATIONS = 600000;
const MIN_PASSWORD = 12;

function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

// ---- args ----
const argv = process.argv.slice(2);
let src = join(root, 'public', 'museum');
let out = join(root, 'public', 'sealed');
let rekey = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--rekey') rekey = true;
  else if (a === '--src' || a === '--out') {
    const v = argv[++i];
    if (!v) die(2, `${a} needs a folder`);
    if (a === '--src') src = resolve(v);
    else out = resolve(v);
  } else die(2, `Unknown argument ${a}\nUsage: node scripts/seal.mjs [--src <dir>] [--out <dir>] [--rekey]`);
}

// ---- crypto (same format as src/viewer/sealed.ts) ----
async function deriveKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aad = (path) => new TextEncoder().encode(path);

async function seal(key, plain, path) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(path), tagLength: 128 }, key, plain));
  return Buffer.concat([MAGIC, iv, ct]);
}

/** Plaintext Buffer, or null when the file is not a valid sealed file for this key and path. */
async function tryOpen(key, sealed, path) {
  if (sealed.length < MAGIC.length + IV_BYTES + TAG_BYTES || !sealed.subarray(0, 4).equals(MAGIC)) return null;
  try {
    const iv = sealed.subarray(4, 4 + IV_BYTES);
    return Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(path), tagLength: 128 }, key, sealed.subarray(4 + IV_BYTES)));
  } catch {
    return null;
  }
}

function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

// ---- password ----
function readHidden(prompt) {
  return new Promise((res) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let s = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          return res(s);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
        else s += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function getPassword(confirm) {
  const env = process.env.MUSEUM_PASSWORD;
  let pw;
  if (env) pw = env;
  else {
    if (!process.stdin.isTTY) die(2, 'No password: set MUSEUM_PASSWORD or run in a terminal to be prompted.');
    pw = await readHidden('Museum password: ');
    if (confirm) {
      const again = await readHidden('Repeat password: ');
      if (again !== pw) die(1, 'The passwords do not match.');
    }
  }
  if (confirm && [...pw].length < MIN_PASSWORD) die(1, `The password must be at least ${MIN_PASSWORD} characters (use a long passphrase).`);
  return pw;
}

// ---- main ----
const museumPath = join(src, 'museum.json');
if (!existsSync(museumPath)) die(1, `${museumPath} not found.`);
const museumBytes = readFileSync(museumPath);
let museum;
try {
  museum = JSON.parse(museumBytes.toString('utf8'));
} catch (e) {
  die(1, `${museumPath} is not valid JSON: ${e.message}`);
}

const manifestPath = join(out, 'manifest.json');
const museumEnc = join(out, 'museum.json.enc');
const fresh = rekey || !existsSync(manifestPath);

let manifest;
let key;
if (fresh) {
  const pw = await getPassword(true);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  manifest = {
    format: 'vr-museum-sealed',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: Buffer.from(salt).toString('base64') },
    cipher: 'AES-GCM',
  };
  key = await deriveKey(pw, salt, ITERATIONS);
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    die(1, `${manifestPath} is not readable (${e.message}). Use --rekey to start over.`);
  }
  const k = manifest?.kdf;
  const salt = typeof k?.salt === 'string' ? Buffer.from(k.salt, 'base64') : null;
  if (
    manifest?.format !== 'vr-museum-sealed' || manifest.version !== 1 || manifest.cipher !== 'AES-GCM' ||
    k?.name !== 'PBKDF2' || k.hash !== 'SHA-256' || !Number.isInteger(k.iterations) ||
    k.iterations < 100000 || k.iterations > 10000000 || !salt || salt.length !== 16
  ) die(1, `${manifestPath} is not a valid sealed manifest. Use --rekey to start over.`);
  if (!existsSync(museumEnc)) die(1, `${museumEnc} is missing, so the password cannot be verified. Use --rekey to set a new one.`);
  const pw = await getPassword(false);
  key = await deriveKey(pw, salt, k.iterations);
  if (!(await tryOpen(key, readFileSync(museumEnc), 'museum.json'))) die(1, 'Wrong password (use --rekey to set a new one)');
}

const counts = { sealed: 0, unchanged: 0, removed: 0, missing: 0, skipped: 0 };

async function sealFile(path, plain) {
  const target = join(out, `${path}.enc`);
  if (!fresh && existsSync(target)) {
    const old = await tryOpen(key, readFileSync(target), path);
    if (old && old.equals(plain)) {
      counts.unchanged++;
      return;
    }
  }
  writeAtomic(target, await seal(key, plain, path));
  counts.sealed++;
}

await sealFile('museum.json', museumBytes);

const listed = new Set();
for (const m of Array.isArray(museum.media) ? museum.media : []) {
  const file = m?.file;
  if (typeof file !== 'string' || !MEDIA_FILE_RE.test(file)) {
    console.warn(`Skipping media entry with an invalid file path: ${JSON.stringify(file)}`);
    counts.skipped++;
    continue;
  }
  if (listed.has(file)) continue;
  listed.add(file);
  const p = join(src, file);
  if (!existsSync(p)) {
    console.warn(`Missing media file (listed in museum.json): ${file}`);
    counts.missing++;
    continue;
  }
  await sealFile(file, readFileSync(p));
}

// Drop sealed media that museum.json no longer lists (only *.enc inside <out>/media).
const mediaOut = join(out, 'media');
if (existsSync(mediaOut)) {
  for (const name of readdirSync(mediaOut)) {
    if (!name.endsWith('.enc')) continue;
    if (!listed.has(`media/${name.slice(0, -4)}`) || !existsSync(join(src, 'media', name.slice(0, -4)))) {
      rmSync(join(mediaOut, name));
      counts.removed++;
    }
  }
}

// The manifest goes last, so an interrupted run never leaves a manifest whose key matches nothing.
if (fresh) writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Sealed ${counts.sealed}, unchanged ${counts.unchanged}, removed ${counts.removed}, missing ${counts.missing}` + (counts.skipped ? `, skipped ${counts.skipped}` : '') + ` -> ${out}`);
