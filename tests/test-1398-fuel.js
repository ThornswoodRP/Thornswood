// test-1398-fuel.js
//
// #1398. The forge burns the grade of charcoal the smith page's table names,
// the smelter the grade of its metal, and the skyforge one grade poorer. A
// drum, a flute and a lute are not asked for a tool handle; a war axe, a
// battleaxe, a warhammer and a mace still are. Grand Chef's batch comes out
// twice (named before the engine gives it, #2906), a Master Weaver's garment ignores 4 degrees of exposure, and a
// Master Carver's fire is 48 at your feet. Temper rows stay unscored and
// Mastercraft is not a temper bonus.
//
// And Patrick's answer on Master Weaver, 4 October: the tailor picks one per
// garment, warmth or armour. A garment made on Warmth is named Master-Woven
// and one made on Armour Master-Lined, never both, and the warmth reads only
// its own. tests/test-1398-weaver.js holds the pick and the 10%.
//
// It reads the page and recipes.json, drives the real mp.onCraft and the
// real needs block out of gamemode.js over a fake mp, and prints PASS and
// FAIL lines. Exit 1 when anything fails.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const RECIPES_JSON = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8').replace(/^﻿/, ''));
const SMITH = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'professions', 'smith.md'), 'utf8').split(CR).join('');
const Fuel = require(path.join(REPO_DIR, 'scripts', 'dev', 'Build-FuelTable.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack : e), false); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function cut(head) { return slice(gm, head, '\n}\n'); }
function lineOf(re) { const m = re.exec(gm); return m ? m[0] : null; }

// ------------------------------------------------- 1. the table and the page
const fuelLine = /^const FUEL_BY_RECIPE = (\{.*\});$/m.exec(gm);
const FUEL = fuelLine ? JSON.parse(fuelLine[1]) : {};
yes('FUEL_BY_RECIPE is installed in the gamemode', !!fuelLine && Object.keys(FUEL).length > 200);
{
  // The gamemode reads the table from game/gamemode-tables/FUEL_BY_RECIPE.json (#5191).
  const built = JSON.parse(Fuel.tableJson(Fuel.fuelTable(RECIPES_JSON)));
  yes('the installed table is what Build-FuelTable.js builds out of recipes.json today',
    JSON.stringify(require('./gamemode-tables.js').table('FUEL_BY_RECIPE')) === JSON.stringify(built));
}
{
  // The page's table, row by row, is the script's METALS.
  const want = {};
  const rows = SMITH.split('\n').filter(function (l) { return /^\| (Poor Charcoal|Charcoal|Briquette|Coke) \|/.test(l); });
  const grades = { 'Poor Charcoal': 1, 'Charcoal': 2, 'Briquette': 3, 'Coke': 4 };
  rows.forEach(function (l) {
    const cells = l.split('|').map(function (c) { return c.trim(); });
    cells[2].split(',').forEach(function (m) { want[m.trim().toLowerCase()] = grades[cells[1]]; });
  });
  yes('the smith page has the four grade rows', rows.length === 4);
  yes('the script\'s metals are the page\'s table, metal for metal and grade for grade',
      JSON.stringify(Object.keys(want).sort().map(function (k) { return k + want[k]; })) ===
      JSON.stringify(Object.keys(Fuel.METALS).sort().map(function (k) { return k + Fuel.METALS[k]; })));
}
const recSrc = slice(gm, 'var RECIPES_BY_ID = {', ';\n');
let RECIPES = null;
try { RECIPES = new Function('return ' + recSrc.slice('var RECIPES_BY_ID = '.length).replace(/;$/, ''))(); } catch (e) { RECIPES = null; }
const keptSrc = slice(gm, 'const KEPT_SMELT = {', '\n};');
let KEPT = null;
try { KEPT = new Function('return ' + keptSrc.slice('const KEPT_SMELT = '.length).replace(/;$/, ''))(); } catch (e) { KEPT = null; }
yes('the recipe table and the kept smelt read', !!RECIPES && !!KEPT);
function byName(name) {
  for (const k of Object.keys(RECIPES)) { if (RECIPES[k].name === name && !RECIPES[k].nobody) { return k; } }
  return null;
}
if (RECIPES && KEPT) {
  const grade = function (name) { const k = byName(name); return k && FUEL[k] ? FUEL[k][0] : 0; };
  yes('an iron sword burns Poor Charcoal', grade('Iron Sword') === 1);
  yes('a steel sword burns Poor Charcoal', grade('Steel Sword') === 1);
  yes('a dwarven sword, an elven sword, an orcish sword, a falmer sword and a silver sword burn Charcoal',
      ['Dwarven Sword', 'Elven Sword', 'Orcish Sword', 'Falmer Sword', 'Silver Sword'].every(function (n) { return grade(n) === 2; }));
  yes('a nordic sword, a glass sword and an ebony sword burn Charcoal Briquette',
      ['Nordic Sword', 'Glass Sword', 'Ebony Sword'].every(function (n) { return grade(n) === 3; }));
  // #516: bows are made at the woodworking bench since #2529, which is not a forge and burns nothing.
  yes('a nordic bow and a glass bow, made at the woodworking bench, burn nothing',
      ['Nordic Bow', 'Glass Bow'].every(function (n) { return !!byName(n) && grade(n) === 0; }));
  yes('a stalhrim sword burns Coke', grade('Stalhrim Sword') === 4);
  yes('ancient nord at the skyforge takes Poor Charcoal, which does not get poorer',
      FUEL[byName('Ancient Nord Armor')] && FUEL[byName('Ancient Nord Armor')].join() === '1,ancient nord,skyforge');
  yes('stalhrim at the skyforge takes briquette (the rule, on a row the table has no skyforge copy of)',
      Fuel.fuelOf({ name: 'Stalhrim Sword', benchName: 'CraftingSmithingSkyforge', inputItems: [] }).join() === '3,stalhrim,skyforge');
  yes('ebony at the skyforge takes Charcoal',
      Fuel.fuelOf({ name: 'Ebony Sword', benchName: 'CraftingSmithingSkyforge', inputItems: [] })[0] === 2);
  yes('smelting an ebony ingot burns Charcoal Briquette, the grade of its metal',
      FUEL['a30d3:Skyrim.esm'] && FUEL['a30d3:Skyrim.esm'].join() === '3,ebony,smelter');
  yes('smelting iron burns Poor Charcoal', FUEL['a30c3:Skyrim.esm'] && FUEL['a30c3:Skyrim.esm'][0] === 1);
  yes('the dwarven smelt KEPT_SMELT keeps burns Charcoal', FUEL['10dd28:Skyrim.esm'] && FUEL['10dd28:Skyrim.esm'].join() === '2,dwarven,smelter');
  yes('a hotter metal on the list wins: glass ingots in a Tribunal robe burn briquette',
      grade('Tribunal Light Robe Black') === 3);
  yes('a forge piece with no metal on the table still burns one charcoal, the lowest',
      grade('Hide Helmet') === 1 && FUEL[byName('Hide Helmet')][1] === '');
  // #3120 moved the Tailor's and the Woodwright's forge rows to their own bench,
  // where nothing burns.
  yes('a piece moved off the forge to its trade\'s bench burns nothing: the Fur Hood is made at the loom',
      !!byName('Fur Hood') && RECIPES_JSON.recipes[byName('Fur Hood')].movedFromName === 'CraftingSmithingForge' &&
      !Object.prototype.hasOwnProperty.call(FUEL, byName('Fur Hood')));
  const reach = Object.keys(FUEL).every(function (k) {
    return (Object.prototype.hasOwnProperty.call(RECIPES, k) && !RECIPES[k].nobody) || Object.prototype.hasOwnProperty.call(KEPT, k);
  });
  yes('every row in the fuel table is one the craft gate lets through', reach);
  let missing = 0;
  for (const k of Object.keys(RECIPES)) {
    const src = RECIPES_JSON.recipes[k];
    if (RECIPES[k].nobody || !src) { continue; }
    if (['CraftingSmithingForge', 'CraftingSmithingSkyforge', 'CraftingSmelter'].indexOf(src.benchName) !== -1 && !FUEL[k]) { missing++; }
  }
  yes('every row the server is asked about at a forge, a skyforge or a smelter is in it', missing === 0);
  const temper = Object.keys(FUEL).filter(function (k) {
    const src = RECIPES_JSON.recipes[k] || {};
    return src.benchName === 'CraftingSmithingSharpeningWheel' || src.benchName === 'CraftingSmithingArmorTable';
  });
  yes('no temper row is in it: the wheel and the armour table stay unscored', temper.length === 0);
}

// ------------------------------------------------------- 2. the craft, driven
const progression = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const box = { console: { log: function () {} } };
box.globalThis = box;
vm.runInNewContext(progression, box);
const P = box.__thornswoodProgression;
yes('the progression rules registered', !!P && !!P.perks);
function person(prof, half, rank) {
  const r = P.pickProfession(P.fresh(), prof, half);
  if (r.ok && rank) { r.state.ranks[half] = rank; }
  return r.ok ? r.state : null;
}
// The character block's weaveOf and the maneuvers block's armour mark, as
// the gamemode has them, for the craft to read the tailor's pick.
const weaveOfSrc = slice(gm, '  function weaveOf(s) {', '\n  }\n');
const weaveOf = weaveOfSrc ? new Function('P', weaveOfSrc + '\nreturn weaveOf;')(P) : null;
const wovenArmourLine = /var WOVEN = (\{ mark: '[^']+', less: [0-9.]+ \});/.exec(gm);
const WOVEN = wovenArmourLine ? new Function('return ' + wovenArmourLine[1])() : null;
yes('the character block\'s weaveOf and the maneuvers block\'s armour mark are in the gamemode', !!weaveOf && !!WOVEN);

const ITEMS = JSON.parse(/^const ITEMS = (\{.*\});$/m.exec(gm)[1]);
const pieces = {
  grades: slice(gm, 'const CHARCOAL_GRADES = [', '\n];'),
  hafted: lineOf(/^const HAFTED_FAMILIES = .*$/m),
  handle: lineOf(/^const HANDLE_DESC = .*$/m),
  tools: slice(gm, 'const TOOLS = {', '\n};'),
  key: lineOf(/^const KEY_RECIPE = .*$/m),
  // #3151: the quality a weapon or an armour piece comes out at.
  quality: [slice(gm, 'const CRAFT_QUALITY = {', '\n};'), lineOf(/^const QUALITY_WEAPON_FAMILIES = .*$/m),
            lineOf(/^const QUALITY_RANKS = .*$/m)].join('\n'),
  fns: ['function idOf(descriptor)', 'function mintedEntry(entry)', 'function takeItem(actorId, itemDesc, count)', 'function addItem(actorId, itemDesc, count)',
        'function craftRow(recipeDesc)', 'function fuelFor(recipeDesc)', 'function packCount(actorId, itemDesc)',
        'function charcoalHeld(actorId, grade)', 'function fuelRefusal(fuel)', 'function wantsAHandle(row)',
        'function holdsPerk(actorId, key)', 'function wovenMark(actorId)',
        'function wovenOutput(actorId, row)', 'function cookedOutput(actorId, row)',
        'function qualityTier(margin, roll)', 'function qualityRolled(row, baseId)',
        'function qualityMargin(actorId, row)', 'function qualityOutput(actorId, row, margin)',
        // A dish named with its days left (#3163), after the other outputs.
        'function spoilingOutput(actorId)',
        'function unfitToMake(actorId, workbenchId)',
        // The trade's tool (#3162): asked before anything is taken and worn after.
        'function aWord(name)', 'function toolFor(key)', 'function holdsTool(actorId, tool)',
        'function toolGate(actorId, key)', 'function toolStamps(actorId)', 'function heldToolId(actorId, tool)',
        'function takeItemById(actorId, baseId, count)', 'function wearTool(actorId, key)',
        'function benchToolKey(row)'].map(cut),
  toolNumbers: [lineOf(/^const TOOL_USES = .*$/m), lineOf(/^const TOOL_WARN_AT = .*$/m),
                lineOf(/^const POLE_USES = .*$/m), lineOf(/^const TOOL_PROPERTY = .*$/m)].join('\n'),
  onCraft: slice(gm, "mp.onCraft = guard('onCraft', function (actorId, craftedItemBaseId, count, recipeId, workbenchId, effects) {", '\n});\n')
};
const TOOLS_TABLE = pieces.tools ? new Function(pieces.tools.replace(/^const TOOLS = /, 'return '))() : {};
yes('the craft pieces are all in the gamemode',
    !!pieces.grades && !!pieces.hafted && !!pieces.handle && !!pieces.tools && !!pieces.key &&
    pieces.fns.every(function (f) { return !!f; }) && !!pieces.onCraft);

/*
  The rig: one pack per person, every descriptor its own number, a recipe id
  that is the descriptor's number, and any timer the craft sets caught, so a
  test can say none was (#3026). craftOutput is the engine's property inside
  onCraft (fork #92, #2906, and fork #93 for the name): what the craft gives,
  which the handler may name, and what lands is what it names, as one entry.
*/
function craftRig(state) {
  const ids = {}, descs = {};
  let next = 0x100;
  function id(desc) { if (!ids[desc]) { ids[desc] = next; descs[next] = desc; next++; } return ids[desc]; }
  const packs = {};
  const timers = [];
  const said = [];
  const credited = [];
  let output = null;
  const mp = {
    getIdFromDesc: function (d) { return id(d); },
    getDescFromId: function (n) { return descs[n] || ''; },
    get: function (a, key) {
      if (key === 'inventory') { return { entries: (packs[a] || []).map(function (e) { return Object.assign({}, e); }) }; }
      if (key === 'craftOutput') { return output ? Object.assign({}, output) : undefined; }
      return undefined;
    },
    set: function (a, key, v) {
      if (key === 'inventory') { packs[a] = v.entries.map(function (e) { return Object.assign({}, e); }); }
      if (key === 'craftOutput' && output) {
        output = Object.assign({}, output, v);
        if (output.name === null) { delete output.name; }
      }
    },
    onCraft: null
  };
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function () { return state; }, weaveOf: weaveOf },
    __thornswoodNeeds: { NEEDS: { wear: { woven: { degrees: 4, mark: 'Master-Woven ' } } } },
    __thornswoodManeuvers: { WOVEN: WOVEN }
  };
  const body = [pieces.grades, fuelLine[0], pieces.hafted, pieces.handle, pieces.tools, pieces.toolNumbers, pieces.key, pieces.quality]
    .concat(pieces.fns).join('\n') + '\n' + pieces.onCraft + '\nreturn mp.onCraft;';
  const onCraft = new Function('mp', 'globalThis', 'ITEMS', 'RECIPES_BY_ID', 'KEPT_SMELT', 'guard', 'notify', 'say', 'log',
    'setTimeout', 'recipelessCraft', 'craftAnswer', 'creditWork', body)(
    mp, g, ITEMS, RECIPES, KEPT, function (n, f) { return f; }, function () {},
    function (a, t) { said.push(t); }, function () {},
    function (f, ms) { timers.push(f); return 0; }, function () { return undefined; },
    function () { return { refusal: null, note: null, credit: 'the half' }; },
    function (a, half) { credited.push(half); return ''; });
  const A = 0xff000001;
  // Every bench trade's tool in the pack (#3162), so these crafts are asked
  // about the fuel and the handle and not refused for a missing hammer.
  ['smith', 'tailor', 'cook', 'woodworker'].forEach(function (k) {
    (packs[A] = packs[A] || []).push({ baseId: id(TOOLS_TABLE[k].give), count: 1 });
  });
  return {
    A: A, packs: packs, said: said, credited: credited, timers: timers,
    give: function (desc, n, extra) { (packs[A] = packs[A] || []).push(Object.assign({ baseId: id(desc), count: n }, extra || {})); },
    count: function (desc) {
      return (packs[A] || []).filter(function (e) { return e.baseId === id(desc); }).reduce(function (t, e) { return t + e.count; }, 0);
    },
    entries: function (desc) { return (packs[A] || []).filter(function (e) { return e.baseId === id(desc); }); },
    // What the engine does after an allowed craft: the output lands, what
    // craftOutput names, the recipe's own unless the handler named another,
    // under the name it was given when it was given one.
    craft: function (recipe, made) {
      const row = RECIPES[recipe] || KEPT[recipe];
      output = { baseId: id(row.out), count: made || 1 };
      const r = onCraft(A, id(row.out), made || 1, id(recipe), 0);
      if (r !== false) {
        const landed = { baseId: output.baseId, count: output.count };
        if (output.name) { landed.name = output.name; }
        (packs[A] = packs[A] || []).push(landed);
      }
      output = null;
      return r;
    },
    // The gamemode said yes and then the engine's RemoveItems threw, because
    // the server did not hold what the client said went in: nothing lands.
    craftThatFails: function (recipe, made) {
      const row = RECIPES[recipe] || KEPT[recipe];
      output = { baseId: id(row.out), count: made || 1 };
      const r = onCraft(A, id(row.out), made || 1, id(recipe), 0);
      output = null;
      return r;
    },
    later: function () { while (timers.length) { timers.shift()(); } }
  };
}

if (RECIPES && KEPT && pieces.onCraft && P) {
  const smith = person('smith', 'edgewright', 'master');
  const plate = person('smith', 'platewright', 'master');
  const ebony = byName('Ebony Sword'), iron = byName('Iron Sword'), dwarven = byName('Dwarven Sword');
  const T1 = ITEMS.charcoalT1, T2 = ITEMS.charcoalT2, T3 = ITEMS.charcoalT3, T4 = ITEMS.charcoalT4, VAN = ITEMS.charcoal;
  const HANDLE = /'([^']+)'/.exec(pieces.handle)[1];

  attempt('the grade the table names', function () {
    const r = craftRig(smith);
    r.give(T1, 3); r.give(T3, 2);
    yes('with Poor Charcoal and briquettes in the pack, an ebony sword burns a briquette',
        r.craft(ebony) !== false && r.count(T3) === 1 && r.count(T1) === 3);
    yes('and an iron sword out of the same pack burns Poor Charcoal',
        r.craft(iron) !== false && r.count(T1) === 2 && r.count(T3) === 1);
    yes('the work is credited once for each', r.credited.length === 2);
  });
  attempt('no charcoal of that grade', function () {
    const r = craftRig(smith);
    r.give(T1, 5);
    const before = JSON.stringify(r.packs[r.A]);
    yes('Poor Charcoal alone does not make an ebony sword', r.craft(ebony) === false);
    yes('and nothing is taken', JSON.stringify(r.packs[r.A]) === before);
    yes('and it says which grade, and for what', /Ebony at a forge burns Charcoal Briquette, and you have none\./.test(r.said.join(' ')));
    yes('nothing is credited for a piece that was not made', r.credited.length === 0);
    const c = craftRig(smith);
    c.give(T4, 1);
    yes('coke is not burned in place of Poor Charcoal for iron', c.craft(iron) === false && c.count(T4) === 1);
  });
  attempt('Skyrim\'s own charcoal', function () {
    const r = craftRig(smith);
    r.give(VAN, 1);
    yes('Skyrim\'s own Charcoal is the Charcoal grade: a dwarven sword takes it', r.craft(dwarven) !== false && r.count(VAN) === 0);
    const c = craftRig(smith);
    c.give(VAN, 1);
    yes('and it is not Poor Charcoal', c.craft(iron) === false && c.count(VAN) === 1);
  });
  attempt('the smelter', function () {
    const r = craftRig(plate);
    r.give(T1, 1);
    yes('smelting an ebony ingot with only Poor Charcoal is refused', r.craft('a30d3:Skyrim.esm') === false && r.count(T1) === 1);
    yes('and it says so', /Smelting Ebony burns Charcoal Briquette/.test(r.said.join(' ')));
    r.give(T2, 1);
    yes('the kept dwarven smelt burns Charcoal', r.craft('10dd28:Skyrim.esm') !== false && r.count(T2) === 0 && r.count(T1) === 1);
  });
  attempt('the skyforge', function () {
    const r = craftRig(plate);
    r.give(T1, 1);
    yes('ancient nord at the skyforge burns Poor Charcoal', r.craft(byName('Ancient Nord Armor')) !== false && r.count(T1) === 0);
  });

  const wood = person('woodworker', 'woodwright', 'novice');
  attempt('the instruments and the hafts', function () {
    ['Lute', 'Drum', 'Flute'].forEach(function (name) {
      const r = craftRig(wood);
      r.give(T1, 1);
      yes('a ' + name.toLowerCase() + ' is made at the woodworking bench without a tool handle, and burns no charcoal',
          r.craft(byName(name)) !== false && r.count(T1) === 1);
    });
    ['Iron War Axe', 'Iron Battleaxe', 'Iron Warhammer', 'Iron Mace'].forEach(function (name) {
      const r = craftRig(smith);
      r.give(T1, 1);
      yes('an ' + name.toLowerCase() + ' with no handle is refused, and the charcoal stays',
          r.craft(byName(name)) === false && r.count(T1) === 1 && /fitted to a wooden handle/.test(r.said.join(' ')));
      r.give(HANDLE, 1);
      yes('with a handle it is made, and takes one handle and one Poor Charcoal',
          r.craft(byName(name)) !== false && r.count(T1) === 0 && r.count(HANDLE) === 0);
    });
    const p = craftRig(smith);
    p.give(T1, 1); p.give(HANDLE, 1);
    yes('a pickaxe names its handle in its own record and is not asked for a second',
        p.craft(byName('Pickaxe')) !== false && p.count(HANDLE) === 1);
    // tests\test-1398-fuel.js is what the comment over HANDLE_DESC says counts these.
    const families = ['War axes', 'Battleaxes', 'Warhammers', 'Maces'];
    const counts = families.map(function (f) {
      return Object.keys(RECIPES).filter(function (k) { return RECIPES[k].family === f && !RECIPES[k].nobody; }).length;
    });
    yes('the four hafted families are the page\'s four, and each still matches rows in the table (' + counts.join(', ') + ')',
        pieces.hafted.indexOf("['War axes', 'Battleaxes', 'Warhammers', 'Maces']") !== -1 && counts.every(function (n) { return n > 0; }));
  });

  attempt('Grand Chef', function () {
    const cookRow = Object.keys(RECIPES).filter(function (k) {
      return RECIPES[k].owner === 'Cook' && !RECIPES[k].nobody && !FUEL[k];
    })[0];
    const row = RECIPES[cookRow];
    const chef = person('cook', row.half.toLowerCase(), 'master');
    const r = craftRig(chef);
    r.craft(cookRow, 1);
    yes('a Grand Chef\'s batch lands as two, named before the engine gives it (' + row.name + ')', r.count(row.out) === 2);
    r.later();
    yes('and nothing is added after it', r.count(row.out) === 2);
    yes('and it is still one piece of work', r.credited.length === 1);
    const two = craftRig(chef);
    two.craft(cookRow, 2);
    yes('a batch of two comes out as four', two.count(row.out) === 4);
    const novice = craftRig(person('cook', row.half.toLowerCase(), 'expert'));
    novice.craft(cookRow, 1);
    novice.later();
    yes('an expert cook gets one', novice.count(row.out) === 1);
    const notCook = craftRig(smith);
    notCook.give(T1, 1);
    notCook.craft(iron);
    notCook.later();
    yes('and a master smith\'s sword is not doubled', notCook.count(RECIPES[iron].out) === 1);
    const refused = craftRig(chef);
    refused.craftThatFails(cookRow, 1);
    refused.later();
    yes('a craft the engine refuses after the gamemode said yes hands a Grand Chef nothing', refused.count(row.out) === 0);
    const behind = craftRig(chef);
    behind.give(row.out, 3);
    behind.craftThatFails(cookRow, 1);
    behind.later();
    yes('and the food already in the pack is not doubled either', behind.count(row.out) === 3);
  });

  attempt('Master Weaver, the mark', function () {
    const hood = byName('Fur Hood');
    const weaver = person('tailor', 'haberdasher', 'master');
    const r = craftRig(weaver);
    r.give(T1, 1);
    r.give(RECIPES[hood].out, 2);
    r.craft(hood, 1);
    const woven = r.entries(RECIPES[hood].out).filter(function (e) { return e.name === 'Master-Woven Fur Hood'; });
    yes('a master tailor\'s new garment is named as woven, by the craft itself', woven.length === 1 && woven[0].count === 1);
    yes('and nothing waits on a timer for it (#3026)', r.timers.length === 0);
    yes('and the other hoods in the pack stay plain, with nothing added', r.count(RECIPES[hood].out) === 3 &&
        r.entries(RECIPES[hood].out).filter(function (e) { return !e.name; })
          .reduce(function (t, e) { return t + e.count; }, 0) === 2);
    const plain = craftRig(person('tailor', 'haberdasher', 'expert'));
    plain.give(T1, 1);
    plain.craft(hood, 1);
    yes('an expert tailor\'s garment is not', plain.entries(RECIPES[hood].out).every(function (e) { return !e.name; }));
    const refused = craftRig(weaver);
    refused.give(T1, 1);
    refused.give(RECIPES[hood].out, 1);
    refused.craftThatFails(hood, 1);
    yes('a craft the engine refuses does not name a hood the master already had',
        refused.entries(RECIPES[hood].out).every(function (e) { return !e.name; }) && refused.count(RECIPES[hood].out) === 1);
    const armour = P.clone(weaver);
    armour.weave = 'armour';
    const batch = craftRig(weaver);
    batch.give(T1, 1);
    batch.craft(hood, 2);
    yes('a batch of two comes out as two woven hoods in one entry',
        batch.entries(RECIPES[hood].out).map(function (e) { return e.name + ' x' + e.count; }).join() === 'Master-Woven Fur Hood x2');
    const lined = craftRig(armour);
    lined.give(T1, 1);
    lined.craft(hood, 1);
    const names = lined.entries(RECIPES[hood].out).map(function (e) { return e.name || ''; });
    yes('a master tailor on Armour makes a hood named Master-Lined (' + names.join(', ') + ')',
        names.length === 1 && names[0] === 'Master-Lined Fur Hood');
    yes('the two marks are told apart from the front of the name, so one garment never carries both',
        WOVEN.mark === 'Master-Lined ' && 'Master-Lined Fur Hood'.indexOf('Master-Woven ') !== 0 &&
        'Master-Woven Fur Hood'.indexOf(WOVEN.mark) !== 0);
    const warm = P.clone(weaver);
    warm.weave = 'warmth';
    const woven2 = craftRig(warm);
    woven2.give(T1, 1);
    woven2.craft(hood, 1);
    yes('on Warmth it is Master-Woven, as every woven garment was before there was a pick',
        woven2.entries(RECIPES[hood].out).map(function (e) { return e.name; }).join() === 'Master-Woven Fur Hood');
    const forged = person('tailor', 'haberdasher', 'expert');
    forged.weave = 'armour';
    const notWeaver = craftRig(forged);
    notWeaver.give(T1, 1);
    notWeaver.craft(hood, 1);
    yes('an expert tailor with armour written on the character still makes a plain hood',
        notWeaver.entries(RECIPES[hood].out).every(function (e) { return !e.name; }));
    const already = craftRig(armour);
    already.give(T1, 1);
    already.give(RECIPES[hood].out, 1, { name: 'Master-Woven Fur Hood' });
    already.craft(hood, 1);
    yes('a hood already woven for warmth is not marked again: the new one is the one named Master-Lined',
        already.entries(RECIPES[hood].out).map(function (e) { return e.name; }).sort().join() === 'Master-Lined Fur Hood,Master-Woven Fur Hood');
    yes('Mastercraft is read nowhere outside the rules: a smith\'s master perk is not a temper bonus',
        (gm.match(/'mastercraft'/g) || []).length === 1 && /key: 'mastercraft'/.test(gm));
  });
}

// ----------------------------------------------- 3. the warmth, driven
const needsSrc = slice(gm, '// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
yes('the needs block is in the gamemode', !!needsSrc);
const WARMTH = JSON.parse(require('./gamemode-tables.js').lineOf(gm, 'WARMTH')[1]);
const WEATHER = JSON.parse(require('./gamemode-tables.js').lineOf(gm, 'WEATHER')[1]);
const WATERS = JSON.parse(require('./gamemode-tables.js').lineOf(gm, 'WATERS')[1]);

function needsRig(states) {
  const store = {}, cells = {}, pos = {}, worn = {};
  const ids = {};
  let next = 0x10;
  function idOf(d) { if (!ids[d]) { ids[d] = next++; } return ids[d]; }
  const mp = {
    makeProperty: function () { },
    getDescFromId: function (id) { for (const d in ids) { if (ids[d] === id) { return d; } } return ''; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number); }
      if (key === 'worldOrCellDesc') { return cells[id] || 'cell:X.esm'; }
      if (key === 'inventory') { return { entries: worn[id] || [] }; }
      if (key === 'equipment') { return { inv: { entries: worn[id] || [] } }; }
      if (key === 'pos') { return pos[id] || [0, 0, 0]; }
      return store[id] ? store[id].v : undefined;
    },
    set: function (id, key, v) { if (key === 'thornswoodBurn') { return; } if (!store[id]) { store[id] = {}; } store[id].v = v; }
  };
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function (id) { return states[id] || null; } }
  };
  const api = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'Math', 'Number', 'String', 'Object', 'isFinite',
    'idOf', 'WARMTH', 'WEATHER', 'WATERS',
    needsSrc + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { now: function () { return 1700000000000; } }, { log: function () { } },
    function () { return 0; }, function () { }, function (n, f) { return f; }, function () { }, function () { },
    Math, Number, String, Object, isFinite, idOf, WARMTH, WEATHER, WATERS);
  api.at = function (id, cell, xyz) { cells[id] = cell; pos[id] = xyz; if (!store[id]) { store[id] = {}; } };
  api.wear = function (id, entries) {
    worn[id] = entries.map(function (e) { return Object.assign({ baseId: idOf(e.desc), worn: true }, e.name ? { name: e.name } : {}, e.ench ? { enchantmentId: 7 } : {}); });
  };
  api.idOf = idOf;
  return api;
}

if (needsSrc && P) {
  const carver = person('woodworker', 'charburner', 'master');
  const novice = person('woodworker', 'charburner', 'novice');
  const weaver = person('tailor', 'haberdasher', 'master');
  const A = 0xff000010, B = 0xff000011;
  attempt('Master Carver\'s fire', function () {
    const N = needsRig({});
    yes('the master fire is 48 and reaches no further than any other', N.NEEDS.fire.master === 48 && N.NEEDS.fire.at === 34 && N.NEEDS.fire.reach === 300);
    N.at(A, 'cell:X.esm', [0, 0, 0]);
    N.place(A, 'indoors', '-', '0', '1', '0', '0');
    yes('an ordinary fire at your feet is 34', N.view(A).fireWorth === 34);

    const M = needsRig({ [A]: carver });
    M.at(A, 'cell:X.esm', [0, 0, 0]);
    M.place(A, 'indoors', '-', '0', '1', '0', '0');
    yes('a Master Carver at their own fire gets 48', M.view(A).fireWorth === 48);
    M.place(A, 'indoors', '-', '0', '1', '0', '150');
    yes('half way to 300 it is 24', M.view(A).fireWorth === 24);
    M.place(A, 'indoors', '-', '0', '1', '0', '300');
    yes('and at 300 it is nothing', M.view(A).fireWorth === 0);

    const S = needsRig({ [A]: carver, [B]: novice });
    S.at(A, 'cell:X.esm', [0, 0, 0]);
    S.at(B, 'cell:X.esm', [100, 0, 0]);
    S.place(A, 'indoors', '-', '0', '1', '0', '50');
    S.place(B, 'indoors', '-', '0', '1', '0', '0');
    yes('somebody at the fire a Master Carver is working gets 48', S.view(B).fireWorth === 48);
    S.at(B, 'cell:Y.esm', [100, 0, 0]);
    yes('not in another cell', S.view(B).fireWorth === 34);
    S.at(B, 'cell:X.esm', [1000, 0, 0]);
    yes('not 1000 units from the master', S.view(B).fireWorth === 34);
    S.at(B, 'cell:X.esm', [100, 0, 0]);
    S.place(A, 'indoors', '-', '0', '1', '0', '-');
    yes('not when the master is at no fire', S.view(B).fireWorth === 34);
    const T = needsRig({ [A]: novice, [B]: novice });
    T.at(A, 'cell:X.esm', [0, 0, 0]);
    T.at(B, 'cell:X.esm', [100, 0, 0]);
    T.place(A, 'indoors', '-', '0', '1', '0', '0');
    T.place(B, 'indoors', '-', '0', '1', '0', '0');
    yes('a novice charburner\'s fire is 34', T.view(B).fireWorth === 34);
  });

  attempt('Master Weaver\'s weather', function () {
    const cloth = Object.keys(WARMTH.items).filter(function (d) { return WARMTH.items[d].m === 'cloth'; });
    const N = needsRig({ [A]: weaver });
    yes('the weaver ignores 4 degrees', N.NEEDS.wear.woven.degrees === 4);
    N.at(A, 'cell:X.esm', [0, 0, 0]);
    // Night with no roof is 6 colder, before anything is worn.
    N.place(A, 'outdoors', '-', '1', '0', '0', '-');
    N.wear(A, [{ desc: cloth[0] }]);
    yes('a plain shirt at night: 6 colder', N.view(A).exposure === -6);
    const plainTarget = N.view(A).tempTarget;
    N.wear(A, [{ desc: cloth[0], name: 'Master-Woven Shirt' }]);
    yes('a woven one: 2 colder', N.view(A).exposure === -2);
    yes('and the target is warmer for it', N.view(A).tempTarget > plainTarget);
    N.wear(A, [{ desc: cloth[0], name: 'Master-Woven Shirt' }, { desc: cloth[1], name: 'Master-Woven Hat' }]);
    yes('two woven pieces do not ignore 8', N.view(A).exposure === -2);
    N.wear(A, [{ desc: cloth[0], name: 'Master-Woven Shirt', ench: true }]);
    yes('a piece named that at the enchanting table is not woven', N.view(A).exposure === -6);
    N.wear(A, [{ desc: cloth[0], name: 'Master-Woven Shirt (85%)' }]);
    yes('a woven piece below 100% is still woven', N.view(A).exposure === -2);
    N.wear(A, [{ desc: cloth[0], name: 'Master-Lined Shirt' }]);
    yes('a garment woven for armour keeps no weather off: 6 colder', N.view(A).exposure === -6);
    N.wear(A, [{ desc: cloth[0], name: 'Master-Lined Shirt' }, { desc: cloth[1], name: 'Master-Woven Hat' }]);
    yes('one of each worn: the warm one still counts, 2 colder', N.view(A).exposure === -2);
    N.place(A, 'outdoors', '-', '1', '0', '20000', '-');
    N.wear(A, [{ desc: cloth[0], name: 'Master-Woven Shirt' }]);
    yes('at night up a mountain, 20 colder becomes 16', N.view(A).exposure === -16);
    const sunny = Object.keys(WEATHER.items).filter(function (d) { return WEATHER.items[d].k === 1 && WEATHER.items[d].w <= WEATHER.mid; })[0];
    N.place(A, 'outdoors', N.idOf(sunny).toString(16), '0', '0', '0', '-');
    yes('a clear day is still 4 warmer, not 8', N.view(A).exposure === 4);
    N.place(A, 'indoors', '-', '1', '1', '0', '-');
    yes('under a roof there is nothing to ignore', N.view(A).exposure === 0);
  });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
