'use strict';
/*
  test-scenario-property.js

  Scenario: systems/property.md

  #5198. A house, end to end, the way people use it: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them.

  Jorn's Home in Windhelm. Three people in the street, all finished
  characters: Brenna, a smith; Aldis, her friend; Corvin, a stranger.

    A  Brenna opens the front door: the engine asks onActivate, it allows,
       the door opens, and the door is written on her and named in her
       door line. She presses Claim (the lock key sends /claim): the claim
       is in the register on disk, the deed for Jorn's Home is in her pack,
       and the line says so. Corvin's /claim after hers is told it is held.
    B  She presses Lock (/lock): the register says locked, every person
       online gets the lock list with the front door shut for the two who
       hold nothing and open for her, and Corvin hears the lock from the
       street.
    C  Corvin's honest client never sends the press on the locked door.
       A client whose lock script did not run sends it, and onActivate
       refuses it: nothing opens and he is told the house is locked. The
       inside half of the door is a way out and is never refused, so
       somebody shut in walks out.
    D  Brenna presses the forge (the engine asks onActivate, the bench
       opens for her) and cuts a key to her own door (/key): no mold is
       needed for her own house, her hammer is in her pack, and a key to
       Jorn's Home is in it after, for one iron ingot. Without a hammer the
       same press is refused and nothing is made or spent.
    E  She opens a chest she has put down and puts the key in it; Aldis
       opens it when she has closed it, and takes the key: each step the
       engine refuses unless the container is held open by that person,
       and the key moves only when the gamemode allows it. With the key,
       Aldis passes the locked door and his lock list has it open.
    F  A restart: the claim, the lock and the key are where they were.
       Unlock (/unlock) opens the door to everyone, Corvin included.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-property.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'property' });

// ------------------------------------------------------------ the street --
const WINDHELM = '3c:Skyrim.esm';
const FRONT = w.idOf('11aeda:WindhelmSSE.esp');   // the front door, a way in
const INSIDE = w.idOf('115c5d:WindhelmSSE.esp');  // its inside half, a way out
const FORGE_BASE = '1a2ad:Skyrim.esm';    // a forge: BENCH_BY_BASE names it the smithing forge
const DEED = w.idOf('15493:Thornswood-Content.esp');
const KEY = w.idOf('15494:Thornswood-Content.esp');
const HAMMER = w.idOf('5cae1:Skyrim.esm');
const IRON = w.idOf('5ace4:Skyrim.esm');
const DOOR_BASE = '1a6f4:Skyrim.esm';
const CHEST_BASE = '1a6f3:Skyrim.esm';
w.record(DOOR_BASE, 'DOOR');
w.record(CHEST_BASE, 'CONT');
w.record(FORGE_BASE, 'FURN');
w.record('15493:Thornswood-Content.esp', 'BOOK');
w.record('15494:Thornswood-Content.esp', 'KEYM');
w.record('15495:Thornswood-Content.esp', 'MISC');

const STREET = [130000, -9000, 9000];
function at(dx, dy) { return [STREET[0] + dx, STREET[1] + dy, STREET[2]]; }
w.ref(FRONT, { base: DOOR_BASE, cell: WINDHELM, pos: at(0, 0) });
w.ref(INSIDE, { base: DOOR_BASE, cell: WINDHELM, pos: at(0, 40) });
const FORGE = w.ref(0xff200001, { base: FORGE_BASE, cell: WINDHELM, pos: at(300, 0) });
const CHEST = w.ref(0xff200002, { base: CHEST_BASE, cell: WINDHELM, pos: at(-200, 0) });

const BRENNA = w.person(0xff000800, { profileId: 1000, name: 'Brenna', prof: 'smith', town: 'windhelm', cell: WINDHELM, pos: at(60, 0),
  inventory: { entries: [{ baseId: 0xf, count: 40 }, { baseId: HAMMER, count: 1 }, { baseId: IRON, count: 2 }] } });
const ALDIS = w.person(0xff000801, { profileId: 1001, name: 'Aldis', prof: 'cook', town: 'windhelm', cell: WINDHELM, pos: at(-150, 0) });
const CORVIN = w.person(0xff000802, { profileId: 1002, name: 'Corvin', prof: 'tailor', town: 'windhelm', cell: WINDHELM, pos: at(80, 80) });
// Well fed, rested and warm, so nothing about the body refuses a craft.
[BRENNA, ALDIS, CORVIN].forEach(function (a) {
  w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() };
});

yes('P0 the whole gamemode loads over the stand-in' + (w.loaded() ? '' : ''), w.boot() || !console.log(w.loadError()));
if (!w.loaded()) { t.done(w); }
[BRENNA, ALDIS, CORVIN].forEach(w.arrive);
w.run(30000);
const P = w.box().__thornswoodProperty;
yes('P0 the property block is loaded and knows the house', !!P && P.buildingOf('11aeda:WindhelmSSE.esp') === '115c21:WindhelmSSE.esp');
const HOUSE = '115c21:WindhelmSSE.esp';

function lastLine(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function claimOnDisk() { const r = w.readPrivate('property.json'); return r && r.claims ? r.claims[HOUSE] : null; }
function deedIn(a) { return (w.row(a).inventory.entries || []).filter(function (e) { return e.baseId === DEED && /Jorn/.test(e.name || ''); }).length; }
function keyIn(id, label) { return (w.row(id).inventory.entries || []).filter(function (e) { return e.baseId === KEY && e.name === label; }).reduce(function (n, e) { return n + e.count; }, 0); }
function shutFor(a) { const l = w.prop(a, 'thornswoodLocks'); return !!l && Array.isArray(l.shut) && l.shut.indexOf(FRONT) >= 0; }
function openFor(a) { const l = w.prop(a, 'thornswoodLocks'); return !!l && Array.isArray(l.open) && l.open.indexOf(FRONT) >= 0; }

// ------------------------------------------------------------ A. claim --
const a1 = w.activate(FRONT, BRENNA);
yes('A1 the front door: onActivate allows it and the door opens', a1.allowed && a1.opened);
const door = w.prop(BRENNA, 'thornswoodDoor');
yes('A1 the door she opened is written on her', !!door && door.door === '11aeda:WindhelmSSE.esp');
yes('A1 and her door line names the house', JSON.stringify(w.prop(BRENNA, 'thornswoodDoorLine') || '').indexOf('Jorn') >= 0);
w.say(BRENNA, '/claim');
const c = claimOnDisk();
yes('A2 Claim puts the claim in the register on disk, hers and open (' + JSON.stringify(c) + ')',
    !!c && c.by === 1000 && c.name === 'Brenna' && c.locked === false);
yes('A2 the deed to Jorn\'s Home is in her pack', deedIn(BRENNA) === 1);
yes('A2 and the line says so (' + lastLine(BRENNA) + ')', /^You claim Jorn's Home\. The deed is in your pack/.test(lastLine(BRENNA)));
w.activate(FRONT, CORVIN);
w.say(CORVIN, '/claim');
yes('A3 Corvin\'s claim after hers is told it is held, and the register is unchanged (' + lastLine(CORVIN) + ')',
    /is held by Brenna/.test(lastLine(CORVIN)) && claimOnDisk().by === 1000 && deedIn(CORVIN) === 0);

// ------------------------------------------------------------- B. lock --
let corvinHeard = w.heard(CORVIN).length;
w.activate(FRONT, BRENNA);
w.say(BRENNA, '/lock');
yes('B1 Lock: the register says locked', claimOnDisk().locked === true);
yes('B1 the lock list shuts the front door for Aldis and Corvin, and leaves it open for her',
    shutFor(ALDIS) && shutFor(CORVIN) && !shutFor(BRENNA) && openFor(BRENNA));
yes('B2 Corvin hears the lock from the street (' + w.heardSince(CORVIN, corvinHeard).join(' | ') + ')',
    w.heardSince(CORVIN, corvinHeard).some(function (l) { return /Jorn's Home is locked for everyone now/.test(l); }));

// ------------------------------------------------------- C. the stranger --
const c1 = w.honestActivate(FRONT, CORVIN);
yes('C1 Corvin\'s honest client never sends the press on the locked door', c1.notSent === true);
corvinHeard = w.heard(CORVIN).length;
const c2 = w.activate(FRONT, CORVIN);
yes('C2 a client whose lock did not run sends it: onActivate refuses and nothing opens', !c2.allowed && !c2.opened);
yes('C2 and he is told the house is locked (' + w.heardSince(CORVIN, corvinHeard).join(' | ') + ')',
    w.heardSince(CORVIN, corvinHeard).indexOf('Jorn\'s Home is locked and you have no key.') >= 0);
const c3 = w.activate(INSIDE, CORVIN);
yes('C3 the inside half is a way out and is never refused', c3.allowed && c3.opened);

// ------------------------------------------------------------ D. a key --
const LABEL = P.keyLabel(HOUSE);
w.give(BRENNA, HAMMER, 0);
let d0 = w.activate(FORGE, BRENNA);
yes('D1 the forge: onActivate allows it and the bench is hers', d0.allowed && d0.opened && w.holds(FORGE) === BRENNA);
w.say(BRENNA, '/key');
yes('D1 a key to her own door is cut with no mold, for one iron ingot (' + lastLine(BRENNA) + ')', keyIn(BRENNA, LABEL) === 1 && w.count(BRENNA, IRON) === 1);
// Without the hammer the same press is refused.
const hammerRow = w.row(BRENNA).inventory.entries.find(function (e) { return e.baseId === HAMMER; });
w.row(BRENNA).inventory.entries = w.row(BRENNA).inventory.entries.filter(function (e) { return e.baseId !== HAMMER; });
w.say(BRENNA, '/key');
yes('D2 without a hammer it is refused and nothing is made (' + lastLine(BRENNA) + ')',
    /hammer/.test(lastLine(BRENNA)) && keyIn(BRENNA, LABEL) === 1 && w.count(BRENNA, IRON) === 1);
w.row(BRENNA).inventory.entries.push(hammerRow);
w.activate(FORGE, BRENNA); // leaves the bench

// --------------------------------------------- E. the key changes hands --
const e0 = w.put(CHEST, BRENNA, KEY, 1, LABEL);
yes('E1 putting the key in a chest she has not opened is refused by the engine before any event', !e0.sent && keyIn(BRENNA, LABEL) === 1);
yes('E1 she opens the chest', w.activate(CHEST, BRENNA).opened && w.holds(CHEST) === BRENNA);
const e1 = w.put(CHEST, BRENNA, KEY, 1, LABEL);
yes('E1 onPutItem allows the key and it leaves her pack for the chest', e1.allowed && e1.moved && keyIn(BRENNA, LABEL) === 0 && keyIn(CHEST, LABEL) === 1);
const e2 = w.take(CHEST, ALDIS, KEY, 1, LABEL);
yes('E2 Aldis cannot take from a chest she holds open', !e2.sent && keyIn(CHEST, LABEL) === 1);
w.activate(CHEST, BRENNA); // closes it: the second activation, no event
yes('E2 she closes it', w.holds(CHEST) === 0 && !w.prop(CHEST, 'isOpen'));
yes('E2 Aldis opens it', w.activate(CHEST, ALDIS).opened);
const e3 = w.take(CHEST, ALDIS, KEY, 1, LABEL);
yes('E2 onTakeItem allows it and the key is his', e3.allowed && e3.moved && keyIn(ALDIS, LABEL) === 1);
w.activate(CHEST, ALDIS);
w.activate(INSIDE, ALDIS); // any door pushes his lock list again
const e4 = w.activate(FRONT, ALDIS);
yes('E3 with the key he passes the locked door, and his lock list has it open', e4.allowed && e4.opened && openFor(ALDIS) && !shutFor(ALDIS));

// ---------------------------------------------------------- F. restart --
const before = JSON.stringify(claimOnDisk());
const r = w.restart();
yes('F1 the server restarts and the gamemode loads again', r.loaded);
[BRENNA, ALDIS, CORVIN].forEach(w.arrive);
w.run(30000);
yes('F1 the claim and the lock are what they were', JSON.stringify(claimOnDisk()) === before && w.box().__thornswoodProperty.holderOf(HOUSE).by === 1000);
yes('F1 the deed and the key are where they were', deedIn(BRENNA) === 1 && keyIn(ALDIS, LABEL) === 1);
yes('F1 Corvin is still refused at the door', !w.activate(FRONT, CORVIN).allowed);
w.activate(FRONT, BRENNA);
w.say(BRENNA, '/unlock');
yes('F2 Unlock: the register says open', claimOnDisk().locked === false);
w.activate(INSIDE, CORVIN);
yes('F2 and the door opens for Corvin', w.activate(FRONT, CORVIN).opened && !shutFor(CORVIN));

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
