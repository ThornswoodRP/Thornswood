'use strict';
/*
  test-4530-one-price-per-item.js

      node tests/test-4530-one-price-per-item.js

  #4530: a guild trader could offer more for an item than it sells it for,
  so someone could sell to it and buy back until its purse was empty (and a
  five-item supply or a commission, both paid at the buy price, paid out
  the same gap). The buy and the sell came from different lines: each side
  was averaged on its own and skipped its own blanks, a hold with no price
  for one side borrowed that side alone from the other holds, and prices
  were kept per label, not per item.

  Patrick's answer (12 Nov 2026, docs/DECIDED.md): only a line with both a
  buy and a sell prices a trader.

  This runs the real books block out of game/gamemode.js, with real books
  submitted at real holds, and asks what every guild trader is quoted
  (guildPrice, which the trader's quote and a commission read, and catalog,
  which its panel and supply read). It holds:
    C1 one book buying with no sell and another selling with no buy never
       makes a buy above a sell;
    C2 a hold that prices one side never borrows the other side alone from
       another hold;
    C3 two labels that name the same item are one item: no label's buy is
       above another label's sell;
    C4 a book line whose own buy is above its own sell is refused when it
       is set, and is not in the book;
    C5 a line like that already saved, from before the rule, loads, and no
       trader is quoted a crossed price because of it;
    C6 ordinary lines still average: 10/20 and 20/30 is 15/25;
    C7 a seeded sweep of books over three holds: no item at any hold is
       quoted a buy above a sell, under any of its labels;
    C8 an item whose only lines are one-sided is not traded at any hold,
       and those lines stay in their book.

  Read only, apart from its own temp folders, which it removes.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8');
const block = src.slice(src.indexOf('/* BOOKS-START */'), src.indexOf('/* BOOKS-END */'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const temps = [];
function done() {
  temps.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { console.log('      could not remove ' + d + ': ' + e.message); } });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
yes('0 the books block is in the gamemode', block.length > 1000);
if (block.length <= 1000) { done(); }

// The labels the item table knows, as __thornswoodResolveItem answers them:
// "Iron Ingots" is the same item as "Iron Ingot".
const ITEMS = {
  'iron ingot': { baseId: 0x5ace4, name: 'Iron Ingot' },
  'iron ingots': { baseId: 0x5ace4, name: 'Iron Ingot' },
  'iron ore': { baseId: 0x71cf3, name: 'Iron Ore' },
  'leather': { baseId: 0xdb5d2, name: 'Leather' },
  'leathers': { baseId: 0xdb5d2, name: 'Leather' },
  'salt pile': { baseId: 0x34cdf, name: 'Salt Pile' }
};
function resolve(label) {
  const hit = ITEMS[String(label || '').trim().toLowerCase()];
  return hit ? { baseId: hit.baseId, name: hit.name } : { error: 'That item is not known.' };
}

// One server: each profile has its own account, so each founds its own
// business book; `at` is the hold the next submit is made at.
function world(dir) {
  if (!dir) { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4530-')); temps.push(dir); }
  const w = { dir: dir, at: 'whiterun' };
  const env = { fs: fs, path: path, privDir: dir, atBox: function () { return w.at; },
    roles: function (pid) { return { business: true, account: 'acct-' + pid }; },
    nameOf: function (pid) { return 'Person ' + pid; }, refresh: function () { },
    resolve: resolve };
  const ctx = { env: env, __thornswoodResolveItem: resolve, console: { log: function () { } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.api = thornswoodBooks(env);', ctx);
  w.api = ctx.api;
  w.cmd = function (pid, line) { return String(w.api.command({ actorId: pid, profileId: pid, parts: line.split(/\s+/) })); };
  w.book = function (pid) {
    const mine = w.api.books().filter(function (b) { return Number(b.owner) === pid; })[0];
    if (mine) { return mine.id; }
    w.cmd(pid, '/book new business Shop ' + pid);
    return w.api.books().filter(function (b) { return Number(b.owner) === pid; })[0].id;
  };
  w.line = function (pid, label, buy, sell) {
    return w.cmd(pid, '/book price ' + w.book(pid) + ' | ' + label + ' | ' + (buy == null ? '-' : buy) + ' | ' + (sell == null ? '-' : sell));
  };
  w.submit = function (pid, hold) { w.at = hold; return w.cmd(pid, '/book submit ' + w.book(pid)); };
  w.quote = function (hold, label) { return w.api.guildPrice(hold, label) || { buy: null, sell: null }; };
  return w;
}

// Every way a trader at `hold` can be quoted an item, under every label any
// book used for it: what its panel lists (catalog) and what a buy, sell,
// supply or commission asks (guildPrice). The worst crossing per item.
function crossings(w, hold, labels) {
  const out = [];
  const byItem = {};
  const quoted = [];
  labels.forEach(function (label) { quoted.push({ label: label, p: w.quote(hold, label) }); });
  (w.api.catalog(hold) || []).forEach(function (row) { quoted.push({ label: row.name, p: { buy: row.buy, sell: row.sell } }); });
  quoted.forEach(function (q) {
    const item = resolve(q.label);
    const key = item.baseId ? String(item.baseId) : 'label:' + q.label.toLowerCase();
    (byItem[key] = byItem[key] || []).push(q);
  });
  Object.keys(byItem).forEach(function (key) {
    const rows = byItem[key];
    rows.forEach(function (a) {
      rows.forEach(function (b) {
        if (a.p.buy != null && b.p.sell != null && a.p.buy > b.p.sell) {
          out.push(hold + ': buys ' + a.label + ' at ' + a.p.buy + ', sells ' + b.label + ' at ' + b.p.sell);
        }
      });
    });
  });
  return out;
}

// ---------------------------------------------------- C1 one-sided lines
{
  const w = world();
  w.line(1, 'Iron Ore', 50, null); w.submit(1, 'whiterun');
  w.line(2, 'Iron Ore', null, 10); w.submit(2, 'whiterun');
  const c = crossings(w, 'whiterun', ['Iron Ore']);
  yes('C1 a book buying Iron Ore at 50 with no sell and another selling it at 10 with no buy: no buy above a sell (' + (c[0] || 'none') + ')', c.length === 0);
}

// ------------------------------------------- C2 no side borrowed alone
{
  const w = world();
  w.line(1, 'Iron Ore', 30, null); w.submit(1, 'whiterun');
  w.line(2, 'Iron Ore', 5, 8); w.submit(2, 'riften');
  const c = crossings(w, 'whiterun', ['Iron Ore']);
  yes('C2 Whiterun buys at 30 and has no sell, Riften prices 5 and 8: Whiterun never pairs its own buy with Riften\'s sell (' + (c[0] || 'none') + ')', c.length === 0);
  const r = w.quote('riften', 'Iron Ore');
  yes('C2 and Riften keeps its own 5 and 8', r.buy === 5 && r.sell === 8);
}

// --------------------------------------------- C3 two labels, one item
{
  const w = world();
  w.line(1, 'Iron Ingot', 20, 25); w.submit(1, 'whiterun');
  w.line(2, 'Iron Ingots', 30, 35); w.submit(2, 'whiterun');
  const c = crossings(w, 'whiterun', ['Iron Ingot', 'Iron Ingots']);
  yes('C3 "Iron Ingot" 20/25 and "Iron Ingots" 30/35 are one item: no label buys above another\'s sell (' + (c[0] || 'none') + ')', c.length === 0);
  const a = w.quote('whiterun', 'Iron Ingot'), b = w.quote('whiterun', 'Iron Ingots');
  yes('C3 and both labels are quoted the same pair (' + JSON.stringify(a) + ', ' + JSON.stringify(b) + ')', a.buy === b.buy && a.sell === b.sell);
  const rows = (w.api.catalog('whiterun') || []).filter(function (r) { const i = resolve(r.name); return i.baseId === 0x5ace4; });
  yes('C3 the trader\'s list has the item once (' + rows.map(function (r) { return r.name; }).join(', ') + ')', rows.length === 1);
}

// ------------------------------------------ C4 a crossed line is refused
{
  const w = world();
  const said = w.line(1, 'Iron Ore', 50, 10);
  const row = (w.api.books()[0].prices || []).filter(function (r) { return r.name === 'Iron Ore'; })[0];
  yes('C4 a line buying at 50 and selling at 10 is refused when it is set ("' + said + '")', !/^Set /.test(said) && !row);
  yes('C4 and the refusal says why in words, with no command in it', /buy/i.test(said) && /sell/i.test(said) && !/\/book/.test(said));
  yes('C4 a line buying at what it sells for is set', /^Set /.test(w.line(1, 'Leather', 12, 12)));
}

// ------------------------------------- C5 a crossed line saved before
{
  const w = world();
  w.line(1, 'Iron Ore', 10, 20); w.submit(1, 'whiterun');
  const file = path.join(w.dir, 'books.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = Object.keys(saved.ledgers.whiterun)[0];
  saved.ledgers.whiterun[id].prices[0].buy = 90;
  saved.books.forEach(function (b) { if (b.id === id) { b.prices[0].buy = 90; } });
  fs.writeFileSync(file, JSON.stringify(saved));
  let w2 = null, why = '';
  try { w2 = world(w.dir); } catch (e) { why = e.message; }
  yes('C5 a crossed line saved before the rule still loads (' + (why || 'loaded') + ')', !!w2);
  if (w2) {
    const c = crossings(w2, 'whiterun', ['Iron Ore']);
    yes('C5 and no trader is quoted a buy above a sell because of it (' + (c[0] || 'none') + ')', c.length === 0);
  }
}

// ------------------------------------------------- C6 ordinary averages
{
  const w = world();
  w.line(1, 'Iron Ore', 10, 20); w.submit(1, 'whiterun');
  w.line(2, 'Iron Ore', 20, 30); w.submit(2, 'whiterun');
  const p = w.quote('whiterun', 'Iron Ore');
  yes('C6 10/20 and 20/30 at one hold still average to 15/25 (' + JSON.stringify(p) + ')', p.buy === 15 && p.sell === 25);
  const f = w.quote('solitude', 'Iron Ore');
  yes('C6 and a hold with no line of its own borrows that pair whole (' + JSON.stringify(f) + ')', f.buy === 15 && f.sell === 25);
}

// ------------------------------------------------- C7 a seeded sweep
{
  let seed = 4530;
  function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }
  const labels = ['Iron Ingot', 'Iron Ingots', 'Iron Ore', 'Leather', 'Leathers', 'Salt Pile'];
  const holds = ['whiterun', 'riften', 'solitude'];
  const found = [];
  for (let round = 0; round < 40; round++) {
    const w = world();
    for (let pid = 1; pid <= 4; pid++) {
      for (let k = 0; k < 4; k++) {
        const kind = rnd(3);
        const a = rnd(60), b = rnd(60);
        const lo = Math.min(a, b), hi = Math.max(a, b);
        w.line(pid, labels[rnd(labels.length)], kind === 1 ? null : lo, kind === 2 ? null : hi);
      }
      w.submit(pid, holds[rnd(holds.length)]);
    }
    holds.forEach(function (h) { crossings(w, h, labels).forEach(function (x) { found.push('round ' + round + ', ' + x); }); });
  }
  yes('C7 40 rounds of four books over three holds: no item at any hold is quoted a buy above a sell (' + found.length + ' found' + (found.length ? ', first: ' + found[0] : '') + ')', found.length === 0);
}

// ------------------------------- C8 only one-sided lines: not traded
{
  const w = world();
  w.line(1, 'Salt Pile', 4, null); w.submit(1, 'whiterun');
  w.line(2, 'Salt Pile', null, 9); w.submit(2, 'riften');
  const traded = ['whiterun', 'riften', 'solitude'].filter(function (h) {
    const q = w.quote(h, 'Salt Pile');
    const listed = (w.api.catalog(h) || []).some(function (r) { return r.name === 'Salt Pile'; });
    return q.buy !== null || q.sell !== null || listed;
  });
  yes('C8 Salt Pile priced only by a buy-only and a sell-only line is not traded at any hold (' + (traded.join(', ') || 'none') + ')', traded.length === 0);
  const kept = w.api.books().filter(function (b) {
    return (b.prices || []).some(function (r) { return r.name === 'Salt Pile'; });
  });
  yes('C8 and both one-sided lines stay in their books', kept.length === 2);
  w.line(3, 'Salt Pile', 5, 8); w.submit(3, 'whiterun');
  const now = w.quote('whiterun', 'Salt Pile');
  yes('C8 a line with both, once it comes in, prices it (' + JSON.stringify(now) + ')', now.buy === 5 && now.sell === 8);
}

done();
