// test-1007-worldspaces.js
//
// #1007. DATA.worldspaces (game/data/data.json, installed as the DATA line of
// game/gamemode.js by scripts/dev/Install-GamemodeConsts.js) is the set
// resolveArrival and the stuck and arrival code read as "outdoors". It listed
// 3c, 1691d and 1b44a under Dragonborn.esm beside the Skyrim.esm entries with
// the same low ids. Measured on 5 October against the Main install's load
// order (101 plugins): no WRLD record in it has any of those three descs.
// Dragonborn.esm carries overrides of Skyrim.esm's Tamriel, WindhelmWorld and
// CWTestHold, which are 3c, 1691d and 1b44a:Skyrim.esm, and the old recovery
// pipeline counted the overrides as worldspaces of their own. The fourth the
// issue named, 1c0b2:Dragonborn.esm, is a WRLD record Dragonborn.esm defines,
// DLC2ApocryphaWorld, and it stays.
//
// Since #1896 the list is every WRLD record of the load order, read out of
// the plugins by scripts/dev/Build-WorldspaceTable.js, and
// tests/test-1896-worldspaces.js holds it to the measured table and reads the
// plugins again. This holds what #1007 was about: the three overrides stay
// out and the records Dragonborn.esm defines stay in.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'data.json'), 'utf8'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const m = require('./gamemode-tables.js').lineOf(gm, 'DATA');
let DATA = null;
try { DATA = m ? JSON.parse(m[1]) : null; } catch (e) { DATA = null; }
const ws = data.worldspaces || [];
yes('the gamemode\'s DATA line holds the same worldspaces as data.json (' + ws.length + ')',
  !!DATA && JSON.stringify(DATA.worldspaces) === JSON.stringify(ws));
yes('no entry is listed twice', new Set(ws).size === ws.length);
for (const d of ['3c:Dragonborn.esm', '1691d:Dragonborn.esm', '1b44a:Dragonborn.esm']) {
  yes(d + ', an override of ' + d.replace('Dragonborn', 'Skyrim') + ' and no WRLD record of its own, is not listed',
    ws.indexOf(d) < 0 && ws.indexOf(d.replace('Dragonborn', 'Skyrim')) >= 0);
}
yes('Solstheim and Apocrypha, the WRLD records Dragonborn.esm defines, are listed',
  ws.indexOf('800:Dragonborn.esm') >= 0 && ws.indexOf('1c0b2:Dragonborn.esm') >= 0);
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
