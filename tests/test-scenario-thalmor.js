'use strict';
/*
  test-scenario-thalmor.js

  Scenario: systems/thalmor.md

  #5198. The Thalmor remnant, end to end: the WHOLE of game/gamemode.js over
  the stand-in server (tests/stand-in-server.js), every step a message the
  engine sends in the order it sends them. The roll is an admin's /remnant
  through the voice queue; the gear is onCraftWork and onCraft at a loom;
  what somebody wears is the engine's equipment. The roll on disk is
  private/embassy.json, beside the embassy's.

  Patrick is an admin by the site's roles. Ondolemar is a Liverywright
  whose application was accepted. Rhys is a Liverywright who never applied.
  Elenwen wears the game's own Thalmor Robes; Brenna wears iron.

    A  Somebody who is no admin cannot write the remnant roll.
    B  Off the roll, neither can make Thalmor Robes at the loom, and nothing
       leaves the pack. Patrick puts Ondolemar on the roll, and he is told in
       his own chat. On it, he makes the robes; Rhys still cannot. Ondolemar
       is on no embassy roll by it.
    C  The marker: Elenwen in the game's own Thalmor Robes reads Thalmor,
       and so does Ondolemar once he puts on the robes he made. Brenna in
       iron does not.
    D  The patrols ship off: the staff settings the server reads say off,
       and nobody is stood up.
    E  A restart: the roll is as it was. Taken off it, Ondolemar is told,
       and makes no more.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  The patrols switched on, their roads and their caps are driven in
  tests/test-1390-thalmor-patrols.js; the world stage they read is the
  factions scenario's.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-thalmor.js
*/
const fs = require('fs');
const path = require('path');
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const RECIPES = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8').replace(/^﻿/, '')).recipes;
const ROBES_R = '9cd:MoreCraftableEquipment.esp';
const robes = RECIPES[ROBES_R];
yes('P0 the recipe table has the Thalmor Robes, on the remnant roll, at the loom',
    !!robes && robes.roll === 'remnant' && robes.bench === '6ce000:Update.esm' && robes.half === 'Liverywright');
if (!robes) { t.done(); }

const w = standIn.world({
  name: 'thalmor',
  files: {
    'private/allowed.json': {
      profiles: [1000, 1001, 1002, 1003, 1009],
      accounts: { 1000: 'acct-ondo', 1001: 'acct-rhys', 1002: 'acct-elenwen', 1003: 'acct-brenna', 1009: 'acct-patrick' },
      adminProfiles: [1009]
    }
  }
});
const CITY = '1691d:Skyrim.esm';
const LOOM_BASE = '801:MoreCraftableEquipment.esp';
w.record(LOOM_BASE, 'FURN');
const LOOM = w.ref(0xff2000e0, { base: LOOM_BASE, cell: CITY, pos: [1000, 0, 0] });
const SHEARS = w.idOf('1b000:Thornswood-Content.esp');
const CRAFT = { recipe: w.idOf(ROBES_R), output: w.idOf(robes.out), count: 1,
  inputs: robes.inputItems.map(function (x) { return { baseId: w.idOf(x.item), count: x.count }; }) };
function pack() {
  return { entries: [{ baseId: SHEARS, count: 1 }].concat(CRAFT.inputs.map(function (x) { return { baseId: x.baseId, count: x.count * 3 }; })) };
}
const GAME_ROBES = w.idOf('65bbf:Skyrim.esm'), IRON = w.idOf('12e4d:Skyrim.esm');
function wearing(base) { return { inv: { entries: [{ baseId: base, count: 1, worn: true }] }, numChanges: 1 }; }
function at(n) { return [1040 + 30 * n, 0, 0]; }

const ONDO = w.person(0xff001300, { profileId: 1000, name: 'Ondolemar', prof: 'tailor', half: 'liverywright', cell: CITY, pos: at(0), inventory: pack() });
const RHYS = w.person(0xff001301, { profileId: 1001, name: 'Rhys', prof: 'tailor', half: 'liverywright', cell: CITY, pos: at(1), inventory: pack() });
const ELENWEN = w.person(0xff001302, { profileId: 1002, name: 'Elenwen', cell: CITY, pos: at(2) });
const BRENNA = w.person(0xff001303, { profileId: 1003, name: 'Brenna', cell: CITY, pos: at(3) });
const PATRICK = w.person(0xff001304, { profileId: 1009, name: 'Patrick', cell: CITY, pos: at(4) });
const ALL = [ONDO, RHYS, ELENWEN, BRENNA, PATRICK];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });
w.row(ELENWEN).equipment = wearing(GAME_ROBES);
w.row(BRENNA).equipment = wearing(IRON);

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, line) { w.say(a, line); return last(a); }
const rolls = () => w.box().__thornswoodRolls;
const marker = () => w.box().__thornswoodThalmor;
function make(a) { w.activate(LOOM, a); const c = w.craft(a, LOOM, CRAFT); w.activate(LOOM, a); return c; }

// ------------------------------------------------------------- A. the roll --
yes('A1 somebody who is no admin cannot write the remnant roll (' + say(ONDO, '/remnant add Ondolemar') + ')',
    last(ONDO) === 'The remnant roll is an application. Only an admin writes it.' && !rolls().has(ONDO, 'remnant'));

// ------------------------------------------------------------- B. the gear --
let inputs = w.count(ONDO, CRAFT.inputs[1].baseId);
const b1 = make(ONDO);
yes('B1 off the roll Ondolemar cannot make Thalmor Robes, and nothing leaves his pack (' + last(ONDO) + ')',
    !b1.made && w.count(ONDO, CRAFT.output) === 0 && w.count(ONDO, CRAFT.inputs[1].baseId) === inputs);
let heardAt = w.heard(ONDO).length;
say(PATRICK, '/remnant add Ondolemar');
yes('B2 Patrick puts him on the roll (' + last(PATRICK) + ')', rolls().has(ONDO, 'remnant') && /^Ondolemar is on the Thalmor remnant roll\./.test(last(PATRICK)));
yes('B2 and he is told in his own chat (' + w.heardSince(ONDO, heardAt).join(' | ') + ')',
    w.heardSince(ONDO, heardAt).indexOf('You are on the Thalmor remnant roll.') >= 0);
const b3 = make(ONDO);
yes('B3 on it he makes the robes (' + JSON.stringify(b3) + ')', b3.made && w.count(ONDO, CRAFT.output) === 1);
const b4 = make(RHYS);
yes('B4 Rhys, who never applied, still cannot', !b4.made && w.count(RHYS, CRAFT.output) === 0);
yes('B5 and the remnant roll is not the embassy roll', !rolls().has(ONDO, 'embassy'));

// ------------------------------------------------------------ C. the marker --
yes('C1 Elenwen in the game\'s own Thalmor Robes reads Thalmor', marker().marked(ELENWEN) === true);
yes('C2 Ondolemar, in nothing yet, does not', marker().marked(ONDO) === false);
w.row(ONDO).equipment = wearing(CRAFT.output);
yes('C2 and in the robes he made, he does', marker().marked(ONDO) === true);
yes('C3 Brenna in iron does not', marker().marked(BRENNA) === false);

// ----------------------------------------------------------- D. the patrols --
const patrols = w.box().__thornswoodThalmorPatrols || {};
yes('D1 the patrols ship off: the staff settings the server read say off, and nobody is stood up (' + JSON.stringify({ on: patrols.on, roads: (patrols.roads || []).length }) + ')',
    patrols.on === false && w.logged(/\[patrols\] on -/).length === 0 && w.logged(/[1-9]\d* stood up/).length === 0);

// -------------------------------------------------------------- E. restart --
const kept = JSON.stringify(w.readPrivate('embassy.json').remnant);
const r = w.restart();
yes('E1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('E1 the roll is as it was', JSON.stringify(w.readPrivate('embassy.json').remnant) === kept && rolls().has(ONDO, 'remnant'));
heardAt = w.heard(ONDO).length;
say(PATRICK, '/remnant remove Ondolemar');
yes('E2 taken off, he is told (' + w.heardSince(ONDO, heardAt).join(' | ') + ')',
    !rolls().has(ONDO, 'remnant') && w.heardSince(ONDO, heardAt).indexOf('You are off the Thalmor remnant roll.') >= 0);
const e3 = make(ONDO);
yes('E3 and makes no more', !e3.made && w.count(ONDO, CRAFT.output) === 1);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
