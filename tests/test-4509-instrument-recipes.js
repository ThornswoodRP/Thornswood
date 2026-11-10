// test-4509-instrument-recipes.js
//
// #4509. Patrick, 9 November 2026, option A on the instruments card: the
// flute, lute and drum people own are Skyrim's own (MISC daba7, dabab, daba9),
// which cannot be equipped, not PlayFluteLuteDrum.esp's weapons (d62, 1d9b,
// 287f), whose equip and playing are record scripts our client never runs.
// Until now nothing in the load order made Skyrim's three: the only recipes
// were PlayFluteLuteDrum.esp's, which turn them into the weapons.
//
// This holds the content plugin's builder to making them:
//
//   I  scripts/mods/Add-ContentRecords.py names Skyrim's three by their own
//      form ids, and writes a woodworking recipe for each, in the records it
//      writes from its own numbers, beside the ladle's.
//   F  the three recipes' form ids are the plugin's own, in the range the
//      bench trades' tools took (0x501B000 on), and no other name in the
//      tool has the same number.
//
// The rebuilt plugin and the tables built from it come with the box rebuild
// (docs/guide/make-a-change.md): a builder change merges on its own first.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const tool = fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Every NAME = 0x... at the start of a line, as numbers.
const consts = {};
const byValue = {};
const re = /^([A-Z][A-Z0-9_]*) = 0x([0-9A-Fa-f]+)\b/gm;
let m;
while ((m = re.exec(tool)) !== null) {
  const v = parseInt(m[2], 16);
  consts[m[1]] = v;
  (byValue[v] = byValue[v] || []).push(m[1]);
}

// The records the tool writes from its own numbers.
const start = tool.indexOf('def thornswood_records(');
const end = start < 0 ? -1 : tool.indexOf('\ndef ', start + 1);
const body = start < 0 ? '' : tool.slice(start, end < 0 ? undefined : end);
yes('the tool has thornswood_records, where its own recipes are written', body.length > 0);

const INSTRUMENTS = [
  { key: 'FLUTE', name: 'Flute', id: 0xDABA7 },
  { key: 'LUTE', name: 'Lute', id: 0xDABAB },
  { key: 'DRUM', name: 'Drum', id: 0xDABA9 }
];

// ------------------------------------------------------------------ I
INSTRUMENTS.forEach(function (x) {
  yes('I1 ' + x.key + ' is Skyrim\'s own ' + x.name + ', 0x' + x.id.toString(16),
      consts[x.key] === x.id);
  const call = new RegExp('cobj\\(RECIPE_' + x.key + ", 'ThornswoodRecipeInstrument" + x.name +
                          "', \\[[^\\]]+\\],\\s*" + x.key + ', WOODWORKING_KEYWORD\\)');
  yes('I2 thornswood_records writes ThornswoodRecipeInstrument' + x.name + ', making the ' + x.name +
      ' at the woodworking bench', call.test(body));
});

// ------------------------------------------------------------------ F
INSTRUMENTS.forEach(function (x) {
  const v = consts['RECIPE_' + x.key];
  yes('F1 RECIPE_' + x.key + ' is the plugin\'s own, from 0x501B000 on',
      typeof v === 'number' && v >= 0x501B000 && v <= 0x501BFFF);
  yes('F2 and no other name in the tool has its number',
      typeof v === 'number' && byValue[v].length === 1);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
