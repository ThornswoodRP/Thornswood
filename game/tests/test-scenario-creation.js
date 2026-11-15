'use strict';
/*
  test-scenario-creation.js

  Scenario: systems/creation.md

  #5198. Making a character, end to end: the WHOLE of game/gamemode.js over
  the stand-in server (tests/stand-in-server.js), every step a message the
  engine sends in the order it sends them. A brand new character comes into
  the world in the hall with nothing on them and no face; the face is the
  appearance the race menu stores, and its close is the plugin's /face done;
  every choice on the K panel is its /pick line through the voice queue; the
  Cook is an E press on the guild's Cook, the board a press on the board,
  and the work a strike at a seam.

  Nell is new and a Nord. Rikk is new and a riekling. Elder was made before
  any of this and is already in Whiterun.

    A  The hall: Nell arrives in the hall and creation begins. Her face is
       stored and the menu closes: she is dressed in the plain tunic and
       boots, and the K panel is the starting panel. Rikk, a riekling, is
       dressed in the riekling cut and footwraps instead.
    B  Home: confirming Whiterun sends her to its start spot, not its inn,
       and creation is over. She has 40 gold and nothing else, and one line
       says her first steps are on the panel behind K. Elder is shown none.
    C  Class and profession wait: before a class the seam turns her away.
       Picking Miner hands her a pickaxe; Smith and Platewright, a hammer.
    D  The first steps: the Cook gives the errand and names what is left;
       the board ticks its step; a strike at the seam ticks the work; back
       at the Cook the errand is done, the Cook names the guild's Smith,
       and the page is gone.
    E  A restart: she is in the world as she was, made, with her steps
       finished, and the hall does not take her back.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Change character, which is the launcher's and the front plugin's, is in
  tests/test-3128-switch.js.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-creation.js
*/
const fs = require('fs');
const path = require('path');
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'creation' });
const id = w.idOf;
const HALL = '19bad4:Skyrim Unbound.esp', HALL_POS = [3755.7, -495.7, -207.7];
const TAMRIEL = '3c:Skyrim.esm', START = [19189.1, -12006.5, -4558.4];   // Whiterun's start spot, chargen.json
const TUNIC = '1be1a:Skyrim.esm', BOOTS = '1be1b:Skyrim.esm';
const RTUNIC = 'bfd98:Playable Rieklings.esp', RWRAPS = 'bfdb1:Playable Rieklings.esp';
const RIEKLING = 'a6746:Playable Rieklings.esp';
[TUNIC, BOOTS, RTUNIC, RWRAPS].forEach(function (d) { w.record(d, 'ARMO'); });
const PICKAXE = 'e3c16:Skyrim.esm', IRON_ORE = '71cf3:Skyrim.esm', IRON_SEAM = '10dcc9:Skyrim.esm';
w.record(IRON_SEAM, 'ACTI');

// The Whiterun Cook, out of the guild's own list, where the server has them.
const TRADERS = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game', 'data', 'merchant-traders.json'), 'utf8').replace(/^﻿/, '')).byRef;
function traderOf(hold, role) {
  for (const ref in TRADERS) { if (TRADERS[ref].bookHold === hold && TRADERS[ref].role === role) { return Object.assign({ ref: ref }, TRADERS[ref]); } }
  return null;
}
const WCOOK = traderOf('whiterun', 'Cook');
yes('P0 the guild lists a Cook in Whiterun', !!WCOOK);
if (!WCOOK) { t.done(); }
w.record('13ba3:Skyrim.esm', 'NPC_');
const COOK = w.ref(id(WCOOK.ref), { base: '13ba3:Skyrim.esm', type: 'NPC_', cell: WCOOK.cell, pos: WCOOK.pos.slice(0, 3) });
Object.assign(w.row(COOK), { profileId: -1, percentages: { health: 1, magicka: 1, stamina: 1 } });
const SEAM = w.ref(0xff2000d0, { base: IRON_SEAM, cell: TAMRIEL, pos: [START[0] + 100, START[1], START[2]] });
// The Whiterun board stands beside its anchor, the chopping block.
const BOARD_BASE = '593b:Thornswood-Content.esp', BOX_BASE = '154d0:Thornswood-Content.esp';
w.record(BOARD_BASE, 'ACTI');
w.record(BOX_BASE, 'CONT');
w.record('1a2b3:Skyrim.esm', 'FURN');
const BOARD_SPOT = [23139.4, -7891.7, -3494.4];
w.ref(id('cdd7a:Skyrim.esm'), { base: '1a2b3:Skyrim.esm', cell: '1a26f:Skyrim.esm', pos: [BOARD_SPOT[0] + 550, BOARD_SPOT[1], BOARD_SPOT[2]] });

function newcomer(a) { const r = w.row(a); r.appearance = null; r.inventory = { entries: [] }; return a; }
const NELL = newcomer(w.person(0xff001a00, { profileId: 1000, name: 'Nell', finished: false, cell: HALL, pos: HALL_POS }));
const RIKK = newcomer(w.person(0xff001a01, { profileId: 1001, name: 'Rikk', finished: false, cell: HALL, pos: [HALL_POS[0] + 80, HALL_POS[1], HALL_POS[2]] }));
const ELDER = w.person(0xff001a02, { profileId: 1002, name: 'Elder', cell: '1a26f:Skyrim.esm', pos: [BOARD_SPOT[0] + 300, BOARD_SPOT[1], BOARD_SPOT[2]] });
const ALL = [NELL, RIKK, ELDER];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(12000);   // the hall waits out the arrival's ten second settle first

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, line) { w.say(a, line); w.run(300); return last(a); }
function stage(a) { return (w.prop(a, 'thornswoodChargen') || {}).stage; }
function ch(a) { return w.prop(a, 'thornswoodCharacter') || {}; }
function panel(a) { return ch(a).panel || {}; }
function steps(a) { const f = panel(a).firstSteps; const o = {}; ((f && f.steps) || []).forEach(function (s) { o[s.key] = s.done; }); return o; }
function packList(a) { return (w.row(a).inventory.entries || []).filter(function (e) { return e.count > 0; }).map(function (e) { return w.descOf(e.baseId) + ' x' + e.count; }).sort(); }
/* The race menu stores a face (the engine's appearance), and the plugin says it closed. */
function face(a, race) { w.row(a).appearance = { name: w.row(a).appearance ? w.row(a).appearance.name : 'Somebody', raceId: race, isFemale: false, weight: 50 }; w.say(a, '/face done'); w.run(3000); }

// --------------------------------------------------------------- A. the hall --
yes('A1 Nell arrives in the hall and creation begins (' + stage(NELL) + ')', stage(NELL) === 'appearance');
let heardAt = w.heard(NELL).length;
face(NELL, 0x13746);
yes('A2 her face is stored and the menu closes: the K panel is the starting panel (' + w.heardSince(NELL, heardAt).join(' | ') + ')',
    stage(NELL) === 'choosing' && panel(NELL).creating === true);
yes('A2 and she is dressed in the plain tunic and boots (' + packList(NELL).join(', ') + ')',
    w.count(NELL, id(TUNIC)) === 1 && w.count(NELL, id(BOOTS)) === 1);
face(RIKK, id(RIEKLING));
yes('A3 Rikk, a riekling, is dressed in the riekling cut and footwraps instead (' + packList(RIKK).join(', ') + ')',
    w.count(RIKK, id(RTUNIC)) === 1 && w.count(RIKK, id(RWRAPS)) === 1 && w.count(RIKK, id(TUNIC)) === 0 && w.count(RIKK, id(BOOTS)) === 0);

// ---------------------------------------------------------------- B. home --
heardAt = w.heard(NELL).length;
say(NELL, '/pick town whiterun');
w.run(3000);
const row = w.row(NELL);
yes('B1 confirming Whiterun sends her to its start spot, not its inn (' + row.worldOrCellDesc + ' ' + row.pos.map(Math.round).join(',') + ')',
    row.worldOrCellDesc === TAMRIEL && Math.hypot(row.pos[0] - START[0], row.pos[1] - START[1]) < 50);
yes('B1 and creation is over', stage(NELL) === 'done' && !panel(NELL).creating);
yes('B2 she has 40 gold and nothing else but her clothes (' + packList(NELL).join(', ') + ')',
    w.count(NELL, 0xf) === 40 && packList(NELL).length === 3);
yes('B3 one line says her first steps are on the panel behind K (' + w.heardSince(NELL, heardAt).join(' | ') + ')',
    w.heardSince(NELL, heardAt).filter(function (l) { return l === 'Your first steps in Whiterun are on the panel behind K.'; }).length === 1);
yes('B4 Elder, made before any of this, is shown none', !panel(ELDER).firstSteps && !w.prop(ELDER, 'thornswoodFirstSteps'));

// ------------------------------------------------- C. class and profession --
w.moveTo(NELL, TAMRIEL, [START[0] + 60, START[1], START[2]]);
yes('C1 before a class the seam turns her away (' + (w.activate(SEAM, NELL), w.run(300), last(NELL)) + ')',
    last(NELL) === 'You have not chosen a class yet. Press K and choose one.' && w.count(NELL, id(IRON_ORE)) === 0);
heardAt = w.heard(NELL).length;
say(NELL, '/pick class miner');
yes('C2 picking Miner hands her a pickaxe (' + w.heardSince(NELL, heardAt).join(' | ') + ')', ch(NELL).cls === 'miner' && w.count(NELL, id(PICKAXE)) === 1);
const before = packList(NELL).length;
heardAt = w.heard(NELL).length;
say(NELL, '/pick profession smith platewright');
yes('C3 Smith and Platewright, a hammer (' + w.heardSince(NELL, heardAt).join(' | ') + ')',
    ch(NELL).prof === 'smith' && ch(NELL).half === 'platewright' && packList(NELL).length === before + 1 && /hammer/i.test(w.heardSince(NELL, heardAt).join(' ')));
yes('C4 the pick step ticked', steps(NELL).pick === true);

// ---------------------------------------------------------- D. first steps --
function cook(a) { w.moveTo(a, WCOOK.cell, [WCOOK.pos[0] + 60, WCOOK.pos[1], WCOOK.pos[2]]); const m = w.heard(a).length; say(a, '/merchant e ' + COOK.toString(16)); return w.heardSince(a, m).filter(function (l) { return /^The Cook says: /.test(l); }).join(' | '); }
const d1 = cook(NELL);
yes('D1 the Cook gives the errand, and names what is left (' + d1 + ')', /^The Cook says: /.test(d1) && steps(NELL).cook === true && /notice board/.test(d1));
w.moveTo(NELL, '1a26f:Skyrim.esm', [BOARD_SPOT[0] + 60, BOARD_SPOT[1], BOARD_SPOT[2]]);
const board = (w.box().__thornswoodProperty.boards() || {}).whiterun;
w.activate(board.ref, NELL);
w.run(300);
yes('D2 the board ticks its step', steps(NELL).board === true);
w.moveTo(NELL, TAMRIEL, [START[0] + 60, START[1], START[2]]);
w.activate(SEAM, NELL);
w.run(900 + 300);
w.activate(SEAM, NELL);
yes('D3 a strike at the seam ticks the work (' + w.count(NELL, id(IRON_ORE)) + ' ore)', w.count(NELL, id(IRON_ORE)) >= 1 && steps(NELL).work === true);
const d4 = cook(NELL);
yes('D4 back at the Cook the errand is done, and the Cook names the guild\'s Smith (' + d4 + ')',
    /^The Cook says: /.test(d4) && /Smith/.test(d4) && !!(w.prop(NELL, 'thornswoodFirstSteps') || {}).done);
yes('D4 and the page is gone', !panel(NELL).firstSteps);

// ------------------------------------------------------------- E. restart --
const kept = JSON.stringify([w.prop(NELL, 'thornswoodChargen'), ch(NELL).cls, ch(NELL).prof, w.prop(NELL, 'thornswoodFirstSteps')]);
const r = w.restart();
yes('E1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('E1 she is made, with her steps finished, as she was',
    JSON.stringify([w.prop(NELL, 'thornswoodChargen'), ch(NELL).cls, ch(NELL).prof, w.prop(NELL, 'thornswoodFirstSteps')]) === kept);
yes('E2 and the hall does not take her back', w.row(NELL).worldOrCellDesc !== HALL && stage(NELL) === 'done' && w.count(NELL, 0xf) === 40);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
