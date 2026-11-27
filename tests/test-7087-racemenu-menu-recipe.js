'use strict';
// test-7087-racemenu-menu-recipe.js
//
//     node .\tests\test-7087-racemenu-menu-recipe.js
//
// The RaceMenu creation menu edit (#7087): Build-ModMenus.py's insert_actions
// run on a small movie built byte by byte, read back independently, and the
// edit's own Jumps held to the blocks they stand for. No copyrighted movie,
// game folder, Flash tool or extra package. tests\fixtures\
// racemenu-menu-recipe.py says what each check is.
const path = require('path'), { spawnSync } = require('child_process');
const python = process.platform === 'win32' ? 'python' : 'python3';
const r = spawnSync(python, ['-B', path.join(__dirname, 'fixtures', 'racemenu-menu-recipe.py')], {
  cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000
});
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.error) console.error(r.error.message);
process.exitCode = r.status === 0 ? 0 : 1;
