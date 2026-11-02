// test-3142-alchemy-journal.js
//
//     node tests/test-3142-alchemy-journal.js
//
// #3142. The Alchemy journal: an in-game page of the mixes a character has
// brewed and the ingredients they have eaten, built on what #3134 keeps on
// the character (the alchemy block's eaten, known and recipes).
//
// J: THE PAGE'S VIEW. The alchemy block's page(actorId) names every eaten
//    ingredient with how many of its effects are known and the names of the
//    known ones the mixtures list names, counts the rest, names every mix
//    brewed with what it made and how many times, and is null while there is
//    nothing on it, for an NPC, and never throws for an ingredient whose
//    record is gone from the load order.
// W: THE WIRING. The character block's writeState puts it on the panel as
//    alchemy, in the world only, beside the Hair dye page.
// U: THE K PANEL. A page titled Alchemy journal, drawn only from the
//    server's alchemy, after Body, with no Confirm and no rows, and its draw
//    run over a stand-in page shows the mixes and the ingredients.
// D: THE PAGES a person reads say where the journal is.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join('');
const gm = require('./gamemode-tables.js').joined(read('game/gamemode.js'));
const SK = read('game/ui/thornswood-skills.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '  (' + why + ')' : '')); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function lift(from, to, src) {
  src = src || gm;
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(to, a + from.length);
  return b < 0 ? null : src.slice(a, b + to.length);
}

const ALCHEMY = lift('// ==== thornswood alchemy ====', '// ==== end thornswood alchemy ====');
const listsSrc = (function () {
  const a = gm.indexOf('var MIXTURES = {');
  const b = gm.indexOf('function recipelessCraft(');
  return (a >= 0 && b > a) ? gm.slice(a, b) : null;
})();
yes('J0 the alchemy block and the mixtures list are in the gamemode', !!ALCHEMY && !!listsSrc);
if (fail) { done(); }

// ------------------------------------------------------- a fake load order --
function put32(v) { v = v >>> 0; return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
const MGEF = {
  damageHealth: 0x3eb42, ravageStamina: 0x73f23, weaknessPoison: 0x90042, slow: 0x73f25,
  damageMagickaRegen: 0x3a2b9, lingeringStamina: 0x10fe6c, fortifyDestruction: 0x3eb03,
  fortifyConjuration: 0x3eaf2
};
// Nightshade and Deathbell in their Skyrim.esm slot order; the root is made
// up, with a first effect the mixtures list does not name.
const INGR = {
  0x2f44c: [MGEF.damageHealth, MGEF.damageMagickaRegen, MGEF.lingeringStamina, MGEF.fortifyDestruction],
  0x516c8: [MGEF.damageHealth, MGEF.ravageStamina, MGEF.slow, MGEF.weaknessPoison],
  0x5f0001: [MGEF.fortifyConjuration, MGEF.fortifyDestruction, MGEF.weaknessPoison, MGEF.ravageStamina]
};
const NIGHTSHADE = 0x2f44c, DEATHBELL = 0x516c8, ROOT = 0x5f0001;
const PERSON = 0xff000058, NPC = 0x1a67c;
const NAMES = { '2f44c:skyrim.esm': 'Nightshade', '516c8:skyrim.esm': 'Deathbell', '5f0001:skyrim.esm': 'Test Root' };
function descOf(n) { return n.toString(16) + ':Skyrim.esm'; }
function idOf(d) { return parseInt(String(d).split(':')[0], 16); }

// A server over a store of properties that outlives it (a second server over
// the same store is a restart) and a load order missing the records in gone.
function server(store, gone) {
  store = store || {};
  gone = gone || {};
  const said = [];
  const mp = {
    makeProperty: function () {},
    get: function (id, prop) {
      if (prop === 'profileId') { return id === NPC ? 0 : 7; }
      const row = store[id] || {};
      return Object.prototype.hasOwnProperty.call(row, prop) ? JSON.parse(row[prop]) : undefined;
    },
    set: function (id, prop, v) { (store[id] = store[id] || {})[prop] = JSON.stringify(v); },
    getDescFromId: descOf,
    getIdFromDesc: idOf,
    lookupEspmRecordById: function (id) {
      if (!INGR[id] || gone[id]) { return null; }
      return {
        record: { type: 'INGR', editorId: 'I' + id, fields: INGR[id].map(function (e) { return { type: 'EFID', data: put32(e) }; }) },
        toGlobalRecordId: function (local) { return local; }
      };
    }
  };
  const T = {};
  new Function('T', 'mp', 'log', 'globalThis', 'holdsPerk', listsSrc + '\nT.MIXTURES = MIXTURES;')(
    T, { makeProperty: function () {} }, function () {}, {}, function () { return false; });
  const box = {
    console: { log: function () {} }, mp: mp, MIXTURES: T.MIXTURES,
    say: function (id, line) { said.push([id, line]); },
    __thornswoodProperty: { itemName: function (e) { return NAMES[descOf(Number(e && e.baseId) || 0).toLowerCase()] || 'something'; } }
  };
  box.globalThis = box;
  vm.runInNewContext(ALCHEMY, box);
  return { A: box.__thornswoodAlchemy, store: store };
}

// ------------------------------------------------------------- J: the view
const s = server();
yes('J1 the alchemy block hands out page', !!s.A && typeof s.A.page === 'function');
yes('J1 nothing eaten and nothing brewed is no page at all', s.A.page(PERSON) === null);
s.A.ate(NPC, DEATHBELL);
yes('J1 an NPC gets no page', s.A.page(NPC) === null);

s.A.ate(PERSON, NIGHTSHADE);
let p = s.A.page(PERSON);
yes('J2 a first taste puts the page up, with the ingredient by name',
    !!p && p.eaten.length === 1 && p.eaten[0].name === 'Nightshade' && p.recipes.length === 0);
yes('J2 eating teaches the first effect: 1 of 4 known, named Damage Health',
    !!p && p.eaten[0].known === 1 && p.eaten[0].of === 4 && JSON.stringify(p.eaten[0].effects) === '["Damage Health"]' &&
    p.eaten[0].other === 0, JSON.stringify(p));

s.A.ate(PERSON, ROOT);
p = s.A.page(PERSON);
const root = p && p.eaten.filter(function (r) { return r.name === 'Test Root'; })[0];
yes('J3 a known effect the mixtures list does not name is counted, not named as a desc',
    !!root && root.known === 1 && root.effects.length === 0 && root.other === 1 &&
    JSON.stringify(p).indexOf(':Skyrim.esm') === -1, JSON.stringify(root));
yes('J3 eaten is in name order', !!p && p.eaten.map(function (r) { return r.name; }).join('|') === 'Nightshade|Test Root');

s.A.ate(PERSON, DEATHBELL);
const nd = [{ baseId: NIGHTSHADE, count: 1 }, { baseId: DEATHBELL, count: 1 }];
s.A.brewed(PERSON, nd, [MGEF.damageHealth]);
s.A.brewed(PERSON, nd, [MGEF.damageHealth]);
s.A.brewed(PERSON, [{ baseId: DEATHBELL, count: 1 }, { baseId: ROOT, count: 1 }], [MGEF.ravageStamina, MGEF.weaknessPoison]);
p = s.A.page(PERSON);
yes('J4 every mix brewed, with its ingredients, what it made and how many times',
    !!p && p.recipes.length === 2 &&
    p.recipes[0].with.join('|') === 'Nightshade|Deathbell' && p.recipes[0].makes.join('|') === 'Damage Health' && p.recipes[0].times === 2 &&
    p.recipes[1].makes.join('|') === 'Ravage Stamina|Weakness to Poison' && p.recipes[1].times === 1, JSON.stringify(p && p.recipes));
const bell = p && p.eaten.filter(function (r) { return r.name === 'Deathbell'; })[0];
yes('J4 a brew\'s effects show on each ingredient: Deathbell knows 3 of 4, all named',
    !!bell && bell.known === 3 && bell.of === 4 && bell.other === 0 &&
    bell.effects.join('|') === 'Damage Health|Ravage Stamina|Weakness to Poison', JSON.stringify(bell));
yes('J4 the record itself is not changed by reading the page',
    JSON.stringify(s.A.read(PERSON)) === JSON.stringify(s.A.read(PERSON)) && s.A.read(PERSON).recipes.length === 2);

// Nightshade eaten, then a restart with its plugin out of the load order.
const kept = {};
server(kept).A.ate(PERSON, NIGHTSHADE);
const s2 = server(kept, { [NIGHTSHADE]: true });
let lost = null, threw = null;
try { lost = s2.A.page(PERSON); } catch (e) { threw = e; }
yes('J5 an ingredient whose record is gone stays on the page, with effects null, and nothing throws',
    !threw && !!lost && lost.eaten.length === 1 && lost.eaten[0].effects === null && lost.eaten[0].name === 'Nightshade',
    threw ? String(threw) : JSON.stringify(lost));

// ------------------------------------------------------------- W: wiring
{
  const ws = lift('  function writeState(actorId, s, redraw) {', '\n  }\n') || '';
  const world = ws.slice(ws.indexOf('if (view && !view.creating) {'), ws.indexOf('var sig = drawn(view);'));
  yes('W1 writeState puts the alchemy block\'s page on the panel as alchemy, in the world only',
      /var AJ = g\.__thornswoodAlchemy;/.test(world) && /AJ\.page\(actorId\)/.test(world) &&
      /if \(alchemyPage\) \{ view\.alchemy = alchemyPage; \}/.test(world));
  yes('W2 and before the signature, so a new taste or mix sends the panel',
      ws.indexOf('view.alchemy = alchemyPage') > 0 && ws.indexOf('view.alchemy = alchemyPage') < ws.indexOf('var sig = drawn(view);'));
  yes('W3 a throw in the page leaves the page off, not the panel',
      /try \{ alchemyPage = \(AJ && AJ\.page\) \? AJ\.page\(actorId\) : null; \} catch \(eAlch\) \{ alchemyPage = null; \}/.test(world));
}

// ------------------------------------------------------------ U: the panel
{
  let parsed = true;
  try { new vm.Script(SK); } catch (e) { parsed = false; }
  yes('U1 thornswood-skills.js parses', parsed);
  yes('U2 K has an Alchemy journal page', /alchemy: \{\s*title: 'Alchemy journal'/.test(SK));
  yes('U3 drawn only from the server\'s alchemy, never while creating, after Body',
      /if \(!creating\(\) && alchemyView\(\)\) sections\.push\('alchemy'\);/.test(SK) &&
      SK.indexOf("sections.push('alchemy')") > SK.indexOf("sections.push('body')"));
  yes('U4 nothing on it is sent: no Confirm and no rows',
      /section !== 'body' && section !== 'alchemy'(?: && section !== 'college')?\);/.test(SK) && /if \(section === 'alchemy'\) return 0;/.test(SK) &&
      /else if \(section === 'alchemy'\) drawAlchemy\(\);/.test(SK));

  // The draw itself, over a stand-in page.
  const fns = ['  function alchemyView() {', '  function alchemyList(field) {', '  function drawAlchemy() {', '  function listWords(words) {']
    .map(function (h) { return lift(h, '\n  }\n', SK); });
  yes('U5 the page\'s functions are found', fns.every(Boolean));
  if (fns.every(Boolean)) {
    function node(tag, cls) {
      return { tag: tag, className: cls || '', textContent: '', children: [],
               appendChild: function (c) { this.children.push(c); return c; } };
    }
    function text(n) { return [n.textContent].concat(n.children.map(text)).join(' '); }
    const elBody = node('div');
    const ctx = {
      elBody: elBody, mine: { alchemy: p },
      el: function (tag, cls, t) { const d = node(tag, cls); if (t !== undefined && t !== null) { d.textContent = t; } return d; }
    };
    vm.createContext(ctx);
    vm.runInContext(fns.join('\n') + '\nthis.drawAlchemy = drawAlchemy;', ctx);
    ctx.drawAlchemy();
    const all = text(elBody);
    yes('U6 the page names the mixes, with what they made and how often',
        /2 mixes brewed, 3 ingredients eaten/.test(all) && /Damage Health/.test(all) && /brewed 2 times/.test(all) &&
        /Nightshade and Deathbell\./.test(all) && /Ravage Stamina and Weakness to Poison/.test(all) && /brewed once/.test(all), all);
    yes('U7 and every ingredient with what is known of it',
        /Deathbell/.test(all) && /3 of 4 known/.test(all) && /Known: Damage Health, Ravage Stamina and Weakness to Poison\./.test(all) &&
        /One more known effect is not one a brew here makes\./.test(all), all);
    elBody.children.length = 0;
    ctx.mine = { alchemy: lost };
    ctx.drawAlchemy();
    yes('U8 an ingredient the server cannot find is said plainly', /cannot find this ingredient/.test(text(elBody)), text(elBody));
  }
  const page = lift('  function drawAlchemy() {', '\n  }\n', SK) || '';
  yes('U9 no long dash and no word the house style keeps out on the page',
      page.indexOf('—') === -1 && !/\bplayers?\b/i.test(page));
}

// ------------------------------------------------------------- D: the docs
{
  const alch = read('docs/systems/professions/alchemist.md');
  const classes = read('site/data/site/classes.md');
  yes('D1 the Alchemist page says where the journal is', /Alchemy journal page of the K panel/.test(alch) && /#3142/.test(alch));
  yes('D2 the classes page on the site says it too', /Alchemy journal page of the K panel/.test(classes));
}

done();
