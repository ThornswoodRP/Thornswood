'use strict';
/*
  test-scenario-dungeon-loot.js

  Scenario: systems/dungeon-loot.md

  #5198. Dungeon loot, end to end: the WHOLE of game/gamemode.js over the
  stand-in server (tests/stand-in-server.js), every step a message the
  engine sends in the order it sends them. A chest is a container opened
  (onActivate, then the engine opens it); a body is a press on a dead actor;
  a death is onDying and onDeath. What a chest or a body paid is in the
  private ledger, private/dungeon-rewards-ledger.json, as on the live server. The dice
  are held where a roll is checked.

  Bob and Aldis are in a tier 1 cave. The cave has a draugr chest, a barrel
  and a burnt body (an urn by its record's name, and a person). A tier 2
  and a tier 4 place each have their boss chest; a tier 3 place has a
  chest. Whiterun's square has a chest too.

    A  Bob opens the tier 1 chest: the gold is inside the tier's span and
       the goods go into his pack, not the chest, and he is told what it
       held. The ledger holds the return.
    B  It pays once: Aldis opening it gets nothing, and neither does Bob
       again. After the tier's 30 minutes of rest it pays again.
    C  What does not pay: a barrel, a burnt body, a chest in a city, a chest
       somebody placed, and a chest opened from more than 400 units away.
    D  A tier 3 chest can hold a novice tome and a dungeon exclusive. The
       tier 2 boss chest pays the tier above's gold; the tier 4 boss chest
       pays tier 4, and when neither roll comes up it still holds a tome or
       an exclusive.
    E  Bodies: a camp bandit's pile is rolled at death and taken by the
       first search, said once, and a second search is silence (#5477). A
       draugr whose roll was empty says so once. Standing back up clears it, and the next
       life is a new roll. A person's body is not searched.
    F  A restart: the chest's rest and the searched body are as they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  The odds behind each row are driven in tests/test-dungeon-loot.js; the
  ledger's refusals of damaged state are tests/test-dungeon-reward-safety.js.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-dungeon-loot.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'dungeon-loot' });

/* A container base, named as its record's EDID says. */
function cont(desc, edid) {
  w.record(desc, 'CONT', { editorId: edid, fields: [{ type: 'EDID', data: Array.from(Buffer.from(edid + '\0', 'latin1')) }] });
  return desc;
}
const CHEST = cont('20671:Skyrim.esm', 'TreasDraugrChest');
const BARREL = cont('1ab9a:Skyrim.esm', 'BarrelFood01');
const BURNT = cont('35d8e:Skyrim.esm', 'TreasBurntCorpse01');
const BOSS = cont('3ac15:Skyrim.esm', 'TreasDraugrBossChest');

const CAVE = '1382e:Skyrim.esm';           // tier 1
const T2 = '151fb:Skyrim.esm';             // tier 2
const T3 = '151fc:Skyrim.esm';             // tier 3
const T4 = '142ed:Dragonborn.esm';         // tier 4
const CITY = '1a26f:Skyrim.esm';
const C1 = w.ref(w.idOf('3a100:Skyrim.esm'), { base: CHEST, cell: CAVE, pos: [0, 0, 0] });
const BAR = w.ref(w.idOf('3a101:Skyrim.esm'), { base: BARREL, cell: CAVE, pos: [60, 0, 0] });
const URN = w.ref(w.idOf('3a102:Skyrim.esm'), { base: BURNT, cell: CAVE, pos: [120, 0, 0] });
const FAR = w.ref(w.idOf('3a103:Skyrim.esm'), { base: CHEST, cell: CAVE, pos: [1000, 0, 0] });
const PLACED = w.ref(0xff200070, { base: CHEST, cell: CAVE, pos: [180, 0, 0] });
const C3 = w.ref(w.idOf('3a104:Skyrim.esm'), { base: CHEST, cell: T3, pos: [0, 0, 0] });
const B2 = w.ref(w.idOf('3a105:Skyrim.esm'), { base: BOSS, cell: T2, pos: [0, 0, 0] });
const B4 = w.ref(w.idOf('3a106:Skyrim.esm'), { base: BOSS, cell: T4, pos: [0, 0, 0] });
const CC = w.ref(w.idOf('3a107:Skyrim.esm'), { base: CHEST, cell: CITY, pos: [20000, -8000, -3500] });

// A camp bandit (the population catalogue names this one at a bandit camp) and a cave draugr.
const BANDIT_BASE = 'b623b:Skyrim.esm', DRAUGR_BASE = '567c8:Skyrim.esm';
w.record(BANDIT_BASE, 'NPC_');
w.record(DRAUGR_BASE, 'NPC_');
const BANDIT = w.ref(w.idOf('15a56:Skyrim.esm'), { base: BANDIT_BASE, type: 'NPC_', cell: CAVE, pos: [0, 200, 0] });
const DRAUGR = w.ref(w.idOf('1006ac:Skyrim.esm'), { base: DRAUGR_BASE, type: 'NPC_', cell: CAVE, pos: [0, 260, 0] });
[BANDIT, DRAUGR].forEach(function (n) { Object.assign(w.row(n), { profileId: -1, percentages: { health: 1, magicka: 1, stamina: 1 } }); });

const BOB = w.person(0xff001500, { profileId: 1000, name: 'Bob', cell: CAVE, pos: [40, 0, 0], inventory: { entries: [] } });
const ALDIS = w.person(0xff001501, { profileId: 1001, name: 'Aldis', cell: CAVE, pos: [40, 40, 0], inventory: { entries: [] } });
const ALL = [BOB, ALDIS];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

const L = w.box().__thornswoodDungeonLoot;
const GOLD = w.idOf('f:Skyrim.esm');
function packSize(a) { return (w.row(a).inventory.entries || []).reduce(function (n, e) { return n + e.count; }, 0); }
function ledger() { return w.readPrivate('dungeon-rewards-ledger.json') || { entries: {} }; }
/* Open a container the way a person does: a second press closes it first, as the engine has it. */
function open(ref, a) {
  if (w.row(ref).isOpen) { w.activate(ref, a); }
  const m = w.heard(a).length;
  const before = { gold: w.count(a, GOLD), size: packSize(a) };
  w.activate(ref, a);
  w.activate(ref, a);
  return { line: w.heardSince(a, m).join(' | '), gold: w.count(a, GOLD) - before.gold, got: packSize(a) - before.size };
}
function stand(a, cell, pos) { w.moveTo(a, cell, pos); }

// ------------------------------------------------------- A. the first chest --
w.dice(0.5);
const a1 = open(C1, BOB);
yes('A1 Bob opens the tier 1 chest: 10 gold, inside 5 to 15, and two goods into his pack (' + a1.line + ')',
    a1.gold === 10 && a1.got > 10 && /^The chest held 10 gold and /.test(a1.line));
yes('A1 the chest itself holds nothing', (w.row(C1).inventory.entries || []).length === 0);
const entry = (ledger() || { entries: {} }).entries['3a100:Skyrim.esm'];
yes('A2 the ledger holds the return: its time, tier, gold and goods (' + JSON.stringify(entry || {}).slice(0, 100) + ')',
    !!entry && entry.tier === 1 && entry.gold === 10 && entry.actor === BOB && entry.items.length > 0);

// ----------------------------------------------------------- B. it rests --
const b1 = open(C1, ALDIS);
yes('B1 Aldis opening it gets nothing (' + b1.line + ')', b1.got === 0 && b1.line === '');
const b2 = open(C1, BOB);
yes('B1 nor Bob again', b2.got === 0 && b2.line === '');
w.run(29 * 60 * 1000);
yes('B2 at 29 minutes it still rests', open(C1, ALDIS).got === 0);
w.run(60 * 1000 + 1000);
const b3 = open(C1, ALDIS);
yes('B2 after the tier\'s 30 minutes it pays again, to whoever opens it (' + b3.line + ')', b3.gold === 10 && /^The chest held/.test(b3.line));

// ------------------------------------------------------ C. what does not pay --
w.run(31 * 60 * 1000);
yes('C1 a barrel does not pay', open(BAR, BOB).got === 0);
yes('C2 a burnt body, an urn by its record\'s name, does not pay', open(URN, BOB).got === 0);
yes('C3 a chest somebody placed does not pay', open(PLACED, BOB).got === 0);
stand(BOB, CAVE, [1000 - 450, 0, 0]);
yes('C4 a chest opened from 450 units away does not pay', open(FAR, BOB).got === 0 && !ledger().entries['3a103:Skyrim.esm']);
stand(BOB, CITY, [20040, -8000, -3500]);
yes('C5 a chest in a city does not pay', open(CC, BOB).got === 0);

// ------------------------------------------------- D. tomes, exclusives, bosses --
w.dice(0.01);
stand(BOB, T3, [40, 0, 0]);
const d1 = open(C3, BOB);
yes('D1 a tier 3 chest can hold a novice tome and a dungeon exclusive (' + d1.line + ')',
    d1.gold === 25 && /Spell Tome: /.test(d1.line) && /Ancient Nord/.test(d1.line));
const novice = L.tomesFor(3).filter(function (x) { return x.rank === 'novice' || !x.rank; }).map(function (x) { return x.name; });
yes('D1 and the tome is a novice one', novice.some(function (n) { return d1.line.indexOf(n) >= 0; }));
w.dice(0.99);
stand(BOB, T2, [40, 0, 0]);
const d2 = open(B2, BOB);
yes('D2 the tier 2 boss chest pays the tier above\'s gold: 70, past tier 2\'s 35 (' + d2.line + ')', d2.gold === 70);
yes('D2 and holds a tome or an exclusive for certain, though neither roll came up', /Spell Tome: |Ancient Nord|Black Soul Gem/.test(d2.line));
stand(BOB, T4, [40, 0, 0]);
const d3 = open(B4, BOB);
yes('D3 the tier 4 boss chest pays tier 4, with no row above (' + d3.line + ')', d3.gold === 120 && /Spell Tome: |Ancient Nord|Black Soul Gem/.test(d3.line));
yes('D3 and the log says it was a boss chest that paid the tier above, for tier 2 only',
    w.logged(/\[dungeon\] tier 2 boss chest paid tier 3,/).length === 1 && w.logged(/\[dungeon\] tier 4 boss chest/).length === 0);
w.dice(null);

// --------------------------------------------------------------- E. bodies --
stand(BOB, CAVE, [40, 200, 0]);
stand(ALDIS, CAVE, [40, 240, 0]);
w.dice(0.01);
w.die(BANDIT, BOB, null);
w.dice(0.99);
w.die(DRAUGR, BOB, null);
w.dice(null);
const bandit = ledger().entries['15a56:Skyrim.esm'], draugr = ledger().entries['1006ac:Skyrim.esm'];
yes('E1 each pile is rolled at the death and kept on that life (' + JSON.stringify([bandit, draugr]).slice(0, 160) + ')',
    !!bandit && bandit.kind === 'body' && bandit.camp === true && bandit.taken === false && bandit.gold >= 1 &&
    !!draugr && draugr.kind === 'body' && draugr.camp === false && draugr.gold === 0 && draugr.items.length === 0);
let m = w.heard(BOB).length;
let gold = w.count(BOB, GOLD);
w.activate(BANDIT, BOB);
yes('E2 Bob\'s search of the camp bandit takes the pile (' + w.heardSince(BOB, m).join(' | ') + ')',
    w.count(BOB, GOLD) - gold === bandit.gold && w.heardSince(BOB, m).length === 1 && /^You take \d gold, .* off the body\.$/.test(w.heardSince(BOB, m)[0]));
m = w.heard(ALDIS).length;
w.activate(BANDIT, ALDIS);
yes('E2 and Aldis\'s, after him, is silence', w.heardSince(ALDIS, m).length === 0 && ledger().entries['15a56:Skyrim.esm'].taken === true);
m = w.heard(BOB).length;
w.activate(DRAUGR, BOB);
yes('E3 a draugr whose roll was empty says so, once in their chat (#5477) (' + w.heardSince(BOB, m).join(' | ') + ')', w.heardSince(BOB, m).join(' | ') === 'There is nothing on this body.');
m = w.heard(BOB).length;
w.activate(DRAUGR, BOB);
yes('E3 and a second search is silence', w.heardSince(BOB, m).length === 0);
w.respawn(DRAUGR);
yes('E4 standing back up clears it', !ledger().entries['1006ac:Skyrim.esm']);
w.dice(0.01);
w.die(DRAUGR, BOB, null);
w.dice(null);
yes('E4 and the next life is a new roll', ledger().entries['1006ac:Skyrim.esm'].gold === 1);
w.die(ALDIS, 0, null);
m = w.heard(BOB).length;
gold = w.count(BOB, GOLD);
w.activate(ALDIS, BOB);
yes('E5 a person\'s body is not searched', w.heardSince(BOB, m).length === 0 && w.count(BOB, GOLD) === gold && !ledger().entries[w.descOf(ALDIS)]);
w.respawn(ALDIS);

// ------------------------------------------------------------- F. restart --
stand(BOB, CAVE, [40, 0, 0]);
w.run(5 * 60 * 1000);
yes('F0 the tier 1 chest was opened again before the restart', open(C1, BOB).gold > 0);
const kept = JSON.stringify(ledger());
const r = w.restart();
yes('F1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('F1 the ledger is as it was', JSON.stringify(ledger()) === kept);
yes('F2 the chest still rests', open(C1, BOB).got === 0);
m = w.heard(ALDIS).length;
w.activate(BANDIT, ALDIS);
yes('F3 the searched bandit is still searched', w.heardSince(ALDIS, m).length === 0);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
