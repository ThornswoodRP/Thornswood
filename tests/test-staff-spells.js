// test-staff-spells.js
//
// Issue #967. Patrick, 28 September: "Enchanters learn staff spells from spell
// tomes". Before this nobody could make a staff: 160 of the Bladebinder's 161
// recipes ask for the staff's own spell and an Enchanter starts with none.
//
// This runs the real blocks out of game/gamemode.js in a sandbox with a fake mp
// that keeps properties the way the server does (JSON in, JSON out):
//   the rules (thornswood progression), the character store (thornswood
//   character), THE STAFF SPELLS block with its mp.onReadBook, and the real
//   craftAnswer the craft gate asks.
// and proves:
//   A. the generated table: every staff row names a spell STAFF_SPELLS knows,
//      and the build opened the Bladebinder (issue's Done when)
//   B. since #1026 (Patrick, 29 September: "No they still need the spell
//      points, the level, and a spell from the level below") an Enchanter
//      learns a staff spell from its tome only under the Mage rules: one with
//      no magic is refused and keeps the tome, the line saying which rules are
//      missing; one a Master mage taught the school learns a Novice spell,
//      has it recorded for staves, and is told so in chat
//   C. since #1128 (Patrick, 29 September: Enchanters get "their own spell
//      point and spell unlocking system like the Mages have ... they do not
//      need the tomes") a tome records nothing for an Enchanter's staves: the
//      tome's line points at K, a staff whose spell is not unlocked is refused
//      with the sentence saying to unlock it on K, and it is allowed once it
//      is (tests/test-enchanter-staff-spells.js has the unlock rules)
//   D. anybody who may not make staves learns the spell under the same rules
//      and nothing is recorded for staves
//   E. what was unlocked survives a restart, in the character store
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function between(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}
function take(start, end) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end || '\n}\n', i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + (end || '\n}\n').length) : null;
}

const RULES = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between('// ==== thornswood character ====', '// ==== end thornswood character ====');
const STAFF = between('// ==== thornswood staff spells ====', '// ==== end thornswood staff spells ====');
const TOMES = between('// ==== thornswood spell tomes ====', '// ==== end thornswood spell tomes ====');
const GATE_PARTS = [
  take('function craftAnswer(actorId, row) {'),
  take('function raceGate(actorId, row) {'),
  take('var RACE_CALLED = {', '\n};\n'),
  take('function professionName(prof) {'),
  take('function aWord(name) {'),
  take('function rankWord(rank) {')
];
yes('the rules, the character store, the spell tomes and the staff spells blocks are in the gamemode',
    RULES !== null && CHARACTER !== null && STAFF !== null && TOMES !== null);
yes('craftAnswer and what it calls are in the gamemode',
    GATE_PARTS.every(function (p) { return p !== null; }));
if (RULES === null || CHARACTER === null || STAFF === null || TOMES === null ||
    !GATE_PARTS.every(function (p) { return p !== null; })) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// The generated recipe table, read as it is.
let TABLE = {};
try { TABLE = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID'); } catch (e) { TABLE = {}; }

// ------------------------------------------------------------- the server --

// Tome desc -> the spell it teaches, read out of STAFF_SPELLS as it stands.
const SPELL_OF_TOME = {};
{
  let table = {};
  try { table = require('./gamemode-tables.js').inGamemode(src, 'STAFF_SPELLS'); } catch (e) { table = {}; }
  Object.keys(table).forEach(function (sp) {
    (table[sp].tomes || []).forEach(function (tm) { SPELL_OF_TOME[tm] = sp; });
  });
}

// A tome desc -> a number and back, the way mp.getDescFromId answers.
const IDS = {};
const DESCS = {};
let nextId = 0x100;
function idFor(desc) {
  if (!Object.prototype.hasOwnProperty.call(IDS, desc)) { IDS[desc] = ++nextId; DESCS[nextId] = desc; }
  return IDS[desc];
}

/*
  One server process. store is the properties on every actor, kept as JSON the
  way the engine keeps them in the change form, so handing the same store to a
  second server() is a restart: nothing in memory survives, only the store.
*/
function server(store) {
  const said = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (key === 'profileId') { return 1000 + (id & 0xff); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) {
      (store[id] = store[id] || {})[key] = JSON.stringify(value);
    },
    getDescFromId: function (n) { return DESCS[n] || ('unknown' + n + ':Nowhere.esp'); },
    // Every tome in STAFF_SPELLS as the engine's BOOK record: DATA flag 0x04
    // and the spell it teaches at offset 4, global already.
    lookupEspmRecordById: function (n) {
      const spellDesc = SPELL_OF_TOME[DESCS[n]];
      if (!spellDesc) { return {}; }
      const sp = idFor(spellDesc);
      return { record: { type: 'BOOK', editorId: 'SpellTome', fields: [
        { type: 'DATA', data: [4, 0, 0, 0, sp & 255, (sp >>> 8) & 255, (sp >>> 16) & 255, (sp >>> 24) & 255] }] },
        toGlobalRecordId: function (x) { return x; } };
    }
  };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    notify: function (id, m) { said.push({ id: id, text: m, how: 'notify' }); },
    say: function (id, m) { said.push({ id: id, text: m, how: 'chat' }); },
    log: function () { }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  vm.runInContext(GATE_PARTS[4], ctx, { filename: 'gamemode.js aWord' });
  vm.runInContext(TOMES, ctx, { filename: 'gamemode.js spell tomes' });
  vm.runInContext(STAFF, ctx, { filename: 'gamemode.js staff spells' });
  const gate = new Function('globalThis', 'log', 'toldCraftingIsComing', 'raceOf',
                            GATE_PARTS.join('\n') + '\nreturn craftAnswer;')(
    ctx, function () { }, {}, function () { return ''; });
  return {
    ctx: ctx, mp: mp, said: said,
    C: ctx.__thornswoodCharacter, P: ctx.__thornswoodProgression, S: ctx.__thornswoodStaffSpells,
    read: function (actor, tomeDesc) { return ctx.mp.onReadBook(actor, idFor(tomeDesc)); },
    craft: function (actor, row) { return gate(actor, row); }
  };
}

/** A character with this class and profession, written into the store. */
function make(srv, actor, cls, prof, half, rank) {
  let s = srv.C.stateOf(actor);
  let r = srv.P.pickClass(s, cls);
  if (r.ok) { s = r.state; }
  if (prof) {
    r = srv.P.pickProfession(s, prof, half);
    if (r.ok) { s = r.state; }
    if (rank) { s.ranks[half] = rank; }
  }
  srv.C.writeState(actor, s);
  return srv.C.stateOf(actor);
}

// ---------------------------------------------------------- A. the table --

const store0 = {};
const first = server(store0);
const SPELLS = (first.S && first.S.STAFF_SPELLS) || {};
const spellKeys = Object.keys(SPELLS);
yes('the staff spells block exports its table (' + spellKeys.length + ' spells)', spellKeys.length > 100);

const staffRows = Object.keys(TABLE).filter(function (k) { return TABLE[k].half === 'Bladebinder'; });
const withSpell = staffRows.filter(function (k) { return !!TABLE[k].spell; });
// The craft book was cut on 2 October (#1511): thirteen staves stay Bladebinder
// work and the rest became nobody's, so the count is the table's, not a fixed
// number. Each staff that stays names the spell it binds. Before the cut the one
// row that named none was the Aetherial Staff (575e:Dawnguard.esm), which the
// table builder finds no spell for; it is allowed to name none if it comes back.
const NO_SPELL = { '575e:Dawnguard.esm': true };
const needSpell = staffRows.filter(function (k) { return !NO_SPELL[TABLE[k].out]; });
yes('every Bladebinder staff names the spell it binds (' + withSpell.length + ' of ' + staffRows.length + ')',
    staffRows.length > 0 && needSpell.every(function (k) { return !!TABLE[k].spell; }));
yes('every spell a staff row names is in STAFF_SPELLS',
    withSpell.every(function (k) { return Object.prototype.hasOwnProperty.call(SPELLS, TABLE[k].spell); }));
const taughtSpells = spellKeys.filter(function (k) { return (SPELLS[k].tomes || []).length > 0; });
const untaught = spellKeys.filter(function (k) { return (SPELLS[k].tomes || []).length === 0; });
yes('most staff spells are taught by a tome (' + taughtSpells.length + ' of ' + spellKeys.length + ')',
    taughtSpells.length > 100);
yes('every spell has a name', spellKeys.every(function (k) { return typeof SPELLS[k].name === 'string' && SPELLS[k].name.length > 0; }));

// Thunderbolt, measured in Build-RecipeTable's header: SpellTomeThunderbolt's
// BOOK DATA reads 4, 0x10f7ee.
const THUNDERBOLT = '10f7ee:Skyrim.esm';
yes('Thunderbolt is a staff spell and a tome teaches it',
    !!SPELLS[THUNDERBOLT] && SPELLS[THUNDERBOLT].name === 'Thunderbolt' && SPELLS[THUNDERBOLT].tomes.length > 0);
const thunderRow = staffRows.map(function (k) { return TABLE[k]; })
  .filter(function (r) { return r.spell === THUNDERBOLT; })[0];
yes('the Staff of Thunderbolts row binds Thunderbolt', !!thunderRow && thunderRow.name === 'Staff of Thunderbolts');
const openStaves = withSpell.filter(function (k) { return TABLE[k].open === true; });
yes('ISSUE DONE WHEN: staff recipes are open now that a tome teaches their spell (' + openStaves.length + ')',
    openStaves.length > 0 && openStaves.every(function (k) { return (SPELLS[TABLE[k].spell].tomes || []).length > 0; }));
yes('and a staff whose spell no tome teaches stays closed',
    withSpell.filter(function (k) { return (SPELLS[TABLE[k].spell].tomes || []).length === 0; })
      .every(function (k) { return TABLE[k].open === false; }));

// The build's own record agrees: the Bladebinder is out of HALVES_NOBODY_CAN_START.
const buildSrc = fs.readFileSync(path.join(REPO, 'scripts', 'dev', 'Build-RecipeTable.ps1'), 'utf8');
const knob = /\$HALVES_NOBODY_CAN_START = \[ordered\]@\{([\s\S]*?)\n\}/.exec(buildSrc);
yes('Build-RecipeTable no longer names the Bladebinder in HALVES_NOBODY_CAN_START',
    !!knob && knob[1].indexOf('Enchanter/Bladebinder') === -1);
let recipesJson = null;
try { recipesJson = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'recipes.json'), 'utf8')); } catch (e) { recipesJson = null; }
const bb = recipesJson && recipesJson.halves && recipesJson.halves['Enchanter/Bladebinder'];
yes('recipes.json counts Bladebinder rows a new Enchanter can reach (' + (bb ? bb.canBeMadeOnDayOne : '?') + ')',
    !!bb && bb.canBeMadeOnDayOne > 0 && !bb.nothingToMakeOnDayOne);
const thunderJson = recipesJson && recipesJson.recipes && recipesJson.recipes['17773:Dragonborn.esm'];
const thunderNeed = thunderJson && (thunderJson.needs || [])[0];
yes('recipes.json says which record the HasSpell names and which tomes teach it',
    !!thunderNeed && thunderNeed.ofDesc === THUNDERBOLT && Array.isArray(thunderNeed.taughtBy) &&
    thunderNeed.taughtBy.length > 0);

// ------------------------------------------------- B. learning from a tome --

const ENCH = 0xff000011;
const WARD = 0xff000012;
const SMITH = 0xff000013;
const NOBODY = 0xff000014;
const RAW = 0xff000017;
const TAUGHT_SMITH = 0xff000018;
const TOME = SPELLS[THUNDERBOLT] ? SPELLS[THUNDERBOLT].tomes[0] : 'none:None.esp';
const FLAMES = '12fcd:Skyrim.esm';
const FLAMES_TOME = SPELLS[FLAMES] ? SPELLS[FLAMES].tomes[0] : 'none:None.esp';
yes('Flames, a Novice Destruction spell, is a staff spell a tome teaches',
    !!SPELLS[FLAMES] && SPELLS[FLAMES].name === 'Flames' && SPELLS[FLAMES].tomes.length > 0);
// A Master mage of Destruction, to teach it.
const TEACHER = { prof: 'mage', ranks: { destruction: 'master' } };
function taught(srv, actor) {
  const s = srv.P.teach(srv.C.stateOf(actor), TEACHER, 'destruction');
  if (s.ok) {
    // And two semesters at the College (#1387), which is where somebody a
    // Master mage taught earns the points their two places are learned with.
    const t0 = 1800000000000;
    srv.C.writeState(actor, srv.P.study(srv.P.study(s.state, t0).state, t0 + 24 * 3600000).state);
  }
  return srv.C.stateOf(actor);
}
function chat(srv, actor) {
  return srv.said.filter(function (x) { return x.id === actor && x.how === 'chat'; });
}
{
  const srv = server(store0);

  // An Enchanter with no magic at all: the Mage rules refuse every tome.
  make(srv, RAW, 'miner', 'enchanter', 'bladebinder', 'master');
  srv.said.length = 0;
  const refused = srv.read(RAW, TOME);
  const rl = (chat(srv, RAW)[0] || {}).text || '';
  yes('ISSUE #1026: a master Bladebinder with no magic reading Thunderbolt is refused, so the tome is kept',
      refused === false);
  yes('  nothing is recorded for staves and nothing learned',
      srv.S.known(srv.C.stateOf(RAW)).length === 0 &&
      (((srv.C.stateOf(RAW).spells || {}).known) || []).length === 0);
  yes('  and the line names all three missing: a spell point, Expert rank in Destruction, an Advanced Destruction spell (' + rl + ')',
      /Thunderbolt \(Expert Destruction\)/.test(rl) && /a spell point to spend/.test(rl) &&
      /Expert rank in Destruction, and you have no rank in it/.test(rl) &&
      /an Advanced Destruction spell you already know/.test(rl));
  yes('  with no em dash and no word player', rl.indexOf('\u2014') === -1 && !/player/i.test(rl));

  // An Enchanter a Master mage taught Destruction: a Novice staff spell passes.
  make(srv, ENCH, 'miner', 'enchanter', 'bladebinder', 'master');
  const before = taught(srv, ENCH);
  yes('a taught Enchanter knows no staff spell yet', srv.S.known(before).length === 0);
  srv.said.length = 0;
  const back = srv.read(ENCH, FLAMES_TOME);
  yes('a taught Enchanter reading Flames passes the rules: not refused, so the engine teaches it and spends the tome',
      back === undefined);
  const after = srv.C.stateOf(ENCH);
  yes('  Flames is in their book, one of their two places spent, and since #1128 nothing is recorded for staves',
      !srv.S.knows(after, FLAMES) && after.spells.known.indexOf('Flames') !== -1 &&
      srv.P.spellPoints(after) === 1);
  const ch = chat(srv, ENCH);
  yes('  and one chat line says what was learned and that staves are unlocked on K (' + ((ch[0] || {}).text || '') + ')',
      ch.length === 1 && /The tome teaches you Flames/.test(ch[0].text) && /press K and unlock Flames under Staff spells/.test(ch[0].text));

  srv.said.length = 0;
  srv.read(ENCH, FLAMES_TOME);
  yes('reading it again records nothing and spends nothing, and points at K again',
      srv.S.known(srv.C.stateOf(ENCH)).length === 0 && srv.P.spellPoints(srv.C.stateOf(ENCH)) === 1 &&
      chat(srv, ENCH).length === 1 && /Staff spells/.test(chat(srv, ENCH)[0].text));

  // The way in since #1128: unlocked on K, no tome.
  const un = srv.S.unlock(srv.P, srv.C.stateOf(ENCH), 'Flames');
  if (un.ok) { srv.C.writeState(ENCH, un.state); }
  yes('the Enchanter unlocks Flames for staves on K instead', un.ok && srv.S.knows(srv.C.stateOf(ENCH), FLAMES));

  srv.said.length = 0;
  const thunder = srv.read(ENCH, TOME);
  const tl = (chat(srv, ENCH)[0] || {}).text || '';
  yes('the same Enchanter is refused Thunderbolt: a taught school stays Novice (' + tl + ')',
      thunder === false && !srv.S.knows(srv.C.stateOf(ENCH), THUNDERBOLT) &&
      /Expert rank in Destruction, and you are Novice in it/.test(tl));

  // A Wardweaver has the Bladebinder's novice as the sister half, so may make
  // novice staves and so learns their spells, under the same rules.
  make(srv, WARD, 'miner', 'enchanter', 'wardweaver');
  taught(srv, WARD);
  srv.read(WARD, FLAMES_TOME);
  yes('a taught Wardweaver learns Flames from the tome and, like any Enchanter, has nothing recorded for staves by it',
      !srv.S.knows(srv.C.stateOf(WARD), FLAMES) && srv.C.stateOf(WARD).spells.known.indexOf('Flames') !== -1);
}

// ------------------------------------------------ D. anybody else reading --
{
  const srv = server(store0);
  make(srv, SMITH, 'miner', 'smith', 'edgewright', 'master');
  srv.said.length = 0;
  const back = srv.read(SMITH, TOME);
  yes('a Smith with no magic reading Thunderbolt is refused under the same rules', back === false);
  yes('  nothing recorded', srv.S.known(srv.C.stateOf(SMITH)).length === 0);
  yes('  and told why', chat(srv, SMITH).length === 1 && /You need/.test(chat(srv, SMITH)[0].text));

  make(srv, TAUGHT_SMITH, 'miner', 'smith', 'edgewright', 'master');
  taught(srv, TAUGHT_SMITH);
  srv.said.length = 0;
  const b2 = srv.read(TAUGHT_SMITH, FLAMES_TOME);
  const l2 = (chat(srv, TAUGHT_SMITH)[0] || {}).text || '';
  yes('a Smith a Master mage taught Destruction learns Flames, and nothing is recorded for staves (' + l2 + ')',
      b2 === undefined && srv.C.stateOf(TAUGHT_SMITH).spells.known.indexOf('Flames') !== -1 &&
      srv.S.known(srv.C.stateOf(TAUGHT_SMITH)).length === 0 && !/staff/.test(l2));

  make(srv, NOBODY, 'miner', null);
  srv.said.length = 0;
  const b3 = srv.read(NOBODY, TOME);
  yes('somebody with no profession yet: refused, nothing recorded',
      b3 === false && srv.S.known(srv.C.stateOf(NOBODY)).length === 0);

  srv.said.length = 0;
  const b4 = srv.read(ENCH, '12345:Skyrim.esm');
  yes('a book that is not a spell tome: not refused, nothing said, nothing changed',
      b4 === undefined && srv.said.length === 0 && srv.S.known(srv.C.stateOf(ENCH)).length === 1);
}

// -------------------------------------------- C. the staff gate, and E. a restart --
{
  // A restart: a second server over the same store and nothing else.
  const srv = server(JSON.parse(JSON.stringify(store0)));
  yes('AFTER A RESTART the Enchanter still has Flames recorded, out of the character store',
      srv.S.knows(srv.C.stateOf(ENCH), FLAMES));

  const flamesRow = withSpell.map(function (k) { return TABLE[k]; })
    .filter(function (r) { return r.spell === FLAMES; })[0];
  yes('the recipe table has a staff that binds Flames', !!flamesRow);
  if (flamesRow) {
    const ok = srv.craft(ENCH, flamesRow);
    yes('a master Bladebinder who learned Flames under the rules may make ' + flamesRow.name + ', and the work is credited',
        !ok.refusal && ok.credit === 'bladebinder');
  }

  const no = srv.craft(ENCH, thunderRow);
  yes('a staff whose spell they could not learn is refused', !!no.refusal);
  yes('  and the refusal names the spell and says to unlock it on K, with no tome (#1128)',
      !!no.refusal && no.refusal.indexOf('Thunderbolt') !== -1 && /Press K and unlock it under Staff spells/.test(no.refusal) &&
      /No tome is needed/.test(no.refusal));
  yes('  with no em dash and no word player',
      !!no.refusal && no.refusal.indexOf('\u2014') === -1 && !/player/i.test(no.refusal));

  if (untaught.length) {
    const closed = withSpell.map(function (k) { return TABLE[k]; })
      .filter(function (r) { return r.spell === untaught[0]; })[0];
    const n = srv.craft(ENCH, closed);
    yes('a staff whose spell no tome teaches is refused to an Enchanter who has not unlocked it',
        !!n.refusal);
  }

  // The spell known some other way does not open a staff: only the record does.
  const fresh = 0xff000015;
  make(srv, fresh, 'miner', 'enchanter', 'bladebinder', 'master');
  const s = taught(srv, fresh);
  s.spells = { points: 0, known: ['Flames'] };
  srv.C.writeState(fresh, s);
  yes('a spell in the book but not unlocked for staves does not open the staff',
      !!flamesRow && !!srv.craft(fresh, flamesRow).refusal);
  srv.said.length = 0;
  const again = srv.read(fresh, FLAMES_TOME);
  yes('  reading its tome records nothing for staves and spends nothing (#1128)',
      again === undefined && !srv.S.knows(srv.C.stateOf(fresh), FLAMES) &&
      srv.C.stateOf(fresh).spells.known.length === 1);
  const un2 = srv.S.unlock(srv.P, srv.C.stateOf(fresh), FLAMES);
  if (un2.ok) { srv.C.writeState(fresh, un2.state); }
  yes('  unlocking it on K does, and the staff opens', un2.ok && !!flamesRow && !srv.craft(fresh, flamesRow).refusal);

  // The staff gate asks after rank and half, so the old answers stand.
  const smith = srv.craft(SMITH, thunderRow);
  yes('a Smith is still refused as a Smith, not told about tomes',
      !!smith.refusal && !/spell tome/.test(smith.refusal));
  const low = 0xff000016;
  make(srv, low, 'miner', 'enchanter', 'bladebinder', 'novice');
  const lowRow = withSpell.map(function (k) { return TABLE[k]; }).filter(function (r) {
    return r.rank !== 'novice' && r.spell === THUNDERBOLT;
  })[0] || null;
  if (lowRow) {
    const lr = srv.craft(low, lowRow);
    yes('a novice Bladebinder at a higher staff hears about rank first', !!lr.refusal && /Rank comes from/.test(lr.refusal));
  }
  const rowless = srv.craft(ENCH, { name: 'Iron Dagger', half: 'Bladebinder', owner: 'Enchanter', rank: 'novice' });
  yes('a row with no spell is untouched by the staff gate', !rowless.refusal);
}

// ------------------------------------------------------- the handler itself --
{
  const lines = src.split('\n').filter(function (l) { return /^mp\.onReadBook\s*=/.test(l); });
  yes('mp.onReadBook is registered once, through guard under its own name',
      lines.length === 1 && lines[0].indexOf("guard('onReadBook', function") !== -1);
  const body = (function () {
    const i = src.indexOf("mp.onReadBook = guard('onReadBook', function");
    const j = i < 0 ? -1 : src.indexOf('\n});', i);
    return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
  })();
  yes('and it returns false only when the spell tomes block refuses the tome',
      !!body && /if \(r && r\.refused\) \{[\s\S]*?return false;\s*\}/.test(body) &&
      (body.match(/return\s+false/g) || []).length === 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
