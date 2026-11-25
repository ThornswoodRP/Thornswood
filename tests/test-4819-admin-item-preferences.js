// Run the native plugin fixture through the same harness gate as the game tests.
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const fixture = path.join(__dirname, 'test-4819-admin-item-preferences.py');
for (const executable of ['python', 'py', 'python3']) {
  const result = spawnSync(executable, [fixture], { stdio: 'inherit' });
  if (result.error && result.error.code === 'ENOENT') continue;
  if (result.error) console.error(result.error.message);
  process.exit(result.status === 0 ? 0 : 1);
}
console.error('FAIL  Python is needed for the admin item preference fixture');
process.exitCode = 1;
