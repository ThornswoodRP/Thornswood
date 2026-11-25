'use strict';
/*
  test-2479-cut-outs.js

  #2479. The spoils block's cut-out list (Dragon Bone and the two Riekling
  spear spell tomes, cut by #1511) was never read: isCutOut had no caller, so
  a chest and the floor both handed all three out. The world now hands
  nothing out at all, so the list went with the rest of the spoil sorting:
  no chest holds what the world put there (forbiddenBaseContainer, #3078) and
  nothing the world placed lies on the floor (Thornswood-Last.esp, #3077).

  Checks, reading the real files and driving the real spoils block over a
  fake mp the way test-spoils.js does:
    - the world fills no container, on live and on dev;
    - Dragon Bone is a MISC and the tomes are BOOKs, and both are types
      Thornswood-Last.esp switches off on the floor;
    - the spoils block keeps no cut-out list, which nothing would read;
    - a press on one is never refused here, placed or dropped.

  Read only.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}

const A = '// ==== thornswood spoils ====';
const B = '// ==== end thornswood spoils ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('the spoils block is in the gamemode', block !== null);
if (!block) { done(); return; }

const CUTS = ['3ada4:Skyrim.esm', 'bff20:Playable Rieklings.esp', 'bff21:Playable Rieklings.esp'];
const read = function (rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8'); };
['Deploy-Gamemode.ps1', 'Deploy-DevGamemode.ps1'].forEach(function (n) {
  yes('W1 ' + n + ' has the engine fill no container (forbiddenBaseContainer CONT)',
      /forbiddenBaseContainer -NotePropertyValue @\('CONT'\)/.test(read(path.join('scripts', 'deploy', n))));
});
const types = (/FLOOR_TYPES = \(([^)]*)\)/.exec(read(path.join('scripts', 'mods', 'Build-LastPlugin.py'))) || ['', ''])[1];
yes('W2 Thornswood-Last.esp switches off every MISC and BOOK on the floor, Dragon Bone\'s and the tomes\' kinds',
    types.indexOf("b'MISC'") >= 0 && types.indexOf("b'BOOK'") >= 0);
yes('W3 the spoils block keeps no cut-out list that nothing would read',
    !/CUT_OUTS|isCutOut/.test(block));

/** The block over a fake mp. ready() says whether a descriptor has an id yet. */
function rig(ready) {
  const store = {}, kinds = {}, timers = [], ids = {};
  let nextId = 0x100;
  function idOf(desc) {
    if (ready && !ready(desc)) { return 0; }
    if (!ids[desc]) { ids[desc] = nextId++; }
    return ids[desc];
  }
  const Fake = {
    makeProperty: function () { },
    get: function (id, key) {
      const row = store[id] || {};
      if (key === 'inventory') { return { entries: (row.inventory || []).slice() }; }
      return row[key];
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      if (key === 'inventory') { store[id].inventory = (v && v.entries) || []; return; }
      store[id][key] = v;
    },
    lookupEspmRecordById: function (baseId) {
      const t = kinds[baseId];
      return t ? { record: { type: t } } : null;
    }
  };
  const fn = new Function(
    'globalThis', 'mp', 'console', 'idOf', 'TOOLS', 'setTimeout', 'putBack',
    'Math', 'Number', 'String', 'Object', 'Array', 'Date',
    block + '\nreturn globalThis.__thornswoodSpoils;');
  const api = fn({}, Fake, { log: function () { } }, idOf, {},
    function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; },
    function () { }, Math, Number, String, Object, Array, Date);
  api.idOf = idOf;
  api.kind = function (desc, type) { const id = idOf(desc); kinds[id] = type; return id; };
  api.put = function (refrId, entries) { store[refrId] = store[refrId] || {}; store[refrId].inventory = entries; };
  api.inv = function (refrId) { return (store[refrId] || {}).inventory || []; };
  return api;
}

// ------------------------------------------------------------ the floor
// None of the three is refused off the floor any more, because none lies
// there: Thornswood-Last.esp switches every placed item off (#3077,
// tests/test-3077-floor-items.js), so the block refuses no press at all.
{
  const g = rig();
  CUTS.forEach(function (d) { g.kind(d, d.indexOf('3ada4') === 0 ? 'MISC' : 'BOOK'); });
  yes('F1 a press on one is never refused here, placed or dropped',
      g.activate(1, 0x00012345, CUTS[0]) === null && g.activate(1, 0xff000123, CUTS[0]) === null);
}

done();
