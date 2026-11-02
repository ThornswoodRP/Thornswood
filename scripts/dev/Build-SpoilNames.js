// Build-SpoilNames.js
//
// #3163. Writes the names of every food that spoils into the spoil block of
// game\data\food-groups.json, and the FOOD_GROUPS line of game\gamemode.js to
// match it.
//
// Food carries its days left on its name, "Venison (6 days left)", so the
// server has to know what a plain piece is called before it can name it. The
// records do not say: Skyrim.esm's names are string ids into the game's own
// string files, which the server never reads. game\data\food.json does, from
// the plugin that wins each record (scripts\dev\Build-FoodTable.js), so the
// names come from there. Which foods spoil is the spoil block's own rule,
// written by hand: days by group, keeps for the ones in those groups that
// never spoil, extra for the ones outside them that do. This only fills
// names, for every record that rule says spoils.
//
// Run from the repository folder after either JSON file changes:
//
//   node scripts\dev\Build-SpoilNames.js
//
// It stops, changing nothing, when a food that spoils has no readable name in
// food.json. tests\test-3163-spoilage.js holds the two files to each other.
'use strict';
const fs = require('fs');
const path = require('path');
const gamemodeSource = require('./gamemode-source.js');

const ROOT = path.join(__dirname, '..', '..');
const GROUPS_FILE = path.join(ROOT, 'game', 'data', 'food-groups.json');
const FOOD_FILE = path.join(ROOT, 'game', 'data', 'food.json');
const GAMEMODE = path.join(ROOT, 'game', 'gamemode');

const groups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
const food = JSON.parse(fs.readFileSync(FOOD_FILE, 'utf8')).items;
const spoil = groups.spoil;
if (!spoil || typeof spoil !== 'object' || !spoil.days) {
  console.log('STOP. food-groups.json has no spoil block with days to read.');
  process.exit(1);
}

function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

/** The days a record keeps, by the spoil block's rule, or 0 for never. */
function lifeOf(desc) {
  if (own(spoil.keeps || {}, desc)) { return 0; }
  if (own(spoil.extra || {}, desc)) { return Number(spoil.extra[desc]) || 0; }
  const group = own(groups.items, desc) ? groups.items[desc] : '';
  if (group && own(spoil.days, group)) { return Number(spoil.days[group]) || 0; }
  // A fine dish is in its plain dish's group (#2906).
  const fine = (groups.quality && groups.quality.fine) || {};
  for (const plain in fine) {
    if (own(fine, plain) && fine[plain] === desc) { return lifeOf(plain); }
  }
  return 0;
}

const wanted = new Set(Object.keys(groups.items));
Object.keys(spoil.extra || {}).forEach(function (d) { wanted.add(d); });
Object.values((groups.quality && groups.quality.fine) || {}).forEach(function (d) { wanted.add(d); });

const names = {};
const missing = [];
Array.from(wanted).sort().forEach(function (desc) {
  if (!lifeOf(desc)) { return; }
  const name = own(food, desc) ? String(food[desc].name || '') : '';
  if (!/^[ -~]+$/.test(name) || !/[A-Za-z]/.test(name)) { missing.push(desc); return; }
  names[desc] = name;
});
if (missing.length) {
  console.log('STOP. These foods spoil and food.json has no readable name for them: ' + missing.join(', '));
  console.log('Give them a name in food.json (Build-FoodTable.js), or a keep in the spoil block.');
  process.exit(1);
}

spoil.names = names;
const text = JSON.stringify(groups);
fs.writeFileSync(GROUPS_FILE, text);

const CR = String.fromCharCode(13);
const gm = gamemodeSource.read(GAMEMODE);
const eol = gm.indexOf(CR + '\n') !== -1 ? CR + '\n' : '\n';
const lines = gm.split(eol);
let at = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('const FOOD_GROUPS = ') === 0) { at = i; break; }
}
if (at < 0) {
  console.log('STOP. game\\gamemode.js has no const FOOD_GROUPS line to write.');
  process.exit(1);
}
lines[at] = 'const FOOD_GROUPS = ' + text + ';';
gamemodeSource.write(GAMEMODE, lines.join(eol));
console.log('Wrote ' + Object.keys(names).length + ' names of foods that spoil into food-groups.json and FOOD_GROUPS.');
