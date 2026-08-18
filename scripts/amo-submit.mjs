// scripts/amo-submit.mjs
import { spawn } from 'node:child_process';
import { clientFromEnv, sleep } from './amo-client.mjs';

// Exit code the workflow reads as "AMO was closed for writes, retry later" rather than a real failure.
const PARKED = 75;

const [version, zip, sourcesZip] = process.argv.slice(2);
if (!version || !zip || !sourcesZip) {
  console.error('usage: amo-submit.mjs <version> <firefox-zip> <sources-zip>');
  process.exit(1);
}

const amo = clientFromEnv();
const budgetMs = Number(process.env.AMO_WAIT_MINUTES ?? 45) * 60_000;

if (await amo.findVersion(version)) {
  console.log(`${version} is already on AMO, nothing to submit`);
  process.exit(0);
}

const deadline = Date.now() + budgetMs;
let backoff = 30_000;
while (await amo.isReadOnly()) {
  const wait = Math.min(backoff, deadline - Date.now());
  if (wait < 1_000) {
    console.error(`AMO has been read-only for ${budgetMs / 60_000} min; ${version} is still unsubmitted`);
    process.exit(PARKED);
  }
  console.log(`AMO is read-only, retrying in ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  backoff = Math.min(backoff * 2, 300_000);
}

const submit = spawn('pnpm', ['wxt', 'submit', '--firefox-zip', zip, '--firefox-sources-zip', sourcesZip], {
  stdio: 'inherit',
});
const code = (await new Promise((resolve) => submit.on('close', resolve))) ?? 1;

// A concurrent run may have landed the version first; AMO rejects the duplicate, which is not a failure here.
if (code !== 0 && (await amo.findVersion(version))) {
  console.log(`submit exited ${code}, but ${version} is on AMO now`);
  process.exit(0);
}
process.exit(code);
