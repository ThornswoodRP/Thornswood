// test-enchanter-staff-spells.js
//
// Issue #1128. Patrick, 29 September: "Enchanters also get their own spell
// point and spell unlocking system like the Mages have, so they can actually
// learn staff spells: like Mages, they do not need the tomes; their Enchanter
// rank decides which ranks they can unlock (Novice, Advanced, and so on). A
// non-Enchanter taught by a Master Enchanter follows the same rules a non-Mage
// has for magic: needs the tome and an earned spell point, and can only learn
// Novice." And later the same day: "just like mages enchanters can't unlock a
// spell even if they are the correct rank and have the spell points, they must
// also have at least one spell of the level below the spell they are trying to
// get."
//
// This runs the real blocks out of game/gamemode.js in a sandbox with a fake mp
// that keeps properties as JSON the way the server does: the rules, the
// character store and its /pick command, the spell tomes block with
// mp.onReadBook, the staff spells block, and the real craftAnswer. Then it runs
// the real K panel (game/ui/thornswood-skills.js) against a small stand-in
// document. It proves:
//   A. every staff spell carries the rank the build read, and the rulebook's
//      own rank wins for a spell it lists
//   B. staff spell points are earned: two to start, one per Bladebinder rank,
//      two at Master, and a record with none stored holds none, not what its
//      rank would have given (#3265)
//   C. unlocking spends one, needs no tome, and puts the spell on the character
//   D. the Bladebinder rank caps the unlock at every rank
//   E. a staff spell of the rank below is needed, Novice exempt, and a refusal
//      names every missing requirement
//   F. a staff is made only once its spell is unlocked, and what #967 recorded
//      stays unlocked
//   G. somebody a Master Enchanter taught: the tome, a place under the cap of
//      two, Novice only, one teaching
//   H. the K panel draws the page for an Enchanter only and sends
//      '/pick staffspell <desc>'
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const SKILLS = process.env.SKILLS || path.join(REPO, 'game', 'ui', 'thornswood-skills.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');
const page = fs.readFileSync(SKILLS, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
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
const NO_PROF = /const NO_PROFESSION_AT_A_BENCH = [^\n]*\n/.exec(src);
yes('the rules, the character store, the tomes, the staff spells and the craft gate are in the gamemode',
    RULES && CHARACTER && STAFF && TOMES && NO_PROF && GATE_PARTS.every(function (p) { return p !== null; }));
if (!(RULES && CHARACTER && STAFF && TOMES && NO_PROF && GATE_PARTS.every(function (p) { return p !== null; }))) { done(); }

// The recipe table, as it is.
// The gamemode reads RECIPES_BY_ID from game/gamemode-tables (#5191).
let TABLE = {};
try { TABLE = require('./gamemode-tables.js').table('RECIPES_BY_ID'); } catch (e) { TABLE = {}; }
const STAFF_ROWS = Object.keys(TABLE).map(function (k) { return TABLE[k]; })
  .filter(function (r) { return r.half === 'Bladebinder' && r.spell; });

// Tome desc -> spell desc, and ids both ways, as the engine answers them.
let STAFF_TABLE = {};
{
  try { STAFF_TABLE = require('./gamemode-tables.js').table('STAFF_SPELLS'); } catch (e) { STAFF_TABLE = {}; }
}
const SPELL_OF_TOME = {};
Object.keys(STAFF_TABLE).forEach(function (sp) {
  (STAFF_TABLE[sp].tomes || []).forEach(function (tm) { SPELL_OF_TOME[tm] = sp; });
});
const IDS = {}, DESCS = {};
let nextId = 0x100;
function idFor(desc) {
  if (!Object.prototype.hasOwnProperty.call(IDS, desc)) { IDS[desc] = ++nextId; DESCS[nextId] = desc; }
  return IDS[desc];
}

/* One server process over a store of properties; a second one over the same store is a restart. */
function server(store) {
  const said = [], granted = [], taken = [], told = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (key === 'profileId') { return 1000 + (id & 0xff); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); },
    getDescFromId: function (n) { return DESCS[n] || ('unknown' + n + ':Nowhere.esp'); },
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
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    notify: function (id, m) { said.push({ id: id, text: m, how: 'notify' }); },
    say: function (id, m) { said.push({ id: id, text: m, how: 'chat' }); },
    log: function () { },
    spellOn: function (id, desc, on) { granted.push({ id: id, desc: desc, on: on }); return true; },
    takeItemById: function (id, base, n) { taken.push({ id: id, base: base, n: n }); return true; },
    giveTool: function () { return null; }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  vm.runInContext(GATE_PARTS[4], ctx, { filename: 'gamemode.js aWord' });
  vm.runInContext(TOMES, ctx, { filename: 'gamemode.js spell tomes' });
  vm.runInContext(STAFF, ctx, { filename: 'gamemode.js staff spells' });
  const gate = new Function('globalThis', 'log', 'raceOf', 'NO_PROFESSION_AT_A_BENCH',
                            GATE_PARTS.join('\n') + '\nreturn craftAnswer;')(
    ctx, function () { }, function () { return ''; }, 'no profession');
  const C = ctx.__thornswoodCharacter;
  return {
    ctx: ctx, said: said, granted: granted, taken: taken, told: told,
    C: C, P: ctx.__thornswoodProgression, S: ctx.__thornswoodStaffSpells,
    read: function (actor, tomeDesc) { return ctx.mp.onReadBook(actor, idFor(tomeDesc)); },
    craft: function (actor, row) { return gate(actor, row); },
    pick: function (actor, words) {
      told.length = 0;
      C.command('/pick', ('/pick ' + words).trim().split(/\s+/), actor, 1000 + (actor & 0xff),
                function (pid, m) { told.push(m); });
      return told.slice();
    }
  };
}

/** A character with this class and profession written into the store, then any changes. */
function make(srv, actor, prof, half, change) {
  let s = srv.C.stateOf(actor);
  let r = srv.P.pickClass(s, 'miner');
  if (r.ok) { s = r.state; }
  if (prof) {
    r = srv.P.pickProfession(s, prof, half);
    if (r.ok) { s = r.state; }
  }
  if (change) { change(s); }
  srv.C.writeState(actor, s);
  return srv.C.stateOf(actor);
}
function chat(srv, actor) { return srv.said.filter(function (x) { return x.id === actor && x.how === 'chat'; }); }

// ----------------------------------------------------------- A. the table --
const store0 = {};
const first = server(store0);
const S = first.S, P = first.P;
const descs = Object.keys(STAFF_TABLE);
yes('the staff spells block exports its table (' + descs.length + ' spells)', descs.length > 100);
const ranked = descs.filter(function (d) { return !!S.rankOf(d); });
yes('the build wrote a school and rank beside the staff spells (' + ranked.length + ' of ' + descs.length + ' ranked)',
    descs.every(function (d) { return 'rank' in STAFF_TABLE[d] && 'school' in STAFF_TABLE[d]; }) &&
    ranked.length >= descs.length - 5);
const byRank = { novice: [], advanced: [], expert: [], master: [] };
ranked.forEach(function (d) { byRank[S.rankOf(d)].push(d); });
yes('staff spells at every rank (novice ' + byRank.novice.length + ', advanced ' + byRank.advanced.length +
    ', expert ' + byRank.expert.length + ', master ' + byRank.master.length + ')',
    byRank.novice.length > 2 && byRank.advanced.length > 1 && byRank.expert.length > 1);
// No staff in this load order binds a Master spell (measured 29 September:
// novice 14, advanced 91, expert 55). The Master rung is proved through the
// rules with a stand-in spell, so it holds the day a mod adds one.
const MASTER_STANDIN = { desc: 'fff:Standin.esp', name: 'Stand-in Storm', rank: 'master' };
function rankWithStandin(d) { return d === MASTER_STANDIN.desc ? 'master' : S.rankOf(d); }
const FLAMES = '12fcd:Skyrim.esm', FROSTBITE = '2b96b:Skyrim.esm', SPARKS = '2dd2a:Skyrim.esm';
const FIREBOLT = '12fd0:Skyrim.esm', THUNDERBOLT = '10f7ee:Skyrim.esm';
yes('the rulebook\'s own rank wins for a spell it lists: Flames Novice, Firebolt Advanced, Thunderbolt Expert',
    S.rankOf(FLAMES) === 'novice' && S.rankOf(FIREBOLT) === 'advanced' && S.rankOf(THUNDERBOLT) === 'expert');
const MASTER = byRank.master[0] || null;
yes('a staff spell is found by its name as well as its desc',
    !!S.find('thunderbolt') && S.find('thunderbolt').desc === THUNDERBOLT && S.find(FLAMES).name === 'Flames');
const buildSrc = fs.readFileSync(path.join(REPO, 'scripts', 'dev', 'Build-RecipeTable.ps1'), 'utf8');
yes('Build-RecipeTable writes the school and rank into STAFF_SPELLS',
    /"school": ' \+ \$schTxt/.test(buildSrc) && /"rank": ' \+ \$rkTxt/.test(buildSrc) && /function StaffSchoolRank/.test(buildSrc));

// ------------------------------------------------- B. points are earned --
const L = P.TABLE.limits;
{
  const srv = server({});
  const e = make(srv, 0xff000101, 'enchanter', 'bladebinder');
  yes('a new Bladebinder has ' + L.enchanterStartStaff + ' staff spell points', P.staffPoints(e) === 2 && e.staffPoints === 2);
  const w = make(srv, 0xff000102, 'enchanter', 'wardweaver');
  yes('a new Wardweaver has the same two', P.staffPoints(w) === 2);
  const sm = make(srv, 0xff000103, 'smith', 'edgewright');
  const mg = make(srv, 0xff000104, 'mage', ['destruction', 'restoration']);
  yes('a Smith and a Mage have none', P.staffPoints(sm) === 0 && P.staffPoints(mg) === 0);

  let s = e;
  const seen = [];
  ['advanced', 'expert', 'master'].forEach(function () {
    const r = P.rankUp(s, 'bladebinder', null);
    s = r.state;
    seen.push(P.staffPoints(s));
  });
  yes('one more with each Bladebinder rank and two at Master: 3, 4, 6 (' + seen.join(', ') + ')',
      seen.join(',') === '3,4,6');

  const w2 = P.rankUp(w, 'wardweaver', null).state;
  yes('a Wardweaver\'s own rank gives no staff spell point (the staff half is the Bladebinder)', P.staffPoints(w2) === 2);
  const w3 = P.rankUp(w2, 'bladebinder', { ranks: { bladebinder: 'master' } }).state;
  yes('a Wardweaver a Master Bladebinder raises earns one', P.staffPoints(w3) === 3);

  const worked = P.creditWork(e, 'bladebinder', null, P.TUNING.workPerRank.advanced);
  yes('work that reaches Advanced Bladebinder reports the staff spell point', !!worked.raised && worked.raised.staffPoints === 1);
  const line = srv.C.raiseLines(0xff000101, worked) || '';
  yes('  and the rank line says so (' + line + ')', /1 more staff spell point to unlock staff spells with, on K/.test(line));

  const old = { cls: 'miner', prof: 'enchanter', half: 'bladebinder', schools: [], taught: [],
                ranks: { bladebinder: 'expert', wardweaver: 'novice' }, tree: {}, points: 0, work: {}, placed: {} };
  yes('an Enchanter record with no staff points stored holds none, not what an Expert would have earned (#3265)', P.staffPoints(old) === 0);
  yes('  and the next rank adds only its own: 2 at Master', P.staffPoints(P.rankUp(old, 'bladebinder', null).state) === 2);
}

// ------------------------------------------ C, D, E. unlocking by the rules --
const E1 = 0xff000111;
{
  const srv = server(store0);
  make(srv, E1, 'enchanter', 'bladebinder');
  srv.granted.length = 0;
  const said = srv.pick(E1, 'staffspell ' + FLAMES);
  let st = srv.C.stateOf(E1);
  yes('NO TOME: a Novice Bladebinder unlocks Flames on K with no book read at all',
      P.knowsStaff(st, FLAMES) && srv.said.length === 0);
  yes('  and it spends one staff spell point (2 -> ' + P.staffPoints(st) + ')', P.staffPoints(st) === 1);
  yes('  and puts Flames on the character, so the crafting menu lists its staves',
      srv.granted.length === 1 && srv.granted[0].desc === FLAMES && srv.granted[0].on === true);
  yes('  and says so (' + said.join(' | ') + ')', /You unlock Flames for staves/.test(said.join(' ')) && /1 staff spell point left/.test(said.join(' ')));
  const again = srv.pick(E1, 'staffspell Flames');
  yes('the same spell twice is refused and spends nothing', /already unlocked Flames/.test(again.join(' ')) && P.staffPoints(srv.C.stateOf(E1)) === 1);

  // D. the rank caps it, at every rank.
  const cap = srv.pick(E1, 'staffspell ' + FIREBOLT);
  const capNote = srv.C.stateOf(E1).note || {};
  yes('RANK: a Novice Bladebinder is refused Firebolt, an Advanced spell, naming only the rank (' + cap.join(' ') + ')',
      !P.knowsStaff(srv.C.stateOf(E1), FIREBOLT) && /Advanced rank as a Bladebinder/.test(cap.join(' ')) &&
      !/staff spell point to spend/.test(cap.join(' ')) && !/already unlocked, and you have none/.test(cap.join(' ')));
  yes('  and the panel hears the same refusal, about staffspell', capNote.about === 'staffspell' && /Advanced rank/.test(capNote.text || ''));

  const ladder = [['advanced', FIREBOLT, THUNDERBOLT], ['expert', THUNDERBOLT, MASTER]];
  if (MASTER) { ladder.push(['master', MASTER, null]); }
  ladder.forEach(function (step) {
    const s = srv.C.stateOf(E1);
    s.ranks.bladebinder = step[0];
    s.staffPoints = 3;
    srv.C.writeState(E1, s);
    srv.pick(E1, 'staffspell ' + step[1]);
    yes('RANK: at ' + step[0] + ' Bladebinder a ' + step[0] + ' staff spell unlocks (' + S.spellFor(step[1]).name + ')',
        P.knowsStaff(srv.C.stateOf(E1), step[1]));
    if (step[2] === null && step[0] === 'expert') {
      const no = P.pickStaffSpell(srv.C.stateOf(E1), MASTER_STANDIN, rankWithStandin);
      yes('  and a Master one does not (a stand-in, since no staff here binds one)',
          !no.ok && no.missing.length === 1 && no.missing[0].what === 'level');
      const s2 = srv.C.stateOf(E1);
      s2.ranks.bladebinder = 'master';
      const at = P.pickStaffSpell(s2, MASTER_STANDIN, rankWithStandin);
      yes('RANK: at master Bladebinder a master staff spell unlocks (the stand-in)', at.ok && P.knowsStaff(at.state, MASTER_STANDIN.desc));
    }
    if (step[2]) {
      const no = srv.pick(E1, 'staffspell ' + step[2]).join(' ');
      yes('  and one a rank above it does not (' + S.spellFor(step[2]).name + ')',
          !P.knowsStaff(srv.C.stateOf(E1), step[2]) && /rank as a Bladebinder/.test(no));
    }
  });
}

// E. the rank below.
{
  const srv = server({});
  const E2 = 0xff000121;
  make(srv, E2, 'enchanter', 'bladebinder', function (s) { s.ranks.bladebinder = 'expert'; s.staffPoints = 5; });
  const r1 = P.pickStaffSpell(srv.C.stateOf(E2), S.spellFor(FIREBOLT), S.rankOf);
  yes('BELOW: an Expert Bladebinder with points and no Novice staff spell is refused Firebolt, for the rank below only',
      !r1.ok && r1.missing.length === 1 && r1.missing[0].what === 'below' &&
      /a Novice staff spell you have already unlocked, and you have none/.test(r1.why));
  const said = srv.pick(E2, 'staffspell Firebolt').join(' ');
  yes('  the chat line names it (' + said + ')', /you need a Novice staff spell you have already unlocked/.test(said));
  const r2 = P.pickStaffSpell(srv.C.stateOf(E2), S.spellFor(FLAMES), S.rankOf);
  yes('BELOW: a Novice staff spell needs none', r2.ok);
  srv.pick(E2, 'staffspell Flames');
  srv.pick(E2, 'staffspell Firebolt');
  yes('BELOW: once a Novice one is unlocked, Firebolt unlocks', P.knowsStaff(srv.C.stateOf(E2), FIREBOLT));
  const r3 = P.pickStaffSpell(srv.C.stateOf(E2), S.spellFor(THUNDERBOLT), S.rankOf);
  yes('  and an Advanced one opens Expert in turn', r3.ok);
  const r4 = P.pickStaffSpell(srv.C.stateOf(E2), MASTER_STANDIN, rankWithStandin);
  yes('  while Master still needs an Expert one and the rank', !r4.ok &&
      r4.missing.map(function (m) { return m.what; }).sort().join(',') === 'below,level');

  const E3 = 0xff000122;
  make(srv, E3, 'enchanter', 'bladebinder', function (s) { s.staffPoints = 0; });
  const all = srv.pick(E3, 'staffspell Thunderbolt').join(' ');
  yes('ALL THREE: a Novice with no points asking for Thunderbolt hears every one (' + all + ')',
      /a staff spell point to spend, and you have none \(an Enchanter earns one with every Bladebinder rank\)/.test(all) &&
      /Expert rank as a Bladebinder, the half that makes staves, and you are Novice/.test(all) &&
      /an Advanced staff spell you have already unlocked, and you have none/.test(all));
  yes('  with no em dash and no word player', all.indexOf('—') === -1 && !/player/i.test(all));
  const nosuch = srv.pick(E3, 'staffspell Not A Spell').join(' ');
  yes('a name no staff binds is refused plainly (' + nosuch + ')', /no staff binds a spell called Not A Spell/.test(nosuch));
}

// ------------------------------------ F. the staff gate, and old records --
{
  const srv = server(JSON.parse(JSON.stringify(store0)));   // a restart
  yes('AFTER A RESTART the unlocked staff spells are still there', P.knowsStaff(srv.C.stateOf(E1), FLAMES));
  const flamesRow = STAFF_ROWS.filter(function (r) { return r.spell === FLAMES && r.rank === 'novice'; })[0] ||
                    STAFF_ROWS.filter(function (r) { return r.spell === FLAMES; })[0];
  const sparksRow = STAFF_ROWS.filter(function (r) { return r.spell === SPARKS && r.rank === 'novice'; })[0] ||
                    STAFF_ROWS.filter(function (r) { return r.spell === SPARKS; })[0];
  yes('the recipe table has staves binding Flames and Sparks', !!flamesRow && !!sparksRow);
  const ok = srv.craft(E1, flamesRow);
  yes('STAFF: an Enchanter who unlocked Flames makes ' + flamesRow.name, !ok.refusal && ok.credit === 'bladebinder');
  const no = srv.craft(E1, sparksRow);
  yes('STAFF: a staff whose spell is not unlocked is refused, and told to unlock it on K with no tome (' + (no.refusal || '') + ')',
      !!no.refusal && /Press K and unlock it under Staff spells/.test(no.refusal) && /No tome is needed/.test(no.refusal) &&
      no.refusal.indexOf('—') === -1 && !/player/i.test(no.refusal));

  // What #967 recorded when a tome was the only way in stays unlocked.
  const OLD = 0xff000131;
  srv.C.writeState(OLD, { cls: 'miner', prof: 'enchanter', half: 'bladebinder', schools: [], taught: [],
    ranks: { bladebinder: 'master', wardweaver: 'novice' }, tree: {}, points: 0, work: {}, placed: {},
    staffSpells: [SPARKS], staffPoints: 6, v: 1 });
  yes('OLD RECORD: a staff spell learned from a tome before #1128 still opens its staff', !srv.craft(OLD, sparksRow).refusal);
  yes('  and that Master Enchanter holds the points stored (6), with the spell from the tome kept for nothing',
      P.staffPoints(srv.C.stateOf(OLD)) === 6);
  srv.granted.length = 0;
  srv.C.grantKnown(OLD);
  yes('  and every spawn puts the staff spell back on the character', srv.granted.some(function (g) { return g.desc === SPARKS && g.on; }));

  // An Enchanter reading a staff spell's tome: the Mage rules, and nothing for staves.
  const ET = 0xff000132;
  make(srv, ET, 'enchanter', 'bladebinder');
  srv.said.length = 0;
  const tome = STAFF_TABLE[FROSTBITE].tomes[0];
  const back = srv.read(ET, tome);
  const line = (chat(srv, ET)[0] || {}).text || '';
  yes('an Enchanter with no magic reading the Frostbite tome is refused under the Mage rules, and nothing is unlocked',
      back === false && !P.knowsStaff(srv.C.stateOf(ET), FROSTBITE) && P.staffPoints(srv.C.stateOf(ET)) === 2);
  yes('  and told staves need no tome: unlock it on K (' + line + ')', /Staves need no tome for an Enchanter: press K and unlock Frostbite under Staff spells/.test(line));
}

// ------------------------------- G. somebody a Master Enchanter taught --
{
  const srv = server({});
  const MASTER_BB = { prof: 'enchanter', half: 'bladebinder', ranks: { bladebinder: 'master' } };
  const T1 = 0xff000141;
  make(srv, T1, 'smith', 'edgewright');
  const t = P.teach(srv.C.stateOf(T1), MASTER_BB, 'bladebinder');
  yes('a Master Bladebinder teaches a Smith the half, at Novice', t.ok && P.rankOf(t.state, 'bladebinder') === 'novice');
  srv.C.writeState(T1, t.state);
  const t2 = P.teach(srv.C.stateOf(T1), MASTER_BB, 'bladebinder');
  yes('ONE SESSION: a second teaching is refused', !t2.ok && /already know that/.test(t2.why));
  yes('the taught Smith has ' + L.outsiderSpells + ' staff spell places, the non-mage cap', P.staffPoints(srv.C.stateOf(T1)) === L.outsiderSpells);

  const onK = srv.pick(T1, 'staffspell Flames').join(' ');
  yes('TOME: they cannot unlock on K (' + onK + ')', /learns a staff spell from its tome, not here/.test(onK) && !P.knowsStaff(srv.C.stateOf(T1), FLAMES));

  srv.said.length = 0;
  const r1 = srv.read(T1, STAFF_TABLE[FLAMES].tomes[0]);
  const l1 = (chat(srv, T1)[0] || {}).text || '';
  yes('TOME: reading the Flames tome unlocks it for staves, and the engine is let teach it and spend the tome (' + l1 + ')',
      r1 !== false && P.knowsStaff(srv.C.stateOf(T1), FLAMES) && /The tome unlocks Flames for staves/.test(l1) &&
      /the tome is spent/.test(l1));
  yes('  one of the two places is gone, and none of a mage\'s spell book',
      P.staffPoints(srv.C.stateOf(T1)) === 1 && !((srv.C.stateOf(T1).spells || {}).known || []).length);

  srv.said.length = 0;
  const r2 = srv.read(T1, STAFF_TABLE[FIREBOLT].tomes[0]);
  const l2 = (chat(srv, T1)[0] || {}).text || '';
  yes('NOVICE ONLY: the Firebolt tome is refused, kept, and the line says a taught trade never goes past Novice (' + l2 + ')',
      r2 === false && !P.knowsStaff(srv.C.stateOf(T1), FIREBOLT) && /Advanced rank as a Bladebinder/.test(l2) &&
      /a taught trade never goes past/.test(l2));

  srv.read(T1, STAFF_TABLE[FROSTBITE].tomes[0]);
  yes('a second Novice tome takes the last place', P.knowsStaff(srv.C.stateOf(T1), FROSTBITE) && P.staffPoints(srv.C.stateOf(T1)) === 0);
  srv.said.length = 0;
  const r3 = srv.read(T1, STAFF_TABLE[SPARKS].tomes[0]);
  const l3 = (chat(srv, T1)[0] || {}).text || '';
  yes('POINT: a third is refused, the cap named (' + l3 + ')',
      r3 === false && !P.knowsStaff(srv.C.stateOf(T1), SPARKS) && /holds 2 staff spells at most/.test(l3));

  const flamesNovice = STAFF_ROWS.filter(function (r) { return r.spell === FLAMES && r.rank === 'novice'; })[0];
  if (flamesNovice) {
    yes('the taught Smith makes a Novice staff of Flames', !srv.craft(T1, flamesNovice).refusal);
  }
  const sparksNovice = STAFF_ROWS.filter(function (r) { return r.spell === SPARKS && r.rank === 'novice'; })[0];
  if (sparksNovice) {
    const n = srv.craft(T1, sparksNovice).refusal || '';
    yes('  and is told to read the tome for one they have not learned (' + n + ')', /Read a spell tome of Sparks/.test(n));
  }

  // A spell already on the character: the tome is spent by the server, since the engine keeps it.
  const T2 = 0xff000142;
  make(srv, T2, 'cook', 'hearthcook', function (s) {
    s.taught = ['bladebinder']; s.ranks.bladebinder = 'novice'; s.spells = { points: 0, known: ['Flames'] };
  });
  srv.taken.length = 0;
  srv.read(T2, STAFF_TABLE[FLAMES].tomes[0]);
  yes('somebody taught who already knows Flames unlocks it for staves, and the server spends the tome',
      P.knowsStaff(srv.C.stateOf(T2), FLAMES) && srv.taken.length === 1);

  const T3 = 0xff000143;
  make(srv, T3, 'smith', 'platewright');
  const r4 = srv.read(T3, STAFF_TABLE[FLAMES].tomes[0]);
  yes('a Smith nobody taught reading the same tome: refused, nothing for staves', r4 === false && !P.knowsStaff(srv.C.stateOf(T3), FLAMES));
}

// -------------------------------------------------- H. the K panel --
{
  const srv = server({});
  const E4 = 0xff000151;
  make(srv, E4, 'enchanter', 'bladebinder');
  const view = srv.C.forPanel(srv.C.stateOf(E4), false, null);
  const sm = make(srv, 0xff000152, 'smith', 'edgewright');
  yes('the panel view carries the staff page for an Enchanter: points, rank, what is unlocked, every ranked spell',
      !!view.staff && view.staff.points === 2 && view.staff.rank === 'novice' && Array.isArray(view.staff.mine) &&
      view.staff.spells.length === ranked.length);
  const order = ['novice', 'advanced', 'expert', 'master'];
  yes('  sorted Novice first, rank by rank', view.staff.spells.every(function (r, i, a) {
    return i === 0 || order.indexOf(a[i - 1][2]) <= order.indexOf(r[2]);
  }) && view.staff.spells[0][2] === 'novice');
  yes('  and nobody else gets one', !srv.C.forPanel(sm, false, null).staff);

  // The page itself, in a stand-in document.
  const sent = [];
  function node(tag) {
    const n = { tag: tag, children: [], style: {}, className: '', _text: '', id: '', onclick: null, title: '' };
    Object.defineProperty(n, 'textContent', {
      get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
      set: function (v) { n._text = String(v); n.children = []; }
    });
    n.appendChild = function (c) { n.children.push(c); return c; };
    n.querySelector = function (sel) { return (n._q && n._q[sel]) || node('div'); };
    return n;
  }
  const doc = {
    head: node('head'), body: node('body'),
    createElement: function (tag) {
      const n = node(tag);
      Object.defineProperty(n, 'innerHTML', { set: function () {
        const close = node('div'); close._q = { span: node('span'), '.key': node('span') };
        n._q = { '.title': node('div'), '.who': node('div'), '.nav': node('div'), '.body': node('div'),
                 '.status': node('div'), '[data-act="confirm"]': node('div'), '[data-act="close"]': close, '.panel': node('div') };
      } });
      return n;
    },
    createTextNode: function (t) { const n = node('#text'); n._text = String(t); return n; }
  };
  const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
                skyrimPlatform: { sendMessage: function (to, m) { sent.push(m); } } };
  const box = { window: win, document: doc, setTimeout: function () { }, Date: Date, JSON: JSON, console: console };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(page, box, { filename: 'thornswood-skills.js' }); } catch (e) { ran = false; console.log(e); }
  const api = win.thornswoodSkills;
  yes('the K panel runs in a stand-in document', ran && !!api);
  if (api) {
    const root = doc.body.children[0];
    const nav = root._q['.nav'], body = root._q['.body'], confirmBtn = root._q['[data-act="confirm"]'];
    const status = root._q['.status'];
    function all(n, out) { out = out || []; out.push(n); n.children.forEach(function (c) { all(c, out); }); return out; }
    api.open();
    api.setData(null, { panel: view });
    const navRows = nav.children.filter(function (r) { return /navrow/.test(r.className); });
    const staffNav = navRows.filter(function (r) { return /Staff spells/.test(r.textContent); })[0];
    yes('an Enchanter\'s K panel has a Staff spells section (' + navRows.map(function (r) { return r.children[0].textContent; }).join(', ') + ')', !!staffNav);
    if (staffNav) {
      staffNav.onclick();
      const rowsOf = function () { return all(body).filter(function (n) { return /(^| )spell( |$)/.test(n.className); }); };
      const byName = function (nm) { return rowsOf().filter(function (n) { return n.children[0] && n.children[0].textContent === nm; })[0]; };
      yes('  drawing every staff spell (' + rowsOf().length + ')', rowsOf().length === ranked.length);
      const fire = byName('Firebolt');
      yes('  with an Advanced one shut for a Novice Bladebinder', !!fire && /shut/.test(fire.className) && /needs Advanced Bladebinder/.test(fire.textContent));
      byName('Flames').onclick();
      yes('  a click marks Flames', /marked/.test(byName('Flames').textContent));
      yes('  and the button reads Unlock', confirmBtn.textContent === 'Unlock' && !/off/.test(confirmBtn.className));
      sent.length = 0;
      confirmBtn.onclick();
      yes('  Unlock sends skills:pick staffspell with the desc (' + sent.join(' | ') + ')', sent.indexOf('skills:pick staffspell ' + FLAMES) !== -1);
      srv.pick(E4, 'staffspell ' + FLAMES);
      api.setData(null, { panel: srv.C.forPanel(srv.C.stateOf(E4), false, null) });
      yes('  and the server\'s answer reads as unlocked (' + status.textContent + ')',
          /unlocked/.test(byName('Flames').textContent) && /Flames is unlocked for staves/.test(status.textContent));
    }
  }
  yes('a refusal about staffspell is taken for the staff page', /'staffspell': 'staff'/.test(page));
}

done();
