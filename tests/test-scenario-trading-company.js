'use strict';
/*
  test-scenario-trading-company.js

  Scenario: systems/trading-company.md

  #5198. The Free Skyrim Trading Company, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js),
  every step a message the engine sends in the order it sends them. A haul
  is the notice board's Send a haul, Take, Hand it back and Confirm, each a
  line the board's panel sends through the voice queue; a sale out of Skyrim
  is the trade panel's Buy for the company. The boards and the ledgers on
  disk are private/property.json.

  Lydia posts from Falkreath's board. Faendal hauls. Brina holds the
  Steward of the Pale's role for Dawnstar. Torsten is a worker the company
  has taken on (its Discord role, as the site lists it); Ralof sells.

    A  Posting: an 80 gold haul to Dawnstar takes 110 from Lydia's pack, the
       30 fee and the pay in full, onto Falkreath's ledger, and the wall
       shows it with its pay and its town. One she cannot cover takes
       nothing; one to her own town, or away from a board, posts nothing.
    B  Taking it: Faendal takes it at Falkreath. It is confirmed only at
       Dawnstar's board, and never by the hauler.
    C  Confirming it: Lydia confirms at Dawnstar. Faendal is paid 72, the
       company keeps 8, and Falkreath's ledger keeps 38: the fee and the
       tenth.
    D  Coming down: a haul handed back returns the pay to Lydia and keeps
       the fee. A 25 gold haul the steward confirms while Faendal is away
       holds his 23 on the ledger, and he is handed it when he is back;
       Lydia is told a steward confirmed it. A haul under 10 gold keeps
       nothing for the company.
    E  A sale out of Skyrim: Ralof cannot press Buy for the company.
       Torsten does, Ralof puts up a ruby, Torsten 50 gold: the ruby leaves
       the world, Ralof receives 40, Torsten keeps his 5, and 5 leaves the
       server. No ledger moves.
    F  A restart: the ledgers and the board are as they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  The company's terms themselves (fee, cut, a change of terms) are in
  tests/test-512-trading-company.js; a cart of cargo is the trade carts
  scenario's.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-trading-company.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({
  name: 'trading-company',
  files: {
    'private/allowed.json': {
      profiles: [1000, 1001, 1002, 1003, 1004],
      accounts: { 1000: 'acct-lydia', 1001: 'acct-faendal', 1002: 'acct-brina', 1003: 'acct-torsten', 1004: 'acct-ralof' },
      offices: { 1002: { steward: ['dawnstar'] } },
      companyProfiles: [1003]
    }
  }
});
const TAMRIEL = '3c:Skyrim.esm';
const FALKREATH = [-30342.2, -87022.7, -3119.1], DAWNSTAR = [32216.4, 102314, -13263];   // the boards' spots, BOARD_SITES
function near(spot, dx) { return [spot[0] + dx, spot[1], spot[2]]; }
w.record('593b:Thornswood-Content.esp', 'ACTI');
w.record('154d0:Thornswood-Content.esp', 'CONT');
const RUBY = '63b42:Skyrim.esm';
w.record(RUBY, 'MISC', { editorId: 'GemRuby' });
const GOLD = 0xf;

const LYDIA = w.person(0xff001700, { profileId: 1000, name: 'Lydia', town: 'falkreath', cell: TAMRIEL, pos: near(FALKREATH, 100),
  inventory: { entries: [{ baseId: GOLD, count: 300 }] } });
const FAENDAL = w.person(0xff001701, { profileId: 1001, name: 'Faendal', town: 'falkreath', cell: TAMRIEL, pos: near(FALKREATH, 140),
  inventory: { entries: [{ baseId: GOLD, count: 10 }] } });
const BRINA = w.person(0xff001702, { profileId: 1002, name: 'Brina', town: 'dawnstar', cell: TAMRIEL, pos: near(DAWNSTAR, 100) });
const TORSTEN = w.person(0xff001703, { profileId: 1003, name: 'Torsten', cell: TAMRIEL, pos: [0, 0, 0], inventory: { entries: [{ baseId: GOLD, count: 100 }] } });
const RALOF = w.person(0xff001704, { profileId: 1004, name: 'Ralof', cell: TAMRIEL, pos: [150, 0, 0],
  inventory: { entries: [{ baseId: GOLD, count: 5 }, { baseId: w.idOf(RUBY), count: 1 }] } });
const ALL = [LYDIA, FAENDAL, BRINA, TORSTEN, RALOF];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

const P = () => w.box().__thornswoodProperty;
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, line) { w.say(a, line); w.run(300); return last(a); }
function gold(a) { return w.count(a, GOLD); }
function fund(hold) { return Number(P().funds()[hold]) || 0; }
function wall(hold) { const r = w.readPrivate('property.json'); return (r && r.notices && r.notices[hold]) || []; }
function haul(n) { return wall('falkreath')[n - 1] || {}; }

// -------------------------------------------------------------- A. posting --
let g0 = gold(LYDIA), f0 = fund('falkreath');
say(LYDIA, '/haul 80 dawnstar a crate of salt');
yes('A1 an 80 gold haul to Dawnstar takes 110 from Lydia\'s pack (' + last(LYDIA) + ')',
    gold(LYDIA) === g0 - 110 && /^Your haul to dawnstar is on the board in falkreath, number 1\. That cost 110 gold: 30 for the board, and the 80 pay/.test(last(LYDIA)));
yes('A1 both onto Falkreath\'s ledger', fund('falkreath') === f0 + 110);
yes('A1 and the wall shows it, with its pay and its town', haul(1).haul === true && haul(1).dest === 'dawnstar' && haul(1).pay === 80 && haul(1).text === 'a crate of salt');
g0 = gold(LYDIA);
yes('A2 one she cannot cover takes nothing (' + say(LYDIA, '/haul 500 dawnstar a cart of ore') + ')',
    gold(LYDIA) === g0 && /you do not have it\. Nothing was taken\.$/.test(last(LYDIA)) && wall('falkreath').length === 1);
yes('A3 one to her own town posts nothing (' + say(LYDIA, '/haul 20 falkreath a sack') + ')',
    gold(LYDIA) === g0 && /from one hold to another/.test(last(LYDIA)) && wall('falkreath').length === 1);
w.moveTo(LYDIA, TAMRIEL, near(FALKREATH, 3000));
yes('A4 nor does one away from a board (' + say(LYDIA, '/haul 20 dawnstar a sack') + ')',
    gold(LYDIA) === g0 && /Stand at the board/.test(last(LYDIA)) && wall('falkreath').length === 1);
w.moveTo(LYDIA, TAMRIEL, near(FALKREATH, 100));

// ------------------------------------------------------------ B. taking it --
say(FAENDAL, '/take 1');
yes('B1 Faendal takes it at Falkreath (' + last(FAENDAL) + ')', haul(1).taken === 1001);
yes('B2 it is not confirmed at Falkreath (' + say(LYDIA, '/haul done falkreath 1') + ')',
    /That haul goes to dawnstar\. It is confirmed at dawnstar's board\./.test(last(LYDIA)) && !haul(1).down);
[LYDIA, FAENDAL].forEach(function (a, i) { w.moveTo(a, TAMRIEL, near(DAWNSTAR, 140 + 40 * i)); });
yes('B3 nor by the hauler (' + say(FAENDAL, '/haul done falkreath 1') + ')',
    /^Only the person who posted it, or a steward of/.test(last(FAENDAL)) && !haul(1).down);

// ---------------------------------------------------------- C. confirming --
g0 = gold(FAENDAL); f0 = fund('falkreath');
let heardAt = w.heard(FAENDAL).length;
say(LYDIA, '/haul done falkreath 1');
yes('C1 Lydia confirms at Dawnstar: Faendal is paid 72 and the company keeps 8 (' + last(LYDIA) + ')',
    gold(FAENDAL) === g0 + 72 && /Faendal is paid 72 gold out of falkreath's ledger, and the company keeps 8\./.test(last(LYDIA)) &&
    w.heardSince(FAENDAL, heardAt).indexOf('Your haul to dawnstar is confirmed. 72 gold is in your pack. The company kept 8.') >= 0);
yes('C2 Falkreath\'s ledger keeps 38 of the 110: the fee and the tenth', fund('falkreath') === f0 - 72 && fund('falkreath') === 38);
yes('C3 and the haul is down', !!haul(1).down && haul(1).paid === 72 && haul(1).kept === 8);

// --------------------------------------------------------- D. coming down --
[LYDIA, FAENDAL].forEach(function (a, i) { w.moveTo(a, TAMRIEL, near(FALKREATH, 100 + 40 * i)); });
say(LYDIA, '/haul 25 dawnstar a barrel of mead');
say(FAENDAL, '/take 2');
g0 = gold(LYDIA); f0 = fund('falkreath');
say(FAENDAL, '/dropjob 2');
yes('D1 a haul handed back returns the pay to Lydia and keeps the fee (' + last(FAENDAL) + ')',
    gold(LYDIA) === g0 + 25 && fund('falkreath') === f0 - 25 && !!haul(2).down);
say(LYDIA, '/haul 25 dawnstar a barrel of mead');
say(FAENDAL, '/take 3');
w.leave(FAENDAL);
w.run(2000);
say(BRINA, '/office hold steward dawnstar');
yes('D2 Brina takes the office of Steward at Dawnstar (' + last(BRINA) + ')', /holds Steward of /.test(last(BRINA)));
heardAt = w.heard(LYDIA).length;
say(BRINA, '/haul done falkreath 3');
yes('D2 she confirms Faendal\'s haul while he is away: his 23 is held on the ledger (' + last(BRINA) + ')',
    /Faendal is away, so the 23 gold is held on falkreath's ledger for them/.test(last(BRINA)) && haul(3).owed === 23 && haul(3).owedTo === 1001);
yes('D2 and Lydia is told a steward confirmed it (' + w.heardSince(LYDIA, heardAt).join(' | ') + ')',
    w.heardSince(LYDIA, heardAt).some(function (l) { return /^Your haul to dawnstar was confirmed by a steward\. Faendal is owed 23\./.test(l); }));
g0 = gold(FAENDAL); f0 = fund('falkreath');
w.arrive(FAENDAL);
w.run(15000);
yes('D3 he is handed the 23 when he is back, off the ledger', gold(FAENDAL) === g0 + 23 && fund('falkreath') === f0 - 23 && !haul(3).owed);
say(LYDIA, '/haul 9 dawnstar a letter');
say(FAENDAL, '/take 4');
[LYDIA, FAENDAL].forEach(function (a, i) { w.moveTo(a, TAMRIEL, near(DAWNSTAR, 140 + 40 * i)); });
g0 = gold(FAENDAL);
say(LYDIA, '/haul done falkreath 4');
yes('D4 a 9 gold haul keeps nothing for the company: Faendal is paid all 9 (' + last(LYDIA) + ')',
    gold(FAENDAL) === g0 + 9 && /Under 10 gold, the company keeps nothing\./.test(last(LYDIA)));

// ----------------------------------------------------- E. a sale out of Skyrim --
function hex(a) { return a.toString(16); }
function win(a) { return w.prop(a, 'thornswoodTrade') || {}; }
function line(a, name) { const l = (win(a).pack || []).find(function (x) { return x.n === name; }); return l ? '#' + l.p : ''; }
const funds0 = JSON.stringify(P().funds());
say(TORSTEN, '/trade ' + hex(RALOF));
say(RALOF, '/yes');
yes('E0 the trade opens', win(TORSTEN).open === true && win(RALOF).open === true);
yes('E1 Ralof cannot press Buy for the company (' + say(RALOF, '/trade sale') + ')',
    /^Only somebody the Free Skyrim Trading Company has taken on buys for it\./.test(last(RALOF)));
heardAt = w.heard(RALOF).length;
say(TORSTEN, '/trade sale');
yes('E2 Torsten does, and Ralof is told what it means (' + w.heardSince(RALOF, heardAt).join(' | ') + ')',
    w.heardSince(RALOF, heardAt).indexOf('Torsten is buying for the Free Skyrim Trading Company. What you put up leaves Skyrim and does not come back.') >= 0);
say(RALOF, '/trade add ' + line(RALOF, 'Gem Ruby') + ' 1');
say(TORSTEN, '/trade gold 50');
const rg = gold(RALOF), tg = gold(TORSTEN);
heardAt = w.heard(RALOF).length;
say(TORSTEN, '/trade ok');
say(RALOF, '/trade ok');
yes('E3 the ruby leaves the world, Ralof receives 40 and Torsten keeps his 5 (' + w.heardSince(RALOF, heardAt).join(' | ') + ')',
    w.count(RALOF, w.idOf(RUBY)) === 0 && w.count(TORSTEN, w.idOf(RUBY)) === 0 && gold(RALOF) === rg + 40 && gold(TORSTEN) === tg - 45 &&
    w.heardSince(RALOF, heardAt).some(function (l) { return /^Sold to the Free Skyrim Trading Company for 50 gold\..* You receive 40: 5 went to Torsten for handling it, and 5 left the world\./.test(l); }));
yes('E4 and no ledger moved', JSON.stringify(P().funds()) === funds0);

// ------------------------------------------------------------- F. restart --
const kept = JSON.stringify([w.readPrivate('property.json').notices.falkreath, P().funds()]);
const r = w.restart();
yes('F1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('F1 the ledgers and the board are as they were', JSON.stringify([w.readPrivate('property.json').notices.falkreath, P().funds()]) === kept);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
