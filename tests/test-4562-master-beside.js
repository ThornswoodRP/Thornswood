// test-4562-master-beside.js
//
//     node tests/test-4562-master-beside.js
//
// #4562. Decided 22 Oct: an apprentice climbs 1.5 times as fast while their
// master is within 10 m. The real rules, character and social blocks out of
// game/gamemode.js, over a stand-in store, and the real creditWork out of the
// class and profession gates, which every trade's work passes through.
//
//   B  beside: Eorlund, Master Platewright, takes Lina (an Edgewright) on in
//      her sister half through the real /apprentice and /yes. Her plate
//      work beside him counts 1.5 times, paid as a whole extra piece every
//      second piece; away from him, in another place, offline, in her own
//      half, or for somebody nobody took on, it counts once.
//   D  the page says so.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const read = (...bits) => fs.readFileSync(path.join(REPO, ...bits), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(text, a, b) {
  const i = text.indexOf(a);
  const j = i < 0 ? -1 : text.indexOf(b, i);
  return (i >= 0 && j >= 0) ? text.slice(i, j) : null;
}

const RULES = between(src, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between(src, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const SOCIAL = between(src, '// ==== thornswood social:', '// ==== end thornswood social ====');
const SOCIAL_CMDS = between(src, "    if (word === '/friend' || word === '/party' || word === '/mute' ||",
                            "    if (word === '/rest') {");
const WORK = between(src, 'function creditWork(actorId, key, n) {', '\nfunction economyGathered');
yes('the rules, the character and social blocks, /yes and creditWork are in the gamemode',
    !!(RULES && CHARACTER && SOCIAL && SOCIAL_CMDS && WORK));
if (!(RULES && CHARACTER && SOCIAL && SOCIAL_CMDS && WORK)) { done(); }

// ---------------------------------------------------------------- server --
const store = {};
const online = [];
const logged = [];
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
    const p = store[id] || {};
    return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
  },
  set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); }
};
const ctx = {
  mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
  isFinite: isFinite, parseInt: parseInt,
  console: { log: function () { }, error: function () { } },
  guard: function (name, fn) { return fn; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  notify: function () { }, say: function () { },
  log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); },
  spellOn: function () { return true; }, giveTool: function () { return null; }, raceOf: function () { return ''; }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(RULES, ctx);
vm.runInContext(CHARACTER, ctx);
vm.runInContext(SOCIAL, ctx);
vm.runInContext(WORK + '\nglobalThis.__work = creditWork;', ctx);
const C = ctx.__thornswoodCharacter, P = ctx.__thornswoodProgression, soc = ctx.__thornswoodSocial;
const work = ctx.__work;

function person(id, name, pid, prof, half, change) {
  store[id] = store[id] || {};
  store[id].profileId = JSON.stringify(pid);
  store[id].appearance = JSON.stringify({ name: name });
  store[id].worldOrCellDesc = JSON.stringify('town:X.esm');
  store[id].pos = JSON.stringify([0, 0, 0]);
  if (online.indexOf(id) === -1) { online.push(id); }
  let s = C.stateOf(id);
  let r = P.pickClass(s, 'miner');
  if (r.ok) { s = r.state; }
  if (prof) { r = P.pickProfession(s, prof, half); if (r.ok) { s = r.state; } }
  if (change) { change(s); }
  C.writeState(id, s);
}
function at(id, cell, pos) {
  store[id].worldOrCellDesc = JSON.stringify(cell);
  store[id].pos = JSON.stringify(pos);
}
function done_(id, key) { return P.workDone(C.stateOf(id), key); }
/* n pieces of work, one call each, as a trade hands them in; how much the count rose. */
function pieces(id, key, n) {
  const was = done_(id, key);
  for (let i = 0; i < n; i++) { work(id, key); }
  return done_(id, key) - was;
}

const EORLUND = 0xff000201, LINA = 0xff000202, SVEN = 0xff000204;
person(EORLUND, 'Eorlund', 201, 'smith', 'platewright', function (s) { s.ranks.platewright = 'master'; });
person(LINA, 'Lina', 202, 'smith', 'edgewright');
person(SVEN, 'Sven', 204, 'smith', 'edgewright');

// Eorlund takes Lina on in Platewright, her sister half, the way K's button and her prompt do.
C.command('/apprentice', ['/apprentice', LINA.toString(16), 'platewright'], EORLUND, 201, function () { });
new Function('globalThis', 'actorId', 'profileId', 'parts', 'word', 'toProfile', 'say', 'notify', 'journalCommand', SOCIAL_CMDS)(
  ctx, LINA, 202, ['/yes'], '/yes', function () { }, function () { }, function () { }, function () { });
yes('B0 Lina has Eorlund as her Master in Platewright', !!C.masterFor(LINA, C.stateOf(LINA), 'platewright'));
yes('B0 the character block hands out masterBeside and its numbers', typeof C.masterBeside === 'function' &&
    !!C.BESIDE && C.BESIDE.times === 1.5 && C.BESIDE.reach === 700);
if (typeof C.masterBeside !== 'function') { done(); }

// B1: beside him, about 4 m away in the same place.
at(LINA, 'town:X.esm', [300, 0, 0]);
yes('B1 the character block says her plate work is beside her master', C.masterBeside(LINA, 'platewright') === 'platewright');
yes('B1 ten pieces of plate beside him count fifteen', pieces(LINA, 'platewright', 10) === 15);
yes('B2 one piece counts one and banks the half, the next counts two',
    pieces(LINA, 'platewright', 1) === 1 && pieces(LINA, 'platewright', 1) === 2);

// B3: just past 10 m.
at(LINA, 'town:X.esm', [701, 0, 0]);
yes('B3 just past 10 m it counts once', C.masterBeside(LINA, 'platewright') === '' && pieces(LINA, 'platewright', 4) === 4);
// B4: right on 10 m.
at(LINA, 'town:X.esm', [700, 0, 0]);
yes('B4 at 10 m it is beside', pieces(LINA, 'platewright', 2) === 3);
// B5: the same spot in another place.
at(LINA, 'inn:X.esm', [0, 0, 0]);
yes('B5 in another place it counts once', pieces(LINA, 'platewright', 4) === 4);
// B6: back beside him, but he is not in the world.
at(LINA, 'town:X.esm', [100, 0, 0]);
online.splice(online.indexOf(EORLUND), 1);
yes('B6 while he is not in the world it counts once', pieces(LINA, 'platewright', 4) === 4);
online.push(EORLUND);
// B7: her own half is not his to speed.
yes('B7 her own Edgewright work beside him counts once', C.masterBeside(LINA, 'edgewright') === '' &&
    pieces(LINA, 'edgewright', 4) === 4);
// B8: somebody nobody took on, beside a Master.
at(SVEN, 'town:X.esm', [100, 0, 0]);
yes('B8 somebody he never took on counts once beside him', C.masterBeside(SVEN, 'platewright') === '' &&
    pieces(SVEN, 'edgewright', 4) === 4);
// B9: once he ends it, she counts once beside him.
C.command('/apprentice', ['/apprentice', 'end', LINA.toString(16), 'platewright'], EORLUND, 201, function () { });
yes('B9 once he ends it, her plate work beside him counts once',
    !C.masterFor(LINA, C.stateOf(LINA), 'platewright') && pieces(LINA, 'platewright', 4) === 4);
yes('B10 nothing was logged as going wrong', logged.length === 0);

// ------------------------------------------------------------------ page --
{
  const page = read('docs', 'systems', 'apprenticeship.md').replace(/\s+/g, ' ');
  yes('D1 apprenticeship.md says work beside your master within 10 metres counts 1.5 times',
      /within 10 metres of you, in the same place, counts 1\.5 times/.test(page));
}

done();
