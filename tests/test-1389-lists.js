// test-1389-lists.js
//
// #1389. The arcane enchanter and the alchemy lab follow their lists.
//
//   * The mixtures list and the enchantments list are in the server, the
//     same names, halves and ranks as docs/systems/mixtures.md and
//     docs/systems/enchantments.md, keyed by the magic effect.
//   * With the effects the engine reports, an effect off the page is
//     refused, the rank is the page's, the sister half and a taught half
//     stop at novice, and Twin Souls is the second enchantment.
//   * A batch is one piece of work, through creditWork, however many
//     effects or bottles it has.
//   * Master Chemist's batch is two, named before the engine gives it
//     (craftOutput, #2906), and nothing waits for the engine.
//   * Twin Souls reaches the menu: the owner property hands over the
//     slots and the script puts the Extra Effect perk on, once.
//   * Until the engine reports the effects (engine/skymp at the pinned
//     commit passes none), a brew and an enchantment go through as before
//     and the log says the lists were not asked.
//
// The bench gates are not touched: an Enchanter at an alchemy lab, and
// anybody else, are still refused there.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function cut(head) { return slice(gm, head, '\n}\n'); }

// ------------------------------------------------------------ the rules ---
const block = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const box = { console: { log: function () {} } };
box.globalThis = box;
if (block) { vm.runInNewContext(block, box); }
const P = box.__thornswoodProgression;
yes('the progression block runs', !!P && !!P.perks && !!P.canWork);

// The lists, the gate, the slots and the property, as one piece.
const listsSrc = (function () {
  const a = gm.indexOf('var MIXTURES = {');
  const b = gm.indexOf('function recipelessCraft(');
  return (a >= 0 && b > a) ? gm.slice(a, b) : null;
})();
const parts = [
  cut('function rankWord(rank) {'),
  cut('function aWord(name) {'),
  cut('function professionName(prof) {'),
  cut('function craftAnswer(actorId, row) {'),
  cut('function holdsPerk(actorId, key) {'),
  cut('function packCount(actorId, itemDesc) {'),
  cut('function wovenOutput(actorId, row) {'),
  cut('function recipelessCraft(actorId, craftedItemBaseId, workbenchId, effects) {')
];
const noProfM = /^const NO_PROFESSION_AT_A_BENCH = '([^']*)';$/m.exec(gm);
yes('the lists, the gate and what they call are in the gamemode',
    !!listsSrc && parts.every(function (p) { return !!p; }) && !!noProfM);

// --------------------------------------------------- the lists vs pages ---
function pageRows(file, sections) {
  const text = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', file), 'utf8').split(CR).join('');
  const out = [];
  Object.keys(sections).forEach(function (heading) {
    const at = text.indexOf('\n## ' + heading + '\n');
    const next = text.indexOf('\n## ', at + 4);
    const body = text.slice(at, next < 0 ? text.length : next);
    body.split('\n').forEach(function (line) {
      const m = /^\| (Novice|Advanced|Expert|Master) \| (.+) \|$/.exec(line);
      if (!m) { return; }
      m[2].split(',').forEach(function (name) {
        out.push({ name: name.trim(), half: sections[heading], rank: m[1].toLowerCase() });
      });
    });
  });
  return out;
}
const T = {};
if (listsSrc) {
  try {
    new Function('T', 'mp', 'log', 'globalThis', 'holdsPerk',
      listsSrc + '\nT.MIXTURES = MIXTURES; T.ENCHANTMENTS = ENCHANTMENTS;')(
      T, { makeProperty: function () {} }, function () {}, {}, function () { return false; });
  } catch (e) { console.log(e); }
}
function sameRows(table, rows) {
  const have = {};
  Object.keys(table || {}).forEach(function (d) {
    const r = table[d];
    have[r.name + '|' + r.half + '|' + r.rank] = true;
  });
  const want = {};
  rows.forEach(function (r) { want[r.name + '|' + r.half + '|' + r.rank] = true; });
  const missing = Object.keys(want).filter(function (k) { return !have[k]; });
  const extra = Object.keys(have).filter(function (k) { return !want[k]; });
  return { missing: missing, extra: extra };
}
const mixPage = pageRows('mixtures.md', { 'Medicine': 'physicker', 'Poison': 'blightbrewer' });
const enchPage = pageRows('enchantments.md', { 'On a weapon': 'bladebinder', 'On armour and clothing': 'wardweaver' });
yes('the pages read: 26 mixtures and 23 enchantments', mixPage.length === 26 && enchPage.length === 23);
const mixDiff = sameRows(T.MIXTURES, mixPage);
yes('every mixture on the page is in the server at its half and rank, and nothing else is' +
    (mixDiff.missing.length + mixDiff.extra.length ? ' (' + mixDiff.missing.concat(mixDiff.extra).join('; ') + ')' : ''),
    !!T.MIXTURES && !mixDiff.missing.length && !mixDiff.extra.length);
const enchDiff = sameRows(T.ENCHANTMENTS, enchPage);
yes('every enchantment on the page is in the server at its half and rank, and nothing else is' +
    (enchDiff.missing.length + enchDiff.extra.length ? ' (' + enchDiff.missing.concat(enchDiff.extra).join('; ') + ')' : ''),
    !!T.ENCHANTMENTS && !enchDiff.missing.length && !enchDiff.extra.length);
yes('every key is a Skyrim.esm magic effect descriptor',
    Object.keys(T.MIXTURES || {}).concat(Object.keys(T.ENCHANTMENTS || {}))
      .every(function (d) { return /^[0-9a-f]+:Skyrim\.esm$/.test(d); }));
yes('the alchemy Resist Fire and the enchanting Resist Fire are two records, one on each list',
    T.MIXTURES && T.ENCHANTMENTS && T.MIXTURES['3eaea:Skyrim.esm'].name === 'Resist Fire' &&
    T.ENCHANTMENTS['48c8b:Skyrim.esm'].name === 'Resist Fire' && !T.MIXTURES['48c8b:Skyrim.esm']);

// ------------------------------------------------------------- the gate ---
function person(prof, half, rank, taught) {
  const r = P.pickProfession(P.fresh(), prof, half);
  if (!r.ok) { return null; }
  if (rank) { r.state.ranks[half] = rank; }
  (taught || []).forEach(function (t) { r.state.taught = (r.state.taught || []).concat([t]); r.state.ranks[t] = 'novice'; });
  return r.state;
}
function nameOf(key) {
  const TB = P.TABLE;
  for (const p in TB.professions) {
    if (P.has(TB.professions[p].halves, key)) { return TB.professions[p].halves[key]; }
    if (p === key) { return TB.professions[p].name; }
  }
  return key;
}

const ID = function (desc) { return parseInt(desc.split(':')[0], 16); };
const INVISIBILITY = 0x3eb12;        // an alchemy effect the page does not name
const FORTIFY_SMITHING = 0x7a102;    // an enchanting effect the page does not name
const UNREADABLE = 0x7f123456;       // an id the server cannot name
const BREWED = 0xff001234;
const IRON_SWORD = 0x12eb7;

function world(state, opts) {
  opts = opts || {};
  const said = [], logs = [], credited = [], props = {}, added = [], timers = [];
  let inventory = { entries: [] };
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: {
      stateOf: function () { return state; },
      nameOf: nameOf,
      masterFor: function () { return null; }
    }
  };
  const mp = {
    makeProperty: function () {},
    get: function (id, prop) {
      if (prop === 'baseDesc') { return 'bench:Test.esp'; }
      if (prop === 'inventory') { return inventory; }
      return Object.prototype.hasOwnProperty.call(props, prop) ? props[prop] : undefined;
    },
    set: function (id, prop, v) { if (prop === 'inventory') { inventory = v; } else { props[prop] = v; } },
    getDescFromId: function (n) {
      if (n === UNREADABLE) { throw new Error('invalid file index'); }
      return n >= 0xff000000 ? (n - 0xff000000).toString(16) : n.toString(16) + ':Skyrim.esm';
    },
    getIdFromDesc: function (d) {
      return d.indexOf(':') === -1 ? 0xff000000 + parseInt(d, 16) : parseInt(d.split(':')[0], 16);
    },
    lookupEspmRecordById: function () { return { record: { editorId: opts.bench || 'AlchemyWorkbench' } }; }
  };
  const fn = new Function('globalThis', 'mp', 'log', 'notify', 'say', 'setTimeout', 'creditWork', 'raceGate',
    'idOf', 'addItem', 'wovenMark', 'RANK_LADDER', 'NO_PROFESSION_AT_A_BENCH', 'BENCH_BY_BASE', 'RECIPES_BY_ID',
    'toolGate', 'wearTool', 'toolFor', 'benchToolKey',
    parts.join('\n') + '\n' + listsSrc +
    '\nreturn { recipelessCraft: recipelessCraft, listAnswer: listAnswer, wovenOutput: wovenOutput,' +
    ' enchantSlots: enchantSlots, handEnchantSlots: handEnchantSlots, enchantSlotsScript: enchantSlotsScript,' +
    ' ENCHANT_SLOTS_PROPERTY: ENCHANT_SLOTS_PROPERTY };');
  const api = fn(g, mp,
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    function () { },
    function (id, m) { said.push(m); },
    function (f) { timers.push(f); },
    function (id, half) { credited.push(half); return opts.raise || null; },
    function () { return ''; },
    function (d) { return mp.getIdFromDesc(d); },
    function (id, d, n) {
      added.push([d, n]);
      const b = mp.getIdFromDesc(d);
      const e = inventory.entries.filter(function (x) { return x.baseId === b; })[0];
      if (e) { e.count += n; } else { inventory.entries.push({ baseId: b, count: n }); }
      return true;
    },
    function () { return 0; },
    ['novice', 'advanced', 'expert', 'master'], noProfM ? noProfM[1] : '', {}, {},
    // The trade's tool is held (#3162); tests/test-3162-bench-tools.js asks the refusal.
    function () { return null; }, function () { return null; }, function () { return { name: 'tool' }; },
    function () { return ''; });
  return { api: api, said: said, logs: logs, credited: credited, props: props, added: added, timers: timers,
           inventory: function () { return inventory; }, setInventory: function (v) { inventory = v; } };
}
function brew(state, effects, opts) {
  const w = world(state, opts);
  const out = w.api.recipelessCraft(0xff000058, (opts && opts.made) || BREWED, 0x1234, effects);
  w.refused = out === false;
  return w;
}
const LAB = { bench: 'AlchemyWorkbench' };
const TABLE = { bench: 'CraftingEnchantingTable' };
function enchant(state, effects, opts) {
  return brew(state, effects, Object.assign({ made: IRON_SWORD }, TABLE, opts || {}));
}

if (P && listsSrc && parts.every(function (p) { return !!p; })) {
  const physNovice = person('alchemist', 'physicker', 'novice');
  const physMaster = person('alchemist', 'physicker', 'master');
  const blightAdv = person('alchemist', 'blightbrewer', 'advanced');
  const bladeNovice = person('enchanter', 'bladebinder', 'novice');
  const bladeMaster = person('enchanter', 'bladebinder', 'master');
  const wardNovice = person('enchanter', 'wardweaver', 'novice');
  const wardMaster = person('enchanter', 'wardweaver', 'master');
  const taughtSmith = person('smith', 'edgewright', 'master', ['physicker']);

  // L1: ON THE LIST, AT THE RANK.
  {
    const r = brew(physNovice, [ID('3eb15:Skyrim.esm')], LAB);
    yes('L1 a novice Physicker brews Restore Health', !r.refused && r.said.length === 0);
    yes('L1 and it is one piece of Physicker work, through creditWork', r.credited.length === 1 && r.credited[0] === 'physicker');
    const r2 = brew(physNovice, [ID('3eb06:Skyrim.esm')], LAB);
    yes('L1 Regenerate Health is master Physicker work, refused to a novice and told the rank',
        r2.refused && r2.credited.length === 0 && /Master Physicker's work and you are a Novice Physicker/.test(r2.said[0] || ''));
    yes('L1 a master Physicker brews it', !brew(physMaster, [ID('3eb06:Skyrim.esm')], LAB).refused);
  }

  // L2: OFF THE LIST.
  {
    const r = brew(physMaster, [ID('3eb15:Skyrim.esm'), INVISIBILITY], LAB);
    yes('L2 a brew carrying Invisibility is refused even to a master, even beside Restore Health',
        r.refused && r.credited.length === 0 && /mixtures list/.test(r.said[0] || ''));
    yes('L2 and the log names the effects it carried',
        r.logs.some(function (l) { return l.indexOf('was refused a brew') !== -1 && l.indexOf(String(INVISIBILITY)) !== -1; }));
    const e = enchant(bladeMaster, [FORTIFY_SMITHING]);
    yes('L2 Fortify Smithing is refused at the arcane enchanter, to a master too',
        e.refused && /enchantments list/.test(e.said[0] || ''));
    yes('L2 an enchanting effect is not a mixture: enchanting Resist Fire at a lab is refused',
        brew(physMaster, [ID('48c8b:Skyrim.esm')], LAB).refused);
    yes('L2 and a mixture is not an enchantment: alchemy Fear at the enchanter is refused',
        enchant(bladeMaster, [ID('73f20:Skyrim.esm')]).refused);
    yes('L2 an effect the server cannot name is refused', brew(physMaster, [UNREADABLE], LAB).refused);
    yes('L2 a bottle with no effect at all is refused', brew(physMaster, [], LAB).refused);
  }

  // L3: THE SISTER HALF AND A TAUGHT HALF STOP AT NOVICE.
  {
    const r = brew(physNovice, [ID('3eb42:Skyrim.esm')], LAB);
    yes('L3 a Physicker brews Damage Health, novice Blightbrewer, their sister half', !r.refused);
    yes('L3 and the piece counts under Blightbrewer, the half that owns it', r.credited[0] === 'blightbrewer');
    const s = brew(physMaster, [ID('73f23:Skyrim.esm')], LAB);
    yes('L3 Ravage Stamina is advanced Blightbrewer, refused to a master Physicker as sister half work',
        s.refused && /sister half/.test(s.said[0] || ''));
    yes('L3 a Blightbrewer at advanced brews it', !brew(blightAdv, [ID('73f23:Skyrim.esm')], LAB).refused);
    yes('L3 a smith a Master taught Physicker brews Restore Health',
        !brew(taughtSmith, [ID('3eb15:Skyrim.esm')], LAB).refused);
    const t = brew(taughtSmith, [ID('3eaf3:Skyrim.esm')], LAB);
    yes('L3 and is refused Fortify Health, advanced, with the taught half sentence',
        t.refused && /never goes further than novice/.test(t.said[0] || ''));
  }

  // L4: A BATCH IS ONE PIECE OF WORK.
  {
    const r = brew(physNovice, [ID('3eb15:Skyrim.esm'), ID('3eb42:Skyrim.esm'), ID('3eb15:Skyrim.esm')], LAB);
    yes('L4 a batch with two effects, one named twice, is one piece of work', !r.refused && r.credited.length === 1);
    yes('L4 and it goes to their own half when one of the effects is theirs', r.credited[0] === 'physicker');
    const raised = brew(physNovice, [ID('3eb15:Skyrim.esm')], Object.assign({ raise: 'You are now an Advanced Physicker.' }, LAB));
    yes('L4 the line about a new rank is said', raised.said.indexOf('You are now an Advanced Physicker.') !== -1);
  }

  // L5: TWIN SOULS IS THE SECOND SLOT.
  {
    yes('L5 a novice Bladebinder puts Fire Damage on a blade', !enchant(bladeNovice, [ID('4605a:Skyrim.esm')]).refused);
    const p = enchant(bladeNovice, [ID('acbb6:Skyrim.esm')]);
    yes('L5 Paralyze is master Bladebinder work', p.refused && /Master Bladebinder/.test(p.said[0] || ''));
    const two = enchant(bladeNovice, [ID('4605a:Skyrim.esm'), ID('4605b:Skyrim.esm')]);
    yes('L5 two enchantments without Twin Souls are refused, and told it is Twin Souls',
        two.refused && /Twin Souls/.test(two.said[0] || '') && two.credited.length === 0);
    const twin = enchant(bladeMaster, [ID('4605a:Skyrim.esm'), ID('4605b:Skyrim.esm')]);
    yes('L5 a master Bladebinder holds Twin Souls and puts two on, as one piece of work',
        !twin.refused && twin.credited.length === 1 && twin.credited[0] === 'bladebinder');
    const three = enchant(bladeMaster, [ID('4605a:Skyrim.esm'), ID('4605b:Skyrim.esm'), ID('4605c:Skyrim.esm')]);
    yes('L5 three are refused even with Twin Souls', three.refused);
    const ward = enchant(wardMaster, [ID('493aa:Skyrim.esm'), ID('7a0f8:Skyrim.esm')]);
    yes('L5 a master Wardweaver puts Fortify Health and Fortify Health Regen on one piece', !ward.refused);
    const mixed = enchant(wardMaster, [ID('493aa:Skyrim.esm'), ID('aa155:Skyrim.esm')]);
    yes('L5 but not Absorb Health beside it: advanced Bladebinder is past the sister half',
        mixed.refused && /sister half/.test(mixed.said[0] || ''));
    yes('L5 a Wardweaver puts Fire Damage on at novice, their sister half',
        !enchant(wardNovice, [ID('4605a:Skyrim.esm')]).refused);
  }

  // L6: THE BENCH GATES STAY. An Enchanter at a lab, a smith anywhere.
  {
    yes('L6 an Enchanter at an alchemy lab is refused before any list',
        brew(bladeMaster, [ID('3eb15:Skyrim.esm')], LAB).refused);
    yes('L6 an Alchemist at the arcane enchanter is refused',
        enchant(physMaster, [ID('4605a:Skyrim.esm')]).refused);
    yes('L6 a smith with no taught alchemy half is refused at the lab',
        brew(person('smith', 'edgewright', 'master'), [ID('3eb15:Skyrim.esm')], LAB).refused);
  }

  // L7: AN ENCHANTED PIECE KEEPS ITS RECORD, so the effects are what route it.
  {
    const e = enchant(bladeNovice, [ID('5b452:Skyrim.esm')]);
    yes('L7 an iron sword with Soul Trap on it, under the runtime line, goes to the enchantment list',
        !e.refused && e.credited[0] === 'bladebinder');
  }

  // L8: THE ENGINE AT THE PINNED COMMIT NAMES NO EFFECTS.
  {
    const r = brew(physNovice, undefined, LAB);
    yes('L8 with no effects reported a brew goes through as before, credited once',
        !r.refused && r.credited.length === 1 && r.credited[0] === 'physicker');
    yes('L8 and the log says the lists were not asked',
        r.logs.some(function (l) { return l.indexOf('lists were not asked') !== -1; }));
    yes('L8 and nothing below the line changes when nothing is reported',
        brew(physNovice, undefined, { made: IRON_SWORD, bench: 'CraftingEnchantingTable' }).credited.length === 0);
  }

  // L9: MASTER CHEMIST, the batch twice, named before the engine gives it
  // (craftOutput, #2906). props.craftOutput stands in for the engine's
  // property inside onCraft: the brew and one bottle.
  {
    const w = world(physMaster, LAB);
    w.props.craftOutput = { baseId: BREWED, count: 1 };
    w.api.recipelessCraft(0xff000058, BREWED, 0x1234, [ID('3eb15:Skyrim.esm')]);
    yes('L9 a master Physicker\'s brew names a batch of two before the engine gives it',
        w.props.craftOutput.count === 2);
    yes('L9 and the bottle stays the engine\'s, the brew\'s own runtime form',
        w.props.craftOutput.baseId === undefined);
    yes('L9 and nothing waits for the engine or is added on top', w.timers.length === 0 && w.added.length === 0);
    yes('L9 and it is still one piece of work', w.credited.length === 1);
    const novice = world(physNovice, LAB);
    novice.props.craftOutput = { baseId: BREWED, count: 1 };
    novice.api.recipelessCraft(0xff000058, BREWED, 0x1234, [ID('3eb15:Skyrim.esm')]);
    yes('L9 a novice gets no second batch', novice.props.craftOutput.count === 1 && novice.timers.length === 0);
    const bm = world(bladeMaster, TABLE);
    bm.props.craftOutput = { baseId: IRON_SWORD, count: 1 };
    bm.api.recipelessCraft(0xff000058, IRON_SWORD, 0x1234, [ID('4605a:Skyrim.esm')]);
    yes('L9 an enchantment is never doubled', bm.props.craftOutput.count === 1 && bm.timers.length === 0);
  }

  // L10: THE SLOTS REACH THE MENU.
  {
    const w = world(bladeMaster, TABLE);
    yes('L10 a master Enchanter has two slots and a novice one',
        w.api.enchantSlots(bladeMaster) === 2 && w.api.enchantSlots(wardMaster) === 2 &&
        w.api.enchantSlots(bladeNovice) === 1 && w.api.enchantSlots(physMaster) === 1);
    w.api.handEnchantSlots(1, bladeMaster);
    yes('L10 the owner property says two', w.props[w.api.ENCHANT_SLOTS_PROPERTY] === 2);
    const calls = [];
    const pc = { addPerk: function (p) { calls.push(['add', p]); }, removePerk: function (p) { calls.push(['remove', p]); } };
    const ctx = { value: 2, state: {}, sp: {
      Game: { getPlayer: function () { return pc; }, getFormEx: function (id) { return { id: id }; } },
      Perk: { from: function (f) { return f; } } } };
    const script = new Function('ctx', w.api.enchantSlotsScript());
    script(ctx); script(ctx); script(ctx);
    yes('L10 the script puts the Extra Effect perk on once, not every frame',
        calls.length === 1 && calls[0][0] === 'add' && calls[0][1].id === 0x58f7f);
    ctx.value = 1;
    script(ctx); script(ctx);
    yes('L10 and takes it off once when the slots go back to one', calls.length === 2 && calls[1][0] === 'remove');
  }
}

// ------------------------------------------------------------- wiring ---
{
  const code = gm.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('onCraft hands the effects to the gate',
      /mp\.onCraft = guard\('onCraft', function \(actorId, craftedItemBaseId, count, recipeId, workbenchId, effects\)/.test(code) &&
      /return recipelessCraft\(actorId, craftedItemBaseId, workbenchId, effects, inputs\);/.test(code));
  const character = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====') || '';
  const writeState = slice(character, 'function writeState(actorId, s, redraw) {', '\n  }\n') || '';
  const grantKnown = slice(character, 'function grantKnown(actorId) {', '\n  }\n') || '';
  yes('the slots are handed over whenever the character is written, and on every spawn',
      /handEnchantSlots\(actorId, s\)/.test(writeState) && /handEnchantSlots\(actorId, s\)/.test(grantKnown));
  const recipeless = cut('function recipelessCraft(actorId, craftedItemBaseId, workbenchId, effects) {') || '';
  yes('the work goes through creditWork, not straight to the character block',
      /creditWork\(actorId, half\)/.test(recipeless) && !/ch\.credit\(/.test(recipeless));
  yes('nothing a person types was added: no enchant, brew or mixture command',
      !/['"]\/(enchant|brew|mixture|twinsouls)\b/.test(code));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
