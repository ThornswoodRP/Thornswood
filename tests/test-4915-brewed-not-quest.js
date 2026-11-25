'use strict';
/*
  test-4915-brewed-not-quest.js

      node tests/test-4915-brewed-not-quest.js

  #4915: a brewed potion, or a poison mixed at a Blightbrewer's lab, could not
  be stored, dropped, taken, traded or loaded as cargo, because the quest item
  check refused every item whose record named no plugin. A bottle the brewing
  client makes is a runtime form, and the engine names a runtime form by its
  bare id: FormDesc::FromFormId gives a form at 0xff000000 and up no file,
  and FormDesc::ToString prints only the id when there is no file, so
  0xff000801 is "801". The check now refuses the seven quest tokens and
  nothing else.

  This lifts every place that asks the check out of game/gamemode.js (the put,
  take and drop hooks; the trade list, the swap, a move and a sale; the trade
  dock's and the market stalls' pack list, take and give, which is cargo) and
  runs each with the policy exactly as gamemode.js carries it, over an engine
  that names forms the way FormDesc does. It holds:
    P a brewed potion and a mixed poison are refused nowhere as quest items;
    T each of the seven quest tokens is still refused everywhere;
    O an ordinary Skyrim item, and a Thornswood-Content item that is not a
      token (a hair dye, deed or key mold), still move.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The seven tokens, where the load order puts Thornswood-Content.esp.
const CONTENT = 0x05000000;
const TOKENS = Array.from({ length: 7 }, function (_, i) { return CONTENT + 0x17000 + i; });
const POTION = 0xff000801;   // a bottle the brewing client made
const POISON = 0xff000802;   // a poison mixed at the lab
const SKYRIM = 0x0003eb42;   // an ordinary Skyrim item
const OURS = CONTENT + 0x17007; // a Thornswood-Content record that is not a token
const GOLD = 15;

// FormDesc::FromFormId and ToString, in the fork.
function descOf(id) {
  if (id >= 0xff000000) { return (id - 0xff000000).toString(16); }
  if ((id >>> 24) === (CONTENT >>> 24)) { return (id & 0xffffff).toString(16) + ':Thornswood-Content.esp'; }
  return (id & 0xffffff).toString(16) + ':Skyrim.esm';
}

// The policy as gamemode.js carries it, not the module beside it.
const policySrc = source.match(/^function createQuestItemPolicy\(mp\) \{[\s\S]*?^\}/m);
yes('gamemode.js carries the quest item policy', !!policySrc);
const holder = {};
vm.createContext(holder);
vm.runInContext(policySrc[0] + '\nthis.make = createQuestItemPolicy;', holder);

function world(pack) {
  const w = { reads: 0, writes: 0, asked: [] };
  w.mp = { getDescFromId: descOf,
    get: function () { w.reads++; return { entries: pack.map(function (id) { return { baseId: id, count: 1 }; }) }; },
    set: function () { w.writes++; } };
  const policy = holder.make(w.mp);
  w.ctx = { mp: w.mp, Buffer: Buffer, guard: function (name, fn) { return fn; },
    questItemBlocked: function (id) { const r = policy.blocked(id); w.asked.push([id, r]); return r; },
    log: function () { }, auditPerson: function () { return ''; }, auditItem: function () { return ''; },
    auditSource: function () { return ''; }, auditCell: function () { return ''; },
    unconfirm: function () { }, push: function () { }, globalThis: {},
    copy: function (v) { return JSON.parse(JSON.stringify(v)); },
    TRADE_DOCK: { isCoin: function (id) { return id === GOLD; } }, BOOK: { isCoin: function (id) { return id === GOLD; } },
    itemName: function () { return 'a thing'; }, pieceOf: function (e) { return String(e.baseId); },
    pieceName: function () { return 'a thing'; }, categoryOf: function () { return ''; }, g: {},
    // The market stalls read and write the pack through these.
    entriesOf: function () { return w.mp.get().entries; }, writePack: function () { w.writes++; } };
  vm.createContext(w.ctx);
  return w;
}

// Each hook, and every copy of each helper (the trade dock and the market
// stalls each have their own packList, packTake and packGive).
function hook(name) {
  return source.match(new RegExp('^mp\\.' + name + " = guard\\('" + name + "',[\\s\\S]*?^\\}\\);", 'm'))[0];
}
function lifts(name) {
  const out = [];
  const re = new RegExp('^(  |    )function ' + name + '\\([^\\n]*\\)[\\s\\S]*?^\\1\\}', 'mg');
  let m;
  while ((m = re.exec(source)) !== null) { out.push(m[0]); }
  return out;
}
const HOOKS = ['onPutItem', 'onTakeItem', 'onDropItem'];
const PACKS = { packList: lifts('packList'), packTake: lifts('packTake'), packGive: lifts('packGive') };
yes('the trade dock and the market stalls each have their pack list, take and give (' +
    [PACKS.packList.length, PACKS.packTake.length, PACKS.packGive.length].join(', ') + ')',
    PACKS.packList.length === 2 && PACKS.packTake.length === 2 && PACKS.packGive.length === 2);
const TRADE = ['carrying', 'moveById', 'saleById', 'swap'].map(function (n) { return lifts(n)[0]; });

const QUEST = /Quest items/;
function thrown(fn) { try { fn(); return ''; } catch (e) { return String(e && e.message); } }

/*
  Each place, for `id`: what the real check answered for it there (asked),
  and whether the place refused it the way it refuses a quest item
  (refused). A place may go on past the check into work this harness does
  not stand up (a whole trade, say); what it said about the item is the
  check's answer and the refusal, which both come first.
*/
function places(id) {
  const out = {};
  function mine(w) { return w.asked.filter(function (a) { return a[0] === id; }).map(function (a) { return a[1]; }); }
  HOOKS.forEach(function (name) {
    const w = world([id]);
    vm.runInContext(hook(name), w.ctx);
    const args = name === 'onDropItem' ? [1, id, 1] : [2, 1, id, 1];
    let r;
    thrown(function () { r = w.ctx.mp[name].apply(null, args); });
    out[name] = { asked: mine(w), refused: r === false && w.reads === 0 };
  });
  // The stalls' packGive puts stall goods back in a pack and asks nothing:
  // the dock's is cargo.
  [['packList', 0], ['packList', 1], ['packTake', 0], ['packTake', 1], ['packGive', 0]].forEach(function (p) {
    const name = p[0], at = p[1];
    const w = world([id]);
    vm.runInContext(PACKS[name][at], w.ctx);
    const where = name + (at ? ' (stalls)' : ' (dock)');
    let refused;
    if (name === 'packList') {
      let rows = [];
      thrown(function () { rows = w.ctx.packList(1) || []; });
      refused = !rows.some(function (r) { return r.baseId === id; });
    } else if (name === 'packTake') {
      refused = QUEST.test(thrown(function () { w.ctx.packTake(1, id, 0, 1); }));
    } else {
      refused = QUEST.test(thrown(function () { w.ctx.packGive(1, { baseId: id, count: 1 }); }));
    }
    out[where] = { asked: mine(w), refused: refused };
  });
  [['carrying', function (c) { return !(c.carrying(1) || []).some(function (r) { return r.id === id; }); }],
   ['swap', function (c) { return QUEST.test(String(c.swap({ offerA: [{ id: GOLD, c: 7 }], offerB: [{ id: id, c: 1 }] }))); }],
   ['moveById', function (c, w) { return c.moveById(1, 2, [[id, 1]]) === false && w.reads === 0; }],
   ['saleById', function (c, w) { return c.saleById(1, 2, [{ id: id, c: 1 }], 5, 5) === false && w.reads === 0; }]
  ].forEach(function (p) {
    const w = world([GOLD, id]);
    TRADE.forEach(function (src) { vm.runInContext(src, w.ctx); });
    let refused = false;
    const err = thrown(function () { refused = p[1](w.ctx, w); });
    out[p[0]] = { asked: mine(w), refused: refused || QUEST.test(err) };
  });
  return out;
}

// --------------------------------------------- P the potion and the poison
[['a brewed potion', POTION], ['a mixed poison', POISON]].forEach(function (pair) {
  const r = places(pair[1]);
  Object.keys(r).forEach(function (place) {
    const a = r[place].asked;
    yes('P ' + pair[0] + ' is not refused as a quest item at ' + place + ' (the check answered ' + JSON.stringify(a) + ')',
        a.length > 0 && a.every(function (x) { return x === false; }) && !r[place].refused);
  });
});

// ------------------------------------------------- T the seven tokens
TOKENS.forEach(function (id, n) {
  const r = places(id);
  const missed = Object.keys(r).filter(function (k) { return !r[k].refused; });
  yes('T quest token ' + (n + 1) + ' (' + descOf(id) + ') is refused at every place' +
      (missed.length ? ' (let through at ' + missed.join(', ') + ')' : ''), missed.length === 0);
});

// --------------------------------------------- O ordinary goods still move
[['a Skyrim item', SKYRIM], ['a Thornswood-Content item that is not a token', OURS]].forEach(function (pair) {
  const r = places(pair[1]);
  const at = Object.keys(r).filter(function (k) {
    return r[k].asked.some(function (x) { return x; }) || r[k].refused;
  });
  yes('O ' + pair[0] + ' is refused nowhere as a quest item' + (at.length ? ' (refused at ' + at.join(', ') + ')' : ''), at.length === 0);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
