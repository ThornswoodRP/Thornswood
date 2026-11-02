// test-3149-rank-unlock-line.js
//
// #3149. Patrick, 26 October, on his report page (B): at each rank up the
// person is told what just opened, from the same count the recipe book on K
// uses.
//
// This runs the real rules and character blocks out of game/gamemode.js in a
// sandbox, with the real recipe table, and proves:
//   A. a half's rank up adds a line naming how many recipes the new rank
//      opens and their kinds, biggest first, counted from the book's index
//   B. the line says how many of them Skyrim lists at the bench, and how many
//      carry a condition of their own, the book's open and locked
//   C. every number in it agrees with the K book's own count for that half
//   D. a class verb, a mage's school and a half with nothing at the new rank
//      get the rank line alone
//   E. a sister half raised under a Master gets the line too, and it goes
//      out through credit, the path every trade's work takes
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
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}

const RULES = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between('// ==== thornswood character ====', '// ==== end thornswood character ====');
const tableAt = src.indexOf('  var RECIPES_BY_ID = {');
const tableEnd = tableAt < 0 ? -1 : src.indexOf('\n  };\n', tableAt);
let TABLE = null;
try { TABLE = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID'); } catch (e) { TABLE = null; }
yes('the rules, the character store and the recipe table are in the gamemode', !!(RULES && CHARACTER && TABLE));
if (!(RULES && CHARACTER && TABLE)) { done(); }

function server(race) {
  const store = {};
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (key === 'profileId') { return 1000 + (id & 0xff); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); },
    getDescFromId: function (n) { return 'unknown' + n + ':Nowhere.esp'; }
  };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    notify: function () { }, say: function () { }, log: function () { },
    raceOf: function () { return race || ''; },
    RECIPES_BY_ID: TABLE
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  return { C: ctx.__thornswoodCharacter, P: ctx.__thornswoodProgression };
}

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

// What the table holds for a half at one rank, counted here on its own,
// the same way the book does: no roll rows, race rows only for that race.
function count(half, rank, race) {
  const out = { n: 0, open: 0, fams: {} };
  Object.keys(TABLE).forEach(function (k) {
    const r = TABLE[k];
    if (!r || String(r.half || '').toLowerCase() !== half || r.roll) { return; }
    if (r.race && String(race || '').indexOf(String(r.race).toLowerCase()) === -1 && race) { return; }
    if (String(r.rank || 'novice').toLowerCase() !== rank) { return; }
    out.n++;
    if (r.open === true) { out.open++; }
    const f = String(r.family || '').toLowerCase();
    out.fams[f] = (out.fams[f] || 0) + 1;
  });
  return out;
}

// ------------------------------------------------- A, B. a Platewright ---
{
  const srv = server('nord');
  const A = 0xff000201;
  make(srv, A, 'smith', 'platewright');
  const r = srv.P.creditWork(srv.C.stateOf(A), 'platewright', null, srv.P.TUNING.workPerRank.advanced);
  yes('work that reaches Advanced Platewright raises the rank', !!r.raised && r.raised.to === 'advanced');
  const line = srv.C.raiseLines(A, r) || '';
  console.log('      ' + line);
  const want = count('platewright', 'advanced', 'nord');
  yes('A the rank line still comes first', line.indexOf('You are now an Advanced Platewright.') === 0);
  yes('A then how many recipes the rank opens (' + want.n + ')',
      line.indexOf('Advanced Platewright work opens ' + want.n + ' more recipes to you: ') !== -1);
  const kinds = Object.keys(want.fams).sort(function (a, b) { return want.fams[b] - want.fams[a]; });
  yes('A every kind at that rank is named', kinds.every(function (k) { return line.indexOf(k) !== -1; }));
  yes('A the biggest kind comes first (' + kinds[0] + ')',
      line.indexOf('to you: ' + kinds[0]) !== -1 || want.fams[kinds[0]] === want.fams[kinds[1]]);
  yes('A the list reads as a sentence, the last kind after "and"', / and [a-z ]+\./.test(line));
  if (want.open < want.n) {
    yes('B how many Skyrim lists at the bench (' + want.open + ') and the rest carry a condition (' + (want.n - want.open) + ')',
        want.open === 0
          ? line.indexOf('Skyrim will not list any of them at the bench') !== -1
          : line.indexOf('Skyrim lists ' + want.open + ' of them at the bench. The other ' + (want.n - want.open)) !== -1);
    yes('B and says what such a condition is', /a perk or a spell or something you have to be holding\./.test(line));
  } else {
    yes('B every row at that rank is listed, so no second sentence', line.indexOf('Skyrim') === -1);
  }
  yes('the line carries no em dash', line.indexOf('—') === -1);

  // ------------------------------------------- C. the K book agrees ---
  const panel = srv.C.forPanel(r.state, false, A);
  const book = panel && panel.book;
  const own = book && book.halves && book.halves.filter(function (h) { return h.key === 'platewright'; })[0];
  const novice = count('platewright', 'novice', 'nord');
  yes('C the K book at Advanced holds what novice held plus what the line named (' + (novice.n + want.n) + ')',
      !!own && own.open + own.locked === novice.n + want.n);
  yes('C and its open count is novice\'s plus the line\'s (' + (novice.open + want.open) + ')',
      !!own && own.open === novice.open + want.open);
}

// ------------------------------------------------ D. nothing more said ---
{
  const srv = server('nord');
  const M = 0xff000202;
  make(srv, M, 'smith', 'platewright');
  const r = srv.P.creditWork(srv.C.stateOf(M), 'miner', null, srv.P.TUNING.workPerRank.advanced);
  const line = r.raised ? (srv.C.raiseLines(M, r) || '') : '';
  yes('D a class verb\'s rank up is the rank line alone (' + line + ')',
      !!r.raised && line === 'You are now an Advanced Miner. 1 skill point to spend, on K.');

  const G = 0xff000203;
  make(srv, G, 'mage', ['destruction', 'restoration']);
  const g = srv.P.creditWork(srv.C.stateOf(G), 'destruction', null, srv.P.TUNING.workPerRank.advanced);
  const gl = g.raised ? (srv.C.raiseLines(G, g) || '') : '';
  yes('D a school\'s rank up names no recipe (' + gl + ')', !!g.raised && gl.indexOf('recipe') === -1);

  // A half with no row at the rank reached.
  const empty = ['advanced', 'expert', 'master'].map(function (rk) {
    return ['physicker', 'blightbrewer', 'charburner', 'confectioner', 'liverywright', 'woodwright', 'bladebinder']
      .filter(function (h) { return count(h, rk, 'nord').n === 0; }).map(function (h) { return { h: h, rk: rk }; });
  }).reduce(function (a, b) { return a.concat(b); }, []);
  yes('D the table has a half with nothing at some rank', empty.length > 0);
  if (empty.length) {
    const e = empty[0];
    const profOf = { physicker: 'alchemist', blightbrewer: 'alchemist', charburner: 'woodworker', woodwright: 'woodworker',
                     confectioner: 'cook', liverywright: 'tailor', bladebinder: 'enchanter' };
    const E = 0xff000204;
    make(srv, E, profOf[e.h], e.h, function (s) {
      const order = ['novice', 'advanced', 'expert', 'master'];
      s.ranks[e.h] = order[order.indexOf(e.rk) - 1];
    });
    const er = srv.P.creditWork(srv.C.stateOf(E), e.h, null, srv.P.TUNING.workPerRank[e.rk]);
    const el = er.raised ? (srv.C.raiseLines(E, er) || '') : '';
    yes('D ' + e.h + ' reaching ' + e.rk + ' has nothing there, so the rank line alone (' + el + ')',
        !!er.raised && el.indexOf('recipe') === -1);
  }
}

// --------------------------------- E. a sister half under a Master, via credit ---
{
  const srv = server('nord');
  const S = 0xff000205;
  make(srv, S, 'smith', 'platewright');
  const master = { ranks: { edgewright: 'master' } };
  const r = srv.P.creditWork(srv.C.stateOf(S), 'edgewright', master, srv.P.TUNING.workPerRank.advanced);
  const line = r.raised ? (srv.C.raiseLines(S, r) || '') : '';
  const want = count('edgewright', 'advanced', 'nord');
  yes('E a Platewright a Master Edgewright raises to Advanced Edgewright is told what opened (' + want.n + ')',
      !!r.raised && line.indexOf('Advanced Edgewright work opens ' + want.n + ' more recipes to you: ') !== -1);

  const W = 0xff000206;
  make(srv, W, 'smith', 'edgewright', function (s) { s.work = s.work || {}; s.work.edgewright = srv.P.TUNING.workPerRank.advanced - 1; });
  let said = null;
  for (let i = 0; i < 3 && !said; i++) { said = srv.C.credit(W, 'edgewright'); }
  yes('E the line goes out through credit, the path every trade takes (' + (said || 'nothing') + ')',
      !!said && said.indexOf('Advanced Edgewright work opens ') !== -1);
}

done();
