// test-1718-trade-pieces.js
//
// #1718. The trade panel lists each piece, not each record: two pieces of one
// record that differ in their name or any other extra (two keys to two
// houses, a sword at 85% and a plain one, an enchanted dagger and a plain
// one) are two lines, each under its own name. What is put up is that piece,
// the other side sees its name on the table, and the swap moves that piece.
//
// Driven out of the real trade block over a fake engine whose packs keep
// exactly the fields Inventory::Entry::Serialize keeps in the fork, the same
// stand-in test-1594-trade-extras.js uses.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const page = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'trade.md'), 'utf8').split(CR).join('');
const panel = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-trade.js'), 'utf8').split(CR).join('');

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
const GEM = 0x2e4e3;
const RECORDS = {};
RECORDS[GOLD] = { type: 'MISC', name: 'Gold' };
RECORDS[KEY] = { type: 'KEYM', name: 'Key' };
RECORDS[SWORD] = { type: 'WEAP', name: 'Iron Sword' };
RECORDS[DAGGER] = { type: 'WEAP', name: 'Steel Dagger' };
RECORDS[GEM] = { type: 'SLGM', name: 'Petty Soul Gem' };

function tradeWorld(company) {
  const store = {};
  const writes = [];
  const g = {};
  if (company) {
    // The property block's two answers a company sale asks (#1393).
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
  const tr = g.__thornswoodTrade;
  return {
    trade: tr,
    store: store,
    writes: writes,
    said: said,
    person: function (id, pack, pid) {
      store[id] = { worldOrCellDesc: 'town:X.esm', pos: [0, 0, 0], profileId: pid || 0,
                    inventory: asEngineKeeps({ entries: pack }) };
      return id;
    },
    pack: function (id) { return store[id].inventory.entries; },
    // What this side's panel is drawn from, as the server sends it.
    view: function (id) { return tr.view(tr.tradeOf(id), id); },
    // The line on this side's panel with exactly this name.
    line: function (id, column, name) {
      return tr.view(tr.tradeOf(id), id)[column].filter(function (l) { return l.n === name; });
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
function names(lines) { return lines.map(function (l) { return l.n; }).sort().join(' | '); }

const BREEZEHOME = { baseId: KEY, count: 1, name: 'Key to Breezehome' };
const HONEYSIDE = { baseId: KEY, count: 1, name: 'Key to Honeyside' };
const ENCHANTED = { baseId: DAGGER, count: 1, enchantmentId: 0x4605a, maxCharge: 1500, chargePercent: 900 };

// ------------------------------------------------- 1. the Done when, whole --
attempt('one of two differently named keys of the same record is offered', function () {
  const w = tradeWorld();
  // Breezehome is first in the pack: the key that went before, whichever was meant.
  const A = w.person(0xff000001, [BREEZEHOME, HONEYSIDE]);
  const B = w.person(0xff000002, [{ baseId: GOLD, count: 50 }]);
  yes('the trade opens', w.trade.begin(A, B) === '');
  const pack = w.view(A).pack;
  yes('each key is its own line, under its own house',
      pack.length === 2 && names(pack) === 'Key to Breezehome | Key to Honeyside' &&
      pack.every(function (l) { return l.c === 1 && l.k === 'Keys'; }));
  yes('and each line carries the number its buttons send, a different one each',
      pack.every(function (l) { return l.p > 0; }) && pack[0].p !== pack[1].p);
  const honeyside = w.line(A, 'pack', 'Key to Honeyside')[0];
  yes('Add on the Honeyside line puts up the Honeyside key', w.trade.add(A, '#' + honeyside.p, 1) === '');
  const mine = w.view(A).mine;
  yes('your side shows the Honeyside key, and only it',
      mine.length === 1 && mine[0].n === 'Key to Honeyside' && mine[0].c === 1 && mine[0].p === honeyside.p);
  const theirs = w.view(B).theirs;
  yes('the other person sees the Honeyside key on the table, by its house',
      theirs.length === 1 && theirs[0].n === 'Key to Honeyside' && theirs[0].c === 1);
  yes('the panel is sent no piece itself, only its number',
      w.view(A).pack.concat(w.view(A).mine, w.view(B).theirs).every(function (l) { return l.x === undefined; }));
  w.trade.gold(B, 50);
  w.trade.confirm(A);
  yes('both agree and it swaps', w.trade.confirm(B) === '' && !w.trade.tradeOf(A));
  yes('the Honeyside key crossed', !!entry(w.pack(B), HONEYSIDE));
  yes('and the Breezehome key did not', !w.pack(B).some(function (e) { return e.name === 'Key to Breezehome'; }));
  yes('the giver still holds the Breezehome key, and only it',
      !!entry(w.pack(A), BREEZEHOME) && w.pack(A).filter(function (e) { return e.baseId === KEY; }).length === 1);
  yes('both are told the house that moved',
      w.said.some(function (s) { return s[0] === A && /You gave Key to Honeyside and got 50 gold/.test(s[1]); }) &&
      w.said.some(function (s) { return s[0] === B && /You gave 50 gold and got Key to Honeyside/.test(s[1]); }));
});

// ------------------------------------- 2. condition and enchantment show --
attempt('a sword at 85% and a plain one, an enchanted dagger and a plain one', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [
    { baseId: SWORD, count: 1, name: 'Iron Sword (85%)' },
    { baseId: SWORD, count: 1 },
    ENCHANTED,
    { baseId: DAGGER, count: 1 }
  ]);
  const B = w.person(0xff000002, [{ baseId: GOLD, count: 10 }]);
  w.trade.begin(A, B);
  yes('four lines, the condition and the enchantment on them',
      names(w.view(A).pack) === 'Iron Sword | Iron Sword (85%) | Steel Dagger | Steel Dagger (enchanted)');
  const plain = w.line(A, 'pack', 'Iron Sword')[0];
  const charmed = w.line(A, 'pack', 'Steel Dagger (enchanted)')[0];
  w.trade.add(A, '#' + plain.p, 1);
  w.trade.add(A, '#' + charmed.p, 1);
  yes('the other side sees which sword and which dagger they are getting',
      names(w.view(B).theirs) === 'Iron Sword | Steel Dagger (enchanted)');
  w.trade.confirm(A); w.trade.confirm(B);
  yes('the plain sword crossed and the one at 85% stayed',
      !!entry(w.pack(B), { baseId: SWORD, count: 1 }) &&
      !!entry(w.pack(A), { baseId: SWORD, count: 1, name: 'Iron Sword (85%)' }));
  yes('the enchanted dagger crossed with its enchantment and the plain one stayed',
      !!entry(w.pack(B), ENCHANTED) && !!entry(w.pack(A), { baseId: DAGGER, count: 1 }));
});

attempt('a soul, a poison and a temper are said after the name', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [
    { baseId: GEM, count: 1 }, { baseId: GEM, count: 1, soul: 5 },
    { baseId: DAGGER, count: 1, poisonId: 0x3a5a4, poisonCount: 2 },
    { baseId: SWORD, count: 1, health: 1.2 }
  ]);
  const B = w.person(0xff000002, []);
  w.trade.begin(A, B);
  yes('each reads differently from the plain piece',
      names(w.view(A).pack) === 'Iron Sword (tempered) | Petty Soul Gem | Petty Soul Gem (Grand soul) | Steel Dagger (poisoned)');
  const both = tradeWorld();
  const C = both.person(0xff000001, [{ baseId: SWORD, count: 1, name: 'Iron Sword (85%)', enchantmentId: 0x4605a,
                                       poisonId: 0x3a5a4, poisonCount: 1 }]);
  both.trade.begin(C, both.person(0xff000002, []));
  yes('two of them on a named piece are said together, after its own name',
      names(both.view(C).pack) === 'Iron Sword (85%) (enchanted, poisoned)');
});

// -------------------------------------------- 3. one piece is one line --
attempt('the same piece in two entries', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [
    { baseId: SWORD, count: 1, name: 'Iron Sword (85%)', worn: true },
    { baseId: SWORD, count: 2, name: 'Iron Sword (85%)' },
    { baseId: SWORD, count: 1, name: 'Iron Sword (40%)' }
  ]);
  const B = w.person(0xff000002, []);
  w.trade.begin(A, B);
  const at85 = w.line(A, 'pack', 'Iron Sword (85%)');
  yes('the one worn and the two in the pack are one line of three: being worn is not a piece',
      at85.length === 1 && at85[0].c === 3 && w.view(A).pack.length === 2);
  w.trade.add(A, '#' + at85[0].p, 5);
  yes('All of a line is the line, not the record', w.view(A).mine[0].c === 3);
  yes('adding it again is refused: that is all of them', w.trade.add(A, '#' + at85[0].p, 1) === 'That is all of them already.');
  const at40 = w.line(A, 'pack', 'Iron Sword (40%)')[0];
  w.trade.add(A, '#' + at40.p, 1);
  yes('the other piece of the record is a line of its own on the table', w.view(A).mine.length === 2);
  w.trade.confirm(A); w.trade.confirm(B);
  yes('all three at 85% and the one at 40% crossed, none of them worn',
      !!entry(w.pack(B), { baseId: SWORD, count: 3, name: 'Iron Sword (85%)' }) &&
      !!entry(w.pack(B), { baseId: SWORD, count: 1, name: 'Iron Sword (40%)' }) && w.pack(A).length === 0);
});

// ---------------------------------------- 4. a number means one piece --
attempt('the numbers the panel sends', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [BREEZEHOME, HONEYSIDE]);
  const B = w.person(0xff000002, []);
  w.trade.begin(A, B);
  const before = w.line(A, 'pack', 'Key to Honeyside')[0].p;
  w.store[A].inventory.entries.unshift({ baseId: KEY, count: 1, name: 'Key to Proudspire Manor' });
  yes('a piece keeps its number when the pack changes under it',
      w.line(A, 'pack', 'Key to Honeyside')[0].p === before &&
      w.line(A, 'pack', 'Key to Proudspire Manor')[0].p !== before);
  yes('a number nobody was given is refused', w.trade.add(A, '#99', 1) === 'You are not carrying that.');
  yes('so is a number that is not one', w.trade.add(A, '#1x', 1) === 'You are not carrying that.' &&
      w.trade.add(A, '#0', 1) === 'You are not carrying that.');
  w.store[A].inventory.entries = w.store[A].inventory.entries.filter(function (e) { return e.name !== 'Key to Honeyside'; });
  yes('a number whose piece is gone is refused, not given to the next key',
      w.trade.add(A, '#' + before, 1) === 'You are not carrying that.' && w.view(A).mine.length === 0);
  w.store[A].inventory.entries.push(HONEYSIDE);
  yes('and the piece back in the pack has its number back', w.line(A, 'pack', 'Key to Honeyside')[0].p === before);
});

attempt('Take back on one of two lines of a record', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [BREEZEHOME, HONEYSIDE]);
  const B = w.person(0xff000002, []);
  w.trade.begin(A, B);
  w.view(A).pack.forEach(function (l) { w.trade.add(A, '#' + l.p, 1); });
  yes('both keys are on the table, each its own line', names(w.view(A).mine) === 'Key to Breezehome | Key to Honeyside');
  const breezehome = w.line(A, 'mine', 'Key to Breezehome')[0];
  yes('Take back on the Breezehome line', w.trade.remove(A, '#' + breezehome.p, 0) === '');
  yes('takes back the Breezehome key and leaves the Honeyside one', names(w.view(A).mine) === 'Key to Honeyside' &&
      names(w.view(B).theirs) === 'Key to Honeyside');
  yes('a number not on your side is not', w.trade.remove(A, '#' + breezehome.p, 0) === 'That is not on your side.');
});

// ------------------------------------------------------ 5. the refusals --
attempt('the piece put up is gone, another of its record is not', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [BREEZEHOME, HONEYSIDE]);
  const B = w.person(0xff000002, [{ baseId: GOLD, count: 20 }]);
  w.trade.begin(A, B);
  w.trade.add(A, '#' + w.line(A, 'pack', 'Key to Honeyside')[0].p, 1);
  w.trade.gold(B, 20);
  w.trade.confirm(A);
  // Dropped between the offer and the agreement. The Breezehome key is still a key.
  w.store[A].inventory.entries = [BREEZEHOME];
  const answer = w.trade.confirm(B);
  yes('the trade is refused and names the house', /does not have the Key to Honeyside any more/.test(answer));
  yes('and nothing was written: the other key is not handed over in its place',
      w.writes.length === 0 && !!entry(w.pack(A), BREEZEHOME) && w.pack(B).length === 1);
});

attempt('a piece whose extra changed after it was put up', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [{ baseId: SWORD, count: 1, name: 'Iron Sword (85%)' }]);
  const B = w.person(0xff000002, [{ baseId: GOLD, count: 20 }]);
  w.trade.begin(A, B);
  w.trade.add(A, '#' + w.view(A).pack[0].p, 1);
  w.trade.gold(B, 20);
  w.trade.confirm(A);
  w.store[A].inventory.entries = [{ baseId: SWORD, count: 1, name: 'Iron Sword (60%)' }];
  yes('is not the piece agreed to: refused, nothing moves',
      /does not have the Iron Sword \(85%\) any more/.test(w.trade.confirm(B)) && w.writes.length === 0);
});

// ----------------------------- 6. a company sale takes the piece put up --
attempt('a company sale of one of two swords', function () {
  const w = tradeWorld([301]);
  const W = w.person(0xff000301, [{ baseId: GOLD, count: 100 }], 301);
  const S = w.person(0xff000302, [{ baseId: SWORD, count: 1, name: 'Iron Sword (85%)' }, { baseId: SWORD, count: 1 }], 302);
  w.trade.begin(W, S);
  yes('the worker buys for the company', w.trade.sale(W) === '');
  w.trade.add(S, '#' + w.line(S, 'pack', 'Iron Sword')[0].p, 1);
  yes('the worker sees which sword is for sale', names(w.view(W).theirs) === 'Iron Sword');
  w.trade.gold(W, 40);
  w.trade.confirm(W);
  yes('the sale goes through', w.trade.confirm(S) === '' && !w.trade.tradeOf(W));
  yes('the plain sword left Skyrim and the one at 85% stayed with the seller',
      !!entry(w.pack(S), { baseId: SWORD, count: 1, name: 'Iron Sword (85%)' }) &&
      !w.pack(S).concat(w.pack(W)).some(function (e) { return e.baseId === SWORD && !e.name; }));
  yes('the seller was told the sword that went',
      w.said.some(function (s) { return s[0] === S && /Iron Sword left Skyrim/.test(s[1]); }));
});

attempt('moveById and saleById with a piece', function () {
  const w = tradeWorld();
  const A = w.person(0xff000001, [BREEZEHOME, HONEYSIDE, { baseId: GOLD, count: 10 }]);
  const B = w.person(0xff000002, []);
  const piece = JSON.stringify([KEY, null, null, null, null, null, 'Key to Honeyside', null, null, null]);
  yes('a pair with a piece moves that piece', w.trade.moveById(A, B, [[KEY, 1, piece], [GOLD, 5]]) === true &&
      !!entry(w.pack(B), HONEYSIDE) && !!entry(w.pack(A), BREEZEHOME));
  yes('and refuses when that piece is not there, though another of its record is',
      w.trade.moveById(A, B, [[KEY, 1, piece]]) === false && !!entry(w.pack(A), BREEZEHOME));
  const W = w.person(0xff000003, [{ baseId: GOLD, count: 100 }]);
  yes('a sale of a piece that is not there is refused, and leaves the other key',
      w.trade.saleById(A, W, [{ id: KEY, c: 1, n: 'Key to Honeyside', x: piece }], 40, 45) === false &&
      !!entry(w.pack(A), BREEZEHOME));
});

// ------------------------------------------------- 7. the panel and page --
{
  yes('the panel sends a line by its number, not its name',
      /function ref\(line\)/.test(panel) && /'#' \+ line\.p/.test(panel) &&
      /data-add="' \+ itRef \+ '"/.test(panel) && /data-rem="' \+ mineRef \+ '"/.test(panel) &&
      /data-for="' \+ itRef \+ '"/.test(panel));
  yes('trade.md says each piece is its own line under its own name',
      /Each piece you are holding is its own line/.test(page) && /under its own name/.test(page));
  yes('and the page says where it is', /one line a piece/i.test(page.slice(page.indexOf('## Where this is'))));
  const said = (TRADE.match(/'[^'\n]*'/g) || []).join(' ');
  yes('no line the trade block says calls anybody a player', !/\bplayers?\b/i.test(said));
}

done();
