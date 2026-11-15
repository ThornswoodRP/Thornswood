'use strict';
/*
  test-2791-last-recipe.js

  #2791: Thornswood-Last.esp copies records from 31 other authors' plugins,
  so it goes out as a recipe each machine builds the plugin from, out of its
  own plugins (Patrick's A of 26 Oct 2026 on #3721).
  scripts/mods/last_recipe.py writes and reads the recipe, and
  scripts/mods/Build-LastPlugin.py writes game/data/last-plugin.recipe on
  every build and stops when it does not make the plugin back byte for byte.

  Without the game this runs tests/last-recipe-cases.py (the recipe made
  from small plugins written there, read back, and refused for a copy written
  as our own or a source that differs), and holds the committed recipe to the
  manifest. The plugin itself is in no repository since #2791 step 3: each
  machine makes it from the recipe (scripts/mods/Make-LastPlugin.py), and
  tests/test-2791-make-last.py makes it from small plugins the same way.

    C1  the recipe names the plugin the manifest names, by size and sha256
    C2  the manifest names the recipe's size and sha256
    C3  every plugin it reads is one the manifest was built against, at
        those bytes
    C4  it reads to its end, and the bytes it makes add up to the plugin
*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const RECIPE = path.join(ROOT, 'game', 'data', 'last-plugin.recipe');
const MANIFEST = path.join(ROOT, 'game', 'data', 'last-plugin.json');
const CASES = path.join(ROOT, 'tests', 'last-recipe-cases.py');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}

const run = python([CASES]);
yes('R1 the recipe cases pass (python tests/last-recipe-cases.py)', !!run && run.status === 0);
if (!run || run.status !== 0) { console.log(run ? run.stdout + run.stderr : 'no python here'); }

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const recipe = fs.readFileSync(RECIPE);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let p = 0;
function varint() {
  let n = 0, mul = 1;
  for (;;) {
    if (p >= recipe.length) { throw new Error('the recipe ends in the middle of a step'); }
    const b = recipe[p++];
    n += (b & 0x7f) * mul;
    if (!(b & 0x80)) { return n; }
    mul *= 128;
  }
}
yes('C0 it is a version 1 recipe', recipe.slice(0, 5).equals(Buffer.from('TSLR\x01', 'latin1')));
p = 5;
const size = recipe.readUInt32LE(p); p += 4;
const made = recipe.slice(p, p + 32).toString('hex'); p += 32;
yes('C1 it names the plugin the manifest names, ' + (manifest.plugin && manifest.plugin.size) + ' bytes',
    !!manifest.plugin && size === manifest.plugin.size && made === manifest.plugin.sha256);
yes('C1 and no repository holds the plugin (#2791 step 3)', !fs.existsSync(path.join(ROOT, 'game', 'content', 'Thornswood-Last.esp')));
yes('C2 the manifest names it', !!manifest.recipe && manifest.recipe.sha256 === sha(recipe) && manifest.recipe.size === recipe.length);
const built = {};
for (const row of manifest.builtAgainst) { built[row.name.toLowerCase()] = row; }
const sources = [];
for (let n = varint(); n > 0; n--) {
  const kind = recipe[p++];
  const len = varint();
  const name = recipe.slice(p, p + len).toString('utf8'); p += len;
  const bytes = varint();
  const want = recipe.slice(p, p + 32).toString('hex'); p += 32;
  sources.push({ kind, name, bytes, want });
}
const off = sources.filter((s) => s.kind === 0 && !(built[s.name.toLowerCase()] &&
  built[s.name.toLowerCase()].size === s.bytes && built[s.name.toLowerCase()].sha256 === s.want));
yes('C3 every plugin it reads is one the manifest was built against, at those bytes (' +
    sources.filter((s) => s.kind === 0).length + ' plugins, ' + sources.filter((s) => s.kind === 1).length +
    ' string tables)' + (off.length ? ' (not: ' + off.map((s) => s.name).join(', ') + ')' : ''), off.length === 0);
let sum = 0, ok = true;
try {
  while (p < recipe.length) {
    const op = recipe[p++];
    if (op === 0) { const n = varint(); p += n; sum += n; }
    else if (op === 1) { varint(); varint(); }
    else if (op === 2) { varint(); sum += varint(); }
    else if (op === 3) { varint(); varint(); }
    else { ok = false; break; }
  }
} catch (e) { ok = false; }
yes('C4 it reads to its end, and what it copies and writes is no more than the plugin', ok && p === recipe.length && sum <= size);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
