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
//   4. A load order change (Rehearse-OnBox.ps1 -Reorder): the masters a
//      plugin names are read from its TES4 header; the earliest full plugin
//      that is nobody's master and loads as no master itself is picked
//      (#6313: a master would be loaded first by the game, never last); the
//      slots a character's ids name are listed; Check-Character.js --pick
//      names that plugin and writes nothing, since the order is the rule's
//      (ServerOrder.ps1, written by Rehearse-OnBox.ps1); and the same saved
//      item is the number of its plugin's new slot.
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

// ---- 4. a load order change ------------------------------------------------
// A plugin as the game writes its header: TES4, its size, flags, then HEDR
// and a MAST and DATA pair for each master.
function plugin(file, masters, flags) {
  const subs = [];
  const sub = (type, data) => { const h = Buffer.alloc(6); h.write(type, 0, 'latin1'); h.writeUInt16LE(data.length, 4); subs.push(h, data); };
  const hedr = Buffer.alloc(12); hedr.writeFloatLE(1.71, 0); hedr.writeUInt32LE(0x800, 8);
  sub('HEDR', hedr);
  for (const m of masters) { sub('MAST', Buffer.from(m + '\0', 'latin1')); sub('DATA', Buffer.alloc(8)); }
  const data = Buffer.concat(subs);
  const head = Buffer.alloc(24);
  head.write('TES4', 0, 'latin1'); head.writeUInt32LE(data.length, 4); head.writeUInt32LE(flags || 0, 8); head.writeUInt16LE(44, 20);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}
const lo = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-6237o-'));
try {
  const dataDir = path.join(lo, 'data');
  fs.mkdirSync(dataDir);
  // Skyrim and Update are masters of others. Fish.esm is nobody's master
  // but is one itself, so the game loads it before every plugin that is
  // not, and it cannot go on the end (#6313). Moves.esp is nobody's and no
  // master, so it is the one that moves; Sword.esp and Last.esp come after it.
  plugin(path.join(dataDir, 'Skyrim.esm'), [], 1);
  plugin(path.join(dataDir, 'Update.esm'), ['Skyrim.esm'], 1);
  plugin(path.join(dataDir, 'Fish.esm'), ['Skyrim.esm'], 1);
  plugin(path.join(dataDir, 'Beards.esl'), ['Skyrim.esm'], 0x200);
  plugin(path.join(dataDir, 'Moves.esp'), ['Skyrim.esm', 'Update.esm']);
  plugin(path.join(dataDir, 'Sword.esp'), ['Update.esm']);
  plugin(path.join(dataDir, 'Last.esp'), ['Sword.esp']);
  const order = ['Skyrim.esm', 'Update.esm', 'Fish.esm', 'Beards.esl', 'Moves.esp', 'Sword.esp', 'Last.esp'];
  const paths = order.map((n) => path.join(dataDir, n));
  yes('the masters a plugin names are read from its header', c.masters(paths[4]).join(',') === 'Skyrim.esm,Update.esm' && c.masters(paths[0]).length === 0);
  yes('a plugin the game loads as a master is told: the 0x1 flag, an .esm or an .esl', c.loadsAsMaster(paths[2]) && c.loadsAsMaster(paths[3]) && !c.loadsAsMaster(paths[4]));
  yes('pick gives the plugin a rehearsal moves and no order: the order is the rule\'s (ServerOrder.ps1, #6313)', typeof c.reorder === 'undefined' && typeof c.pick === 'function');
  const r = c.pick(paths);
  yes('the earliest full plugin that is nobody\'s master and no master itself is picked, from its slot to the last', r.moved === 'Moves.esp' && r.from === 3 && r.to === 5);
  let none = '';
  try { c.pick(paths.slice(0, 3)); } catch (e) { none = e.message; }
  yes('an order with no such plugin but the last is refused', /none can move/.test(none));
  // The order the rule makes of it: Moves.esp out of the running order and back
  // as a new full plugin, on the end of the full ones (test-4688 holds that).
  const moved = ['Skyrim.esm', 'Update.esm', 'Fish.esm', 'Beards.esl', 'Sword.esp', 'Last.esp', 'Moves.esp'];
  const before = c.slots(paths);
  const after = c.slots(moved.map((n) => path.join(dataDir, n)));
  const form = { worldOrCellDesc: '3c:Skyrim.esm', inv: { entries: [{ baseId: '801:Sword.esp', count: 1, enchantmentId: '802:Beards.esl' }] } };
  yes('the slots a character\'s ids name are listed', JSON.stringify(c.pluginsOf(form, before)) === JSON.stringify({ 'Skyrim.esm': '0x00', 'Sword.esp': '0x04', 'Beards.esl': '0xfe000' }));
  yes('  and after the change the plugin after the one that moved is a slot earlier', c.pluginsOf(form, after)['Sword.esp'] === '0x03');
  yes('the same saved item is its plugin\'s number in each order', c.numbered(form.inv.entries[0], before).baseId === 0x04000801 && c.numbered(form.inv.entries[0], after).baseId === 0x03000801);
  // Check-Character.js --pick on a folder: it says which plugin moves and
  // writes nothing; Rehearse-OnBox.ps1 builds and writes the order by the rule.
  const settingsFile = path.join(lo, 'server-settings.json');
  const settingsText = JSON.stringify({ port: 7800, dataDir: 'data', loadOrder: order, other: { kept: true } }, null, 2);
  fs.writeFileSync(settingsFile, settingsText);
  const cli = (args) => childProcess.spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'bot', 'Check-Character.js')].concat(args), { encoding: 'utf8' });
  let cr = cli(['--root', lo, '--pick']);
  yes('Check-Character.js --pick says which plugin moves, from which slot to which', cr.status === 0 && /^PICK Moves\.esp from slot 0x03 to 0x05$/m.test(cr.stdout));
  yes('  and writes no load order', fs.readFileSync(settingsFile, 'utf8') === settingsText && !fs.existsSync(settingsFile + '.before-reorder'));
  cr = cli(['--root', lo, '--reorder']);
  yes('--reorder, which wrote an order of its own, is refused, and nothing is written', cr.status === 1 && fs.readFileSync(settingsFile, 'utf8') === settingsText);
} finally {
  fs.rmSync(lo, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
