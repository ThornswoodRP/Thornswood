'use strict';
// test-2792-terms-game-files.js
//
//     node tests\test-2792-terms-game-files.js
//
// The terms page says exactly what of Bethesda's Thornswood hands on, and
// since #2827 that is nothing. Issues #2792 and #2827.
//
// WHY THIS EXISTS. Until 19 October terms.md said "Thornswood ships no game
// files", while every pack and the installer carried Data\Interface\
// startmenu.swf, Skyrim's own interface file edited (#2177), and the notice
// board and drop box meshes, built from pieces of Skyrim's own (#2502). The
// page was written before those shipped, and nothing compared it with the
// pack list. Patrick picked on 19 Oct to make the page exact (#2792, option
// 1), and then to stop shipping the three and have the launcher make them
// from each person's own game (#2827, option 2). This holds the page to the
// pack list from now on:
//
//   1. no file Ship-Rules.ps1 $ShipOursFiles ships has a register entry
//      (records\asset-provenance.json) that says Bethesda made it, or that it
//      was built from Bethesda's;
//   2. the three the launcher makes from the game are not in $ShipOursFiles,
//      are in $ShipMadeFromGame, and the register says so;
//   3. the page says Thornswood ships no game files, and names each file
//      made from the game, so nobody reads a file in their game folder as
//      one Thornswood handed them;
//   4. the page and the credits page carry the line Bethesda's terms for
//      mods ask for (Creation Kit licence 2.B);
//   5. the checks catch a shipped Bethesda file and a page that no longer
//      says none ships, on planted copies.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

const ROOT = REPO_DIR;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n'); }
  catch (e) { return null; }
}

// A Ship-Rules list, its comments taken out first: they hold apostrophes
// ("Daedric Online's") that would pair with the quotes around the paths.
function shipList(text, name) {
  const m = new RegExp('^\\$' + name + ' = @\\(([\\s\\S]*?)^\\)', 'm').exec(text || '');
  if (!m) return [];
  const body = m[1].split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
  return (body.match(/'[^']+'/g) || []).map((q) => q.slice(1, -1));
}

const NOTICE = 'THIS MOD IS NOT MADE, GUARANTEED OR SUPPORTED BY ZENIMAX OR ITS AFFILIATES.';
const NONE = 'Thornswood ships no game files.';
function flat(t) { return (t || '').replace(/\s+/g, ' '); }

// Each finding is one line saying what is wrong.
function audit(reg, ships, made, terms) {
  const bad = [];
  const shipped = (reg.assets || []).filter((a) => {
    const m = /^game\/ours\/(Data\/.+)$/.exec(a.path || '');
    return m && ships.indexOf(m[1].split('/').join('\\')) >= 0;
  });
  for (const a of shipped) {
    if (/Bethesda/.test(a.creator || '') || /^Skyrim's own /.test(a.source || '')) {
      bad.push(a.path + ': ships, and the register says it is Bethesda\'s or built from Bethesda\'s');
    }
  }
  for (const rel of made) {
    if (ships.indexOf(rel) >= 0) bad.push(rel + ': made from the person\'s game, and $ShipOursFiles still ships it');
    const name = rel.split('\\').pop();
    if (flat(terms).indexOf(name) < 0) bad.push(rel + ': made from the person\'s game, and terms.md does not name ' + name);
  }
  if (flat(terms).indexOf(NONE) < 0) bad.push('terms.md does not say "' + NONE + '"');
  if (/hands on \w+ of the game's own files/.test(flat(terms))) bad.push('terms.md still says it hands on some of the game\'s own files');
  return bad;
}

const reg = JSON.parse(read('records/asset-provenance.json') || '{}');
const rules = read('scripts/release/Ship-Rules.ps1');
const ships = shipList(rules, 'ShipOursFiles');
const made = shipList(rules, 'ShipMadeFromGame');
const terms = read('site/data/site/terms.md');
const credits = read('site/data/site/credits.md');
yes('the register, $ShipOursFiles, $ShipMadeFromGame, terms.md and credits.md read', reg.version === 1 && ships.length > 0 && made.length === 3 && terms !== null && credits !== null);

const bad = audit(reg, ships, made, terms);
yes('nothing shipped is Bethesda\'s, the three made from the game do not ship, and terms.md says no game files ship and names the three' + (bad.length ? ': ' + bad.join('; ') : ''), bad.length === 0);
const registered = (reg.notInRepo || []).filter((a) => a.status === 'made-from-game' && a.record === 'scripts/release/Ship-Rules.ps1#ShipMadeFromGame');
const paths = [].concat.apply([], registered.map((a) => a.paths || []));
yes('the register records each of the three as made from the game, by $ShipMadeFromGame', made.every((m) => paths.indexOf(m) >= 0));
yes('terms.md carries the notice line Bethesda\'s terms for mods ask for', flat(terms).indexOf(NOTICE) >= 0);
yes('and so does credits.md', flat(credits).indexOf(NOTICE) >= 0);

// ----------------------------------------------------- the checks bite --
const planted = JSON.parse(JSON.stringify(reg));
planted.assets.push({ path: 'game/ours/Data/Interface/map.swf', creator: 'Bethesda Game Studios', source: "Skyrim's own interface\\map.swf, edited" });
let r = audit(planted, ships.concat(['Data\\Interface\\map.swf']), made, terms);
yes('a shipped Bethesda file is caught', r.some((b) => b.indexOf('map.swf: ships') >= 0));
r = audit(reg, ships.concat([made[0]]), made, terms);
yes('a file made from the game that ships again is caught', r.some((b) => /still ships it/.test(b)));
r = audit(reg, ships, made, flat(terms).replace(NONE, 'Thornswood hands on one of the game\'s own files.'));
yes('a page that no longer says none ships is caught', r.some((b) => /does not say "Thornswood ships no game files/.test(b)) && r.some((b) => /still says it hands on/.test(b)));
r = audit(reg, ships, made, terms.split('dropbox01.nif').join('the box'));
yes('a page that stops naming one of the three is caught', r.some((b) => /does not name dropbox01\.nif/.test(b)));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
