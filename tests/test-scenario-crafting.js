'use strict';
/*
  test-scenario-crafting.js

  Scenario: systems/professions.md

  #5198. Making something at a bench, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them: the press on
  the bench (onActivate), then for each craft onCraftWork, which sets how
  long the work takes, and once that time is up and the person is still at
  the bench, onCraft, which the engine follows by taking the inputs and
  giving what was made. The recipes and their inputs are the ones the
  server reads, out of game/data/recipes.json.

  Brenna is a novice Platewright with a hammer. Corvin is a tailor. Aldis
  is a novice Platewright too, worn out.

    A  Brenna presses the forge: onActivate allows it and the bench is hers.
       She makes Leather Boots, a novice Platewright recipe: onCraftWork
       sets a work time the engine accepts, onCraft allows it after that
       time, the forge burns one Poor Charcoal, the leather and strips
       leave her pack and the boots are in it.
    B  Banded Iron Armor is an advanced recipe: onCraft refuses it, saying
       the rank it needs, and nothing leaves her pack. (Her own game hides
       a recipe above her rank; this is the server's half, which does not
       trust that.)
    C  She starts the boots again and gets up before the work is done: the
       engine stops the work, onCraft is never asked, and nothing is taken.
       The same when she walks off from the bench instead.
    D  Corvin, a tailor, presses the forge: onActivate refuses it, the bench
       does not open for him, and he is told whose bench it is.
    E  Aldis, worn out, at another forge: the work is refused before it
       starts, with the line the body gives, and nothing is taken.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-crafting.js
*/
const fs = require('fs');
const path = require('path');
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const RECIPES = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8').replace(/^﻿/, ''));
function recipe(desc) {
  const rows = RECIPES.recipes || {};
  const r = rows[desc];
  return r ? r : null;
}
const BOOTS_R = 'dca01:Skyrim.esm', BANDED_R = 'dc9ff:Skyrim.esm';
const boots = recipe(BOOTS_R), banded = recipe(BANDED_R);
yes('P0 the server\'s recipe table has Leather Boots and Banded Iron Armor, at the forge',
    !!boots && !!banded && boots.bench === '88105:Skyrim.esm' && banded.bench === '88105:Skyrim.esm');
if (!boots || !banded) { t.done(); }

const w = standIn.world({ name: 'crafting' });
const CITY = '1691d:Skyrim.esm';
const FORGE_BASE = '1a2ad:Skyrim.esm';           // a forge: BENCH_BY_BASE names it the smithing forge
w.record(FORGE_BASE, 'FURN');
const FORGE = w.ref(0xff200010, { base: FORGE_BASE, cell: CITY, pos: [1000, 0, 0] });
const FORGE2 = w.ref(0xff200011, { base: FORGE_BASE, cell: CITY, pos: [5000, 0, 0] });
const HAMMER = w.idOf('5cae1:Skyrim.esm');
const CHARCOAL = w.idOf('15481:Thornswood-Content.esp');   // Poor Charcoal, what a forge burns
function craftOf(desc, r) {
  return { recipe: w.idOf(desc), output: w.idOf(r.out), count: r.makes || 1,
           inputs: r.inputItems.map(function (x) { return { baseId: w.idOf(x.item), count: x.count }; }) };
}
const BOOTS = craftOf(BOOTS_R, boots), BANDED = craftOf(BANDED_R, banded);
function stock(c, times) { return c.inputs.map(function (x) { return { baseId: x.baseId, count: x.count * times }; }); }

const BRENNA = w.person(0xff000800, { profileId: 1000, name: 'Brenna', prof: 'smith', half: 'platewright', cell: CITY, pos: [1050, 0, 0],
  inventory: { entries: [{ baseId: 0xf, count: 40 }, { baseId: HAMMER, count: 1 }, { baseId: CHARCOAL, count: 5 }].concat(stock(BOOTS, 3), stock(BANDED, 1)) } });
const CORVIN = w.person(0xff000801, { profileId: 1001, name: 'Corvin', prof: 'tailor', cell: CITY, pos: [1100, 50, 0] });
const ALDIS = w.person(0xff000802, { profileId: 1002, name: 'Aldis', prof: 'smith', half: 'platewright', cell: CITY, pos: [5050, 0, 0],
  inventory: { entries: [{ baseId: 0xf, count: 40 }, { baseId: HAMMER, count: 1 }, { baseId: CHARCOAL, count: 5 }].concat(stock(BOOTS, 1)) } });
w.row(BRENNA).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() };
w.row(CORVIN).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() };
w.row(ALDIS).thornswoodNeeds = { food: 90, drink: 90, rest: 5, temp: 50, at: w.now() };

yes('P0 the whole gamemode loads over the stand-in', w.boot() || !console.log(w.loadError()));
if (!w.loaded()) { t.done(w); }
[BRENNA, CORVIN, ALDIS].forEach(w.arrive);
w.run(30000);
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
/* What is in a pack, stack by stack, however the stacks are split. */
function pack(a) {
  const n = {};
  w.row(a).inventory.entries.forEach(function (e) { const k = e.baseId + ':' + (e.name || ''); n[k] = (n[k] || 0) + e.count; });
  return JSON.stringify(Object.keys(n).sort().map(function (k) { return [k, n[k]]; }));
}
const MAX_WORK = 10 * 60 * 1000;   // CraftWorkEvent::kMaxWorkTime is the engine's bound; the server's own are minutes

// ------------------------------------------------------------- A. boots --
const a0 = w.activate(FORGE, BRENNA);
yes('A1 the forge: onActivate allows it and the bench is hers', a0.allowed && a0.opened && w.holds(FORGE) === BRENNA);
const before = { leather: w.count(BRENNA, BOOTS.inputs[0].baseId), strips: w.count(BRENNA, BOOTS.inputs[1].baseId) };
const a1 = w.craft(BRENNA, FORGE, BOOTS);
yes('A2 onCraftWork starts the work and sets a work time the engine takes (' + a1.workMs + ' ms)',
    a1.started && typeof a1.workMs === 'number' && a1.workMs >= 0 && a1.workMs <= MAX_WORK);
yes('A2 after it onCraft allows it: the boots are in her pack (' + JSON.stringify(a1) + ')', a1.made && w.count(BRENNA, BOOTS.output) === 1);
yes('A2 the forge burned one Poor Charcoal', w.count(BRENNA, CHARCOAL) === 4);
yes('A2 and the leather and strips the recipe asks for are gone',
    w.count(BRENNA, BOOTS.inputs[0].baseId) === before.leather - BOOTS.inputs[0].count &&
    w.count(BRENNA, BOOTS.inputs[1].baseId) === before.strips - BOOTS.inputs[1].count);

// ------------------------------------------------------- B. not hers yet --
let p0 = pack(BRENNA);
const b1 = w.craft(BRENNA, FORGE, BANDED);
yes('B1 Banded Iron Armor, an advanced recipe: onCraft refuses it, naming the rank (' + last(BRENNA) + ')',
    !b1.made && /Advanced Platewright's work and you are a Novice Platewright/.test(last(BRENNA)));
yes('B1 and nothing left her pack, charcoal included', pack(BRENNA) === p0);

// ------------------------------------------------------- C. getting up --
p0 = pack(BRENNA);
function crafts() { return w.did.filter(function (d) { return d[2] === 'event' && d[3] === 'onCraft'; }).length; }
let asked = crafts();
const c1 = w.craft(BRENNA, FORGE, BOOTS, function () { w.craftLeave(BRENNA); });
yes('C1 she gets up before the work is done: onCraft is never asked and nothing is taken (' + c1.why + ')',
    c1.started && !c1.made && pack(BRENNA) === p0 && crafts() === asked);
const c2 = w.craft(BRENNA, FORGE, BOOTS, function () { w.moveTo(BRENNA, CITY, [3000, 0, 0]); });
yes('C2 the same when she walks off from the bench (' + c2.why + ')', c2.started && !c2.made && pack(BRENNA) === p0 && crafts() === asked);
w.moveTo(BRENNA, CITY, [1050, 0, 0]);
w.activate(FORGE, BRENNA); // gets up: the second activation, no event

// ------------------------------------------------------- D. not a smith --
const d1 = w.activate(FORGE, CORVIN);
yes('D1 Corvin, a tailor: onActivate refuses the forge and it does not open for him', !d1.allowed && !d1.opened && w.holds(FORGE) === 0);
yes('D1 and he is told whose bench it is (' + last(CORVIN) + ')', /^There is nothing you can make here\. That bench is .*Platewright/.test(last(CORVIN)));

// ------------------------------------------------------- E. worn out --
w.activate(FORGE2, ALDIS);
p0 = pack(ALDIS);
const e1 = w.craft(ALDIS, FORGE2, BOOTS);
yes('E1 Aldis, worn out, is refused before the work starts (' + last(ALDIS) + ')', !e1.started && !e1.made && /tired|rest/i.test(last(ALDIS)));
yes('E1 and nothing left his pack', pack(ALDIS) === p0);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
