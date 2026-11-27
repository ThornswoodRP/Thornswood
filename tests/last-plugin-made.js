'use strict';
/*
  last-plugin-made.js

  Thornswood-Last.esp for the harnesses that read its records (#2791). No
  repository holds it since #2791 step 3: it copies other authors' records,
  so each machine makes it from the committed recipe,
  game/data/last-plugin.recipe, out of its own plugins and string tables
  (scripts/mods/Make-LastPlugin.py). This makes it the same way from a Data
  folder with the collection: THORNSWOOD_DATA, or C:\Thornswood\Game\Data. A
  Thornswood-Last.esp already there at the bytes game/data/last-plugin.json
  names (the launcher makes it before every Play) is read as it is.

  Where there is no such folder, or the recipe does not make the plugin there
  (another copy of a plugin it reads), it hands back no plugin and why, and
  the harness prints SKIP for the checks that read the plugin's records; the
  checks of the manifest, the recipe and the builder still run.

      const lastPlugin = require('./last-plugin-made.js');
      const made = lastPlugin.made();
      if (!made.buf) { console.log('SKIP  R: ' + made.why); }

  made() returns { path, buf, why }. The plugin is made once per manifest
  into the temporary folder and kept there by its sha256, so the harnesses
  of one gate make it once. Nothing outside the temporary folder is written.
*/
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NAME = 'Thornswood-Last.esp';
const RECIPE = path.join(ROOT, 'game', 'data', 'last-plugin.recipe');
const MANIFEST = path.join(ROOT, 'game', 'data', 'last-plugin.json');
const MAKE = path.join(ROOT, 'scripts', 'mods', 'Make-LastPlugin.py');

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function want() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8').replace(/^\ufeff/, ''));
  return { size: m.plugin.size, sha256: String(m.plugin.sha256).toLowerCase() };
}

function dataFolder() {
  for (const d of [process.env.THORNSWOOD_DATA, 'C:\\Thornswood\\Game\\Data']) {
    if (d && fs.existsSync(path.join(d, 'Skyrim.esm'))) { return d; }
  }
  return null;
}

function python(args) {
  for (const [exe, first] of [['python', []], ['py', ['-3']], ['python3', []]]) {
    const p = spawnSync(exe, first.concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}

function read(p, w) {
  try {
    const buf = fs.readFileSync(p);
    if (buf.length === w.size && sha(buf) === w.sha256) { return buf; }
  } catch (e) { /* not there */ }
  return null;
}

let cached = null;
function made() {
  if (cached) { return cached; }
  const w = want();
  const data = dataFolder();
  if (!data) {
    cached = { path: null, buf: null, why: 'no Data folder with the game here (THORNSWOOD_DATA), so ' + NAME + ' cannot be made from its recipe' };
    return cached;
  }
  const there = read(path.join(data, NAME), w);
  if (there) { cached = { path: path.join(data, NAME), buf: there, why: '' }; return cached; }
  const kept = path.join(os.tmpdir(), 'thornswood-last-' + w.sha256.slice(0, 16) + '.esp');
  const old = read(kept, w);
  if (old) { cached = { path: kept, buf: old, why: '' }; return cached; }
  const mine = kept + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex');
  const p = python(['-I', '-B', MAKE, '--recipe', RECIPE, '--data', data, '--out', mine]);
  const said = p ? (p.stdout + p.stderr).trim() : 'no python here';
  const buf = p && p.status === 0 ? read(mine, w) : null;
  if (!buf) {
    try { fs.unlinkSync(mine); } catch (e) { /* nothing written */ }
    cached = { path: null, buf: null, why: NAME + ' could not be made from its recipe out of ' + data + ': ' + said.split(/\r?\n/).slice(-2).join(' ') };
    return cached;
  }
  try { fs.renameSync(mine, kept); } catch (e) {
    // Another harness kept one first: read that one, and take this one away.
    if (read(kept, w)) { try { fs.unlinkSync(mine); } catch (e2) { /* gone already */ } }
  }
  cached = { path: fs.existsSync(mine) ? mine : kept, buf, why: '' };
  return cached;
}

function doorReferenceOverrides(manifest) {
  return new Set(['gatesUnlocked', 'riftwealdUnlocked', 'claimableDoorsUnlocked',
    'authoredDoorsUnlocked', 'authoredDoorsDirectActivation'].flatMap(key => manifest[key] || [])
    .concat(manifest.cisternPassage?.enabled || [], manifest.cisternPassage?.disabled || []));
}

module.exports = { NAME, made, want, doorReferenceOverrides };
