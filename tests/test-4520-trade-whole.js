// test-4520-trade-whole.js
//
// #4520. A trade moves both sides or neither, and a failure says what
// happened. Each side's pile used to move in its own pair of pack writes,
// one side after the other, so a failure on the second side came after the
// first side's pile had moved, and the trade still said "Nothing was taken."
// A sale to a worker wrote its two packs with nothing between them either.
//
// Driven out of the real trade block in game/gamemode.js over a stand-in
// engine that does what the fork does with a pack write
// (InventoryBinding::Set, MpObjectReference::SetInventory):
//   - a count past 4294967295 is not refused but cut to 32 bits, as
//     nlohmann narrows it into Inventory::Entry::count;
//   - a throw after the pack is set (the save queue, the send to its owner)
//     leaves the pack written.
//
//   A  the second side's things would take a stack past its limit: refused,
//      both packs as they were, and the message says why
//   B  the same for a sale to a worker: the seller's gold
//   C  the second pack's write throws after it is set: the trade is done and
//      says so, and both packs hold the trade
//   D  the first pack's write throws after it is set and the second is never
//      written: the message says whose pack was written, never "Nothing was
//      taken", and the trade is closed
//   E  an ordinary trade still moves both piles, in one write per person
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
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

const ENTRY_FIELDS = ['baseId', 'count', 'health', 'enchantmentId', 'maxCharge',
  'removeEnchantmentOnUnequip', 'chargePercent', 'name', 'soul', 'poisonId',
  'poisonCount', 'worn', 'wornLeft'];
// What the engine keeps of a pack it is given: its fields, and each count
// narrowed to Inventory::Entry's uint32_t.
function asEngineKeeps(inv) {
  const entries = (inv && inv.entries) || [];
  return {
    entries: entries.map(function (e) {
      const out = {};
      ENTRY_FIELDS.forEach(function (f) {
        if (e[f] !== undefined && e[f] !== null) { out[f] = e[f]; }
      });
      if (typeof out.count === 'number') { out.count = out.count % 4294967296; }
      return out;
    })
  };
}

const GOLD = 0xf;
const SWORD = 0x12eb7;
const LEEK = 0x64b3f;
const RECORDS = {};
RECORDS[GOLD] = { type: 'MISC', name: 'Gold' };
RECORDS[SWORD] = { type: 'WEAP', name: 'Iron Sword' };
RECORDS[LEEK] = { type: 'INGR', name: 'Leek' };
const MAX = 4294967295;

function tradeWorld(company) {
  const store = {};
  const writes = [];
  // throwAfter[id]: the next write to this pack sets it, then throws, as a
  // throw in the save queue or the send would.
  const throwAfter = {};
  const g = {};
  // The social block's names, which is where the trade block asks for one.
  g.__thornswoodSocial = { nameOfPerson: function (id) { return (store[id] && store[id].name) || 'somebody'; } };
  if (company) {
    g.__thornswoodProperty = {
      inCompany: function (pid) { return company.indexOf(pid) !== -1; },
      saleCuts: function (price) {
        const cut = price >= 10 ? Math.floor(price / 10) : 0;
        return { price: price, worker: cut, gone: cut, seller: price - cut - cut };
      }
    };
  }
  const mp = {
    get: function (id, prop) {
      if (prop === 'onlinePlayers') { return Object.keys(store).map(Number); }
      const p = store[id];
      if (!p) { return undefined; }
      if (prop === 'inventory') { return JSON.parse(JSON.stringify(p.inventory)); }
      return p[prop];
    },
    set: function (id, prop, value) {
      if (prop === 'inventory') {
        writes.push(id);
        store[id].inventory = asEngineKeeps(JSON.parse(JSON.stringify(value)));
        if (throwAfter[id]) { throwAfter[id] = false; throw new Error('the send to its owner failed'); }
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
    require('./fixtures/ordinary-quest-items') + TRADE)(
    g, mp, { log: function () { } }, function () { return 1; }, function () { },
    function (n, f) { return f; }, function (id, line) { said.push([id, line]); }, function () { });
  const tr = g.__thornswoodTrade;
  return {
    trade: tr, store: store, writes: writes, said: said, throwAfter: throwAfter,
    person: function (id, pack, pid, name) {
      store[id] = { worldOrCellDesc: 'town:X.esm', pos: [0, 0, 0], profileId: pid || 0, name: name,
                    inventory: asEngineKeeps({ entries: pack }) };
      return id;
    },
    pack: function (id) { return JSON.stringify(store[id].inventory.entries); },
    count: function (id, baseId) {
      return store[id].inventory.entries.filter(function (e) { return e.baseId === baseId; })
        .reduce(function (s, e) { return s + (e.count || 1); }, 0);
    },
    line: function (id, name) {
      return tr.view(tr.tradeOf(id), id).pack.filter(function (l) { return l.n === name; })[0];
    }
  };
}
const A = 0xff000001, B = 0xff000002;

// ------------------------------------- A. the second side cannot be held --
attempt('A: the second side\'s gold would pass a stack\'s limit', function () {
  const w = tradeWorld();
  w.person(A, [{ baseId: SWORD, count: 1 }, { baseId: GOLD, count: MAX - 10 }]);
  w.person(B, [{ baseId: GOLD, count: 50 }]);
  const packA = w.pack(A), packB = w.pack(B);
  w.trade.begin(A, B);
  w.trade.add(A, '#' + w.line(A, 'Iron Sword').p, 1);
  w.trade.gold(B, 50);
  w.trade.confirm(A);
  const r = w.trade.confirm(B);
  yes('A1 the trade is refused: "' + r + '"', r !== '');
  yes('A2 the first side\'s sword did not move: both packs are as they were',
      w.pack(A) === packA && w.pack(B) === packB);
  yes('A3 nothing was written at all', w.writes.length === 0);
  yes('A4 the message says why, and that nothing was taken',
      /a stack holds at most 4294967295\. Nothing was taken\.$/.test(r));
  yes('A5 the trade stays open with both agreements taken back',
      !!w.trade.tradeOf(A) && !w.trade.tradeOf(A).okA && !w.trade.tradeOf(A).okB);
});

// ------------------------------------------------- B. a sale to a worker --
attempt('B: a sale whose share would pass the seller\'s gold stack', function () {
  const w = tradeWorld([7]);
  w.person(A, [{ baseId: GOLD, count: 100 }], 7);
  w.person(B, [{ baseId: LEEK, count: 1 }, { baseId: GOLD, count: MAX - 5 }], 8);
  const packA = w.pack(A), packB = w.pack(B);
  w.trade.begin(A, B);
  yes('B0 the worker buys for the company', w.trade.sale(A) === '');
  w.trade.add(B, '#' + w.line(B, 'Leek').p, 1);
  w.trade.gold(A, 50);
  w.trade.confirm(A);
  const r = w.trade.confirm(B);
  yes('B1 the sale is refused: "' + r + '"', r !== '');
  yes('B2 both packs are as they were', w.pack(A) === packA && w.pack(B) === packB && w.writes.length === 0);
  yes('B3 the message says why', /a stack holds at most 4294967295\. Nothing was taken\.$/.test(r));
});

// --------------------------- C. the second write throws after it is set --
attempt('C: the second pack is written and its send throws', function () {
  const w = tradeWorld();
  w.person(A, [{ baseId: SWORD, count: 1 }]);
  w.person(B, [{ baseId: GOLD, count: 50 }]);
  w.trade.begin(A, B);
  w.trade.add(A, '#' + w.line(A, 'Iron Sword').p, 1);
  w.trade.gold(B, 50);
  w.trade.confirm(A);
  w.throwAfter[B] = true;
  const r = w.trade.confirm(B);
  yes('C1 the trade is done: "' + r + '"', r === '' && !w.trade.tradeOf(A));
  yes('C2 both packs hold the trade',
      w.count(A, GOLD) === 50 && w.count(A, SWORD) === 0 && w.count(B, SWORD) === 1 && w.count(B, GOLD) === 0);
  yes('C3 both are told it traded, and nobody is told nothing was taken',
      w.said.some(function (s) { return s[0] === A && /^Traded\./.test(s[1]); }) &&
      w.said.some(function (s) { return s[0] === B && /^Traded\./.test(s[1]); }) &&
      !w.said.some(function (s) { return /Nothing was taken/.test(s[1]); }));
});

// ---------------- D. the first write throws after it is set, half done --
attempt('D: the first pack is written, its send throws, the second never is', function () {
  const w = tradeWorld();
  w.person(A, [{ baseId: SWORD, count: 1 }], 0, 'Aldis');
  w.person(B, [{ baseId: GOLD, count: 50 }], 0, 'Sera');
  w.trade.begin(A, B);
  w.trade.add(A, '#' + w.line(A, 'Iron Sword').p, 1);
  w.trade.gold(B, 50);
  w.trade.confirm(A);
  w.throwAfter[A] = true;
  const r = w.trade.confirm(B);
  yes('D1 it does not say nothing was taken: "' + r + '"', r !== '' && !/Nothing was taken/.test(r));
  yes('D2 it says whose pack was written and whose was not',
      r === 'The trade went only half through: Aldis\'s pack was written and Sera\'s was not. ' +
            'Tell staff, it is in the server log.' &&
      w.said.filter(function (s) { return s[1] === r; }).length === 2);
  yes('D3 and the packs are as it says: the first written, the second untouched',
      w.count(A, GOLD) === 50 && w.count(A, SWORD) === 0 && w.count(B, GOLD) === 50);
  yes('D4 the trade is closed, so nothing moves a second time', !w.trade.tradeOf(A) && w.writes.length === 1);
});

// ------------------------------------------- E. an ordinary trade, whole --
attempt('E: both piles move, one write per person', function () {
  const w = tradeWorld();
  w.person(A, [{ baseId: SWORD, count: 1 }, { baseId: GOLD, count: 5 }]);
  w.person(B, [{ baseId: GOLD, count: 50 }, { baseId: LEEK, count: 3 }]);
  w.trade.begin(A, B);
  w.trade.add(A, '#' + w.line(A, 'Iron Sword').p, 1);
  w.trade.add(B, '#' + w.line(B, 'Leek').p, 2);
  w.trade.gold(B, 50);
  w.trade.confirm(A);
  yes('E1 it trades', w.trade.confirm(B) === '' && !w.trade.tradeOf(A));
  yes('E2 each pack holds its new things',
      w.count(A, GOLD) === 55 && w.count(A, LEEK) === 2 && w.count(A, SWORD) === 0 &&
      w.count(B, SWORD) === 1 && w.count(B, LEEK) === 1 && w.count(B, GOLD) === 0);
  yes('E3 one write each, two in all', w.writes.length === 2 && w.writes[0] === A && w.writes[1] === B);
});

done();
