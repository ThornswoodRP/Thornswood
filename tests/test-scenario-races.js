'use strict';
/*
  test-scenario-races.js

  Scenario: systems/races.md

  #5198. A people's own things, end to end: the WHOLE of game/gamemode.js
  over the stand-in server (tests/stand-in-server.js), every step a message
  the engine sends in the order it sends them: the press on the loom
  (onActivate), then for each craft onCraftWork and, once its time is up,
  onCraft, which the engine follows by taking the inputs and giving what was
  made. The recipes, their inputs and their race are the ones the server
  reads, out of game/data/recipes.json and the recipe table. A person's race
  is the race on their appearance, as the race menu stored it. A login is
  the launcher's pass and onThornswoodLogin.

  Ragnar is a Nord, Rikka a Riekling and Dravyn a Dark Elf, all three novice
  Haberdashers with shears, at a loom in Windhelm.

    A  Ragnar presses the loom: it is his, as it is all three's.
    B  A Riekling Belted Tunic is riekling gear: Ragnar is refused it, told
       only a Riekling can make it, and nothing leaves his pack. Rikka makes
       it.
    C  Dunmer Shoes are a people's dress: Ragnar is refused them, told only a
       Dark Elf can make them. Dravyn makes them.
    D  Ragged Boots belong to no people: Ragnar, Rikka and Dravyn each make
       a pair.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  A new riekling starting in riekling clothes is Creation's scenario.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-races.js
*/
const fs = require('fs');
const path = require('path');
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const RECIPES = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8').replace(/^﻿/, '')).recipes || {};
const TUNIC_R = 'bfee5:Playable Rieklings.esp', SHOES_R = '95d:MoreCraftableEquipment.esp', BOOTS_R = '922:MoreCraftableEquipment.esp';
const tunic = RECIPES[TUNIC_R], shoes = RECIPES[SHOES_R], boots = RECIPES[BOOTS_R];
yes('P0 the server\'s recipe table has the Riekling Belted Tunic (riekling), Dunmer Shoes (Dark Elf) and Ragged Boots (nobody\'s), at the loom',
  !!tunic && !!shoes && !!boots && tunic.race === 'riekling' && shoes.race === 'darkelf' && !boots.race &&
  [tunic, shoes, boots].every(function (r) { return r.bench === '6ce000:Update.esm' && r.half === 'Haberdasher' && r.rank === 'novice'; }));
if (!tunic || !shoes || !boots) { t.done(); }

const w = standIn.world({ name: 'races' });
const CITY = '1691d:Skyrim.esm';
const LOOM_BASE = '801:MoreCraftableEquipment.esp';    // a loom: BENCH_BY_BASE names it the tailoring bench
w.record(LOOM_BASE, 'FURN');
const LOOM = w.ref(0xff2000d0, { base: LOOM_BASE, cell: CITY, pos: [1000, 0, 0] });
const SHEARS = w.idOf('1b000:Thornswood-Content.esp');
const NORD = '13746:Skyrim.esm', RIEKLING = 'a6746:Playable Rieklings.esp', DARK_ELF = '13742:Skyrim.esm';
function craftOf(desc, r) {
  return { recipe: w.idOf(desc), output: w.idOf(r.out), count: r.makes || 1,
           inputs: r.inputItems.map(function (x) { return { baseId: w.idOf(x.item), count: x.count }; }) };
}
const TUNIC = craftOf(TUNIC_R, tunic), SHOES = craftOf(SHOES_R, shoes), BOOTS = craftOf(BOOTS_R, boots);
function stock(c, times) { return c.inputs.map(function (x) { return { baseId: x.baseId, count: x.count * times }; }); }
function pack() { return { entries: [{ baseId: 0xf, count: 40 }, { baseId: SHEARS, count: 1 }].concat(stock(TUNIC, 1), stock(SHOES, 1), stock(BOOTS, 1)) }; }
function face(name, race) { return { name: name, raceId: w.idOf(race), isFemale: false, hairColor: 0, weight: 50, headpartIds: [] }; }
function at(n) { return [1040 + 30 * n, 0, 0]; }
const RAGNAR = w.person(0xff001a00, { profileId: 1000, name: 'Ragnar', prof: 'tailor', half: 'haberdasher', cell: CITY, pos: at(0), inventory: pack(), appearance: face('Ragnar', NORD) });
const RIKKA = w.person(0xff001a01, { profileId: 1002, name: 'Rikka', prof: 'tailor', half: 'haberdasher', cell: CITY, pos: at(1), inventory: pack(), appearance: face('Rikka', RIEKLING) });
const DRAVYN = w.person(0xff001a02, { profileId: 1004, name: 'Dravyn', prof: 'tailor', half: 'haberdasher', cell: CITY, pos: at(2), inventory: pack(), appearance: face('Dravyn', DARK_ELF) });
const EVERYONE = [RAGNAR, RIKKA, DRAVYN];
EVERYONE.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P1 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function show(a) {
  return JSON.stringify((w.row(a).inventory.entries || []).filter(function (e) { return e.count > 0; })
    .map(function (e) { return e.baseId.toString(16) + 'x' + e.count; }).sort());
}
function make(a, c) { return w.craft(a, LOOM, c); }

// ------------------------------------------------------------- A. the loom --
const opened = EVERYONE.map(function (a) { return w.activate(LOOM, a); });
yes('A1 the loom opens for all three (' + JSON.stringify(opened) + ')', opened.every(function (o) { return o.allowed; }));

// ------------------------------------------------------- B. riekling gear --
let before = show(RAGNAR);
const b1 = make(RAGNAR, TUNIC);
yes('B1 Ragnar, a Nord, is refused the Riekling Belted Tunic, told only a Riekling can make it, and nothing leaves his pack (' + last(RAGNAR) + ')',
  !b1.made && last(RAGNAR) === 'That is Riekling work, and their hands are not yours. Only a Riekling can make it.' && show(RAGNAR) === before);
const b2 = make(RIKKA, TUNIC);
yes('B2 Rikka, a Riekling, makes it (' + JSON.stringify(b2) + ')', b2.made && w.count(RIKKA, TUNIC.output) === 1);

// ---------------------------------------------------- C. a people's dress --
before = show(RAGNAR);
const c1 = make(RAGNAR, SHOES);
yes('C1 Ragnar is refused the Dunmer Shoes, told only a Dark Elf can make them (' + last(RAGNAR) + ')',
  !c1.made && last(RAGNAR) === 'That is Dark Elf work, and their hands are not yours. Only a Dark Elf can make it.' && show(RAGNAR) === before);
before = show(RIKKA);
const c2 = make(RIKKA, SHOES);
yes('C2 and so is Rikka (' + last(RIKKA) + ')', !c2.made && /Only a Dark Elf can make it\.$/.test(last(RIKKA)) && show(RIKKA) === before);
const c3 = make(DRAVYN, SHOES);
yes('C3 Dravyn, a Dark Elf, makes them (' + JSON.stringify(c3) + ')', c3.made && w.count(DRAVYN, SHOES.output) === 1);

// ------------------------------------------------------- D. nobody's dress --
const d = EVERYONE.map(function (a) { return make(a, BOOTS); });
yes('D1 Ragged Boots belong to no people: all three make a pair (' + JSON.stringify(d.map(function (x) { return x.made; })) + ')',
  d.every(function (x) { return x.made; }) && EVERYONE.every(function (a) { return w.count(a, BOOTS.output) === 1; }));
EVERYONE.forEach(function (a) { w.activate(LOOM, a); });

t.done(w);
