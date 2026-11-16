// tests/test-6237-character.js
//
// The restore rehearsal's character check (scripts/bot/character.js) on a
// world kept by plugin (#6237): a saved id is "801:Sword.esp" and a made
// bottle's or enchantment's id is "made", where the server sends numbers.
//
// HOW. Always:
//   1. Each id in an inventory entry becomes the number the server sends for
//      it under the server's load order: a full plugin's, a light plugin's
//      (FE space), a runtime form's number kept as it is.
//   2. A made bottle's and a made enchantment's id are worked out again from
//      their effects the way the engine does (Inventory.cpp, FNV-1a over the
//      canonical text); the three expected numbers were printed by that C++
//      compiled on its own with fmt on 16 Nov 2026.
//   3. An entry whose plugin is not loaded is refused by name.
// With THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI (a mongod that
// takes writes to thornswood-wtestc): characters() reads a server whose
// settings say MongoDB out of the database and leaves no copy behind;
// without them that prints SKIP.
// Any platform. A second.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const c = require('../scripts/bot/character.js');

let pass = 0;
let fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

// Skyrim.esm full 0, Beards.esl light 0, Update.esm full 1, Sword.esp full 2.
const table = {
  'skyrim.esm': { full: true, index: 0 },
  'beards.esl': { full: false, index: 0 },
  'update.esm': { full: true, index: 1 },
  'sword.esp': { full: true, index: 2 }
};

// ---- 1. ids ------------------------------------------------------------
const plain = c.numbered({ baseId: '801:Sword.esp', count: 1, poisonId: '827:Beards.esl', enchantmentId: 'f:Skyrim.esm' }, table);
yes('a full plugin\'s id is its index and local id', plain.baseId === 0x02000801);
yes('a light plugin\'s id is in FE space', plain.poisonId === 0xfe000827);
yes('a master\'s id is its own', plain.enchantmentId === 0x0000000f);
yes('a number is kept as it is', c.numbered({ baseId: 0xff000456, count: 2 }, table).baseId === 0xff000456);
yes('an entry is not changed in place', typeof c.numbered({ baseId: '1:Update.esm', count: 1 }, table).baseId === 'number');

// ---- 2. made ids -------------------------------------------------------
const bottle = c.numbered({
  baseId: 'made', count: 2,
  made: { name: 'Sword Oil', poison: false, effects: [
    { effectId: '3eb15:Skyrim.esm', magnitude: 10, area: 0, duration: 30 },
    { effectId: '812:Sword.esp', magnitude: 2.5, area: 0, duration: 60 }] }
}, { 'skyrim.esm': { full: true, index: 0 }, 'sword.esp': { full: true, index: 1 } });
yes('a made bottle\'s id is the engine\'s hash of its effects, read by plugin (4286948520)', bottle.baseId === 4286948520);
yes('and its effects are numbers', bottle.made.effects[1].effectId === 0x01000812);
yes('a made enchantment\'s id is the engine\'s hash (4291194218)', c.madeId(c.canonicalEnchantment({ weapon: true, effects: [
  { effectId: 0xfe001813, magnitude: 5, area: 0, duration: 1 },
  { effectId: 0x3eb16, magnitude: 12.34000015258789, area: 15, duration: 0 }] })) === 4291194218);
yes('a poison with a name past ASCII hashes its UTF-8 (4293412693)', c.madeId(c.canonicalMade({ name: 'Ælfric\'s Bane', poison: true, effects: [
  { effectId: 0x3eb15, magnitude: 10, area: 0, duration: 30 },
  { effectId: 0x01000812, magnitude: 2.5, area: 0, duration: 60 }] })) === 4293412693);

// ---- 3. a plugin that is not loaded -------------------------------------
let said = '';
try { c.numbered({ baseId: '801:Gone.esp', count: 1 }, table); } catch (e) { said = e.message; }
yes('an id from a plugin not loaded is refused by name', /Gone\.esp/.test(said));

// ---- with a MongoDB --------------------------------------------------------
const shell = process.env.THORNSWOOD_TEST_MONGOSH;
const uri = process.env.THORNSWOOD_TEST_MONGO_URI;
if (!shell || !uri || !fs.existsSync(shell)) {
  console.log('SKIP  reading a character out of MongoDB: set THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-6237c-'));
  const uriFile = path.join(tmp, 'test.uri');
  fs.writeFileSync(uriFile, uri);
  const db = 'thornswood-wtestc';
  const dbUri = uri.replace(/\/\?/, '/' + db + '?');
  const run = (js) => childProcess.spawnSync(shell, ['--quiet', dbUri, '--eval', js], { encoding: 'utf8' });
  try {
    run('db.dropDatabase(); db.changeForms.insertMany([{ formDesc: "a01", profileId: 5001, recType: 1, isDeleted: false, inv: { entries: [{ baseId: "f:Skyrim.esm", count: 3 }] } }, { formDesc: "a02", profileId: 7, isDeleted: true }])');
    process.env.THORNSWOOD_MONGOSH = shell;
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('thornswood-world-')).length;
    const all = c.characters(tmp, { databaseDriver: 'mongodb', databaseName: db, databaseUriFile: uriFile });
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('thornswood-world-')).length;
    yes('characters() reads a MongoDB world out and finds the living character', all.length === 1 && all[0].profileId === 5001 && all[0].file === 'a01.json');
    yes('with its inventory as kept, by plugin', all[0].form.inv.entries[0].baseId === 'f:Skyrim.esm');
    yes('and leaves no copy of the world behind', after === before);
    let bad = '';
    try { c.characters(tmp, { databaseDriver: 'mongodb', databaseName: db, databaseUriFile: path.join(tmp, 'none.uri') }); } catch (e) { bad = e.message; }
    yes('a world it cannot read out is said, not read as empty', /could not be read out/.test(bad));
  } finally {
    run('db.dropDatabase()');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
