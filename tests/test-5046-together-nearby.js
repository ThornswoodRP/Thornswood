// test-5046-together-nearby.js
//
//     node tests/test-5046-together-nearby.js
//
// #5046: the party's work share, the party panel's count and a bard's rest
// bonus counted somebody as with you when their worldOrCellDesc matched
// yours. Indoors that is one building or cave; outdoors it is the whole
// worldspace, so two people a hold apart in Tamriel were "together". Now
// together() in the social block says: the same interior, or outdoors in the
// same worldspace within nearReach (the Near you list's reach), and the
// party bonus and the needs block's bardNear both ask it.
//
// This runs the REAL social block and the REAL creditWork out of
// game/gamemode.js over two people in one party. Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8')).split(String.fromCharCode(13)).join('');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
function between(a, b) {
  const i = src.indexOf(a); if (i < 0) { return null; }
  const k = src.indexOf(b, i); if (k < 0) { return null; }
  return src.slice(i, k + b.length);
}
const SOCIAL = between('// ==== thornswood social:', '// ==== end thornswood social ====');
const NEEDS = between('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const WORK = between('function creditWork(actorId, key, n) {', 'const PARTY_BANK = {};');
yes('the social block, the needs block and creditWork are in gamemode.js', !!SOCIAL && !!NEEDS && !!WORK);
if (!SOCIAL || !NEEDS || !WORK) { done(); return; }

const bard = between('function bardNear(actorId, savedOnly) {', '\n    return false;\n  }');
yes('bardNear asks the social block who is together', !!bard && bard.indexOf('soc.together(actorId, who)') >= 0);
yes('bardNear no longer compares the cell description alone', !!bard && bard.indexOf('worldOrCellDesc') < 0);

const TAMRIEL = '3c:Skyrim.esm', INN = '1605e:Skyrim.esm';
const store = {};
const online = [];
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
    const p = store[id] || {};
    return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
  },
  set: function (id, key, value) { (store[id] = store[id] || {})[key] = JSON.stringify(value); }
};
const credited = [];
const ctx = {
  mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
  isFinite: isFinite, parseInt: parseInt,
  WORLDSPACES: new Set([TAMRIEL]),
  console: { log: function () { }, error: function () { } },
  guard: function (name, fn) { return fn; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  notify: function () { }, say: function () { }, log: function () { }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(SOCIAL, ctx);
ctx.__thornswoodCharacter = { credit: function (id, key) { credited.push(key); return null; } };
vm.runInContext(WORK + '\nconst MASTER_BANK = {};\nglobalThis.__work = creditWork;', ctx);
const soc = ctx.__thornswoodSocial;
yes('the social block offers together', !!soc && typeof soc.together === 'function');
if (!soc || typeof soc.together !== 'function') { done(); return; }

const A = 0xff000301, B = 0xff000302;
function person(id, pid) {
  store[id] = { profileId: JSON.stringify(pid), appearance: JSON.stringify({ name: 'P' + pid }) };
  online.push(id);
}
function at(id, cell, pos) {
  store[id].worldOrCellDesc = JSON.stringify(cell);
  store[id].pos = JSON.stringify(pos);
}
person(A, 301);
person(B, 302);
soc.parties.p1 = { id: 'p1', leader: 301, members: [301, 302] };
soc.inParty[301] = 'p1';
soc.inParty[302] = 'p1';

function share(n) {
  credited.length = 0;
  for (let i = 0; i < n; i++) { ctx.__work(A, 'mine'); }
  return credited.length;
}

// Outdoors, a hold apart: the same worldspace, 60,000 units away.
at(A, TAMRIEL, [0, 0, 0]);
at(B, TAMRIEL, [60000, 0, 0]);
yes('two people a hold apart outdoors are not together', !soc.together(A, B));
yes('the party panel counts nobody with you', soc.partyNear(A) === 0);
yes('the party bonus pays nothing extra for 14 pieces apart', share(14) === 14);

// Outdoors, side by side.
at(B, TAMRIEL, [300, 0, 0]);
yes('two people side by side outdoors are together', soc.together(A, B));
yes('the party panel counts one with you', soc.partyNear(A) === 1);
yes('the party bonus pays two extra for 14 pieces together', share(14) === 16);

// Outdoors, just inside and just outside the Near you reach.
at(B, TAMRIEL, [2599, 0, 0]);
yes('2599 units apart outdoors is together', soc.together(A, B));
at(B, TAMRIEL, [2601, 0, 0]);
yes('2601 units apart outdoors is not', !soc.together(A, B));

// Indoors, the same interior counts however far across it.
at(A, INN, [0, 0, 0]);
at(B, INN, [5000, 0, 0]);
yes('the same interior is together, however far across', soc.together(A, B));

// One inside and one out is not.
at(B, TAMRIEL, [0, 0, 0]);
yes('one inside and one outside are not together', !soc.together(A, B));
done();
