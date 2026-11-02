'use strict';
/*
  test-scenario-offices.js

  Scenario: systems/offices.md

  #5198. Windhelm's offices and its jail, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them.

  The site's list of Discord roles names Svana's account Jarl of Windhelm
  and Torvar's Guard of Windhelm. Corvin holds nothing.

    A  Svana chooses this character for Jarl of Windhelm on the Office page.
       She names Torvar Guard of Windhelm, a role his account holds, and the
       office is his character's. Corvin cannot name anybody to anything.
    B  At a cell door of Windhelm Barracks, Corvin, no guard, cannot lock it.
       Torvar opens it and locks it: law.json has the cell locked, the lock
       list shuts it for Corvin and leaves it open for the guard, and Corvin
       standing by hears it lock.
    C  Corvin's honest client never sends the press on the locked cell. A
       client whose lock script did not run sends it, and onActivate
       refuses it: the cell stays shut and he is told only a guard opens it.
       Torvar opens it.
    D  The jail building is the Jarl's alone: Corvin's claim at its door is
       refused and nothing is written; Svana claims it.
    E  A restart: the cell is still locked and Torvar still the guard. He
       unlocks it and it opens for Corvin.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-offices.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({
  name: 'offices',
  files: {
    'private/allowed.json': {
      profiles: [3000, 3001, 1002],
      accounts: { 3000: 'acct-svana', 3001: 'acct-torvar', 1002: 'acct-corvin' },
      offices: { 3000: { jarl: ['windhelm'] }, 3001: { guard: ['windhelm'] } }
    }
  }
});

// --------------------------------------------------------- the barracks --
const BARRACKS = '1677a:Skyrim.esm';             // the jail's room, and the building
const CELL_DESC = 'd61e5:Skyrim.esm';            // a cell door in it the game ships unlocked (game/data/jails.json)
const FRONT_DESC = 'c0e0d:Skyrim.esm';           // the barracks' door in from the street
const CELL_BASE = '40bb2:Skyrim.esm', DOOR_BASE = '1a6f4:Skyrim.esm';
w.record(CELL_BASE, 'DOOR');
w.record(DOOR_BASE, 'DOOR');
const CELL = w.ref(w.idOf(CELL_DESC), { base: CELL_BASE, cell: BARRACKS, pos: [0, 0, 0] });
const FRONT = w.ref(w.idOf(FRONT_DESC), { base: DOOR_BASE, cell: BARRACKS, pos: [0, 600, 0] });

const SVANA = w.person(0xff000900, { profileId: 3000, name: 'Svana', town: 'windhelm', cell: BARRACKS, pos: [0, 500, 0] });
const TORVAR = w.person(0xff000901, { profileId: 3001, name: 'Torvar', town: 'windhelm', cell: BARRACKS, pos: [40, 0, 0] });
const CORVIN = w.person(0xff000902, { profileId: 1002, name: 'Corvin', town: 'windhelm', cell: BARRACKS, pos: [-40, 0, 0] });

yes('P0 the whole gamemode loads over the stand-in', w.boot() || !console.log(w.loadError()));
if (!w.loaded()) { t.done(w); }
[SVANA, TORVAR, CORVIN].forEach(w.arrive);
w.run(30000);
const P = () => w.box().__thornswoodProperty;
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function law() { return w.readPrivate('law.json') || {}; }
function shutFor(a, id) { const l = w.prop(a, 'thornswoodLocks'); return !!l && Array.isArray(l.shut) && l.shut.indexOf(id) >= 0; }
function openFor(a, id) { const l = w.prop(a, 'thornswoodLocks'); return !!l && Array.isArray(l.open) && l.open.indexOf(id) >= 0; }
const hex = CELL.toString(16);

// ------------------------------------------------------------ A. offices --
yes('A0 the barracks are Windhelm\'s jail', P().jailOfBuilding(BARRACKS) === 'windhelm' && P().jailHoldOf(CELL_DESC) === 'windhelm');
w.say(CORVIN, '/office guard windhelm 1002');
yes('A1 Corvin cannot name anybody to anything (' + last(CORVIN) + ')', /Only the Jarl of Windhelm gives its offices/.test(last(CORVIN)) &&
    !P().isGuard(1002, 'windhelm'));
w.say(SVANA, '/office hold jarl windhelm');
yes('A2 Svana chooses this character for Jarl of Windhelm (' + last(SVANA) + ')', P().isJarlOf(3000, 'windhelm'));
yes('A2 Torvar is no guard until somebody puts a character in the office', !P().isGuard(3001, 'windhelm'));
w.say(SVANA, '/office guard windhelm 3001');
yes('A3 she names Torvar Guard of Windhelm, a role his account holds (' + last(SVANA) + ')',
    /Torvar holds Guard of Windhelm now/.test(last(SVANA)) && P().isGuard(3001, 'windhelm'));
yes('A3 and he is told', w.heard(TORVAR).some(function (l) { return /names this character Guard of Windhelm/.test(l); }));

// ------------------------------------------------------------- B. a cell --
w.activate(CELL, CORVIN);
w.say(CORVIN, '/lock ' + hex);
yes('B1 Corvin cannot lock a cell (' + last(CORVIN) + ')', last(CORVIN) === 'A cell is a guard\'s to lock.' && !(law().cells || {})[CELL_DESC]);
let heardAt = w.heard(CORVIN).length;
const b2 = w.activate(CELL, TORVAR);
yes('B2 Torvar opens the cell door', b2.allowed && b2.opened);
w.say(TORVAR, '/lock ' + hex);
yes('B2 and locks it: law.json has the cell locked (' + last(TORVAR) + ')', (law().cells || {})[CELL_DESC] === true);
yes('B2 the lock list shuts it for Corvin and leaves it open for the guard', shutFor(CORVIN, CELL) && openFor(TORVAR, CELL) && !shutFor(TORVAR, CELL));
yes('B2 Corvin, standing by, hears it lock', w.heardSince(CORVIN, heardAt).indexOf('The cell door is locked.') >= 0);

// ---------------------------------------------------------- C. shut in --
yes('C1 Corvin\'s honest client never sends the press on the locked cell', w.honestActivate(CELL, CORVIN).notSent === true);
heardAt = w.heard(CORVIN).length;
const c2 = w.activate(CELL, CORVIN);
yes('C2 a client whose lock did not run sends it: onActivate refuses and the cell stays shut', !c2.allowed && !c2.opened);
yes('C2 and he is told only a guard opens it (' + w.heardSince(CORVIN, heardAt).join(' | ') + ')',
    w.heardSince(CORVIN, heardAt).indexOf('The cell is locked, and only a guard of this hold opens it.') >= 0);
yes('C3 Torvar opens it', w.activate(CELL, TORVAR).opened);

// ----------------------------------------------------- D. the building --
w.activate(FRONT, CORVIN);
w.say(CORVIN, '/claim');
yes('D1 the jail is the Jarl\'s alone: Corvin\'s claim is refused and nothing is written (' + last(CORVIN) + ')',
    /is Windhelm's jail\. Only the Jarl of Windhelm claims it\./.test(last(CORVIN)) && !P().holderOf(BARRACKS));
w.activate(FRONT, SVANA);
w.say(SVANA, '/claim');
yes('D2 Svana claims it (' + last(SVANA) + ')', !!P().holderOf(BARRACKS) && P().holderOf(BARRACKS).by === 3000);
yes('D2 and her claim leaves the cell as the guard left it', (law().cells || {})[CELL_DESC] === true);

// ----------------------------------------------------------- E. restart --
const r = w.restart();
yes('E1 the server restarts and the gamemode loads again', r.loaded);
[SVANA, TORVAR, CORVIN].forEach(w.arrive);
w.run(30000);
yes('E1 the cell is still locked and Torvar still the guard', (law().cells || {})[CELL_DESC] === true && P().isGuard(3001, 'windhelm'));
yes('E1 Corvin is still refused at it', !w.activate(CELL, CORVIN).allowed);
w.activate(CELL, TORVAR);
w.say(TORVAR, '/unlock ' + hex);
yes('E2 Torvar unlocks it (' + last(TORVAR) + ')', (law().cells || {})[CELL_DESC] === false);
w.activate(FRONT, CORVIN); // any door sends his lock list again
yes('E2 and it opens for Corvin', !shutFor(CORVIN, CELL) && w.activate(CELL, CORVIN).opened);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
