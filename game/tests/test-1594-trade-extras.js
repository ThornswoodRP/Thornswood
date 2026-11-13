// test-1594-trade-extras.js
//
// #1594. A trade moves each piece with everything the engine keeps on it
// beside its base and count: the name (a key's or a deed's house, a piece's
// condition, a Master-Woven garment), the enchantment and its charge, a
// poison, a soul. The stack left behind keeps what it had, and so does every
// stack the receiver already holds. A piece arrives not worn.
//
// Driven out of the real trade block over a fake engine whose packs keep
// exactly the fields Inventory::Entry::Serialize keeps in the fork, so a
// field the trade drops is gone here the way it is gone on the server.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), false); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const TRADE = slice(gm, '// ==== thornswood trade ====', '// ==== end thornswood trade ====');
yes('the trade block is in the gamemode', TRADE !== null);
if (TRADE === null) { done(); }

// ------------------------------------------------------------ the engine --
/*
  Inventory::Entry::Serialize (skymp5-server/cpp/server_guest_lib/Inventory.h
  in the fork): baseId and count, then ExtraData's fields. JsonOutputArchive
  leaves a field out when it has no value, and JsonInputArchive reads only
  these names, so this is everything a pack can carry through mp.get and
  mp.set, and nothing else.
*/
const ENTRY_FIELDS = ['baseId', 'count', 'health', 'enchantmentId', 'maxCharge',
  'removeEnchantmentOnUnequip', 'chargePercent', 'name', 'soul', 'poisonId',
  'poisonCount', 'worn', 'wornLeft'];
function asEngineKeeps(inv) {
  const entries = (inv && inv.entries) || [];
  return {
    entries: entries.map(function (e) {
      const out = {};
      ENTRY_FIELDS.forEach(function (f) {
        if (e[f] !== undefined && e[f] !== null) { out[f] = e[f]; }
      });
      return out;
    })
  };
}

const GOLD = 0xf;
const KEY = 0x15494;
const SWORD = 0x12eb7;
const DAGGER = 0x139b6;
const ARROW = 0x1397d;
const RECORDS = {};
RECORDS[GOLD] = { type: 'MISC', name: 'Gold' };
RECORDS[KEY] = { type: 'KEYM', name: 'Key' };
RECORDS[SWORD] = { type: 'WEAP', name: 'Iron Sword' };
RECORDS[DAGGER] = { type: 'WEAP', name: 'Steel Dagger' };
RECORDS[ARROW] = { type: 'AMMO', name: 'Iron Arrow' };

function tradeWorld() {
  const store = {};
  const writes = [];
  const g = {};
  const mp = {
    get: function (id, prop) {
      if (prop === 'onlinePlayers') { return Object.keys(store).map(Number); }
      const p = store[id];
      if (!p) { return undefined; }
      if (prop === 'inventory') { return JSON.parse(JSON.stringify(asEngineKeeps(p.inventory))); }
      return p[prop];
    },
    set: function (id, prop, value) {
      if (prop === 'inventory') {
        writes.push(id);
        store[id].inventory = asEngineKeeps(JSON.parse(JSON.stringify(value)));
        return;
      }
      if (store[id]) { store[id][prop] = value; }
    },
    makeProperty: function () { },
    lookupEspmRecordById: function (baseId) {
      const r = RECORDS[baseId];
      if (!r) { return { record: null }; }
      return { record: { type: r.type, editorId: r.name.replace(/ /g, ''), fields: [{ type: 'FULL', data: r.name }] } };
    }
  };
  const said = [];
  new Function(
    'globalThis', 'mp', 'console', 'setInterval', 'clearInterval', 'guard', 'say', 'notify',
    require('../../tests/fixtures/ordinary-quest-items') + TRADE)(
    g, mp, { log: function () { } }, function () { return 1; }, function () { },
    function (n, f) { return f; }, function (id, line) { said.push([id, line]); }, function () { });
  return {
    trade: g.__thornswoodTrade,
    store: store,
    writes: writes,
    said: said,
    person: function (id, pack) {
      store[id] = { worldOrCellDesc: 'town:X.esm', pos: [0, 0, 0], inventory: asEngineKeeps({ entries: pack }) };
      return id;
    },
    pack: function (id) { return store[id].inventory.entries; },
    gold: function (id) {
      return store[id].inventory.entries.reduce(function (n, e) { return n + (e.baseId === GOLD ? e.count : 0); }, 0);
    }
  };
}

/* The one entry in a pack with exactly these fields, or null. */
function entry(pack, want) {
  const hits = pack.filter(function (e) {
    const ka = Object.keys(e).sort().join(','), kb = Object.keys(want).sort().join(',');
    if (ka !== kb) { return false; }
    return Object.keys(want).every(function (k) { return e[k] === want[k]; });
  });
  return hits.length === 1 ? hits[0] : null;
}

const KEY_HOME = { baseId: KEY, count: 1, name: 'Key to Breezehome' };
const ENCHANTED = { baseId: DAGGER, count: 1, name: 'Steel Dagger of Frost', enchantmentId: 0x4605a,
                    maxCharge: 1500, chargePercent: 62.5, removeEnchantmentOnUnequip: false };
const WORN_DOWN = { baseId: SWORD, count: 1, name: 'Iron Sword (85%)' };

// ------------------------------------------------- 1. the Done when, whole --
attempt('a named key, an enchanted piece and a piece at 85% traded for gold', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [KEY_HOME, ENCHANTED, WORN_DOWN, { baseId: GOLD, count: 10 }]);
  const B = w.person(0xff000002, [{ baseId: GOLD, count: 100 }]);
  yes('the trade opens', w.trade.begin(A, B) === '');
  yes('the key goes on the table', w.trade.add(A, 'Key', 1) === '');
  yes('the dagger goes on the table', w.trade.add(A, 'Steel Dagger', 1) === '');
  yes('the sword goes on the table', w.trade.add(A, 'Iron Sword', 1) === '');
  yes('the gold goes on the table', w.trade.gold(B, 60) === '');
  w.trade.confirm(A);
  yes('both agree and it swaps', w.trade.confirm(B) === '' && !w.trade.tradeOf(A));
  const got = w.pack(B);
  yes('the key arrives with its house on it', !!entry(got, KEY_HOME));
  yes('the enchanted dagger arrives with its name, enchantment, charge and charge left', !!entry(got, ENCHANTED));
  yes('the sword arrives at 85%, not put back to 100%', !!entry(got, WORN_DOWN));
  yes('nothing arrives plain', !got.some(function (e) { return e.baseId !== GOLD && !e.name; }));
  yes('and the giver holds none of the three any more',
      !w.pack(A).some(function (e) { return e.baseId === KEY || e.baseId === DAGGER || e.baseId === SWORD; }));
  yes('the gold crossed the other way and the total holds',
      w.gold(A) === 70 && w.gold(B) === 40 && w.gold(A) + w.gold(B) === 110);
});

// ------------------------------------------- 2. the stack left behind --
attempt('part of a stack is traded', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [
    { baseId: KEY, count: 3, name: 'Key to Honeyside' },
    { baseId: ARROW, count: 20, poisonId: 0x3a5a4, poisonCount: 4 },
    { baseId: SWORD, count: 2, name: 'Iron Sword (40%)', worn: true }
  ]);
  const B = w.person(0xff000002, [{ baseId: GOLD, count: 50 }]);
  w.trade.begin(A, B);
  w.trade.add(A, 'Key', 1);
  w.trade.add(A, 'Iron Arrow', 5);
  w.trade.add(A, 'Iron Sword', 1);
  w.trade.gold(B, 5);
  w.trade.confirm(A); w.trade.confirm(B);
  const left = w.pack(A);
  yes('the two keys left behind keep their house',
      !!entry(left, { baseId: KEY, count: 2, name: 'Key to Honeyside' }));
  yes('the fifteen arrows left behind keep their poison',
      !!entry(left, { baseId: ARROW, count: 15, poisonId: 0x3a5a4, poisonCount: 4 }));
  yes('the sword left behind keeps its condition and is still worn',
      !!entry(left, { baseId: SWORD, count: 1, name: 'Iron Sword (40%)', worn: true }));
  const got = w.pack(B);
  yes('the key that crossed carries the same house',
      !!entry(got, { baseId: KEY, count: 1, name: 'Key to Honeyside' }));
  yes('the five arrows that crossed carry the same poison',
      !!entry(got, { baseId: ARROW, count: 5, poisonId: 0x3a5a4, poisonCount: 4 }));
  yes('the sword that crossed carries its condition and is not worn by somebody who never put it on',
      !!entry(got, { baseId: SWORD, count: 1, name: 'Iron Sword (40%)' }));
});

// --------------------------------- 3. what the receiver already holds --
attempt('the receiver already holds pieces of the same records', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [KEY_HOME, WORN_DOWN, { baseId: ARROW, count: 4 }]);
  const B = w.person(0xff000002, [
    { baseId: GOLD, count: 30 },
    { baseId: KEY, count: 1, name: 'Key to Proudspire Manor' },
    { baseId: SWORD, count: 1 },
    { baseId: SWORD, count: 1, name: 'Iron Sword (85%)', worn: true },
    { baseId: ARROW, count: 10, poisonId: 0x3a5a4, poisonCount: 2 },
    { baseId: ARROW, count: 6 }
  ]);
  w.trade.begin(A, B);
  w.trade.add(A, 'Key', 1);
  w.trade.add(A, 'Iron Sword', 1);
  w.trade.add(A, 'Iron Arrow', 4);
  w.trade.gold(B, 30);
  w.trade.confirm(A); w.trade.confirm(B);
  const got = w.pack(B);
  yes('the key they had still opens their own house',
      !!entry(got, { baseId: KEY, count: 1, name: 'Key to Proudspire Manor' }));
  yes('and the key that came is its own stack, for its own house', !!entry(got, KEY_HOME));
  yes('their plain sword is still one plain sword', !!entry(got, { baseId: SWORD, count: 1 }));
  yes('the sword at 85% they are wearing is still worn, still one, still at 85%',
      !!entry(got, { baseId: SWORD, count: 1, name: 'Iron Sword (85%)', worn: true }));
  yes('and the sword at 85% that came sits beside it, not worn', !!entry(got, WORN_DOWN));
  yes('their poisoned arrows keep their poison and their count',
      !!entry(got, { baseId: ARROW, count: 10, poisonId: 0x3a5a4, poisonCount: 2 }));
  yes('plain arrows land on their plain arrows, the way the engine stacks them',
      !!entry(got, { baseId: ARROW, count: 10 }));
  yes('and their gold, all of it put up, is gone from their pack', w.gold(B) === 0 && w.gold(A) === 30);
});

attempt('the same piece lands on the same stack', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [WORN_DOWN]);
  const B = w.person(0xff000002, [{ baseId: SWORD, count: 2, name: 'Iron Sword (85%)' }]);
  yes('a pile moves', w.trade.moveById(A, B, [[SWORD, 1]]) === true);
  yes('a sword at 85% lands on their two at 85%, one stack of three',
      !!entry(w.pack(B), { baseId: SWORD, count: 3, name: 'Iron Sword (85%)' }) && w.pack(B).length === 1);
});

// ------------------------------- 4. one line over pieces that differ --
attempt('two keys to two houses on one line', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [
    { baseId: KEY, count: 1, name: 'Key to Breezehome' },
    { baseId: KEY, count: 1, name: 'Key to Honeyside' }
  ]);
  const B = w.person(0xff000002, []);
  yes('both move', w.trade.moveById(A, B, [[KEY, 2]]) === true);
  yes('each with its own house',
      !!entry(w.pack(B), { baseId: KEY, count: 1, name: 'Key to Breezehome' }) &&
      !!entry(w.pack(B), { baseId: KEY, count: 1, name: 'Key to Honeyside' }));
  yes('and the giver has no key left', w.pack(A).length === 0);
});

// ---------------------------------------------------- 5. the refusals --
attempt('a pile bigger than the pack', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [KEY_HOME, ENCHANTED]);
  const B = w.person(0xff000002, [{ baseId: KEY, count: 1, name: 'Key to Proudspire Manor' }]);
  const beforeA = JSON.stringify(w.pack(A)), beforeB = JSON.stringify(w.pack(B));
  yes('is refused', w.trade.moveById(A, B, [[DAGGER, 1], [KEY, 2]]) === false);
  yes('with nothing written to either pack',
      w.writes.length === 0 && JSON.stringify(w.pack(A)) === beforeA && JSON.stringify(w.pack(B)) === beforeB);
});

attempt('the piece was dropped between the offer and the agreement', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [KEY_HOME]);
  const B = w.person(0xff000002, [{ baseId: GOLD, count: 20 }]);
  w.trade.begin(A, B);
  w.trade.add(A, 'Key', 1);
  w.trade.gold(B, 20);
  w.trade.confirm(A);
  w.store[A].inventory = { entries: [] };
  const answer = w.trade.confirm(B);
  // The line is the piece, so the refusal names its house (#1718).
  yes('the trade is refused and says why', /does not have the Key to Breezehome any more/.test(answer));
  yes('and the gold did not move', w.gold(B) === 20 && w.writes.length === 0);
});

// -------------------------- 6. a company sale leaves the rest as it was --
attempt('a company sale of one named piece from a stack', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [{ baseId: GOLD, count: 100 }]);
  const B = w.person(0xff000002, [{ baseId: SWORD, count: 2, name: 'Iron Sword (85%)' }]);
  yes('the sale goes through',
      w.trade.saleById(B, A, [{ id: SWORD, c: 1, n: 'Iron Sword' }], 40, 45) === true);
  yes('the sword the seller keeps is still at 85%',
      !!entry(w.pack(B), { baseId: SWORD, count: 1, name: 'Iron Sword (85%)' }));
});

// ------------------------------------------------- 7. the code itself --
{
  const move = slice(TRADE, '  function moveById(', '\n  }\n');
  yes('moveById is in the trade block', move !== null);
  yes('moveById never builds a bare { baseId, count } entry',
      move !== null && !/\{\s*baseId\s*:\s*baseId\s*,\s*count\s*:/.test(move));
  yes('the trade block knows every extra the engine keeps',
      ['health', 'enchantmentId', 'maxCharge', 'removeEnchantmentOnUnequip', 'chargePercent', 'name',
       'soul', 'poisonId', 'poisonCount'].every(function (f) { return TRADE.indexOf("'" + f + "'") !== -1; }));
}

done();
