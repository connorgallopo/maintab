// scripts/fetch-signed-xpi.mjs
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PARKED, clientFromEnv, sleep } from './amo-client.mjs';

const [version, outPath] = process.argv.slice(2);
if (!version || !outPath) {
  console.error('usage: fetch-signed-xpi.mjs <version> <out-path>');
  process.exit(1);
}

const amo = clientFromEnv();
const deadline = Date.now() + Number(process.env.AMO_SIGNING_WAIT_MINUTES ?? 10) * 60_000;

while (true) {
  // A backend hiccup mid-signing should keep the poll alive, not abandon a version AMO is about to sign.
  const found = await amo.findVersion(version).catch((error) => {
    console.log(`AMO is unreachable (${error.message})`);
    return null;
  });
  const file = found?.file;

  if (file?.status === 'public' && file.url) {
    const bytes = await amo.download(file.url).catch((error) => {
      console.log(`download failed (${error.message})`);
      return null;
    });

    if (bytes) {
      // A mismatch here is corruption rather than an outage, so it fails loudly instead of parking.
      const [algorithm, expected] = (file.hash ?? '').split(':');
      if (expected) {
        const actual = createHash(algorithm).update(bytes).digest('hex');
        if (actual !== expected) throw new Error(`hash mismatch: AMO said ${algorithm}:${expected}, got ${actual}`);
      }
      await writeFile(outPath, bytes);
      console.log(`signed ${version} -> ${outPath} (${bytes.length} bytes, ${file.hash ?? 'unverified'})`);
      break;
    }
  }

  if (Date.now() > deadline) {
    console.error(`gave up waiting on signing for ${version}; file status is ${file?.status ?? 'missing'}`);
    process.exit(PARKED);
  }

  console.log(`waiting on signing for ${version} (status ${file?.status ?? 'no version yet'})`);
  await sleep(15_000);
}
