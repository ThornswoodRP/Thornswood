// test-1388-apprentice.js
//
// #1388, and #1147 under it. docs/systems/apprenticeship.md: a Master takes
// somebody on and can end it, and nobody is owed one. The sister half past
// novice needs a Master of that half and does not use one of the two outside
// trades. An outside trade is a novice list, twice in a life, and it never
// climbs. Work done while taken on is counted with the Master handed in, so a
// sister half rises past the threshold it waited at.
//
// Traps from the issue: smelting and tanning are not the two outside trades,
// and a taught novice never makes the expert list.
//
// This runs the real blocks out of game/gamemode.js in one sandbox over a fake
// mp that keeps properties as JSON the way the server does: the rules, the
// character store and its commands, the social block (the offer and the
// prompt), the chat block's /yes branch, and the real craft gate. A second
// server over the same store is a restart.
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}
const party = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-party.js'), 'utf8').split(CR).join('');
const page = fs.readFileSync(path.join(REPO, 'docs', 'systems', 'apprenticeship.md'), 'utf8').split(CR).join('');

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
const SOCIAL = between('// ==== thornswood social:', '// ==== end thornswood social ====');
const SOCIAL_CMDS = between("    if (word === '/friend' || word === '/party' || word === '/mute' ||",
                            "    if (word === '/rest') {");
const GATE_PARTS = [
  take('function craftAnswer(actorId, row) {'),
  take('function raceGate(actorId, row) {'),
  take('var RACE_CALLED = {', '\n};\n'),
  take('function professionName(prof) {'),
  take('function aWord(name) {'),
  take('function rankWord(rank) {')
];
const ok = RULES && CHARACTER && SOCIAL && SOCIAL_CMDS && GATE_PARTS.every(function (p) { return p !== null; });
yes('the rules, the character store, the social block, the /yes branch and the craft gate are in the gamemode', !!ok);
if (!ok) { done(); }

const tableAt = src.indexOf('  var RECIPES_BY_ID = {');
const tableEnd = tableAt < 0 ? -1 : src.indexOf('\n  };\n', tableAt);
let TABLE = {};
try { TABLE = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID'); } catch (e) { TABLE = {}; }
const ROW = {
  plateNovice: TABLE['dca04:Skyrim.esm'],      // Leather Helmet
  plateAdvanced: TABLE['f6f2a:Skyrim.esm'],    // Steel Shin Boots
  plateExpert: TABLE['dd97a:Skyrim.esm'],      // Dwarven Armor
  cookNovice: TABLE['f4317:Skyrim.esm'],       // Venison Stew
  cookAdvanced: TABLE['f4318:Skyrim.esm'],     // Tomato Soup
  cookExpert: TABLE['f431a:Skyrim.esm'],       // Cabbage Potato Soup
  ironIngot: TABLE['a30c3:Skyrim.esm'],        // the smelt that stays (#1400)
  leather: TABLE['1033de:Skyrim.esm']          // the tanning that stays (#1400)
};
yes('the recipe rows this test crafts are in the table',
    Object.keys(ROW).every(function (k) { return !!ROW[k]; }) &&
    ROW.plateAdvanced.rank === 'advanced' && ROW.plateExpert.rank === 'expert' &&
    ROW.cookNovice.half === 'Hearthcook' && ROW.cookExpert.rank === 'expert');

/* One server process over a store; a second one over the same store is a restart. */
function server(store, online, gone) {
  const said = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (gone.indexOf(id) !== -1) { throw new Error('no form ' + id); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) {
      if (gone.indexOf(id) !== -1) { throw new Error('no form ' + id); }
      (store[id] = store[id] || {})[key] = JSON.stringify(value);
    }
  };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    isFinite: isFinite, parseInt: parseInt,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    notify: function (id, m) { said.push({ id: id, text: m, how: 'notify' }); },
    say: function (id, m) { said.push({ id: id, text: m, how: 'chat' }); },
    log: function () { },
    spellOn: function () { return true; },
    giveTool: function () { return null; },
    raceOf: function () { return ''; },
    RECIPES_BY_ID: TABLE
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  vm.runInContext(SOCIAL, ctx, { filename: 'gamemode.js social' });
  vm.runInContext(GATE_PARTS[4], ctx, { filename: 'gamemode.js aWord' });
  const gate = new Function('globalThis', 'log', 'raceOf', 'NO_PROFESSION_AT_A_BENCH',
                            GATE_PARTS.join('\n') + '\nreturn craftAnswer;')(
    ctx, function () { }, function () { return ''; }, 'no profession');
  const C = ctx.__thornswoodCharacter;
  const soc = ctx.__thornswoodSocial;
  function told(actor) {
    return said.filter(function (x) { return x.id === actor && x.how === 'chat'; }).map(function (x) { return x.text; });
  }
  return {
    ctx: ctx, said: said, C: C, P: ctx.__thornswoodProgression, soc: soc, told: told,
    craft: function (actor, row) { return gate(actor, row); },
    /** A typed command through the character block, as handle() hands it on. */
    type: function (actor, text) {
      said.length = 0;
      const parts = text.trim().split(/\s+/);
      const pid = soc.profileOf(actor);
      const handled = C.command(parts[0], parts, actor, pid, function (p, m) { said.push({ id: actor, text: m, how: 'chat' }); });
      return handled ? told(actor) : null;
    },
    /** /yes or /no through the chat block's real branch. */
    answer: function (actor, text) {
      said.length = 0;
      const parts = text.trim().split(/\s+/);
      new Function('globalThis', 'actorId', 'profileId', 'parts', 'word',
                   'toProfile', 'say', 'notify', 'journalCommand', SOCIAL_CMDS)(
        ctx, actor, soc.profileOf(actor), parts, parts[0],
        function (p, m) { said.push({ id: soc.actorForProfile(p), text: m, how: 'chat' }); },
        function (to, m) { said.push({ id: to, text: m, how: 'chat' }); }, function () { }, function () { });
      return said.slice();
    }
  };
}

const store = {};
const online = [];
const gone = [];
function person(srv, id, name, pid, cls, prof, half, change) {
  store[id] = store[id] || {};
  store[id].profileId = JSON.stringify(pid);
  store[id].appearance = JSON.stringify({ name: name });
  store[id].worldOrCellDesc = JSON.stringify('town:X.esm');
  store[id].pos = JSON.stringify([0, 0, 0]);
  if (online.indexOf(id) === -1) { online.push(id); }
  let s = srv.C.stateOf(id);
  let r = srv.P.pickClass(s, cls || 'miner');
  if (r.ok) { s = r.state; }
  if (prof) {
    r = srv.P.pickProfession(s, prof, half);
    if (r.ok) { s = r.state; }
  }
  if (change) { change(s); }
  srv.C.writeState(id, s);
  return id;
}
function st(srv, id) { return srv.C.stateOf(id); }
function work(srv, id, key, n) {
  let line = null;
  for (let i = 0; i < n; i++) { line = srv.C.credit(id, key) || line; }
  return line;
}

let srv = server(store, online, gone);
const P = srv.P;
const L = P.TABLE.limits;

// ------------------------------------------------------------ A. the rules --
{
  const edge = P.pickProfession(P.fresh(), 'smith', 'edgewright').state;
  const cook = P.pickProfession(P.fresh(), 'cook', 'hearthcook').state;
  const mPlate = { prof: 'smith', half: 'platewright', ranks: { platewright: 'master', edgewright: 'novice' } };
  const mEdge = { prof: 'smith', half: 'edgewright', ranks: { edgewright: 'master', platewright: 'novice' } };
  const mCook = { prof: 'cook', half: 'hearthcook', ranks: { hearthcook: 'master', confectioner: 'master' } };
  const who = { id: 7, name: 'Eorlund', at: 1 };

  const t = P.takeOn(edge, mPlate, 'platewright', who);
  yes('A1: a Master Platewright takes an Edgewright on in the sister half, and it is recorded',
      t.ok && t.state.masters.platewright.id === 7 && P.rankOf(t.state, 'platewright') === 'novice');
  yes('A1: the sister half does not use an outside trade', t.ok && t.state.taught.length === 0);
  yes('A1: a Master of the other half cannot take them on in it',
      !P.takeOn(edge, mEdge, 'platewright', who).ok);
  yes('A1: their own half is not taken on, it climbs on their own work',
      /their own half/.test(P.takeOn(edge, mEdge, 'edgewright', who).why || ''));
  yes('A1: somebody with no profession is refused',
      !P.takeOn(P.fresh(), mPlate, 'platewright', who).ok);
  yes('A1: a half of another profession is not a sister half',
      !P.takeOn(cook, mPlate, 'platewright', who).ok);
  yes('A1: a second Master in the same half is refused while one stands',
      !P.takeOn(t.state, mPlate, 'platewright', who).ok);

  const own = P.teach(edge, mPlate, 'platewright', who);
  yes('A2: a Master of their own profession cannot use the outside trade rules, and says so (' + own.why + ')',
      !own.ok && /outside trade/.test(own.why));
  const a = P.teach(edge, mCook, 'hearthcook', who);
  const b = a.ok ? P.teach(a.state, mCook, 'confectioner', who) : a;
  yes('A2: a Master Cook teaches a Smith two outside trades, each at novice',
      a.ok && b.ok && P.rankOf(b.state, 'hearthcook') === 'novice' && P.rankOf(b.state, 'confectioner') === 'novice' &&
      b.state.masters.hearthcook.id === 7);
  const mChar = { prof: 'woodworker', half: 'charburner', ranks: { charburner: 'master' } };
  const third = b.ok ? P.teach(b.state, mChar, 'charburner', who) : { ok: true };
  yes('A2: a third outside trade is refused (' + third.why + ')', !third.ok && /2 outside trades/.test(third.why));
  yes('A2: a Master Edgewright cannot teach plate', !P.teach(cook, mEdge, 'platewright', who).ok);

  const endA = P.release(b.state, 'hearthcook', 7);
  yes('A3: ending an outside trade takes its novice list away and keeps it counted',
      endA.ok && endA.ended === 'outside' && !P.rankOf(endA.state, 'hearthcook') &&
      endA.state.taught.indexOf('hearthcook') === -1 && endA.state.untaught.indexOf('hearthcook') !== -1);
  const after = endA.ok ? P.teach(endA.state, mChar, 'charburner', who) : { ok: true };
  yes('A3: ending one does not open a third', !after.ok);
  yes('A3: only the Master on the record can end it', !P.release(b.state, 'hearthcook', 8).ok);
  const endS = P.release(t.state, 'platewright', 7);
  yes('A3: ending the sister half keeps the rank and the half', endS.ok && endS.ended === 'sister' &&
      P.rankOf(endS.state, 'platewright') === 'novice' && !endS.state.masters.platewright);

  // The ladder: waiting without a Master, climbing with one, never for a taught half.
  let s = edge;
  for (let i = 0; i < 140; i++) { s = P.creditWork(s, 'platewright', null).state; }
  yes('A4: without a Master the sister half count waits at the threshold (' + P.workDone(s, 'platewright') + ')',
      P.rankOf(s, 'platewright') === 'novice' && P.workDone(s, 'platewright') === 100);
  const up = P.creditWork(s, 'platewright', mPlate);
  yes('A4: with the Master handed in, the next piece raises it to Advanced and hands a skill point',
      up.ok && up.raised && up.raised.to === 'advanced' && up.raised.points > 0);
  let taught = a.state;
  for (let i = 0; i < 400; i++) { taught = P.creditWork(taught, 'hearthcook', mCook).state; }
  yes('A4: a taught half never climbs, even with its Master handed in', P.rankOf(taught, 'hearthcook') === 'novice' &&
      P.workDone(taught, 'hearthcook') === 100);
  yes('A4: and a taught novice never makes the expert list', !P.canWork(taught, 'hearthcook', 'expert') &&
      !P.canWork(taught, 'hearthcook', 'advanced') && P.canWork(taught, 'hearthcook', 'novice'));
}

// --------------------------------------------- B. the sister half, in game --
const MASTER = 0xff000101, LINA = 0xff000102, EDGE2 = 0xff000103;
person(srv, MASTER, 'Eorlund', 101, 'miner', 'smith', 'platewright', function (s) { s.ranks.platewright = 'master'; });
person(srv, LINA, 'Lina', 102, 'miner', 'smith', 'edgewright');
person(srv, EDGE2, 'Bryn', 103, 'miner', 'smith', 'edgewright');

work(srv, LINA, 'platewright', 130);
yes('B1: Lina\'s sister half count waits at 100 with nobody taking her on',
    P.rankOf(st(srv, LINA), 'platewright') === 'novice' && P.workDone(st(srv, LINA), 'platewright') === 100);
let lines = srv.type(LINA, '/apprentice');
yes('B1: /apprentice on its own says the sister half waits for a Master (' + lines.join(' ') + ')',
    /Platewright, your sister half, waits at novice until a Master of it takes you on/.test(lines.join(' ')) &&
    /0 of your 2 outside trades used/.test(lines.join(' ')));
lines = srv.type(LINA, '/apprentice Bryn');
yes('B1: nobody is owed one: somebody who is not a Master cannot take anybody on (' + lines.join(' ') + ')',
    /Only a Master takes anybody on/.test(lines.join(' ')) && !srv.soc.standingOffer(103));

lines = srv.type(MASTER, '/apprentice Lina');
yes('B2: a Master offers with /apprentice <name>, and is told it is asked (' + lines.join(' ') + ')',
    /Asked Lina to be your apprentice in Platewright/.test(lines.join(' ')));
const offer = srv.soc.standingOffer(102);
yes('B2: the offer stands on Lina\'s prompt as an apprentice offer for the Platewright half',
    !!offer && offer.kind === 'apprentice' && offer.half === 'platewright' && offer.master === MASTER &&
    srv.soc.view(LINA).offer.kind === 'apprentice');
yes('B2: Lina is told what it is and that it costs no outside trade',
    srv.said.some(function (x) { return x.id === LINA && /your sister half/.test(x.text) && /not one of your two outside trades/.test(x.text); }));
yes('B2: nothing is recorded before she says yes', !(st(srv, LINA).masters || {}).platewright);

srv.answer(LINA, '/yes');
yes('B3: Lina says yes and both sides are recorded',
    st(srv, LINA).masters.platewright.id === MASTER &&
    (st(srv, MASTER).apprentices || []).some(function (r) { return r.id === LINA && r.half === 'platewright' && r.kind === 'sister'; }));
yes('B3: Eorlund is told', srv.said.some(function (x) { return x.id === MASTER && /Lina is your apprentice in Platewright/.test(x.text); }));
yes('B3: the outside trades are untouched', st(srv, LINA).taught.length === 0);

const pointsWas = st(srv, LINA).points || 0;
let line = srv.C.credit(LINA, 'platewright');
yes('B4: the next piece of real work raises the sister half past the stuck threshold (' + line + ')',
    P.rankOf(st(srv, LINA), 'platewright') === 'advanced' && /Advanced Platewright/.test(line || '') &&
    (st(srv, LINA).points || 0) === pointsWas + 1);
yes('B4: an advanced Platewright piece is made now', !srv.craft(LINA, ROW.plateAdvanced).refusal);
const exp = srv.craft(LINA, ROW.plateExpert).refusal || '';
yes('B4: an expert piece is not, and the line says rank comes from the work (' + exp + ')',
    /A Master took you on in it, so rank comes from doing the work/.test(exp));

// A restart: the agreement is on both characters, not in memory.
srv = server(store, online, gone);
work(srv, LINA, 'platewright', 250);
yes('B5: after a restart the Master still counts, and 250 more pieces make her Expert',
    P.rankOf(st(srv, LINA), 'platewright') === 'expert');

lines = srv.type(MASTER, '/apprentice end Lina');
yes('B6: /apprentice end <name> ends it (' + lines.join(' ') + ')',
    /You ended Lina's apprenticeship in Platewright/.test(lines.join(' ')) &&
    !(st(srv, LINA).masters || {}).platewright && !(st(srv, MASTER).apprentices || []).length);
yes('B6: Lina is told the ranks she earned stay', srv.said.some(function (x) {
  return x.id === LINA && /ended your apprenticeship in Platewright/.test(x.text) && /ranks you earned in it stay/.test(x.text);
}));
work(srv, LINA, 'platewright', 700);
yes('B6: the rank she earned stays and the count waits at the next threshold again (' +
    P.workDone(st(srv, LINA), 'platewright') + ')',
    P.rankOf(st(srv, LINA), 'platewright') === 'expert' && P.workDone(st(srv, LINA), 'platewright') === 600);
yes('B6: an expert piece is still hers', !srv.craft(LINA, ROW.plateExpert).refusal);

// The Master's side decides: ended there, or the Master's character gone, and nothing is handed in.
srv.type(MASTER, '/apprentice Bryn');
srv.answer(EDGE2, '/yes');
yes('B7: Bryn is taken on', !!srv.C.masterFor(EDGE2, st(srv, EDGE2), 'platewright'));
const m = st(srv, MASTER);
m.apprentices = [];
srv.C.writeState(MASTER, m);
yes('B7: a record the Master\'s side no longer lists hands nothing in', !srv.C.masterFor(EDGE2, st(srv, EDGE2), 'platewright'));
const m2 = st(srv, MASTER);
m2.apprentices = [{ id: EDGE2, name: 'Bryn', half: 'platewright', at: 1 }];
srv.C.writeState(MASTER, m2);
gone.push(MASTER);
work(srv, EDGE2, 'platewright', 130);
yes('B7: a Master whose character is gone hands nothing in, and the count waits',
    P.rankOf(st(srv, EDGE2), 'platewright') === 'novice' && P.workDone(st(srv, EDGE2), 'platewright') === 100);
const brynLine = srv.craft(EDGE2, ROW.plateAdvanced).refusal || '';
yes('B7: and the craft gate says a Master can take him on, not that one has, and names no command (' + brynLine + ')',
    /A Master Platewright can take you on, from the prompt they see when they look at you/.test(brynLine) &&
    !/\/apprentice/.test(brynLine));
gone.length = 0;
const bryn = st(srv, EDGE2);
bryn.masters = {};
srv.C.writeState(EDGE2, bryn);
lines = srv.type(MASTER, '/apprentice end Bryn');
yes('B8: ending a row whose person no longer names you only clears your list, and says so (' + lines.join(' ') + ')',
    /You took Bryn off your list/.test(lines.join(' ')) && !(st(srv, MASTER).apprentices || []).length &&
    !srv.said.some(function (x) { return x.id === EDGE2; }));

// ------------------------------------------------ C. outside trades, in game --
const CHEF = 0xff000111, SMITH = 0xff000112, KILN = 0xff000113, MAGE = 0xff000114, MAGE2 = 0xff000115;
person(srv, CHEF, 'Hroki', 111, 'farmer', 'cook', 'hearthcook', function (s) { s.ranks.hearthcook = 'master'; s.ranks.confectioner = 'master'; });
person(srv, SMITH, 'Sven', 112, 'miner', 'smith', 'edgewright');
person(srv, KILN, 'Ash', 113, 'gatherer', 'woodworker', 'charburner', function (s) { s.ranks.charburner = 'master'; });
person(srv, MAGE, 'Tolfdir', 114, 'gatherer', 'mage', ['destruction', 'alteration'], function (s) { s.ranks.destruction = 'master'; });
person(srv, MAGE2, 'Onmund', 115, 'gatherer', 'mage', ['restoration', 'illusion']);

// Smelting and tanning are a smith's anyway, and cost no outside trade.
yes('C1: an Edgewright smelts the iron ingot and tans the leather with nobody teaching them',
    !srv.craft(SMITH, ROW.ironIngot).refusal && !srv.craft(SMITH, ROW.leather).refusal);
work(srv, SMITH, 'platewright', 3);
yes('C1: smelting and tanning are not the two outside trades: none is used',
    st(srv, SMITH).taught.length === 0 && !(st(srv, SMITH).untaught || []).length);

lines = srv.type(CHEF, '/apprentice Sven');
yes('C2: a Master of two halves is asked which (' + lines.join(' ') + ')',
    /Hearthcook or Confectioner/.test(lines.join(' ')) && !srv.soc.standingOffer(112));
lines = srv.type(CHEF, '/apprentice Sven hearthcook');
yes('C2: with the half named, the offer stands', !!srv.soc.standingOffer(112) && srv.soc.standingOffer(112).half === 'hearthcook');
yes('C2: Sven is told it is one of two for life', srv.said.some(function (x) {
  return x.id === SMITH && /one of your two outside trades for life/.test(x.text);
}));
srv.answer(SMITH, '/no');
yes('C2: /no records nothing', st(srv, SMITH).taught.length === 0 && !srv.soc.standingOffer(112));

srv.type(CHEF, '/apprentice Sven hearthcook');
srv.answer(SMITH, '/yes');
yes('C3: Sven says yes and holds novice Hearthcook, taught by Hroki',
    st(srv, SMITH).taught.indexOf('hearthcook') !== -1 && P.rankOf(st(srv, SMITH), 'hearthcook') === 'novice' &&
    st(srv, SMITH).masters.hearthcook.id === CHEF);
yes('C3: the novice list is his', !srv.craft(SMITH, ROW.cookNovice).refusal);
work(srv, SMITH, 'hearthcook', 300);
yes('C3: the count sits at the novice ceiling and never raises the rank, however long',
    P.rankOf(st(srv, SMITH), 'hearthcook') === 'novice' && P.workDone(st(srv, SMITH), 'hearthcook') === 100);
yes('C3: a taught novice never makes the advanced or the expert list',
    !!srv.craft(SMITH, ROW.cookAdvanced).refusal && !!srv.craft(SMITH, ROW.cookExpert).refusal);

lines = srv.type(CHEF, '/apprentice Sven');
yes('C4: with Hearthcook known, the only half left is offered without asking (' + lines.join(' ') + ')',
    /in Confectioner/.test(lines.join(' ')) && srv.soc.standingOffer(112).half === 'confectioner');
srv.answer(SMITH, '/yes');
lines = srv.type(KILN, '/apprentice Sven');
yes('C4: a third outside trade is refused, and says it is two in a life (' + lines.join(' ') + ')',
    /2 outside trades, and that is all there is in a life/.test(lines.join(' ')) && !srv.soc.standingOffer(112));

lines = srv.type(CHEF, '/apprentice end Sven');
yes('C5: a Master with the same person in two halves is asked which, on K and not by typing (' + lines.join(' ') + ')',
    /Each has its own End on K/.test(lines.join(' ')) && !/\/apprentice/.test(lines.join(' ')) &&
    st(srv, SMITH).taught.length === 2);
lines = srv.type(CHEF, '/apprentice end Sven hearthcook');
yes('C5: ending it takes the novice list away (' + lines.join(' ') + ')',
    st(srv, SMITH).taught.indexOf('hearthcook') === -1 && !P.rankOf(st(srv, SMITH), 'hearthcook') &&
    !!srv.craft(SMITH, ROW.cookNovice).refusal);
yes('C5: Sven is told it still counts', srv.said.some(function (x) {
  return x.id === SMITH && /novice list is gone/.test(x.text) && /still counts as one of your two outside trades/.test(x.text);
}));
lines = srv.type(KILN, '/apprentice Sven');
yes('C5: and it does not open a third (' + lines.join(' ') + ')', /2 outside trades/.test(lines.join(' ')) && !srv.soc.standingOffer(112));
lines = srv.type(SMITH, '/apprentice');
yes('C5: /apprentice says so from his side (' + lines.join(' ') + ')',
    /2 of your 2 outside trades used in this life/.test(lines.join(' ')) && /Hroki taught you novice Confectioner/.test(lines.join(' ')));

// Inside one profession the outside trade rules refuse, and say so.
lines = srv.type(MAGE, '/apprentice Onmund destruction');
yes('C6: a Master mage cannot teach another mage a school as an outside trade (' + lines.join(' ') + ')',
    /own profession/.test(lines.join(' ')) && !srv.soc.standingOffer(115));

// The mage's non-mage rules still stand on teach: one school, two novice spells from the tome.
const SMITH2 = 0xff000116;
person(srv, SMITH2, 'Gerd', 116, 'miner', 'smith', 'platewright');
srv.type(MAGE, '/apprentice Gerd');
const gerdHeard = srv.answer(SMITH2, '/yes');
const g2 = st(srv, SMITH2);
yes('C7: a Master mage teaches a Smith one school through the same command, and the non-mage rules hold',
    g2.taught.indexOf('destruction') !== -1 && P.schoolsOf(g2).join() === 'destruction' &&
    P.placesLeft(g2) === L.outsiderSpells && P.spellPoints(g2) === 0 &&
    gerdHeard.some(function (x) { return x.id === SMITH2 && /learn 2 novice spells of it, each from its tome/.test(x.text); }));

// #1147's own case: a Master Bladebinder teaching a Smith, through the command.
const BINDER = 0xff000118, SMITH4 = 0xff000119;
person(srv, BINDER, 'Enthir', 118, 'gatherer', 'enchanter', 'bladebinder', function (s) { s.ranks.bladebinder = 'master'; });
person(srv, SMITH4, 'Hilde', 119, 'miner', 'smith', 'edgewright');
lines = srv.type(BINDER, '/apprentice Hilde');
srv.answer(SMITH4, '/yes');
const h4 = st(srv, SMITH4);
yes('C9: a Master Bladebinder teaches a Smith Bladebinder through /apprentice: novice, taught, and the non-Enchanter staff places',
    h4.taught.indexOf('bladebinder') !== -1 && P.rankOf(h4, 'bladebinder') === 'novice' &&
    P.staffTaught(h4) && P.staffPoints(h4) === L.outsiderSpells && h4.masters.bladebinder.id === BINDER);

// The answer is checked again when it lands.
const SMITH3 = 0xff000117;
person(srv, SMITH3, 'Ulla', 117, 'miner', 'smith', 'platewright');
srv.type(CHEF, '/apprentice Ulla hearthcook');
const u = st(srv, SMITH3);
u.taught = ['charburner', 'woodwright'];
srv.C.writeState(SMITH3, u);
const ans = srv.answer(SMITH3, '/yes');
yes('C8: an offer that no longer holds when it is answered writes nothing, and the Master is told why',
    st(srv, SMITH3).taught.indexOf('hearthcook') === -1 &&
    ans.some(function (x) { return x.id === CHEF && /2 outside trades/.test(x.text); }));

// ------------------------------------------------ D. the words and the page --
{
  const words = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  const pwords = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  const W = words ? new Function('return ' + words[1])() : [];
  const PW = pwords ? new Function('return ' + pwords[1])() : [];
  // #1634: the look prompt and K send it, and nobody is told to type it.
  yes('D1: the server answers /apprentice, and it is not in the list named to everybody (#1634)',
      W.indexOf('/apprentice') !== -1 && PW.indexOf('/helpme') !== -1 && PW.indexOf('/apprentice') === -1);
  // The help is a panel since #1633: its Work topic, as a fresh install reads it.
  const h = helpTopic('work');
  yes('D1: the help panel\'s Work says a Master takes you on from the prompt and K lists it, and names no /apprentice (#1634)',
      !!h && !/\/apprentice/.test(h) && /presses K when the prompt names it/.test(h) && /K lists who took you on/.test(h));
  yes('D2: the prompt on P says what an apprentice offer is',
      /kind === 'apprentice'\) \{ return 'offers to take you on as an apprentice\.'; \}/.test(party) &&
      /data\.offer\.kind === 'apprentice' \? 'offers to take you on as an apprentice'/.test(party));
  yes('D3: the page names the prompt row and K, no command, and no longer says nothing calls teach (#1634)',
      !/\/apprentice/.test(page) && /Take on as apprentice/.test(page) && /Masters and apprentices page/.test(page) &&
      !/nothing in the world calls it/.test(page));
  yes('D3: every rank still rises through rankUp: the character block writes no rank itself',
      !/\.ranks\[[^\]]+\]\s*=/.test(CHARACTER.slice(CHARACTER.indexOf('MASTERS AND APPRENTICES'), CHARACTER.indexOf('/** /apprentice, every form of it.'))));
}

done();
