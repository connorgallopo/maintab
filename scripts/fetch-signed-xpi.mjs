// scripts/fetch-signed-xpi.mjs
import { createHmac, randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const [version, outPath] = process.argv.slice(2);
if (!version || !outPath) {
  console.error('usage: fetch-signed-xpi.mjs <version> <out-path>');
  process.exit(1);
}

const { FIREFOX_EXTENSION_ID, FIREFOX_JWT_ISSUER, FIREFOX_JWT_SECRET } = process.env;
for (const [name, value] of Object.entries({ FIREFOX_EXTENSION_ID, FIREFOX_JWT_ISSUER, FIREFOX_JWT_SECRET })) {
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
}

const BASE = 'https://addons.mozilla.org';
const TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 15_000;

// AMO rejects a JWT living longer than five minutes, so each request signs a fresh one.
function jwt() {
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ iss: FIREFOX_JWT_ISSUER, jti: randomUUID(), iat, exp: iat + 240 });
  const signature = createHmac('sha256', FIREFOX_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function findVersion() {
  const url = `${BASE}/api/v5/addons/addon/${encodeURIComponent(FIREFOX_EXTENSION_ID)}/versions/?filter=all_with_unlisted`;
  const res = await fetch(url, { headers: { Authorization: `JWT ${jwt()}` } });
  if (!res.ok) throw new Error(`listing versions failed: ${res.status} ${await res.text()}`);
  const { results = [] } = await res.json();
  return results.find((v) => v.version === version);
}

// Node strips Authorization across a redirect to another host, so the CDN hop is followed by hand.
async function download(url) {
  const res = await fetch(url, { headers: { Authorization: `JWT ${jwt()}` }, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const next = await fetch(new URL(res.headers.get('location'), url));
    if (!next.ok) throw new Error(`download failed: ${next.status}`);
    return Buffer.from(await next.arrayBuffer());
  }
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const deadline = Date.now() + TIMEOUT_MS;
while (true) {
  const found = await findVersion();
  const file = found?.file;

  if (file?.status === 'public' && file.url) {
    const bytes = await download(file.url);
    const [algorithm, expected] = (file.hash ?? '').split(':');
    if (expected) {
      const actual = createHash(algorithm).update(bytes).digest('hex');
      if (actual !== expected) throw new Error(`hash mismatch: AMO said ${algorithm}:${expected}, got ${actual}`);
    }
    await writeFile(outPath, bytes);
    console.log(`signed ${version} -> ${outPath} (${bytes.length} bytes, ${file.hash ?? 'unverified'})`);
    break;
  }

  if (Date.now() > deadline) {
    throw new Error(`timed out after ${TIMEOUT_MS / 60000} min; version ${version} file status is ${file?.status ?? 'missing'}`);
  }

  console.log(`waiting on signing for ${version} (status ${file?.status ?? 'no version yet'})`);
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
