'use strict';
/*
  test-scenario-embassy.js

  Scenario: systems/embassy.md

  #5198. The Imperial Embassy in Solitude, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. The roll is
  an admin's /embassy through the voice queue; the door is onActivate and
  the property block's /claim and /evict; the gear is onCraftWork and onCraft
  at a forge. The roll on disk is private/embassy.json.

  The file on the server asks for 21 on the roll, 7 of them marked armed.
  Patrick is an admin by the site's roles. Brenna is an advanced Platewright, Aldis is new, and
  Hroki is the Steward of Haafingar by the Discord role the site lists.

    A  At start the roll holds what the Accord allows, whatever the file
       says: 20, 6 of them armed. Somebody who is no admin cannot write it.
    B  The roll is full: Brenna is refused. One whose character is not in
       the world comes off, and the server goes on (#5475). Marking her
       armed as the 7th is refused, and nobody is added. Named unarmed she is
       on it, and told in her own chat. Aldis, the 21st, is refused. One
       armed mark comes off, and Brenna is marked armed, and told.
    C  The gear: off the roll Brenna cannot make an Imperial Helmet at the
       forge, and nothing leaves her pack. On it, she makes one.
    D  The door: its line offers nobody a claim, a claim sent anyway is
       refused, and the Steward of Haafingar cannot evict the Accord.
    E  A restart: the roll is as it was. Taken off, Brenna is told, and the
       count drops.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  The remnant roll and the Thalmor marker are on the Thalmor's scenario.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-embassy.js
*/
const fs = require('fs');
const path = require('path');
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const RECIPES = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8').replace(/^﻿/, '')).recipes;
const HELMET_R = 'dc9f8:Skyrim.esm';
const helmet = RECIPES[HELMET_R];
yes('P0 the recipe table has the Imperial Helmet, on the embassy roll', !!helmet && helmet.roll === 'embassy');
if (!helmet) { t.done(); }

// The roll file asks for more than the Accord allows.
const seeded = { embassy: [], remnant: [] };
for (let i = 1; i <= 21; i++) {
  seeded.embassy.push({ actor: 0xff00a000 + i, profile: 3000 + i, name: 'Envoy ' + i, at: 1, armed: i <= 7 });
}
const w = standIn.world({
  name: 'embassy',
  files: {
    'private/embassy.json': seeded,
    'private/allowed.json': {
      profiles: [1000, 1001, 1009, 2000],
      adminProfiles: [1009],
      accounts: { 1000: 'acct-brenna', 1001: 'acct-aldis', 1009: 'acct-patrick', 2000: 'acct-hroki' },
      offices: { 2000: { steward: ['solitude'] } }
    }
  }
});

const SOLITUDE = '37ede:Skyrim.esm';
const SQUARE = [-62000, 98000, 7000];
function at(dx) { return [SQUARE[0] + dx, SQUARE[1], SQUARE[2]]; }
const DOOR_BASE = '1a6f4:Skyrim.esm', FORGE_BASE = '1a2ad:Skyrim.esm';
w.record(DOOR_BASE, 'DOOR');
w.record(FORGE_BASE, 'FURN');
const DOOR = w.ref(w.idOf('5cb0:The Great City of Solitude.esp'), { base: DOOR_BASE, cell: SOLITUDE, pos: at(0) });
const FORGE = w.ref(0xff200030, { base: FORGE_BASE, cell: SOLITUDE, pos: at(600) });
const HAMMER = w.idOf('5cae1:Skyrim.esm');
const CHARCOAL = w.idOf('15481:Thornswood-Content.esp');
const CRAFT = { recipe: w.idOf(HELMET_R), output: w.idOf(helmet.out), count: 1,
  inputs: helmet.inputItems.map(function (x) { return { baseId: w.idOf(x.item), count: x.count }; }) };

const BRENNA = w.person(0xff001200, { profileId: 1000, name: 'Brenna', prof: 'smith', half: 'platewright', rank: 'advanced',
  town: 'solitude', cell: SOLITUDE, pos: at(640),
  inventory: { entries: [{ baseId: HAMMER, count: 1 }, { baseId: CHARCOAL, count: 5 }].concat(CRAFT.inputs.map(function (x) {
    return { baseId: x.baseId, count: x.count * 2 };
  })) } });
const ALDIS = w.person(0xff001201, { profileId: 1001, name: 'Aldis', town: 'solitude', cell: SOLITUDE, pos: at(80) });
const PATRICK = w.person(0xff001202, { profileId: 1009, name: 'Patrick', town: 'solitude', cell: SOLITUDE, pos: at(120) });
const HROKI = w.person(0xff001203, { profileId: 2000, name: 'Hroki', town: 'solitude', cell: SOLITUDE, pos: at(40) });
const ALL = [BRENNA, ALDIS, PATRICK, HROKI];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

const E = () => w.box().__thornswoodEmbassy;
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, line) { w.say(a, line); return last(a); }
function roll() { return w.readPrivate('embassy.json').embassy; }
function onRoll(a) { return w.box().__thornswoodRolls.has(a, 'embassy'); }

// --------------------------------------------------------- A. the roll --
const listing = say(PATRICK, '/embassy');
yes('A1 at start the roll holds what the Accord allows, whatever the file says (' + listing.slice(0, 120) + ')',
    /20 of 20 on the roll, 6 of 6 marked armed\./.test(listing));
yes('A1 and the log says what it left off', w.logged(/\[embassy\] the roll file asked for more than the Accord allows/).length === 1);
yes('A2 somebody who is no admin cannot write it (' + say(ALDIS, '/embassy add Aldis') + ')',
    last(ALDIS) === 'Only an admin writes the embassy roll.' && !onRoll(ALDIS));

// -------------------------------------------------------- B. the caps --
yes('B1 the roll is full: Brenna is refused (' + say(PATRICK, '/embassy add Brenna') + ')',
    /^The embassy roll is full: 20 persons in service, no more\./.test(last(PATRICK)) && !onRoll(BRENNA));
say(PATRICK, '/embassy remove Envoy 20');
yes('B2 Envoy 20, whose character is not in the world, comes off, and the server goes on (#5475) (' + last(PATRICK) + ')', /^Envoy 20 is off the embassy roll\. 19 of 20/.test(last(PATRICK)));
yes('B2 marking Brenna armed as the 7th is refused, and nobody is added (' + say(PATRICK, '/embassy add Brenna armed') + ')',
    /Nobody was added/.test(last(PATRICK)) && !onRoll(BRENNA));
let heardAt = w.heard(BRENNA).length;
say(PATRICK, '/embassy add Brenna');
yes('B3 named unarmed she is on it (' + last(PATRICK) + ')', onRoll(BRENNA) && /^Brenna is on the embassy roll\. 20 of 20/.test(last(PATRICK)));
yes('B3 and told in her own chat (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    w.heardSince(BRENNA, heardAt).indexOf('You are on the embassy roll.') >= 0);
heardAt = w.heard(ALDIS).length;
yes('B4 Aldis, the 21st, is refused (' + say(PATRICK, '/embassy add Aldis') + ')',
    /^The embassy roll is full/.test(last(PATRICK)) && !onRoll(ALDIS) && w.heardSince(ALDIS, heardAt).length === 0);
say(PATRICK, '/embassy disarm Envoy 1');
heardAt = w.heard(BRENNA).length;
say(PATRICK, '/embassy arm Brenna');
yes('B5 one armed mark comes off, and Brenna is marked armed, and told (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    roll().filter(function (r) { return r.armed; }).length === 6 && roll().some(function (r) { return r.name === 'Brenna' && r.armed; }) &&
    w.heardSince(BRENNA, heardAt).indexOf('You are marked armed on the embassy roll. You bear arms inside the walls only.') >= 0);

// ---------------------------------------------------------- C. the gear --
say(PATRICK, '/embassy remove Brenna');
w.activate(FORGE, BRENNA);
const before = w.count(BRENNA, CRAFT.inputs[2].baseId);
const c1 = w.craft(BRENNA, FORGE, CRAFT);
w.run(300);
yes('C1 off the roll she cannot make an Imperial Helmet, and nothing leaves her pack (' + last(BRENNA) + ')',
    !c1.made && w.count(BRENNA, CRAFT.output) === 0 && w.count(BRENNA, CRAFT.inputs[2].baseId) === before);
say(PATRICK, '/embassy add Brenna armed');
w.activate(FORGE, BRENNA);
w.activate(FORGE, BRENNA);
const c2 = w.craft(BRENNA, FORGE, CRAFT);
yes('C2 on the roll she makes one (' + JSON.stringify(c2) + ')', c2.made && w.count(BRENNA, CRAFT.output) === 1);

// ---------------------------------------------------------- D. the door --
w.moveTo(ALDIS, SOLITUDE, at(30));
w.activate(DOOR, ALDIS);
const line = w.prop(ALDIS, 'thornswoodDoorLine') || {};
yes('D1 the embassy door\'s line offers nobody a claim (' + JSON.stringify(line).slice(0, 120) + ')', line.x !== 'claim');
yes('D2 a claim sent anyway is refused (' + say(ALDIS, '/claim') + ')',
    last(ALDIS) === 'The embassy is held by the Ambassador\'s office under the Accord. It cannot be claimed.');
say(HROKI, '/office hold steward solitude');
yes('D3 Hroki takes the office of Steward of Haafingar (' + last(HROKI) + ')', /holds Steward of /.test(last(HROKI)));
w.activate(DOOR, HROKI);
yes('D3 and cannot evict the Accord (' + say(HROKI, '/evict') + ')',
    last(HROKI) === 'The embassy is not a house of the hold. A steward of Haafingar does not evict the Accord.');

// ------------------------------------------------------------- E. restart --
const kept = JSON.stringify(roll());
const r = w.restart();
yes('E1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('E1 the roll is as it was', JSON.stringify(roll()) === kept && onRoll(BRENNA) && /20 of 20 on the roll, 6 of 6/.test(say(PATRICK, '/embassy')));
heardAt = w.heard(BRENNA).length;
say(PATRICK, '/embassy remove Brenna');
yes('E2 taken off, she is told, and the count drops (' + last(PATRICK) + ')',
    !onRoll(BRENNA) && /19 of 20 on the roll, 5 of 6/.test(last(PATRICK)) && w.heardSince(BRENNA, heardAt).indexOf('You are off the embassy roll.') >= 0);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
