// scripts/amo-client.mjs
import { createHmac, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const BASE = 'https://addons.mozilla.org';

// Exit code the workflows read as "AMO would not cooperate, retry later" rather than a real failure.
export const PARKED = 75;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function requireEnv(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`missing env: ${missing.join(', ')}`);
    process.exit(1);
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

export function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

// AMO rejects a JWT that lives longer than five minutes, so every request signs a fresh one. It also
// rejects an iat in its own future, so the timestamp is backdated to absorb a skewed local clock.
function jwt(issuer, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000) - 60;
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ iss: issuer, jti: randomUUID(), iat, exp: iat + 240 });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// Gateway errors come back as full HTML pages; only the title is worth putting in a log.
async function describe(res) {
  const body = await res.text().catch(() => '');
  const title = body.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  if (title) return title;
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 160);
  return snippet ? `${res.status} ${snippet}` : String(res.status);
}

export function client({ issuer, secret, extensionId }) {
  const auth = () => ({ Authorization: `JWT ${jwt(issuer, secret)}` });
  // A struggling AMO holds connections open instead of refusing them, and node's fetch waits forever by default.
  const deadlined = (ms, init = {}) => ({ ...init, signal: AbortSignal.timeout(ms) });

  return {
    async isReadOnly() {
      const res = await fetch(`${BASE}/api/v5/site/`, deadlined(30_000));
      if (!res.ok) throw new Error(`site status failed: ${await describe(res)}`);
      return (await res.json()).read_only === true;
    },

    async findVersion(version) {
      const path = `/api/v5/addons/addon/${encodeURIComponent(extensionId)}/versions/?filter=all_with_unlisted`;
      const res = await fetch(`${BASE}${path}`, deadlined(30_000, { headers: auth() }));
      if (!res.ok) throw new Error(`listing versions failed: ${await describe(res)}`);
      const { results = [] } = await res.json();
      return results.find((candidate) => candidate.version === version);
    },

    // Node drops Authorization when a redirect crosses hosts, so the CDN hop is followed by hand.
    async download(url) {
      const res = await fetch(url, deadlined(120_000, { headers: auth(), redirect: 'manual' }));
      if (res.status >= 300 && res.status < 400) {
        const followed = await fetch(new URL(res.headers.get('location'), url), deadlined(120_000));
        if (!followed.ok) throw new Error(`download failed: ${await describe(followed)}`);
        return Buffer.from(await followed.arrayBuffer());
      }
      if (!res.ok) throw new Error(`download failed: ${await describe(res)}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export function clientFromEnv() {
  const env = requireEnv('FIREFOX_EXTENSION_ID', 'FIREFOX_JWT_ISSUER', 'FIREFOX_JWT_SECRET');
  return client({
    issuer: env.FIREFOX_JWT_ISSUER,
    secret: env.FIREFOX_JWT_SECRET,
    extensionId: env.FIREFOX_EXTENSION_ID,
  });
}
