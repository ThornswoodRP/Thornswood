// test-6714-tp-mines.js
//
// #6714: on Main playtest 6 a tester's /tp to Dead Drop Mine and to Damphall
// Mine failed. This asks the real /tp lookup, over the real content tables,
// what it answers for each name, and prints the table rows behind it, so the
// cause can be read off the output.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('../../tests/gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function table(name) {
  const re = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm');
  const m = re.exec(src);
  return m ? JSON.parse(m[1]) : null;
}

const NAME = table('BUILDING_NAME');
const BYDOOR = table('BUILDING_BY_DOOR');
yes('the named building table and its doors are in the gamemode', NAME !== null && BYDOOR !== null);

const WANTED = ['dead drop mine', 'damphall mine'];

if (NAME && BYDOOR) {
  // Every building whose name holds a word of what was asked, and its doors.
  for (const want of WANTED) {
    const word = want.split(' ')[0];
    const rows = Object.keys(NAME).filter(function (b) { return String(NAME[b]).toLowerCase().indexOf(word) !== -1; });
    console.log('INFO  buildings with "' + word + '" in the name: ' + rows.length);
    for (const b of rows) {
      const doors = Object.keys(BYDOOR).filter(function (d) { return BYDOOR[d] === b; });
      console.log('INFO    ' + b + ' "' + NAME[b] + '" doors: ' + doors.length + ' ' + doors.slice(0, 8).join(' '));
    }
  }

  const a = src.indexOf('  function places() {');
  const b = src.indexOf('\n  function round1(', a);
  const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
  yes('the /tp lookup block is in the gamemode', !!block);
  const dataLine = src.split('\n').find(function (l) { return l.indexOf('const DATA = ') === 0; });
  const DATA = JSON.parse(dataLine.slice('const DATA = '.length).replace(/;\s*$/, ''));

  if (block) {
    // A world where every door resolves and stands in the street, so what
    // comes back is the lookup's answer and nothing about a loaded cell.
    const api = new Function(
      'PASSAGES', 'HALL', 'BUILDING_BY_DOOR', 'BUILDING_NAME', 'DATA',
      'idOf', 'mp', 'log', 'Object', 'String',
      block + '\nreturn { findPlace: findPlace, index: buildNamedDoors };')(
      {}, { desc: 'hall:Y.esp', pos: [0, 0, 0], rot: [0, 0, 0] },
      BYDOOR, NAME, DATA,
      function () { return 1; },
      { get: function (id, key) { return key === 'pos' ? [1, 2, 3] : (key === 'worldOrCellDesc' ? '3c:Skyrim.esm' : undefined); } },
      function () { }, Object, String);
    const idx = api.index();
    for (const want of WANTED) {
      const keys = Object.keys(idx).filter(function (k) { return k.indexOf(want.split(' ')[0]) !== -1; });
      console.log('INFO  /tp index keys for "' + want + '": ' + JSON.stringify(keys));
      const r = api.findPlace(want);
      console.log('INFO  /tp ' + want + ' answers: ' + JSON.stringify(r));
      yes('/tp ' + want + ' finds a place to stand', !!r.where);
    }
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
