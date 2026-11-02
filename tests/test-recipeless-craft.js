// test-recipeless-craft.js
//
// Brewing, enchanting and tempering: the three things that reach the craft
// event with no recipe behind them.
//
// THE FIRST VERSION OF THIS GATE DECIDED ON THE OUTPUT'S RECORD TYPE AND ALL
// THREE OF ITS FAULTS CAME FROM THAT. The audit of 21 September found them:
//
//   * a brewed potion HAS NO RECORD. Mixing a potion and enchanting an item
//     both MAKE A NEW FORM, so the id is above 0xff000000 and kindOf, which
//     reads plugin records, answers nothing. The gate refused every brew: the
//     change written to let the Alchemist work was the thing stopping it.
//   * TEMPERING ARRIVES HERE NOW. CraftService throws out the armour table and
//     the sharpening wheel before it considers a recipe, which leaves the
//     recipe list EMPTY, and an empty list is what the fork patch reports
//     rather than drops. A tempered sword is a WEAP, so it read as an
//     enchantment and was refused to every smith in the world.
//   * NOTHING CREDITED THE WORK, so an Alchemist could brew for ever and stay
//     a novice: creditWork is the only road to rankUp.
//
// So the runtime line is the discriminator. Above it something was made from
// nothing and the BENCH says which trade. Below it the item already existed,
// which is tempering, and this gate has no business in it.
//
// BELOW THE LINE WAS A DOOR ROUND THE WHOLE CRAFT GATE (To Do 347g). A craft
// whose list of inputs matched no recipe exactly came below the line and was
// allowed with no race, profession or rank asked. On 23 September a Riekling
// helmet arrived that way listing thirteen entries. So at any bench but the two
// tempering benches, an item a recipe row makes now goes to the real
// craftAnswer, and S9 to S16 below drive it beside the real function, with the
// helmet's own row out of the generated table. An item no row makes, and a
// bench nobody has classified, are still let through.
//
// A TEMPER IS REFUSED NOW (#1384). Tempering is cut and a piece is mended
// with a kit (docs/systems/durability.md), so a craft at the sharpening wheel
// or the armour table is refused to everybody, points at the kit in the
// inventory and never at a command (no chat commands for what people do,
// Patrick, 4 October), and is not credited. S9 and S16 drive it.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const START = 'function recipelessCraft(actorId, craftedItemBaseId, workbenchId, effects) {';
const END = '\n}\n';
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;

yes('the recipeless gate is in the gamemode', block !== null);

// The one sentence somebody with no profession hears at any bench (#1037).
const noProfM = /^const NO_PROFESSION_AT_A_BENCH = '([^']*)';$/m.exec(src);
const NO_PROF = noProfM ? noProfM[1] : null;
yes('the no-profession sentence is in the gamemode and says to press K', !!NO_PROF && /Press K/.test(NO_PROF));

/*
  THE REAL CRAFT GATE GOES BESIDE IT, NOT A STUB OF IT. The point of 347g is
  that this path asks craftAnswer exactly what the recipe gate asks of a matched
  recipe, so a stub answering what this file expects would prove nothing.
  craftAnswer and everything it calls on the way to a sentence are cut out of
  the gamemode as they are. Only raceOf and the progression rules are stubbed:
  raceOf reads a RACE table and an appearance the harness has neither of, and
  the rules live in another block.
*/
function take(start, end) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end || '\n}\n', i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + (end || '\n}\n').length) : null;
}
const GATE_PARTS = [
  take('function craftAnswer(actorId, row) {'),
  take('function raceGate(actorId, row) {'),
  take('var RACE_CALLED = {', '\n};\n'),
  take('function professionName(prof) {'),
  take('function aWord(name) {'),
  take('function rankWord(rank) {')
];
yes('craftAnswer and what it calls are in the gamemode',
    GATE_PARTS.every(function (p) { return p !== null; }));
const GATE = GATE_PARTS.join('\n');

// The generated tables, read as they are rather than copied, so the tempering
// benches and the helmet below are the ones the server has.
const ladderLine = /const RANK_LADDER = (\[[^\]]*\]);/.exec(src);
const RANK_LADDER = ladderLine ? JSON.parse(ladderLine[1].replace(/'/g, '"')) : [];
const benchLine = /const BENCH_BY_BASE = (\{.*\});/.exec(src);
const REAL_BENCHES = benchLine ? JSON.parse(benchLine[1]) : {};
const tableAt = src.indexOf('  var RECIPES_BY_ID = {');
const tableEnd = tableAt < 0 ? -1 : src.indexOf('\n  };\n', tableAt);
let REAL_TABLE = {};
try {
  REAL_TABLE = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID');
} catch (e) { REAL_TABLE = {}; }
yes('the rank ladder, the bench table and the recipe table all read',
    RANK_LADDER.length === 4 && Object.keys(REAL_BENCHES).length > 10 &&
    Object.keys(REAL_TABLE).length > 1000);

function basesFor(keyword) {
  return Object.keys(REAL_BENCHES).filter(function (b) { return REAL_BENCHES[b] === keyword; });
}
const FORGES = basesFor('88105:Skyrim.esm');
const WHEELS = basesFor('88108:Skyrim.esm');
const ARMOUR_TABLES = basesFor('adb78:Skyrim.esm');
yes('the bench table knows a forge, a sharpening wheel and an armour table',
    FORGES.length > 0 && WHEELS.length > 0 && ARMOUR_TABLES.length > 0);
const FORGE = FORGES[0];

// A potion or an enchanted item: made at runtime, so above the line.
const BREWED = 0xff001234;
// A tempered sword: the same record it always was, so below it.
const TEMPERED = 0x12eb7;
const ACTOR = 0xff000058;

// The halves of each profession, for the progression stub.
const HALVES = {
  alchemist: ['blightbrewer', 'physicker'],
  enchanter: ['bladebinder', 'wardweaver'],
  smith: ['platewright', 'edgewright'],
  cook: ['hearthcook', 'confectioner']
};

/**
 * The rules craftAnswer leans on, cut down to what classes.md says: your own
 * half up to your rank, your sister half and a taught half at novice only.
 */
function progression() {
  function sisterOf(prof, half) {
    const h = HALVES[prof] || [];
    if (h.indexOf(half) === -1) { return null; }
    return h[0] === half ? h[1] : h[0];
  }
  return {
    TABLE: { professions: {
      smith: { name: 'Smith' }, cook: { name: 'Cook' },
      alchemist: { name: 'Alchemist' }, enchanter: { name: 'Enchanter' } } },
    has: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); },
    halvesOf: function (prof) { return HALVES[prof] || []; },
    sisterOf: sisterOf,
    rankOf: function (s, half) {
      if (s.half === half) { return (s.ranks || {})[half] || 'novice'; }
      if ((s.taught || []).indexOf(half) !== -1) { return 'novice'; }
      return null;
    },
    canWork: function (s, half, rank) {
      const want = RANK_LADDER.indexOf(rank);
      if (s.half === half) {
        return RANK_LADDER.indexOf((s.ranks || {})[half] || 'novice') >= want;
      }
      if (s.half && sisterOf(s.prof, s.half) === half) { return want <= 0; }
      if ((s.taught || []).indexOf(half) !== -1) { return want <= 0; }
      return false;
    }
  };
}

/** One gamemode's worth of the gate, with everything it says written down. */
function context(opts) {
  const said = [];
  const spoken = [];
  const logs = [];
  const credited = [];
  const told = opts.told || {};
  const fn = new Function(
    'globalThis', 'log', 'notify', 'say', 'mp', 'idOf', 'Number',
    'RECIPES_BY_ID', 'BENCH_BY_BASE', 'RANK_LADDER', 'NO_PROFESSION_AT_A_BENCH', 'raceOf',
    'creditWork', 'holdsPerk', 'toolGate', 'wearTool', 'toolFor', 'benchToolKey',
    GATE + '\n' + block +
    '\nreturn { recipelessCraft: recipelessCraft, craftAnswer: craftAnswer };');

  const character = opts.noCharacter ? null : {
    stateOf: function () {
      if (opts.stateThrows) { throw new Error('no character'); }
      return opts.state;
    },
    nameOf: function (k) { return k.charAt(0).toUpperCase() + k.slice(1); },
    credit: function (id, half) { credited.push(half); }
  };

  const g = {
    __thornswoodCharacter: character,
    __thornswoodProgression: progression()
  };

  const api = fn(
    g,
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    function (id, m) { said.push(m); },
    function (id, m) { said.push(m); spoken.push(m); },
    { get: function (id, prop) {
        if (prop === 'baseDesc') {
          if (opts.baseThrows) { throw new Error('no base'); }
          if (opts.benchBase !== undefined) { return opts.benchBase; }
        }
        return 'bench';
      },
      getDescFromId: function (n) {
        if (opts.descThrows) { throw new Error('no desc'); }
        return opts.outDesc !== undefined ? opts.outDesc : 'nothing:Made.esp';
      },
      lookupEspmRecordById: function () {
        if (opts.benchThrows) { throw new Error('no bench record'); }
        return opts.bench === null ? null
          : { record: { editorId: opts.bench || 'AlchemyWorkbench' } };
      } },
    function () { return 1; },
    Number,
    opts.table || {},
    opts.benches || REAL_BENCHES,
    RANK_LADDER,
    NO_PROF,
    function () { return opts.race || ''; },
    // The work goes through creditWork now (#1389), the one road every other
    // piece of work takes; what it was asked to count is what is checked.
    function (id, half) { credited.push(half); return null; },
    // No perks here: Master Chemist's batch is test-1389-lists.js L9.
    function () { return false; },
    // The trade's tool is held (#3162); tests/test-3162-bench-tools.js asks the refusal.
    function () { return null; }, function () { return null; }, function () { return { name: 'tool' }; },
    function () { return ''; });
  return { api: api, said: said, spoken: spoken, logs: logs, credited: credited, told: told };
}

/** Drive the real function. */
function run(opts) {
  const c = context(opts);
  const out = c.api.recipelessCraft(ACTOR, opts.made, 0x1234);
  return { refused: out === false, said: c.said, spoken: c.spoken, logs: c.logs,
           credited: c.credited, told: c.told };
}

/** What the recipe gate itself answers this person for this row, in a fresh context. */
function expected(opts, row) {
  return context({ state: opts.state, race: opts.race, noCharacter: opts.noCharacter,
                   told: {} }).api.craftAnswer(ACTOR, row);
}

if (block !== null) {
  const alchemist = { prof: 'alchemist', half: 'physicker', taught: [] };
  const enchanter = { prof: 'enchanter', half: 'bladebinder', taught: [] };
  const smith = { prof: 'smith', half: 'edgewright', taught: [] };

  // S1: THE FAULT THAT BROKE BREWING. A potion is a runtime form with no
  //     record at all, so nothing can be learned from its type.
  {
    const r = run({ made: BREWED, bench: 'AlchemyWorkbench', state: alchemist });
    yes('S1 an Alchemist may brew, and the output having no record does not stop it',
        !r.refused);
    yes('S1 and nothing is said to them', r.said.length === 0);
  }

  // S2: AND THE WORK COUNTS, or the half can never leave novice.
  {
    const r = run({ made: BREWED, bench: 'AlchemyWorkbench', state: alchemist });
    yes('S2 brewing credits the half they hold', r.credited.length === 1 &&
        r.credited[0] === 'physicker');
    const e = run({ made: BREWED, bench: 'CraftingEnchantingTable', state: enchanter });
    yes('S2 and enchanting credits theirs', e.credited[0] === 'bladebinder');
  }

  // S3: THE BENCH DECIDES, NOT THE ITEM. Same runtime output, two benches.
  {
    yes('S3 an Alchemist at an enchanting table is refused',
        run({ made: BREWED, bench: 'CraftingEnchantingTable', state: alchemist }).refused);
    yes('S3 an Enchanter at an alchemy lab is refused',
        run({ made: BREWED, bench: 'AlchemyWorkbench', state: enchanter }).refused);
    const r = run({ made: BREWED, bench: 'AlchemyWorkbench', state: smith });
    yes('S3 a Smith at an alchemy lab is refused and told whose work it is',
        r.refused && r.said[0].indexOf('Alchemist') !== -1);
  }

  // S4: TEMPERING. The item already existed, so the id is below the runtime
  //     line and this gate has no business in it. A smith must not be refused
  //     at a grindstone, which is what deciding on the output type did.
  {
    const r = run({ made: TEMPERED, bench: 'CraftingSmithingSharpeningWheel',
                    state: smith });
    yes('S4 tempering is allowed, whoever is doing it', !r.refused);
    yes('S4 and nothing is said', r.said.length === 0);
    yes('S4 and it is not credited as a brew', r.credited.length === 0);
    yes('S4 an Alchemist tempering is also allowed, because it is not this gate\'s business',
        !run({ made: TEMPERED, bench: 'CraftingSmithingArmorTable',
               state: alchemist }).refused);
  }

  // S5: a half taught by a Master of another profession counts, at novice.
  {
    const taughtBrewer = { prof: 'smith', half: 'edgewright', taught: ['physicker'] };
    const r = run({ made: BREWED, bench: 'AlchemyWorkbench', state: taughtBrewer });
    yes('S5 a taught half may do the work', !r.refused);
    yes('S5 and the taught half is what gets credited',
        r.credited[0] === 'physicker');
    yes('S5 a taught half of another profession does not',
        run({ made: BREWED, bench: 'AlchemyWorkbench',
              state: { prof: 'smith', half: 'edgewright', taught: ['hearthcook'] } }).refused);
  }

  // S6: NO PROFESSION, NO BREWING AND NO ENCHANTING (#1037). Patrick, 29
  //     September: "There should be no grace at all".
  {
    const r = run({ made: BREWED, bench: 'AlchemyWorkbench', state: { prof: null, taught: [] } });
    yes('S6 a character with no profession is refused at the alchemy lab', r.refused);
    yes('S6 and told, once, to press K and choose one',
        r.spoken.length === 1 && r.spoken[0] === NO_PROF);
    yes('S6 and nothing is credited', r.credited.length === 0);
    const e = run({ made: BREWED, bench: 'CraftingEnchantingTable', state: { prof: null, taught: [] } });
    yes('S6 the same at the arcane enchanter', e.refused && e.spoken[0] === NO_PROF);
  }

  // S7: A BENCH NOBODY HAS CLASSIFIED IS NOT A REFUSAL. That is a hole in our
  //     table, and it must not cost somebody their materials.
  {
    yes('S7 an unknown bench lets an Alchemist work',
        !run({ made: BREWED, bench: 'SomeModdedThing', state: alchemist }).refused);
    yes('S7 and an Enchanter too',
        !run({ made: BREWED, bench: 'SomeModdedThing', state: enchanter }).refused);
    yes('S7 but still refuses somebody who holds neither trade',
        run({ made: BREWED, bench: 'SomeModdedThing', state: smith }).refused);
    yes('S7 and a bench lookup that throws is treated the same way',
        !run({ made: BREWED, benchThrows: true, state: alchemist }).refused);
  }

  // S8: it fails OPEN on the server's own faults. A character the server
  //     cannot read must not cost somebody their ingredients.
  {
    yes('S8 a character block that is not loaded lets the craft through',
        !run({ made: BREWED, bench: 'AlchemyWorkbench', state: alchemist,
               noCharacter: true }).refused);
    yes('S8 a character read that throws lets it through',
        !run({ made: BREWED, bench: 'AlchemyWorkbench', state: alchemist,
               stateThrows: true }).refused);
  }

  // ------------------------------------------------ below the line, 347g
  const nordSmith = { prof: 'smith', half: 'platewright', ranks: { platewright: 'master' }, taught: [] };
  const novicePlate = { prof: 'smith', half: 'platewright', ranks: { platewright: 'novice' }, taught: [] };
  const advancedPlate = { prof: 'smith', half: 'platewright', ranks: { platewright: 'advanced' }, taught: [] };
  const edgewright = { prof: 'smith', half: 'edgewright', ranks: { edgewright: 'master' }, taught: [] };
  const cook = { prof: 'cook', half: 'confectioner', ranks: { confectioner: 'novice' }, taught: [] };
  const taughtCook = { prof: 'cook', half: 'hearthcook', ranks: { hearthcook: 'master' },
                       taught: ['platewright'] };
  const nobodyYet = { prof: null, taught: [] };

  // Rows shaped as the generated table writes them. Steel Armor and Iron
  // Fittings are copied from it; the pie, the dumpling and the cloak are made
  // up to put several rows behind one output in an order that proves something.
  const STEEL = { out: 'f6f22:Skyrim.esm', name: 'Steel Armor', type: 'ARMO', makes: 1,
                  owner: 'Smith', half: 'Platewright', race: '', rank: 'advanced',
                  family: 'Body armour', open: false };
  const FITTINGS = { out: '3035:HearthFires.esm', name: 'Iron Fittings', type: 'MISC', makes: 1,
                     owner: '', half: '', race: '', rank: '', family: '',
                     nobody: 'house fittings, for a house nobody builds here.' };
  const PIE_MASTER = { out: 'pie:Test.esp', name: 'Apple Pie', owner: 'Cook',
                       half: 'Confectioner', race: '', rank: 'master' };
  const PIE_ADVANCED = { out: 'pie:Test.esp', name: 'Apple Pie', owner: 'Cook',
                         half: 'Confectioner', race: '', rank: 'advanced' };
  const CLOAK_RIEKLING = { out: 'cloak:Test.esp', name: 'Fur Cloak', owner: 'Smith',
                           half: 'Platewright', race: 'riekling', rank: 'novice' };
  const CLOAK_ANYBODY = { out: 'cloak:Test.esp', name: 'Fur Cloak', owner: 'Smith',
                          half: 'Platewright', race: '', rank: 'novice' };
  const TABLE = {
    'f6f2c:Skyrim.esm': STEEL,
    '3036:HearthFires.esm': FITTINGS,
    // The dearer pie first, so the order of the table cannot be what picks the sentence.
    'p2:Test.esp': PIE_MASTER,
    'p1:Test.esp': PIE_ADVANCED,
    // The advanced dumpling first: any row that allows is enough.
    'd3:Test.esp': { out: 'dumpling:Test.esp', name: 'Apple Dumpling', owner: 'Cook',
                     half: 'Confectioner', race: '', rank: 'advanced' },
    'd1:Test.esp': { out: 'dumpling:Test.esp', name: 'Apple Dumpling', owner: 'Cook',
                     half: 'Confectioner', race: '', rank: 'novice' },
    'd2:Test.esp': { out: 'dumpling:Test.esp', name: 'Apple Dumpling', owner: 'Cook',
                     half: 'Confectioner', race: '', rank: 'novice' },
    // A race's row first and an open one after it, for the note.
    'c1:Test.esp': CLOAK_RIEKLING,
    'c2:Test.esp': CLOAK_ANYBODY
  };
  const PLUGIN_ITEM = 0x0100abcd;
  function atForge(state, outDesc, extra) {
    return Object.assign({ made: PLUGIN_ITEM, benchBase: FORGE, outDesc: outDesc,
                           table: TABLE, state: state, race: 'nordrace' }, extra || {});
  }

  // S9: THE CRAFT THAT FOUND IT. The Riekling helmet of 23 September, by its
  //     own form id out of the log and its own row out of the generated table.
  //     The open book was cut on 2 October (#1511) and that helmet went with
  //     it: its row is still riekling, and nobody makes it, so the gate answers
  //     the cut row's own sentence to everybody, a riekling smith included.
  //     What the helmet first proved (a riekling row refuses a Nord smith in
  //     the riekling words and lets a riekling smith through) is driven on the
  //     Riekling Horned Helmet, a riekling helmet the cut kept, as S9b.
  {
    const HELM = 0x38019f67;
    const helmDesc = '19f67:Playable Rieklings.esp';
    const rows = Object.keys(REAL_TABLE).filter(function (k) { return REAL_TABLE[k].out === helmDesc; });
    yes('S9 the helmet has a row in the generated table, and it is riekling work',
        rows.length > 0 && rows.every(function (k) { return REAL_TABLE[k].race === 'riekling'; }));
    yes('S9 and since the cut nobody makes it, with the reason on the row',
        rows.length > 0 && rows.every(function (k) { return typeof REAL_TABLE[k].nobody === 'string' && REAL_TABLE[k].nobody.length > 0; }));
    const nord = { made: HELM, benchBase: FORGE, outDesc: helmDesc, table: REAL_TABLE,
                   state: nordSmith, race: 'nordrace' };
    const r = run(nord);
    yes('S9 a Nord smith whose list matched no recipe is refused the helmet at a forge', r.refused);
    yes('S9 and is told in the words the recipe gate uses for that row',
        rows.length > 0 && r.spoken.length === 1 &&
        r.spoken[0] === expected(nord, REAL_TABLE[rows[0]]).refusal &&
        r.spoken[0].indexOf('Nobody makes that here.') === 0);
    yes('S9 and the log says who was refused what',
        r.logs.some(function (l) { return l.indexOf('was refused') !== -1 && l.indexOf(helmDesc) !== -1; }));
    const rk = run(Object.assign({}, nord, { race: 'dlc2rieklingrace' }));
    yes('S9 a riekling smith is refused it too, with the same sentence',
        rk.refused && rk.spoken.length === 1 && rk.spoken[0] === r.spoken[0]);
    yes('S9 and tempering that helmet at the armour table is refused, riekling or not (#1384)',
        ARMOUR_TABLES.every(function (b) {
          const t = run(Object.assign({}, nord, { benchBase: b }));
          const r2 = run(Object.assign({}, nord, { benchBase: b, race: 'dlc2rieklingrace' }));
          return t.refused && r2.refused && t.spoken.length === 1 &&
                 t.spoken[0].indexOf('/repair') === -1 && /inventory/.test(t.spoken[0]) &&
                 t.credited.length === 0;
        }));
  }

  // S9b: A RIEKLING HELMET THE CUT KEPT, the Riekling Horned Helmet, novice
  //      Platewright work for a riekling.
  {
    const HORNED = 0x38019f62;
    const hornedDesc = '19f62:Playable Rieklings.esp';
    const rows = Object.keys(REAL_TABLE).filter(function (k) { return REAL_TABLE[k].out === hornedDesc; });
    yes('S9b the Riekling Horned Helmet has a row, riekling Platewright work nobody has cut',
        rows.length > 0 && rows.every(function (k) {
          const row = REAL_TABLE[k];
          return row.race === 'riekling' && row.half === 'Platewright' && !row.nobody;
        }));
    const nord = { made: HORNED, benchBase: FORGE, outDesc: hornedDesc, table: REAL_TABLE,
                   state: nordSmith, race: 'nordrace' };
    const r = run(nord);
    yes('S9b a Nord smith is refused it at a forge', r.refused);
    yes('S9b and is told in the words the recipe gate uses for that row',
        rows.length > 0 && r.spoken.length === 1 &&
        r.spoken[0] === expected(nord, REAL_TABLE[rows[0]]).refusal &&
        r.spoken[0].indexOf('Riekling') !== -1);
    yes('S9b a riekling smith is let through',
        !run(Object.assign({}, nord, { race: 'dlc2rieklingrace' })).refused);
  }

  // S10: NOBODY MAKES IT, asked first, as it is for a matched recipe.
  {
    const o = atForge(nordSmith, FITTINGS.out);
    const r = run(o);
    yes('S10 a thing nobody makes here is refused even to a master smith', r.refused);
    yes('S10 with the row\'s own sentence',
        r.spoken[0] === expected(o, FITTINGS).refusal &&
        r.spoken[0].indexOf('Nobody makes that here.') === 0);
  }

  // S11: ANOTHER PROFESSION ENTIRELY.
  {
    const o = atForge(cook, STEEL.out);
    const r = run(o);
    yes('S11 a Cook is refused Steel Armor', r.refused);
    yes('S11 and told whose work it is, as the recipe gate would',
        r.spoken[0] === expected(o, STEEL).refusal &&
        r.spoken[0] === 'Only a Platewright can make a Steel Armor. That is Smith work and you are a Cook. Ask one.');
  }

  // S12: THE HALF. A sister half and a taught half both stop at novice.
  {
    const o = atForge(edgewright, STEEL.out);
    const r = run(o);
    yes('S12 an Edgewright, whose sister half this is, is refused advanced Platewright work',
        r.refused && r.spoken[0] === expected(o, STEEL).refusal &&
        r.spoken[0].indexOf('sister half') !== -1);
    const t = atForge(taughtCook, STEEL.out);
    const rt = run(t);
    yes('S12 and so is somebody a Master taught Platewright',
        rt.refused && rt.spoken[0] === expected(t, STEEL).refusal &&
        rt.spoken[0].indexOf('never goes further than novice') !== -1);
  }

  // S13: THE RANK.
  {
    const o = atForge(novicePlate, STEEL.out);
    const r = run(o);
    yes('S13 a novice Platewright is refused advanced work, and told the rank it wants',
        r.refused && r.spoken[0] === expected(o, STEEL).refusal &&
        r.spoken[0].indexOf('an Advanced') !== -1);
    const ok = run(atForge(advancedPlate, STEEL.out));
    yes('S13 an advanced Platewright makes it', !ok.refused && ok.said.length === 0);
    yes('S13 and it is not credited, which this path never was', ok.credited.length === 0);
    yes('S13 and the log names the row that let it through',
        ok.logs.some(function (l) { return l.indexOf('f6f2c:Skyrim.esm') !== -1; }));
  }

  // S14: SEVERAL ROWS FOR ONE THING. Any row that allows is enough, and a
  //      refusal names the least rank that would have done.
  {
    yes('S14 a novice Confectioner makes a dumpling whose first row is advanced',
        !run(atForge(cook, 'dumpling:Test.esp')).refused);
    const o = atForge(cook, 'pie:Test.esp');
    const r = run(o);
    yes('S14 a novice Confectioner is refused a pie that is master and advanced work', r.refused);
    yes('S14 and told advanced, the lower of the two, though master comes first in the table',
        r.spoken[0] === expected(o, PIE_ADVANCED).refusal &&
        r.spoken[0].indexOf('Advanced') !== -1 && r.spoken[0].indexOf('Master') === -1);
  }

  // S15: NO PROFESSION, NOTHING MADE, below the line too (#1037). Every row
  //      that makes the thing refuses them, and they hear one line.
  {
    const o = atForge(nobodyYet, 'cloak:Test.esp');
    const r = run(o);
    yes('S15 somebody with no profession is refused the cloak with no recipe matched', r.refused);
    yes('S15 and hears one line, the one the recipe gate gives the row it names',
        r.spoken.length === 1 && expected(o, CLOAK_ANYBODY).refusal === NO_PROF);
    const d = run(atForge(nobodyYet, 'dumpling:Test.esp'));
    yes('S15 three rows, every one refused, still one line, and it says to press K',
        d.refused && d.spoken.length === 1 && d.spoken[0] === NO_PROF);
    const c = run(atForge(cook, 'dumpling:Test.esp'));
    yes('S15 and somebody with the profession still makes it', !c.refused);
  }

  // S16: EVERYTHING ELSE IS AS IT WAS. An item no row makes, and a bench that
  //      cannot be read, are let through with nothing said, and the note is
  //      not touched, which shows craftAnswer was never asked. A temper is
  //      refused to everybody, says the kit, and is not credited (#1384).
  {
    function asToday(what, extra) {
      const told = {};
      const r = run(atForge(nobodyYet, STEEL.out, Object.assign({ told: told }, extra)));
      const r2 = run(atForge(cook, STEEL.out, extra));
      yes('S16 ' + what,
          !r.refused && r.said.length === 0 && Object.keys(told).length === 0 &&
          !r2.refused && r2.said.length === 0 &&
          r2.logs.some(function (l) { return l.indexOf('no recipe matched the inputs') !== -1; }));
    }
    function aTemper(what, extra) {
      const told = {};
      const r = run(atForge(nobodyYet, STEEL.out, Object.assign({ told: told }, extra)));
      const r2 = run(atForge(cook, STEEL.out, extra));
      const smithing = run(atForge({ prof: 'smith', half: 'edgewright', ranks: { edgewright: 'master' }, taught: [] },
                                   STEEL.out, extra));
      yes('S16 ' + what + ' is refused to everybody, a master smith included, and says the kit',
          r.refused && r2.refused && smithing.refused &&
          smithing.spoken.length === 1 && /repair kit/.test(smithing.spoken[0]) &&
          smithing.spoken[0].indexOf('/repair') === -1 && /inventory/.test(smithing.spoken[0]) &&
          Object.keys(told).length === 0 &&
          smithing.logs.some(function (l) { return l.indexOf('was refused a temper') !== -1; }));
      yes('S16 ' + what + ' is not counted as work', r.credited.length === 0 &&
          r2.credited.length === 0 && smithing.credited.length === 0);
    }
    WHEELS.forEach(function (b) { aTemper('tempering at the sharpening wheel ' + b, { benchBase: b }); });
    ARMOUR_TABLES.forEach(function (b) { aTemper('tempering at the armour table ' + b, { benchBase: b }); });
    asToday('an item no row makes, at a forge', { outDesc: 'nothing:Made.esp' });
    asToday('a bench the table does not know', { benchBase: 'abc:Nowhere.esp' });
    asToday('a bench whose base cannot be read', { baseThrows: true });
    asToday('a bench whose base reads as nothing', { benchBase: '' });
    asToday('an item whose descriptor cannot be read', { descThrows: true });
  }
}

// ---------------------------------------------------------------- structure
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('onCraft takes the workbench the fork sends',
      /function \(actorId, craftedItemBaseId, count, recipeId, workbenchId, effects\)/.test(code));
  // One set in each game (#613) is named first and goes on as its recipe.
  yes('and a craft with no recipe goes to the gate',
      /if \(!recipeId && !desc\) \{/.test(code) &&
      /return recipelessCraft\(actorId, craftedItemBaseId, workbenchId, effects, inputs\);/.test(code));
  yes('the runtime line is what splits made-from-nothing from tempering',
      /0xff000000/.test(code) && /madeFromNothing/.test(code));
  yes('and the output record type is no longer consulted',
      !/RECIPELESS\[kind\]/.test(code));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
