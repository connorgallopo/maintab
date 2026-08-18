// scripts/amo-pending.mjs
import { clientFromEnv, setOutput } from './amo-client.mjs';

const [version] = process.argv.slice(2);
if (!version) {
  console.error('usage: amo-pending.mjs <version>');
  process.exit(1);
}

const found = await clientFromEnv().findVersion(version);
setOutput('pending', found ? 'false' : 'true');
console.log(found ? `${version} is on AMO (file ${found.file?.status})` : `${version} is not on AMO yet`);
