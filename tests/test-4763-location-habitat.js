'use strict';
const path = require('node:path'), {spawnSync} = require('node:child_process');
function main() {
  for (const command of ['python', 'py', 'python3']) {
    const result = spawnSync(command, [path.join(__dirname,'test-4763-location-habitat.py')], {stdio:'inherit'});
    if (result.error && result.error.code === 'ENOENT') continue;
    if (result.error) console.error(result.error.message);
    return result.status === 0 ? 0 : 1;
  }
  console.error('FAIL Python is needed for the location habitat fixture');
  return 1;
}
process.exitCode = main();
