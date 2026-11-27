// test-4509-instrument-stock.js
//
// #4509. Patrick, 9 November 2026, option A on the instruments card: the
// flute, lute and drum people own are Skyrim's own (MISC daba7, dabab, daba9),
// which cannot be equipped, not PlayFluteLuteDrum.esp's weapons (d62, 1d9b,
// 287f), whose equip and playing are record scripts our client never runs.
//
// The builders are already on main: Thornswood-Content.esp gets three
// woodworking recipes for Skyrim's own instruments, and Thornswood-Last.esp
// hides PlayFluteLuteDrum.esp's 1838, 2de4 and 2de5, which turned those
// instruments into the weapon forms. This harness holds the tables the box
// builds from them, the ones the server reads, to that outcome:
//
//   R  game/gamemode-tables/RECIPES_BY_ID.json: no profession's recipe makes
//      a weapon form, and the Woodwright's three recipes make Skyrim's own
//      Flute, Lute and Drum.
//   M  game/gamemode-tables/MERCHANT_STAGE.json: no merchant role buys, sells
//      or stocks a weapon form.
//
// Those tables are not committed (#6345). The gate lays the newest box
// build before it runs this. A checkout without them fails and says so.
//
// Read only.
'use strict';
const fs = require('fs');
const T = require('./gamemode-tables.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const WEAPON = /^(d62|1d9b|287f):PlayFluteLuteDrum\.esp$/i;
const OWN = [
  { name: 'Flute', out: 'daba7:Skyrim.esm' },
  { name: 'Lute', out: 'dabab:Skyrim.esm' },
  { name: 'Drum', out: 'daba9:Skyrim.esm' }
];

function load(name) {
  if (!fs.existsSync(T.file(name))) { return null; }
  return T.table(name);
}

// Every string anywhere in a value that names a weapon form, with its path.
function weaponsIn(value, at, found) {
  if (typeof value === 'string') { if (WEAPON.test(value.trim())) { found.push(at + ' = ' + value); } return found; }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (WEAPON.test(k)) { found.push(at + '.' + k); }
      weaponsIn(value[k], at + '.' + k, found);
    }
  }
  return found;
}

// ------------------------------------------------------------------ R
const book = load('RECIPES_BY_ID');
yes('R0 ' + T.file('RECIPES_BY_ID') + ' is there (the gate lays the box build)', book !== null);
if (book) {
  const makesWeapon = Object.keys(book).filter(k => WEAPON.test(String(book[k] && book[k].out || '')) && !(book[k] && book[k].nobody));
  yes('R1 no profession\'s recipe makes a weapon form of the flute, lute or drum' +
      (makesWeapon.length ? ' (' + makesWeapon.join(', ') + ')' : ''), makesWeapon.length === 0);
  OWN.forEach(function (x) {
    const rows = Object.keys(book).filter(k => book[k] && book[k].out === x.out && !book[k].nobody);
    yes('R2 a recipe makes Skyrim\'s own ' + x.name + ' (' + x.out + ')', rows.length > 0);
  });
}

// ------------------------------------------------------------------ M
const stage = load('MERCHANT_STAGE');
yes('M0 ' + T.file('MERCHANT_STAGE') + ' is there (the gate lays the box build)', stage !== null);
if (stage) {
  const found = weaponsIn(stage, 'MERCHANT_STAGE', []);
  yes('M1 no merchant buys, sells or stocks a weapon form of the flute, lute or drum' +
      (found.length ? ' (' + found.slice(0, 6).join('; ') + (found.length > 6 ? '; ...' : '') + ')' : ''),
      found.length === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
