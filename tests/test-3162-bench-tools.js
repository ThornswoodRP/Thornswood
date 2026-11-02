// test-3162-bench-tools.js
//
// #3162. Patrick's A on his report page, 22 October 2026: each bench trade
// needs its own tool, worn out after 50 uses like a gathering tool. Until then
// only the four gathering tools were asked for; a smith with an empty pack
// forged as freely as one holding a hammer, because nothing in the craft path
// asked toolGate at all.
//
// This drives the real pieces out of game/gamemode.js over a fake mp, one pack
// per person and every descriptor its own number:
//
//   T  the table: a tool for each trade that owns a recipe row, each one's
//      form id a record that exists (Skyrim's own, or Thornswood-Content.esp's
//      own as Add-ContentRecords.py writes it), and a recipe for every tool.
//   K  benchToolKey: the row's owner names the tool, a row nobody owns asks
//      for none, and the row that makes the hammer asks for none.
//   C  mp.onCraft: refused with the sentence and nothing taken with no tool,
//      made with it, one use off per craft, worn thin at 15 left, and broken
//      and taken at 50. A plugin missing from the load order asks for nothing.
//   B  benchGate: the forge stays shut for a tailor with no shears and says
//      why, and opens with them; a smith with no hammer gets in to forge one; the alchemy lab and the arcane enchanter the
//      same with the alembic and the rune knife.
//   R  recipelessCraft, cutKey and cutMasterKey ask the tool before anything
//      is taken and wear it after.
//   P  the pick hands the tool over: giveTool for each of the five.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(process.env.GM || path.join(ROOT, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const addContent = fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py'), 'utf8').split(CR).join('');
const recipeOwners = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'recipe-owners.json'), 'utf8').replace(/^\uFEFF/, '')).owner || {};

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack : e), false); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function cut(head) { return slice(gm, head, '\n}\n'); }
function lineOf(re) { const m = re.exec(gm); return m ? m[0] : null; }
const BENCH_TRADES = ['smith', 'tailor', 'cook', 'alchemist', 'enchanter'];

// ------------------------------------------------------------ the pieces
const toolsSrc = slice(gm, 'const TOOLS = {', '\n};');
const TOOLS = toolsSrc ? new Function(toolsSrc.replace(/^const TOOLS = /, 'return '))() : null;
const recSrc = slice(gm, 'var RECIPES_BY_ID = {', ';\n');
const RECIPES = recSrc ? new Function('return ' + recSrc.slice('var RECIPES_BY_ID = '.length).replace(/;$/, ''))() : null;
const keptSrc = slice(gm, 'const KEPT_SMELT = {', '\n};');
const KEPT = keptSrc ? new Function('return ' + keptSrc.slice('const KEPT_SMELT = '.length).replace(/;$/, ''))() : null;
const ITEMS = JSON.parse(/^const ITEMS = (\{.*\});$/m.exec(gm)[1]);
const BENCH_ACCESS = JSON.parse(/^const BENCH_ACCESS = (\{.*\});$/m.exec(gm)[1]);
const BENCH_BY_BASE = JSON.parse(/^const BENCH_BY_BASE = (\{.*\});$/m.exec(gm)[1]);
const pieces = {
  grades: slice(gm, 'const CHARCOAL_GRADES = [', '\n];'),
  fuel: lineOf(/^const FUEL_BY_RECIPE = .*$/m),
  hafted: lineOf(/^const HAFTED_FAMILIES = .*$/m),
  handle: lineOf(/^const HANDLE_DESC = .*$/m),
  key: lineOf(/^const KEY_RECIPE = .*$/m),
  noProf: lineOf(/^const NO_PROFESSION_AT_A_BENCH = .*$/m),
  // #3151: the quality a weapon or an armour piece comes out at, which onCraft asks.
  quality: [slice(gm, 'const CRAFT_QUALITY = {', '\n};'), lineOf(/^const QUALITY_WEAPON_FAMILIES = .*$/m),
            lineOf(/^const QUALITY_RANKS = .*$/m)].join('\n'),
  toolNumbers: [lineOf(/^const TOOL_USES = .*$/m), lineOf(/^const TOOL_WARN_AT = .*$/m),
                lineOf(/^const POLE_USES = .*$/m), lineOf(/^const TOOL_PROPERTY = .*$/m)].join('\n'),
  fns: ['function idOf(descriptor)', 'function mintedEntry(entry)', 'function takeItem(actorId, itemDesc, count)',
        'function addItem(actorId, itemDesc, count)', 'function craftRow(recipeDesc)', 'function fuelFor(recipeDesc)',
        'function packCount(actorId, itemDesc)', 'function charcoalHeld(actorId, grade)', 'function fuelRefusal(fuel)',
        'function wantsAHandle(row)', 'function holdsPerk(actorId, key)', 'function wovenMark(actorId)',
        'function wovenOutput(actorId, row)', 'function cookedOutput(actorId, row)',
        'function qualityTier(margin, roll)', 'function qualityRolled(row, baseId)',
        'function qualityMargin(actorId, row)', 'function qualityOutput(actorId, row, margin)',
        // A dish named with its days left (#3163), after the other outputs.
        'function spoilingOutput(actorId)',
        'function unfitToMake(actorId, workbenchId)', 'function rankWord(rank)', 'function aWord(name)',
        'function professionName(prof)', 'function craftAnswer(actorId, row)',
        'function toolFor(key)', 'function holdsTool(actorId, tool)', 'function toolStamps(actorId)',
        'function handTool(actorId, key)', 'function giveTool(actorId, key)', 'function toolGate(actorId, key)',
        'function heldToolId(actorId, tool)', 'function takeItemById(actorId, baseId, count)',
        'function wearTool(actorId, key)', 'function benchToolKey(row)', 'function professionOfHalf(half)',
        'function benchGate(actorId, baseDesc)'].map(cut),
  onCraft: slice(gm, "mp.onCraft = guard('onCraft', function (actorId, craftedItemBaseId, count, recipeId, workbenchId, effects) {", '\n});\n')
};
yes('TOOLS, the recipe table, the bench tables and every craft piece are in the gamemode',
    !!TOOLS && !!RECIPES && !!KEPT && !!pieces.grades && !!pieces.fuel && !!pieces.hafted && !!pieces.handle &&
    !!pieces.key && !!pieces.noProf && pieces.fns.every(function (f) { return !!f; }) && !!pieces.onCraft);
if (!TOOLS || !RECIPES || !pieces.onCraft || !pieces.fns.every(function (f) { return !!f; })) { done(); }

const progression = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const pbox = { console: { log: function () {} } };
pbox.globalThis = pbox;
vm.runInNewContext(progression, pbox);
const P = pbox.__thornswoodProgression;
yes('the progression rules registered', !!P && !!P.pickProfession);
function person(prof, half, rank) {
  const r = P.pickProfession(P.fresh(), prof, half);
  if (r.ok && rank) { r.state.ranks[half] = rank; }
  return r.ok ? r.state : null;
}

// -------------------------------------------------------------- T. the table
{
  yes('T1 each bench trade has a tool: ' + BENCH_TRADES.map(function (k) { return k + ' ' + (TOOLS[k] ? TOOLS[k].name : '?'); }).join(', '),
      BENCH_TRADES.every(function (k) {
        const t = TOOLS[k];
        return !!t && typeof t.name === 'string' && t.accept.indexOf(t.give) === 0 && !!t.where && !!t.broken;
      }));
  const owners = {};
  Object.keys(RECIPES).forEach(function (k) { if (RECIPES[k].owner) { owners[RECIPES[k].owner.toLowerCase()] = true; } });
  yes('T2 every trade that owns a recipe row has a tool (' + Object.keys(owners).sort().join(', ') + ')',
      Object.keys(owners).length > 0 && Object.keys(owners).every(function (o) { return !!TOOLS[o]; }));
  yes('T3 the hammer and the ladle are Skyrim\'s own, BlacksmithHammer01 and WoodenLadle01',
      TOOLS.smith.give === '5cae1:Skyrim.esm' && TOOLS.cook.give === '319e5:Skyrim.esm');
  // Thornswood-Content.esp's own: the form id Add-ContentRecords.py gives a
  // MISC record of that name, so the descriptor is one the plugin really has.
  const own = { tailor: 'Shears', alchemist: 'Alembic', enchanter: 'Rune Knife' };
  Object.keys(own).forEach(function (k) {
    const m = /^([0-9a-f]+):Thornswood-Content\.esp$/.exec(TOOLS[k].give);
    const name = m ? (new RegExp('^([A-Z_]+) = 0x5' + ('000000' + m[1]).slice(-6) + '$', 'mi').exec(addContent) || [])[1] : '';
    const rec = name ? new RegExp('misc\\(' + name + ", 'ThornswoodMiscTool[A-Za-z]+', '" + own[k] + "'").test(addContent) : false;
    yes('T4 the ' + TOOLS[k].name + ' is Thornswood-Content.esp\'s own MISC record ' + (name || '?') + ', named ' + own[k],
        rec && TOOLS[k].name.toLowerCase().indexOf(own[k].toLowerCase()) !== -1);
  });
  // Every tool has a recipe in the plugin, made at a bench by a trade whose
  // own tool is not the thing being made, except the hammer itself.
  const makes = {
    smith: ['HAMMER', 'FORGE_KEYWORD'], tailor: ['SHEARS', 'FORGE_KEYWORD'], alchemist: ['ALEMBIC', 'FORGE_KEYWORD'],
    enchanter: ['RUNE_KNIFE', 'FORGE_KEYWORD'], cook: ['LADLE', 'WOODWORKING_KEYWORD']
  };
  Object.keys(makes).forEach(function (k) {
    const re = new RegExp('cobj\\(RECIPE_' + makes[k][0] + ", 'ThornswoodRecipeTool\\w+', \\[[^\\]]*\\],\\s*" + makes[k][0] + ', ' + makes[k][1] + '\\)');
    yes('T5 the ' + TOOLS[k].name + ' has a recipe in Add-ContentRecords.py, at the ' +
        (makes[k][1] === 'FORGE_KEYWORD' ? 'forge' : 'woodworking bench'), re.test(addContent));
  });
  // The owners are data in records/recipe-owners.json, which Build-RecipeTable.ps1 reads (#3470).
  const owns = function (e, owner, half) { const o = recipeOwners['ThornswoodRecipeTool' + e]; return !!o && o.Owner === owner && o.Half === half && !!o.Why; };
  yes('T6 records/recipe-owners.json names an owner for every tool\'s recipe (smith for four, woodworker for the ladle)',
      ['Hammer', 'Shears', 'Alembic', 'RuneKnife'].every(function (e) { return owns(e, 'Smith', 'Edgewright'); }) &&
      owns('Ladle', 'Woodworker', 'Woodwright'));
}

// ---------------------------------------------------------------- the rig
/*
  One pack per person, every descriptor its own number, a recipe id that is
  the descriptor's number. `missing` is a plugin not in the load order: its
  descriptors resolve to 0, as getIdFromDesc answers for a plugin not loaded.
*/
function rig(state, missing) {
  const ids = {}, descs = {};
  let next = 0x100;
  function id(desc) {
    if (missing && String(desc).indexOf(':' + missing) !== -1) { return 0; }
    if (!ids[desc]) { ids[desc] = next; descs[next] = desc; next++; }
    return ids[desc];
  }
  const packs = {};
  const props = {};
  const said = [];
  const credited = [];
  const mp = {
    getIdFromDesc: function (d) { return id(d); },
    getDescFromId: function (n) { return descs[n] || ''; },
    get: function (a, key) {
      if (key === 'inventory') { return { entries: (packs[a] || []).map(function (e) { return Object.assign({}, e); }) }; }
      if (props[a] && Object.prototype.hasOwnProperty.call(props[a], key)) { return JSON.parse(JSON.stringify(props[a][key])); }
      return undefined;
    },
    set: function (a, key, v) {
      if (key === 'inventory') { packs[a] = v.entries.map(function (e) { return Object.assign({}, e); }); return; }
      (props[a] = props[a] || {})[key] = JSON.parse(JSON.stringify(v));
    }
  };
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function () { return state; }, nameOf: function (h) { return h; }, weaveOf: function () { return ''; } },
    __thornswoodNeeds: { NEEDS: { wear: { woven: { degrees: 4, mark: 'Master-Woven ' } } } },
    __thornswoodManeuvers: { WOVEN: { mark: 'Master-Lined ', less: 0.1 } }
  };
  const body = [pieces.grades, pieces.fuel, pieces.hafted, pieces.handle, toolsSrc, pieces.toolNumbers, pieces.key, pieces.noProf, pieces.quality]
    .concat(pieces.fns).join('\n') + '\n' + pieces.onCraft +
    '\nreturn { onCraft: mp.onCraft, benchGate: benchGate, giveTool: giveTool, benchToolKey: benchToolKey, toolGate: toolGate };';
  const api = new Function('mp', 'globalThis', 'ITEMS', 'RECIPES_BY_ID', 'KEPT_SMELT', 'BENCH_ACCESS', 'BENCH_BY_BASE',
    'guard', 'notify', 'say', 'log', 'setTimeout', 'recipelessCraft', 'creditWork', 'raceGate', 'onCraftRoll', body)(
    mp, g, ITEMS, RECIPES, KEPT, BENCH_ACCESS, BENCH_BY_BASE, function (n, f) { return f; }, function () {},
    function (a, t) { said.push(t); }, function () {}, function () { return 0; }, function () { return undefined; },
    function (a, half) { credited.push(half); return ''; }, function () { return null; }, function () { return false; });
  const A = 0xff000001;
  return {
    A: A, api: api, said: said, credited: credited, packs: packs, props: props, id: id,
    give: function (desc, n) { (packs[A] = packs[A] || []).push({ baseId: id(desc), count: n }); },
    count: function (desc) {
      return (packs[A] || []).filter(function (e) { return e.baseId === id(desc); }).reduce(function (t, e) { return t + e.count; }, 0);
    },
    craft: function (recipe) {
      const row = RECIPES[recipe] || KEPT[recipe];
      const r = api.onCraft(A, id(row.out), 1, id(recipe), 0);
      if (r !== false) { (packs[A] = packs[A] || []).push({ baseId: id(row.out), count: 1 }); }
      return r;
    }
  };
}
function byName(name, owner) {
  for (const k of Object.keys(RECIPES)) {
    const r = RECIPES[k];
    if (r.name === name && !r.nobody && (!owner || r.owner === owner)) { return k; }
  }
  return null;
}

// --------------------------------------------------------- K. benchToolKey
attempt('benchToolKey', function () {
  const k = rig(null).api.benchToolKey;
  yes('K1 a smith\'s row asks for the hammer, a tailor\'s for the shears, a cook\'s for the ladle',
      k({ owner: 'Smith', out: '12eb7:Skyrim.esm' }) === 'smith' && k({ owner: 'Tailor', out: 'x' }) === 'tailor' &&
      k({ owner: 'Cook', out: 'x' }) === 'cook');
  yes('K1 a woodworker\'s row asks for the woodcutter\'s axe, the one tool of that trade',
      k({ owner: 'Woodworker', out: 'x' }) === 'woodworker');
  yes('K2 a row nobody owns asks for nothing', k({ owner: '', out: 'x' }) === '' && k({ out: 'x' }) === '' && k(null) === '');
  yes('K3 the row that makes a hammer asks for no hammer, so a smith whose hammer broke can forge another',
      k({ owner: 'Smith', out: TOOLS.smith.give }) === '');
  yes('K3 and that is the hammer alone: a smith forging shears still needs the hammer',
      k({ owner: 'Smith', out: TOOLS.tailor.give }) === 'smith' && k({ owner: 'Woodworker', out: TOOLS.cook.give }) === 'woodworker');
});

// ---------------------------------------------------------- C. mp.onCraft
const iron = byName('Iron Dagger', 'Smith') || byName('Iron Sword', 'Smith');
const T1 = ITEMS.charcoalT1;
yes('the recipe table has an iron dagger or sword a smith makes', !!iron);
attempt('a craft with no tool', function () {
  const r = rig(person('smith', 'edgewright', 'master'));
  r.give(T1, 3);
  const before = JSON.stringify(r.packs[r.A]);
  yes('C1 a smith with no hammer is refused the iron piece', r.craft(iron) === false);
  yes('C1 with the sentence that says which tool and who makes one (' + r.said[0] + ')',
      r.said[0] === 'You need a hammer in your pack for that. ' + TOOLS.smith.where);
  yes('C1 and nothing is taken, nothing is credited', JSON.stringify(r.packs[r.A]) === before && r.credited.length === 0);
});
attempt('a craft with the tool, worn to nothing', function () {
  const r = rig(person('smith', 'edgewright', 'master'));
  r.give(T1, 60);
  r.give(TOOLS.smith.give, 1);
  yes('C2 with a hammer the same craft goes through and burns its charcoal',
      r.craft(iron) !== false && r.count(T1) === 59 && r.credited.length === 1);
  yes('C2 one use comes off the hammer', r.props[r.A][lineOf(/^const TOOL_PROPERTY = '([^']+)'/m).split("'")[1]]['wear:smith'] === 1);
  let warned = -1;
  for (let i = 2; i <= 49; i++) {
    r.said.length = 0;
    r.craft(iron);
    if (r.said.some(function (l) { return /worn thin/.test(l); })) { warned = i; }
  }
  yes('C3 the hammer is worn thin at 15 uses left, the 35th craft (' + warned + ')', warned === 35);
  yes('C3 and still in the pack after 49', r.count(TOOLS.smith.give) === 1);
  r.said.length = 0;
  r.craft(iron);
  yes('C4 the 50th craft breaks it: it is gone from the pack and the count starts again',
      r.count(TOOLS.smith.give) === 0 && r.said.some(function (l) { return /hammer/.test(l); }));
  yes('C4 and the next craft is refused for want of one', r.craft(iron) === false);
});
attempt('the other trades', function () {
  const tailorRow = Object.keys(RECIPES).filter(function (k) {
    const x = RECIPES[k];
    return x.owner === 'Tailor' && !x.nobody && x.rank === 'novice' && !FUEL_ROW(k);
  })[0];
  const cookRow = Object.keys(RECIPES).filter(function (k) {
    const x = RECIPES[k];
    return x.owner === 'Cook' && !x.nobody && x.rank === 'novice' && !FUEL_ROW(k);
  })[0];
  yes('the table has a novice tailor\'s row and a novice cook\'s row that burn nothing', !!tailorRow && !!cookRow);
  const tr = RECIPES[tailorRow], cr = RECIPES[cookRow];
  const t = rig(person('tailor', tr.half.toLowerCase(), 'master'));
  yes('C5 a tailor with no shears is refused (' + tr.name + ')',
      t.craft(tailorRow) === false && /pair of shears/.test(t.said[0]));
  t.give(TOOLS.tailor.give, 1);
  yes('C5 and makes it with a pair', t.craft(tailorRow) !== false);
  const c = rig(person('cook', cr.half.toLowerCase(), 'master'));
  yes('C6 a cook with no ladle is refused (' + cr.name + ')',
      c.craft(cookRow) === false && /You need a wooden ladle/.test(c.said[0]));
  c.give(TOOLS.cook.give, 1);
  yes('C6 and makes it with one', c.craft(cookRow) !== false);
});
attempt('a plugin not in the load order', function () {
  const tailorRow = Object.keys(RECIPES).filter(function (k) {
    const x = RECIPES[k];
    return x.owner === 'Tailor' && !x.nobody && x.rank === 'novice' && !FUEL_ROW(k);
  })[0];
  const tr = RECIPES[tailorRow];
  const t = rig(person('tailor', tr.half.toLowerCase(), 'master'), 'Thornswood-Content.esp');
  yes('C7 with Thornswood-Content.esp missing the shears do not resolve, and the craft is not refused for them',
      t.craft(tailorRow) !== false);
});
function FUEL_ROW(k) { return new RegExp('"' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '":').test(pieces.fuel); }

// ------------------------------------------------------------ B. benchGate
function baseFor(key) {
  return Object.keys(BENCH_BY_BASE).filter(function (b) { return BENCH_BY_BASE[b] === key; })[0];
}
attempt('the bench doors', function () {
  const forge = baseFor('88105:Skyrim.esm');
  yes('the forge has a base in BENCH_BY_BASE', !!forge);
  // The forge holds the hammer's own row, which asks for no hammer, so a
  // smith whose hammer broke still gets in to forge another (C1 holds the
  // refusal of everything else they reach for there).
  const hammerRow = Object.keys(RECIPES).filter(function (k) { return RECIPES[k].out === TOOLS.smith.give && RECIPES[k].owner === 'Smith'; })[0];
  yes('B1 the recipe table has the hammer\'s row, a novice Edgewright\'s at the forge (' + hammerRow + ')',
      !!hammerRow && RECIPES[hammerRow].rank === 'novice' && RECIPES[hammerRow].half === 'Edgewright' &&
      (BENCH_ACCESS['88105:Skyrim.esm'].rows || []).indexOf(hammerRow) !== -1);
  const r = rig(person('smith', 'platewright', 'novice'));
  yes('B1 so a smith with no hammer is let in to the forge, the sister half included',
      r.api.benchGate(r.A, forge) === null);
  r.give(ITEMS.charcoalT1, 1);
  r.give(ITEMS.ironIngot || '5ace4:Skyrim.esm', 1);
  r.give(lineOf(/^const HANDLE_DESC = '([^']+)'/m).split("'")[1], 1);
  yes('B1 and forges a hammer there with none in the pack', r.craft(hammerRow) !== false && r.count(TOOLS.smith.give) === 1);
  // A tailor's rows are at the loom since #3120 moved them off the forge.
  const loom = baseFor('6ce000:Update.esm');
  const t = rig(person('tailor', 'haberdasher', 'novice'));
  const shut = loom ? t.api.benchGate(t.A, loom) : null;
  yes('B1 a tailor with no shears is turned away from the loom, told which tool and who makes one (' + shut + ')',
      shut === 'You need a pair of shears in your pack for that. ' + TOOLS.tailor.where);
  t.give(TOOLS.tailor.give, 1);
  yes('B1 and the loom opens with a pair in the pack', !!loom && t.api.benchGate(t.A, loom) === null);

  const lab = baseFor('alchemy');
  const ench = baseFor('enchanting');
  yes('the alchemy lab and the arcane enchanter have bases in BENCH_BY_BASE', !!lab && !!ench);
  const a = rig(person('alchemist', 'physicker', 'novice'));
  const noAlembic = a.api.benchGate(a.A, lab);
  yes('B2 an alchemist with no alembic is turned away from the lab (' + noAlembic + ')', /You need an alembic/.test(noAlembic || ''));
  a.give(TOOLS.alchemist.give, 1);
  yes('B2 and it opens with one', a.api.benchGate(a.A, lab) === null);
  const e = rig(person('enchanter', 'bladebinder', 'novice'));
  yes('B3 an enchanter with no rune knife is turned away from the arcane enchanter',
      /You need a rune knife/.test(e.api.benchGate(e.A, ench) || ''));
  e.give(TOOLS.enchanter.give, 1);
  yes('B3 and it opens with one', e.api.benchGate(e.A, ench) === null);
  const c = rig(person('cook', 'hearthcook', 'novice'));
  const pot = baseFor('a5cb3:Skyrim.esm');
  yes('B4 a cook with no ladle is turned away from the cooking pot', /You need a wooden ladle/.test(c.api.benchGate(c.A, pot) || ''));
  c.give(TOOLS.cook.give, 1);
  yes('B4 and it opens with one', c.api.benchGate(c.A, pot) === null);
  const n = rig(person('alchemist', 'physicker', 'novice'));
  const notHers = n.api.benchGate(n.A, forge);
  yes('B5 somebody whose trade is not at the bench is still told whose bench it is, not about a hammer (' + notHers + ')',
      /There is nothing you can make here/.test(notHers || '') && !/hammer/.test(notHers || ''));
});

// ------------------------------------------- R. the other ways of making
{
  function strip(s) { return String(s || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '); }
  const rc = strip(cut('function recipelessCraft('));
  yes('R1 a brew or an enchantment asks the alembic or the rune knife before anything is credited, and wears it after',
      /var noBenchTool = toolGate\(actorId, want\);/.test(rc) &&
      rc.indexOf('toolGate(actorId, want)') < rc.indexOf('creditWork(') &&
      rc.lastIndexOf('wearTool(actorId, want)') > rc.lastIndexOf('creditWork('));
  yes('R1 the path that finds the menu\'s row asks that row\'s tool', /toolGate\(actorId, benchToolKey\(allowedBy\.row\)\)|benchToolKey\(allowedBy\.row\)/.test(rc));
  const ck = strip(slice(gm, '  function cutKey(actorId, profileId, toProfile, parts) {', '\n  }\n'));
  const cm = strip(slice(gm, '  function cutMasterKey(', '\n  }\n'));
  [['R2 a key cut at a forge', ck], ['R3 a master key', cm]].forEach(function (p) {
    yes(p[0] + ' asks for the hammer before the ingot is taken, and wears it once the key is cut',
        /toolGate\(actorId, 'smith'\)/.test(p[1]) && p[1].indexOf("toolGate(actorId, 'smith')") < p[1].indexOf('takeItem(') &&
        p[1].lastIndexOf("wearTool(actorId, 'smith')") > p[1].indexOf('takeItem('));
  });
}

// ------------------------------------------------------------- P. the pick
attempt('the pick', function () {
  BENCH_TRADES.forEach(function (k) {
    const r = rig(null);
    const line = r.api.giveTool(r.A, k);
    yes('P1 a ' + k + ' is handed ' + TOOLS[k].name + ' at the pick (' + line + ')',
        r.count(TOOLS[k].give) === 1 && /^You are handed an? /.test(line || ''));
  });
  yes('P2 an alembic is "an alembic", not "a alembic"', /You are handed an alembic\./.test(rig(null).api.giveTool(0xff000001, 'alchemist') || ''));
  yes('P3 the pick hands the tool of a class or a profession, so the five come with the profession pick',
      /var handed = giveTool\(actorId, whose\);/.test(gm));
});

done();
