// scripts/amo-submit.mjs
import { spawn } from 'node:child_process';
import { PARKED, clientFromEnv, sleep } from './amo-client.mjs';

const [version, zip, sourcesZip] = process.argv.slice(2);
if (!version || !zip || !sourcesZip) {
  console.error('usage: amo-submit.mjs <version> <firefox-zip> <sources-zip>');
  process.exit(1);
}

const amo = clientFromEnv();
const budgetMs = Number(process.env.AMO_WAIT_MINUTES ?? 45) * 60_000;

// Read-only windows, backend errors and outright unreachability all mean the same thing here: wait.
async function probe() {
  try {
    if (await amo.findVersion(version)) return 'submitted';
    return (await amo.isReadOnly()) ? 'AMO is read-only' : 'writable';
  } catch (error) {
    return `AMO is unreachable (${error.message})`;
  }
}

const deadline = Date.now() + budgetMs;
let backoff = 30_000;

while (true) {
  const state = await probe();

  if (state === 'submitted') {
    console.log(`${version} is already on AMO, nothing to submit`);
    process.exit(0);
  }
  if (state === 'writable') break;

  const wait = Math.min(backoff, deadline - Date.now());
  if (wait < 1_000) {
    console.error(`${state}; gave up after ${budgetMs / 60_000} min with ${version} unsubmitted`);
    process.exit(PARKED);
  }
  console.log(`${state}, retrying in ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  backoff = Math.min(backoff * 2, 300_000);
}

const submit = spawn('pnpm', ['wxt', 'submit', '--firefox-zip', zip, '--firefox-sources-zip', sourcesZip], {
  stdio: 'inherit',
});
const code = (await new Promise((resolve) => submit.on('close', resolve))) ?? 1;

// A concurrent run may have landed the version first; AMO rejects the duplicate, which is not a failure here.
if (code !== 0) {
  const landed = await amo.findVersion(version).catch(() => null);
  if (landed) {
    console.log(`submit exited ${code}, but ${version} is on AMO now`);
    process.exit(0);
  }
}
process.exit(code);
