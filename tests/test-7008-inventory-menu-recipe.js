'use strict';
// Runs the real recipe's AVM1 predicate/rebaser, using an original synthetic
// program. No copyrighted movie, game directory, Flash tool or extra package.
const path = require('path'), { spawnSync } = require('child_process');
const python = process.platform === 'win32' ? 'python' : 'python3';
const r = spawnSync(python, ['-B', path.join(__dirname, 'fixtures', 'inventory-menu-recipe.py')], {
  cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000
});
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.error) console.error(r.error.message);
process.exitCode = r.status === 0 ? 0 : 1;
