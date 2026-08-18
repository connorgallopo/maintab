// scripts/fetch-signed-xpi.mjs
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { clientFromEnv, sleep } from './amo-client.mjs';

const [version, outPath] = process.argv.slice(2);
if (!version || !outPath) {
  console.error('usage: fetch-signed-xpi.mjs <version> <out-path>');
  process.exit(1);
}

const amo = clientFromEnv();
const deadline = Date.now() + 10 * 60_000;

while (true) {
  const file = (await amo.findVersion(version))?.file;

  if (file?.status === 'public' && file.url) {
    const bytes = await amo.download(file.url);
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
    throw new Error(`timed out waiting on signing; version ${version} file status is ${file?.status ?? 'missing'}`);
  }

  console.log(`waiting on signing for ${version} (status ${file?.status ?? 'no version yet'})`);
  await sleep(15_000);
}
