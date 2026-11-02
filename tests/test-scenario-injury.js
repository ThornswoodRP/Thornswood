'use strict';
/*
  test-scenario-injury.js

  Scenario: systems/injury.md

  #5198. Wounds, end to end: the WHOLE of game/gamemode.js over the stand-in
  server (tests/stand-in-server.js), on a dev server with every placed
  person the catalogue keeps, so the bandits of Halted Stream Camp are
  there to land the blows. A blow is the engine's order
  (ActionListener::OnWeaponHit): OnHit to the target, then the damage
  written in the same call. The bleed is the engine's own damage
  (Actor.DamageActorValue), and a bleed that empties health is a death with
  no killer. Every treatment is the line the H panel or the look prompt's
  Tend their wounds sends.

  Brenna is a warrior, Corvin a tailor with bandages and a splint, Dagny a
  physicker with a poultice, and Eirik staff.

    A  A plain swing and a blocked power attack open nothing; an unblocked
       power attack with a sword is a cut, which bleeds 2 health a second.
    B  Torn cloth slows it to 1. Corvin cannot bandage her from across the
       street; beside her, his bandage stops it and comes out of his pack.
    C  At 10 minutes a bandaged cut catches wound fever on a roll under 10%;
       with a poultice too, the same roll is over its 5%.
    D  A power attack with a mace breaks a limb. Corvin splints it; he
       cannot set it, Dagny the physicker can.
    E  A wolf's bite is a bite, and bleeds.
    F  Left open, the bite bleeds her out: a death with no killer, the wake
       at the temple, the wound still on her and the bleed stopped.
    G  Staff write an agreed scar; clearing her wounds does not clear it.
    H  With no bandage left Corvin is told so. The server restarts: her
       bandaged cut and the scar are as they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-injury.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const CATALOGUE = standIn.npcCatalogue();
const P = CATALOGUE.population;
const DATA = require('../game/gamemode-tables/DATA.json');
const LEDGER = require('../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(require('../game/data/merchant-roster.json'), require('../game/data/npc-population.json'));
const RACES = { imperial: '13744:Skyrim.esm', breton: '13741:Skyrim.esm' };
const AT_CAMP = { cell: '3c:Skyrim.esm', pos: [15600, 20000, -4300] };
const SWORD = '12eb7:Skyrim.esm';    // Iron Sword: DNAM animation 1, a one handed sword
const MACE = '13982:Skyrim.esm';     // Iron Mace: DNAM animation 4
const WOLF_BASE = '10fe05:Skyrim.esm';
const BANDAGE = '154c0:Thornswood-Content.esp', SPLINT = '154c1:Thornswood-Content.esp', POULTICE = '154c2:Thornswood-Content.esp';
const TEMPLE = DATA.destinations.whiterun.temple;

const w = standIn.world({
  name: 'injury',
  settings: { loadOrder: P.plugins, thornswoodServer: 'dev', thornswoodDevs: [1006] },
  loadOrder: P.plugins,
  files: { 'private/merchant-ledger.json': LEDGER, 'private/merchant-ledger.initialized': '1' }
});
w.cast(CATALOGUE, RACES);
w.record(SWORD, 'WEAP', { editorId: 'IronSword', fields: [{ type: 'DNAM', data: [1, 0, 0, 0] }] });
w.record(MACE, 'WEAP', { editorId: 'IronMace', fields: [{ type: 'DNAM', data: [4, 0, 0, 0] }] });
w.record(WOLF_BASE, 'NPC_', { race: '1320a:Skyrim.esm' });
[BANDAGE, SPLINT, POULTICE].forEach(function (d) { w.record(d, 'MISC'); });
const WOLF = w.ref(0xff00a001, { base: WOLF_BASE, type: 'NPC_', cell: AT_CAMP.cell, pos: [15700, 20000, -4300] });

function at(n) { return [AT_CAMP.pos[0] + 40 * n, AT_CAMP.pos[1], AT_CAMP.pos[2]]; }
const BRENNA = w.person(0xff000c00, { profileId: 1000, name: 'Brenna', prof: 'warrior', half: 'bulwark', cell: AT_CAMP.cell, pos: at(0) });
const CORVIN = w.person(0xff000c01, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: AT_CAMP.cell, pos: at(1) });
const DAGNY = w.person(0xff000c02, { profileId: 1004, name: 'Dagny', prof: 'alchemist', half: 'physicker', cell: AT_CAMP.cell, pos: at(2) });
const EIRIK = w.person(0xff000c03, { profileId: 1006, name: 'Eirik', cell: AT_CAMP.cell, pos: at(3) });
const EVERYONE = [BRENNA, CORVIN, DAGNY, EIRIK];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);
const BANDIT = w.idOf('50533:Skyrim.esm');
yes('P1 a bandit of the camp is loaded and server-controlled', !!w.row(BANDIT) && w.row(BANDIT).serverControlled === true);
w.give(CORVIN, w.idOf(BANDAGE), 2);
w.give(CORVIN, w.idOf(SPLINT), 1);
w.give(DAGNY, w.idOf(POULTICE), 1);

function hex(a) { return a.toString(16); }
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function rec(a) { return w.prop(a, 'thornswoodHurt') || {}; }
function wounds(a, k) { return (rec(a).wounds || []).filter(function (x) { return !k || x.k === k; }); }
function ills(a) { return (rec(a).ills || []).map(function (i) { return i.k; }); }
function hp(a) { return Math.round(w.health(a) * 1000) / 10; }   // health points out of 100
function heal(a) { w.row(a).percentages = { health: 1, magicka: 1, stamina: 1 }; }
let answer = '', h0 = 0;

// ------------------------------------------------------------ A. a blow --
w.hit(BRENNA, BANDIT, SWORD, { damage: 10 });
w.run(500);
yes('A1 a plain swing with a sword takes health and opens nothing (' + hp(BRENNA) + ', ' + wounds(BRENNA).length + ')',
  hp(BRENNA) === 90 && wounds(BRENNA).length === 0);
w.hit(BRENNA, BANDIT, SWORD, { power: true, blocked: true, damage: 2 });
w.run(500);
yes('A2 a blocked power attack opens nothing', wounds(BRENNA).length === 0);
w.hit(BRENNA, BANDIT, SWORD, { power: true, damage: 10 });
w.run(200);
answer = last(BRENNA);
yes('A3 an unblocked power attack with a sword is a cut (' + answer + ')',
  answer === 'You are cut and bleeding.' && wounds(BRENNA, 'cut').length === 1 && wounds(BRENNA, 'cut')[0].bleed === true);
h0 = hp(BRENNA);
w.run(5000);
yes('A4 it bleeds 2 health a second (' + h0 + ' -> ' + hp(BRENNA) + ' in 5 seconds)', Math.round(h0 - hp(BRENNA)) === 10);

// --------------------------------------------------------- B. treatment --
answer = say(BRENNA, '/treat me cloth');
h0 = hp(BRENNA);
w.run(5000);
yes('B1 torn cloth slows it to 1 a second (' + answer + ', ' + h0 + ' -> ' + hp(BRENNA) + ')',
  /^You tear a strip of cloth/.test(answer) && Math.round(h0 - hp(BRENNA)) === 5);
w.moveTo(CORVIN, AT_CAMP.cell, [AT_CAMP.pos[0] + 2000, AT_CAMP.pos[1], AT_CAMP.pos[2]]);
answer = say(CORVIN, '/treat ' + hex(BRENNA) + ' bandage');
yes('B2 Corvin cannot bandage her from across the camp (' + answer + ')', /^Stand closer/.test(answer) && w.count(CORVIN, w.idOf(BANDAGE)) === 2);
w.moveTo(CORVIN, AT_CAMP.cell, at(1));
answer = say(CORVIN, '/treat ' + hex(BRENNA) + ' bandage');
h0 = hp(BRENNA);
w.run(5000);
yes('B3 beside her, his bandage stops the bleeding and comes out of his pack (' + answer + ', ' + last(BRENNA) + ', ' + h0 + ' -> ' + hp(BRENNA) + ')',
  answer === 'You bandage Brenna\'s cut. The bleeding stops.' && last(BRENNA) === 'Corvin bandages your cut. The bleeding stops.' &&
  hp(BRENNA) === h0 && w.count(CORVIN, w.idOf(BANDAGE)) === 1);

// ------------------------------------------------------------ C. fever --
/* Up to five seconds before the cut's 10 minutes, then every roll at 8% across the hurt tick that rolls it. */
function toTenMinutes(k) { const cut = wounds(BRENNA, k)[0]; w.run(cut.at + 10 * 60000 - 5000 - w.now()); }
toTenMinutes('cut');
w.dice(0.08);
w.run(15000);
w.dice(null);
yes('C1 at 10 minutes the bandaged cut catches wound fever on a roll of 8%, under its 10% (' + ills(BRENNA).join() + ')',
  ills(BRENNA).indexOf('fever') !== -1 && wounds(BRENNA, 'cut').length === 0);
say(EIRIK, '/hurt Brenna clear');
heal(BRENNA);
w.hit(BRENNA, BANDIT, SWORD, { sneak: true, damage: 10 });
w.run(200);
say(CORVIN, '/treat ' + hex(BRENNA) + ' bandage');
answer = say(DAGNY, '/treat ' + hex(BRENNA) + ' poultice');
toTenMinutes('cut');
w.dice(0.08);
w.run(15000);
w.dice(null);
yes('C2 a sneak attack\'s cut, bandaged and with Dagny\'s poultice, does not catch it on the same roll, over its 5% (' + answer + ', ' + JSON.stringify(ills(BRENNA)) + ')',
  /^You press a poultice/.test(answer) && ills(BRENNA).length === 0 && wounds(BRENNA, 'cut').length === 0 && w.count(DAGNY, w.idOf(POULTICE)) === 0);

// ------------------------------------------------------------ D. a break --
w.dice(0.3);
w.hit(BRENNA, BANDIT, MACE, { power: true, damage: 10 });
w.run(200);
w.dice(null);
answer = last(BRENNA);
yes('D1 a power attack with a mace breaks a limb (' + answer + ')',
  answer === 'Your arm is broken.' && wounds(BRENNA, 'break').length === 1 && wounds(BRENNA, 'break')[0].limb === 'arm');
answer = say(CORVIN, '/treat ' + hex(BRENNA) + ' splint');
yes('D2 Corvin splints it (' + answer + ')', /^You splint Brenna's/.test(answer) && wounds(BRENNA, 'break')[0].splint === true && w.count(CORVIN, w.idOf(SPLINT)) === 0);
answer = say(CORVIN, '/treat ' + hex(BRENNA) + ' set');
yes('D3 he cannot set it (' + answer + ')', answer === 'Only a physicker sets a bone, or a shrine in a temple.' && !wounds(BRENNA, 'break')[0].set);
answer = say(DAGNY, '/treat ' + hex(BRENNA) + ' set');
yes('D4 Dagny the physicker sets it (' + answer + ')', /^You set the broken arm for Brenna\. A set break heals in 3 days\.$/.test(answer) && wounds(BRENNA, 'break')[0].set > 0);

// ------------------------------------------------------------- E. a bite --
w.hit(BRENNA, WOLF, 0, { damage: 8 });
w.run(200);
answer = last(BRENNA);
yes('E1 a wolf\'s bite is a bite, and bleeds (' + answer + ')', answer === 'You are bitten and bleeding.' && wounds(BRENNA, 'bite')[0].bleed === true);

// -------------------------------------------------------- F. bled out --
const deathsBefore = w.logged(/\bdeath \S+ in /).length;
for (let s = 0; s < 120 && !w.row(BRENNA).isDead; s++) { w.run(1000); }
const bledOut = w.logged(/\bdeath \S+ in /).slice(deathsBefore);
yes('F1 left open, the bite bleeds her out: a death with no killer (' + bledOut.join(' | ') + ')',
  w.row(BRENNA).isDead === true && bledOut.length === 1 && !/killer=/.test(bledOut[0]));
w.run(26000);
yes('F2 she wakes at the temple, the bite still on her and the bleed stopped (' + w.row(BRENNA).worldOrCellDesc + ', ' + JSON.stringify(wounds(BRENNA, 'bite')) + ')',
  w.row(BRENNA).isDead === false && w.row(BRENNA).worldOrCellDesc === TEMPLE.desc &&
  wounds(BRENNA, 'bite').length === 1 && wounds(BRENNA, 'bite')[0].bleed === false && wounds(BRENNA, 'break').length === 1);

// -------------------------------------------------------- G. staff --
answer = say(EIRIK, '/hurt Brenna agreed scar a burn across the jaw');
yes('G1 staff write an agreed scar (' + answer + ', ' + JSON.stringify(rec(BRENNA).agreed) + ')',
  !!rec(BRENNA).agreed && !!rec(BRENNA).agreed.scar && rec(BRENNA).agreed.scar.text === 'a burn across the jaw');
const woundsBefore = wounds(BRENNA).length;
answer = say(EIRIK, '/hurt Brenna clear');
yes('G2 clearing her wounds leaves the scar (' + woundsBefore + ' -> ' + wounds(BRENNA).length + ')',
  woundsBefore > 0 && wounds(BRENNA).length === 0 && !!rec(BRENNA).agreed.scar);

// -------------------------------------------------------- H. restart --
w.moveTo(BRENNA, AT_CAMP.cell, at(0));
w.hit(BRENNA, BANDIT, SWORD, { power: true, damage: 10 });
w.run(200);
answer = say(CORVIN, '/treat ' + hex(BRENNA) + ' bandage');
yes('H1 with no bandage left, Corvin is told so and nothing is done (' + answer + ')',
  /^You carry no bandage\./.test(answer) && wounds(BRENNA, 'cut')[0].bleed === true);
w.give(CORVIN, w.idOf(BANDAGE), 1);
say(CORVIN, '/treat ' + hex(BRENNA) + ' bandage');
const before = JSON.stringify(rec(BRENNA));
const r = w.restart();
yes('H2 the server comes back up', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(3000);
yes('H3 her bandaged cut and the scar are as they were',
  wounds(BRENNA, 'cut').length === 1 && wounds(BRENNA, 'cut')[0].bandage === true && rec(BRENNA).agreed.scar.text === 'a burn across the jaw' &&
  JSON.stringify(rec(BRENNA).agreed) === JSON.stringify(JSON.parse(before).agreed));

t.done(w);
