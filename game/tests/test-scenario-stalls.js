'use strict';
/*
  test-scenario-stalls.js

  Scenario: systems/stalls.md

  #5198. A market stall in Whiterun, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. The lock key
  at a stall sends /stall open and the stall's id, and every button on the
  stall's panel is a /stall line through the voice queue, as the panel sends
  it; what the panel draws is the thornswoodStallView property the server
  writes for the person who opened it. The register on disk is
  private/market-stalls.json.

  Alice keeps a stall in Whiterun's market and sells there. Bob buys. Hroki
  is the Steward of Whiterun by the Discord role the site lists. Sam is
  staff. Dagny kept the stall beside Alice's, and has not opened its panel
  for 15 days.

    A  At start Dagny's stall has lapsed: it is free, and the salt she had
       on it waits in Whiterun's drop box, for her.
    B  Away from a stall the lock key's line opens nothing. At a free stall
       the panel offers Claim, and Claim makes it Alice's for nothing. Bob
       cannot claim it while she keeps it, and is never told who keeps it.
    C  Alice's panel lists what she carries, not gold and not what she
       wears. She lays out 2 swords at 30 gold, and they leave her pack.
       Gold is refused as goods. Find turns up Iron Ingot, and she lays out
       3 salt at 2 Iron Ingot a piece.
    D  Bob sees the wares, their prices and that the keeper is here. He buys
       a sword: 30 gold from his pack to hers, the sword to him, and she is
       told in her chat, as a chat line (#5473). He buys 2 salt for 4 Iron
       Ingot, which go to her. More gold than he carries is refused, and
       nothing moves.
    E  With Alice walked away, the panel says the keeper is away and nothing
       is sold. Out of the world, even standing there, nothing is sold
       either. She cannot buy from her own stall.
    F  Alice changes a price to goods, and Bob cannot. She takes a sword
       back into her pack.
    G  A restart: the stall is still hers, with what is on it, and sells.
       She lays out one more salt, at 5 gold.
    H  Bob cannot end her keeping. Hroki, once this character holds the
       office, ends it: the stall is free, the salt is in Whiterun's drop box
       for her, and the staff log has nothing. She claims it again and Sam
       ends it as staff: one line in the staff log, an eviction, naming the
       stall. She claims it again and lets it go.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  When a pack will not take a write, a deleted character's stall and a
  register that does not read are driven in tests/test-3160-market-stalls.js,
  which can make a write fail; the stand-in's packs always take one.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-stalls.js
*/
const path = require('path');
const standIn = require('../../tests/stand-in-server.js');
const BOOK = require(path.join(__dirname, '..', '..', 'game', 'market-stalls.js'));
const TABLE = require(path.join(__dirname, '..', '..', 'game', 'data', 'market-stalls.json')).stalls;
const t = standIn.checks();
const yes = t.yes;

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 26, 18, 0, 0);
const GOLD = 0xf, SWORD = 0x12eb7, INGOT = 0x5ace4, SALT = 0x34cdf;
const HERS = 'whiterun-5b2e4', DAGNYS = 'whiterun-5bee6';
const stallRow = function (id) { return TABLE.filter(function (s) { return s.id === id; })[0]; };
const ROW = stallRow(HERS);

// Dagny claimed the next stall and laid out salt 15 days before this start.
const DAGNY_ID = 0xff000904;
const before = BOOK.emptyState();
const T = BOOK.checkTable([stallRow(DAGNYS)]);
BOOK.claim(before, T[DAGNYS], { actor: DAGNY_ID, profile: 1003 }, START - 15 * DAY);
BOOK.lay(before, DAGNYS, { actor: DAGNY_ID, profile: 1003 }, { baseId: SALT, count: 2 }, { gold: 4 });

const w = standIn.world({
  name: 'stalls', start: START,
  settings: { thornswoodDevs: [1006] },
  files: {
    'private/allowed.json': {
      profiles: [1000, 1001, 1003, 1006, 2000],
      accounts: { 1000: 'acct-alice', 1001: 'acct-bob', 1003: 'acct-dagny', 1006: 'acct-sam', 2000: 'acct-hroki' },
      offices: { 2000: { steward: ['whiterun'] } }
    },
    'private/market-stalls.json': BOOK.saveRegister(before)
  }
});

const CITY = ROW.world;
function at(dx) { return [ROW.pos[0] + dx, ROW.pos[1], ROW.pos[2]]; }
const AWAY = [ROW.pos[0] + 3000, ROW.pos[1], ROW.pos[2]];
const ALICE = w.person(0xff000900, { profileId: 1000, name: 'Alice', town: 'whiterun', cell: CITY, pos: AWAY,
  inventory: { entries: [{ baseId: GOLD, count: 100 }, { baseId: SWORD, count: 3 }, { baseId: SALT, count: 5 },
                         { baseId: SWORD, count: 1, worn: true }] } });
const BOB = w.person(0xff000901, { profileId: 1001, name: 'Bob', town: 'whiterun', cell: CITY, pos: at(40),
  inventory: { entries: [{ baseId: GOLD, count: 100 }, { baseId: INGOT, count: 5 }] } });
const HROKI = w.person(0xff000902, { profileId: 2000, name: 'Hroki', town: 'whiterun', cell: CITY, pos: at(-40) });
const SAM = w.person(0xff000903, { profileId: 1006, name: 'Sam', town: 'whiterun', cell: CITY, pos: at(60) });
w.person(DAGNY_ID, { profileId: 1003, name: 'Dagny', town: 'whiterun', cell: CITY, pos: AWAY });
const EVERYONE = [ALICE, BOB, HROKI, SAM];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

const P = () => w.box().__thornswoodProperty;
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function view(a) { return w.prop(a, 'thornswoodStallView') || {}; }
function stall(a, line) { w.say(a, '/stall ' + line); return view(a); }
function count(a, base) {
  return (w.prop(a, 'inventory').entries || []).reduce(function (s, e) { return s + (e.baseId === base && !e.worn ? e.count : 0); }, 0);
}
function book() { return w.readPrivate('market-stalls.json').state; }
function boxItems() { return ((P().dropbox().whiterun || {}).items) || []; }
function staffLines() { return w.logged(/staff: .* evict /); }
function lineOf(v, what) { return (v.lines || []).filter(function (l) { return l.what === what; })[0]; }

// ---------------------------------------------------- A. Dagny's lapse --
yes('A1 at start Dagny\'s stall, 15 days untended, has lapsed and is free (' + JSON.stringify(Object.keys(book().stalls)) + ')',
    !book().stalls[DAGNYS] && book().out.length === 0);
yes('A1 and her salt waits in Whiterun\'s drop box, for her', boxItems().some(function (it) {
  return it.baseId === SALT && it.count === 2 && it.by === 1003 && it.kind === 'stall';
}));

// ------------------------------------------------------- B. claiming --
let v = stall(ALICE, 'open ' + HERS);
yes('B1 away from the stall the lock key\'s line opens nothing (' + last(ALICE) + ')',
    last(ALICE) === 'Stand at the stall.' && !w.prop(ALICE, 'thornswoodStallView'));
w.moveTo(ALICE, CITY, at(0));
v = stall(ALICE, 'open ' + HERS);
yes('B2 at the stall a free stall offers Claim', v.open && v.free && !v.mine && v.place === ROW.place);
v = stall(ALICE, 'claim');
yes('B3 Claim makes it hers, for nothing (' + v.said + ')', v.mine && !v.free && /^The stall is yours/.test(v.said) &&
    count(ALICE, GOLD) === 100 && book().stalls[HERS].keeper.profile === 1000);
stall(BOB, 'open ' + HERS);
v = stall(BOB, 'claim');
yes('B4 Bob cannot claim it while she keeps it (' + v.said + ')', /already keeps/.test(v.said) && !v.mine);
yes('B4 and is never told who keeps it', JSON.stringify(v).indexOf('Alice') < 0);

// ----------------------------------------------------- C. laying out --
v = stall(ALICE, 'open ' + HERS);
const swords = (v.pack || []).filter(function (x) { return x.what === 'Iron Sword'; });
yes('C1 her panel lists what she carries to lay out: not gold, not the sword she wears (' + JSON.stringify(swords) + ')',
    swords.length === 1 && swords[0].count === 3 && v.pack.every(function (x) { return x.what !== 'Gold'; }));
v = stall(ALICE, 'lay ' + SWORD.toString(16) + ' 0 2 gold 30');
yes('C2 she lays out 2 swords at 30 gold: they leave her pack and are on the stall (' + v.said + ')',
    count(ALICE, SWORD) === 1 && v.lines.length === 1 && v.lines[0].count === 2 && v.lines[0].words === '30 gold');
v = stall(ALICE, 'lay ' + GOLD.toString(16) + ' 0 10 gold 1');
yes('C3 gold is refused as goods, and nothing moves (' + v.said + ')', /price, not goods/.test(v.said) && count(ALICE, GOLD) === 100);
v = stall(ALICE, 'find iron ingot');
yes('C4 Find turns up Iron Ingot for a goods price', (v.found || []).some(function (f) { return f.name === 'Iron Ingot' && f.base === INGOT.toString(16); }));
v = stall(ALICE, 'lay ' + SALT.toString(16) + ' 0 3 goods ' + INGOT.toString(16) + ' 2');
const salt = lineOf(v, 'Salt Pile');
yes('C5 she lays out 3 salt at 2 Iron Ingot a piece (' + JSON.stringify(salt) + ')',
    !!salt && salt.count === 3 && salt.words === '2 Iron Ingot' && count(ALICE, SALT) === 2);
const sword = lineOf(v, 'Iron Sword');

// --------------------------------------------------------- D. buying --
v = stall(BOB, 'open ' + HERS);
yes('D1 Bob sees the wares, their prices and that the keeper is here, with no keeper controls',
    v.lines.length === 2 && v.keeperHere === true && !v.mine && !('pack' in v) && v.packGold === 100);
let heardAt = w.heard(ALICE).length;
v = stall(BOB, 'buy ' + sword.n + ' 1');
yes('D2 Bob buys a sword: 30 gold from his pack to hers, the sword to him, one off the line (' + v.said + ')',
    v.said === 'Bought Iron Sword.' && count(BOB, GOLD) === 70 && count(ALICE, GOLD) === 130 && count(BOB, SWORD) === 1 &&
    lineOf(v, 'Iron Sword').count === 1);
yes('D2 and she is told in her chat what sold, as a chat line (#5473) (' + w.heardSince(ALICE, heardAt).join(' | ') + ')',
    w.heardSince(ALICE, heardAt).indexOf('Iron Sword sold for 30 gold.') >= 0);
v = stall(BOB, 'buy ' + salt.n + ' 2');
yes('D3 he buys 2 salt for 4 Iron Ingot, and the ingots go to her (' + v.said + ')',
    count(BOB, SALT) === 2 && count(BOB, INGOT) === 1 && count(ALICE, INGOT) === 4 && count(BOB, GOLD) === 70);
w.give(BOB, GOLD, -60);
v = stall(BOB, 'buy ' + sword.n + ' 1');
yes('D4 more gold than he carries is refused, and nothing moves (' + v.said + ')',
    v.said === 'You do not carry 30 gold.' && count(BOB, GOLD) === 10 && count(ALICE, GOLD) === 130 && count(BOB, SWORD) === 1);
w.give(BOB, GOLD, 60);

// -------------------------------------------- E. only while she is there --
w.moveTo(ALICE, CITY, AWAY);
v = stall(BOB, 'open ' + HERS);
yes('E1 with Alice walked away, Bob\'s panel says the keeper is away', v.keeperHere === false);
v = stall(BOB, 'buy ' + sword.n + ' 1');
yes('E1 and nothing is sold, and nothing moves (' + v.said + ')',
    v.said === 'The keeper is not at the stall, so nothing is sold.' && count(BOB, GOLD) === 70 && count(BOB, SWORD) === 1);
w.moveTo(ALICE, CITY, at(0));
w.leave(ALICE);
v = stall(BOB, 'buy ' + sword.n + ' 1');
yes('E2 out of the world, even standing there, nothing is sold (' + v.said + ')',
    v.said === 'The keeper is not at the stall, so nothing is sold.' && count(BOB, SWORD) === 1);
w.arrive(ALICE);
w.run(30000);
stall(ALICE, 'open ' + HERS);
v = stall(ALICE, 'buy ' + sword.n + ' 1');
yes('E3 she cannot buy from her own stall (' + v.said + ')', v.said === 'It is your own stall.');

// ---------------------------------------------- F. her prices, her goods --
v = stall(ALICE, 'price ' + sword.n + ' goods ' + INGOT.toString(16) + ' 3');
yes('F1 she changes the sword\'s price to goods (' + v.said + ')', lineOf(v, 'Iron Sword').words === '3 Iron Ingot');
stall(BOB, 'open ' + HERS);
v = stall(BOB, 'price ' + sword.n + ' gold 1');
yes('F1 and Bob cannot (' + v.said + ')', /not yours/.test(v.said) && book().stalls[HERS].lines.some(function (l) { return l.n === sword.n && l.price.goods; }));
v = stall(ALICE, 'back ' + sword.n + ' 1');
yes('F2 she takes the sword back into her pack (' + v.said + ')', count(ALICE, SWORD) === 2 && !lineOf(v, 'Iron Sword'));

// ------------------------------------------------------- G. restart --
const kept = JSON.stringify(book());
const r = w.restart();
yes('G1 the server restarts', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(30000);
v = stall(BOB, 'open ' + HERS);
yes('G1 the stall is still hers, with what is on it, and she is at it (' + v.lines.length + ' line)',
    JSON.stringify(book()) === kept && v.lines.length === 1 && v.keeperHere === true);
w.give(BOB, INGOT, 1);
v = stall(BOB, 'buy ' + lineOf(v, 'Salt Pile').n + ' 1');
yes('G2 and it sells (' + v.said + ')', v.said === 'Bought Salt Pile.' && count(BOB, SALT) === 3 && count(BOB, INGOT) === 0 && count(ALICE, INGOT) === 6);

stall(ALICE, 'open ' + HERS);
v = stall(ALICE, 'lay ' + SALT.toString(16) + ' 0 1 gold 5');
yes('G3 she lays out one more salt, at 5 gold (' + v.said + ')', lineOf(v, 'Salt Pile').words === '5 gold' && count(ALICE, SALT) === 1);

// --------------------------------------- H. a steward, staff, letting go --
v = stall(BOB, 'end');
yes('H1 Bob cannot end her keeping (' + v.said + ')', /^Only this hold's steward, or staff/.test(v.said) && !v.free);
w.say(HROKI, '/office hold steward whiterun');
yes('H2 Hroki chooses this character for Steward of Whiterun (' + last(HROKI) + ')', /holds Steward of Whiterun now/.test(last(HROKI)));
stall(HROKI, 'open ' + HERS);
const boxWas = boxItems().length;
v = stall(HROKI, 'end');
yes('H2 Hroki ends it: the stall is free (' + v.said + ')', v.free === true && !book().stalls[HERS]);
yes('H2 the salt left on it is in Whiterun\'s drop box for her, and the staff log has nothing',
    boxItems().length === boxWas + 1 && boxItems().slice(-1)[0].baseId === SALT && boxItems().slice(-1)[0].by === 1000 &&
    staffLines().length === 0);
stall(ALICE, 'open ' + HERS);
stall(ALICE, 'claim');
stall(SAM, 'open ' + HERS);
v = stall(SAM, 'end');
yes('H3 Sam ends it as staff, and the press is one line in the staff log, an eviction naming the stall (' + staffLines().join(' | ') + ')',
    v.free === true && staffLines().length === 1 && /Sam \(profile 1006\) evict Alice \(profile 1000\): the market stall Whiterun/.test(staffLines()[0]));
stall(ALICE, 'open ' + HERS);
stall(ALICE, 'claim');
v = stall(ALICE, 'letgo');
yes('H4 she lets it go, and it is free (' + v.said + ')', v.free === true && v.said === 'You let the stall go.' && !book().stalls[HERS]);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
