// test-admin-names.js
//
// /give reaches every item and /spawn every actor in the load order.
//
// Patrick, 27 September: "/give is an admin/tester command I should be able
// /give any item I like and /span any npc I like not just animals but trolls,
// giants, skeletons, etc".
//
// This runs the REAL addThing, buildThings, buildBeasts, findIn, findThing,
// findBeast and byFormId out of game/gamemode.js over the REAL ITEM_NAMES,
// ADMIN_NAMES, RECIPES_BY_ID and ITEMS blocks, and asks for the names Patrick
// named. The other tables (ores, plants, hunts) stand in empty: what is asked
// here is what the generated block adds.
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8')).split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function cut(from, to) {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a);
  return a < 0 || b < 0 ? null : src.slice(a, b + to.length);
}

const recipes = cut('  var RECIPES_BY_ID = {', ';\n');
const names = cut('  var ITEM_NAMES = {', ';\n');
const admin = (cut('  var ADMIN_ITEMS = {', ';\n') || '') + '\n' + (cut('  var ADMIN_ACTORS = {', ';\n') || '');
const itemsLine = (src.match(/^const ITEMS = .*;$/m) || [null])[0];
const lookups = cut('  function addThing(idx, name, desc) {', '\n  function holdTownOf(');
yes('ADMIN_ITEMS and ADMIN_ACTORS are in gamemode.js', /var ADMIN_ITEMS = \{/.test(admin) && /var ADMIN_ACTORS = \{/.test(admin));
yes('and the lookups, the recipe table, ITEM_NAMES and ITEMS', !!(recipes && names && itemsLine && lookups));

if (admin && recipes && names && itemsLine && lookups) {
  const logged = [];
  // Only these resolve, the way idOf answers 0 for a record the load order lacks.
  const known = { '23aba:Skyrim.esm': 1, '12eb7:Skyrim.esm': 1, '800:Dawnguard.esm': 1 };
  const box = { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); },
                idOf: function (d) { return known[d] ? 0xff : 0; } };
  vm.createContext(box);
  vm.runInContext(itemsLine.replace(/^const /, 'var ') + '\n' +
    'var ORES_BY_BASE = {}, HARVESTS_BY_BASE = {}, CROPS_BY_BASE = {}, FISH_BY_BASE = {}, HUNTS_BY_BASE = {}, GAME_BY_BASE = {};\n' +
    'var thingIndex = null, beastIndex = null;\n' + recipes + '\n' + names + '\n' + admin + '\n' +
    lookups.replace(/\n  function holdTownOf\($/, ''), box);

  const give = function (w) { return box.findThing(String(w).toLowerCase()); };
  const spawn = function (w) { return box.findBeast(String(w).toLowerCase()); };
  const size = function (o) { return Object.keys(o).length; };

  yes('the tables built without an error: ' + (logged.join('; ') || 'nothing logged'), logged.length === 0);
  yes('ADMIN_ITEMS holds thousands of items (' + size(box.ADMIN_ITEMS) + ')', size(box.ADMIN_ITEMS) > 5000);
  yes('ADMIN_ACTORS holds the actors (' + size(box.ADMIN_ACTORS) + ')', size(box.ADMIN_ACTORS) > 1000);

  [['troll', 'Troll', '23aba:Skyrim.esm'], ['frost troll', 'Frost Troll', '23abb:Skyrim.esm'],
   ['giant', 'Giant', '23aae:Skyrim.esm'], ['skeleton', 'Skeleton', '2d1de:Skyrim.esm'],
   ['draugr', 'Draugr', '1fe76:Skyrim.esm'], ['mammoth', 'Mammoth', '23ab4:Skyrim.esm']
  ].forEach(function (c) {
    const hit = spawn(c[0]);
    yes('/spawn ' + c[0] + ' finds ' + c[1] + ' ' + c[2], !!hit && hit.desc === c[2] && hit.name === c[1]);
  });
  const dragon = spawn('dragon');
  yes('/spawn dragon finds a Dragon', !!dragon && dragon.name === 'Dragon' && /:Skyrim\.esm$/.test(dragon.desc || ''));

  [['gold', 'Gold', 'f:Skyrim.esm'], ['iron sword', 'Iron Sword', '12eb7:Skyrim.esm'],
   ['Iron Ingot', 'Iron Ingot', '5ace4:Skyrim.esm']].forEach(function (c) {
    const hit = give(c[0]);
    yes('/give ' + c[0] + ' finds ' + c[2], !!hit && hit.desc === c[2] && hit.name === c[1]);
  });
  const book = give('a game at dinner');
  yes('/give reaches a book no recipe names', !!book && book.desc === '1afc4:Skyrim.esm');

  // By form id, only after the names and only with a digit in it.
  const byId = box.byFormId;
  yes('a bare form id is a Skyrim.esm record', (byId('23aba') || {}).desc === '23aba:Skyrim.esm');
  yes('0x in front works too', (byId('0x23aba') || {}).desc === '23aba:Skyrim.esm');
  yes('a lower-cased master is spelled the load order\'s way', (byId('800:dawnguard.esm') || {}).desc === '800:Dawnguard.esm');
  yes('an id the load order lacks is not a hit', byId('99999') === null);
  yes('a word made of hex letters is never taken for an id', byId('bed') === null && byId('cab') === null);
  yes('a name still wins over an id', (spawn('troll') || {}).desc === '23aba:Skyrim.esm');
}

// The wiring in the command itself.
{
  yes('the name is looked up first and the form id only when it finds nothing',
      /var hit = \(word === '\/give'\) \? findThing\(want\) : findBeast\(want\);\s*if \(!hit\.desc\) \{ hit = byFormId\(want\) \|\| hit; \}/.test(src));
  yes('/give takes up to a hundred thousand, /spawn still forty',
      /var most = \(word === '\/give'\) \? 100000 : 40;/.test(src));
  yes('and both stay behind the playtester gate',
      /if \(word === '\/give' \|\| word === '\/spawn'\) \{\s*if \(!isPlaytester\(profileId\)\) \{/.test(src));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
