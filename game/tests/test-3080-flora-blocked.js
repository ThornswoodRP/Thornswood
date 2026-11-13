// test-3080-flora-blocked.js
//
//     node game/tests/test-3080-flora-blocked.js
//
// #3080 half A: somebody who may not pick a plant never starts the pick.
//
// The fork's client blocks activation on Flora and Tree (dealWithRef in
// skymp5-client/src/extensions/objectReferenceEx.ts), so a press only sends
// the activation and the server answers it. A refused press changes nothing on
// the presser's machine, which is why putBack(), PUTBACK_PROPERTY, its four
// second timer and floraHanded() are gone. An allowed press is shown picked on
// the presser's machine through PICKED_PROPERTY, decided by whether their
// pack grew, never by the sentence.
//
// This replaces test-putback-flora.js. It reads game/gamemode.js and runs the
// lifted functions against a fake mp. The fork half reads the pinned
// engine/skymp when it is checked out (git submodule update --init
// engine/skymp); without it that half says SKIP, as test-2483-kept-npcs.js
// does, and THORNSWOOD_FORK_REQUIRED=1 makes a missing fork a failure.
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function liftFn(name) {
  const a = src.indexOf('\nfunction ' + name + '(');
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(a + 1, i + 1); } }
  }
  return null;
}

function cut(from, end) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b + end.length);
}

// ---- nothing of the put-back is left -------------------------------------

yes('putBack() is gone', !/\nfunction putBack\(/.test(src));
yes('PUTBACK_PROPERTY is gone', !/PUTBACK_PROPERTY/.test(src));
yes('floraHanded() is gone, nothing reads a sentence to decide a pick', !/floraHanded/.test(src));
yes('no thornswoodPutBack property is made', !/thornswoodPutBack/.test(src));
yes('the old harness is gone',
    !fs.existsSync(path.join(__dirname, 'test-putback-flora.js')));

const head = "mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {";
const handler = cut(head, '\n});');
yes('the activate handler is found', !!handler);
yes('no branch of the activate handler calls putBack',
    !!handler && !/putBack\(/.test(handler));
for (const call of ['fish(', 'game(', 'collectEgg(', 'churn(', 'hive(', 'harvest(']) {
  yes('the handler still answers ' + call + '...)', !!handler && handler.indexOf(call) >= 0);
}

// ---- the picked look -----------------------------------------------------

yes('PICKED_PROPERTY is made with its owner script',
    /mp\.makeProperty\(PICKED_PROPERTY, \{[\s\S]{0,120}updateOwner: pickedScript\(\)/.test(src));

const parts = {
  pickedScript: liftFn('pickedScript'),
  showPicked: liftFn('showPicked'),
  packCounts: liftFn('packCounts'),
  packGrew: liftFn('packGrew'),
  showsPick: liftFn('showsPick'),
  wrap: cut('(function answerFlora() {', '\n})();')
};
for (const k of Object.keys(parts)) { yes(k + ' is in the gamemode', !!parts[k]); }
yes('the wrapper sits after the activate handler',
    src.indexOf('(function answerFlora() {') > src.indexOf(head));
yes('the wrapper sets no timer', !!parts.wrap && !/setTimeout/.test(parts.wrap));
yes('showPicked sets no timer', !!parts.showPicked && !/setTimeout/.test(parts.showPicked));

// The client script, run against a fake Skyrim Platform.
function runScript(value, refs, state) {
  const calls = [];
  const sp = {
    Game: { getFormEx: function (id) { return refs[id] ? { id: id } : null; } },
    ObjectReference: {
      from: function (f) {
        if (!f) { return null; }
        const r = refs[f.id];
        return {
          isHarvested: function () { return r.harvested; },
          setHarvested: function (h) { calls.push('setHarvested ' + h); r.harvested = h; },
          disable: function () { calls.push('disable'); return { then: function (fn) { fn(); } }; },
          enable: function () { calls.push('enable'); }
        };
      }
    }
  };
  const ctx = { value: value, state: state, sp: sp };
  new Function('ctx', parts.pickedScript ? new Function('return ' + parts.pickedScript.replace(/^function pickedScript\(\)/, 'function ()'))()() : '')(ctx);
  return calls;
}
if (parts.pickedScript) {
  const refs = { 0x10: { harvested: false } };
  const state = {};
  let calls = runScript({ ref: 0x10, at: 5 }, refs, state);
  yes('a new order empties the plant and turns it off and on so the model follows',
      calls.join(',') === 'setHarvested true,disable,enable' && refs[0x10].harvested === true);
  calls = runScript({ ref: 0x10, at: 5 }, refs, state);
  yes('the same order the next frame does nothing', calls.length === 0);
  refs[0x10].harvested = false;
  calls = runScript({ ref: 0, at: 0 }, refs, state);
  yes('a cleared order does nothing', calls.length === 0 && refs[0x10].harvested === false);
  calls = runScript({ ref: 0x99, at: 6 }, refs, state);
  yes('a plant that is not loaded is left alone', calls.length === 0);
}

// The wrapper, against a fake mp and a fake handler.
const FLOWER = 0x100, CHURN = 0x101, DOOR = 0x102, PERSON = 0x14;
function world(answerer) {
  const rec = { set: [] };
  const packs = { [PERSON]: { entries: [{ baseId: 0x55, count: 1 }] } };
  const bases = { [FLOWER]: 'f1:Skyrim.esm', [CHURN]: 'c1:Skyrim.esm', [DOOR]: 'd1:Skyrim.esm' };
  const kinds = { 0xf1: 'FLOR', 0xc1: 'FLOR', 0xd1: 'DOOR' };
  const mp = {
    get: function (id, key) {
      if (key === 'baseDesc') { return bases[id]; }
      if (key === 'inventory') { return JSON.parse(JSON.stringify(packs[id])); }
      return null;
    },
    set: function (id, key, value) { rec.set.push({ id: id, key: key, value: value }); },
    onActivate: function (refrId, casterRefrId) { return answerer(packs, refrId, casterRefrId); }
  };
  const g = { __thornswoodSpoils: { kindOf: function (id) { return kinds[id] || ''; } } };
  const idOf = function (desc) { return parseInt(String(desc).split(':')[0], 16); };
  const isChurn = function (desc) { return desc === 'c1:Skyrim.esm'; };
  const body = "'use strict';\nconst PICKED_PROPERTY = 'thornswoodPicked';\n" +
    [parts.showPicked, parts.packCounts, parts.packGrew, parts.showsPick].join('\n') + '\n' +
    parts.wrap + '\nreturn mp.onActivate;';
  const onActivate = new Function('mp', 'globalThis', 'idOf', 'isChurn', 'log', body)(
    mp, g, idOf, isChurn, function () { });
  return { rec: rec, onActivate: onActivate };
}
const give = function (packs, refrId, who) { packs[who].entries.push({ baseId: 0x66, count: 1 }); return false; };
const refuse = function () { return false; };
const sow = function (packs, refrId, who) { packs[who].entries[0].count = 0; return false; };

if (parts.wrap && parts.showPicked && parts.packCounts && parts.packGrew && parts.showsPick) {
  let w = world(refuse);
  let r = w.onActivate(FLOWER, PERSON);
  yes('a refused press answers false', r === false);
  yes('a refused press sends the presser nothing: the plant is never emptied',
      w.rec.set.length === 0);

  w = world(give);
  w.onActivate(FLOWER, PERSON);
  yes('an allowed press empties that plant on the presser\'s machine, and only theirs',
      w.rec.set.length === 1 && w.rec.set[0].id === PERSON &&
      w.rec.set[0].key === 'thornswoodPicked' && w.rec.set[0].value.ref === FLOWER &&
      w.rec.set[0].value.at > 0);

  w = world(sow);
  w.onActivate(FLOWER, PERSON);
  yes('a press that only took from the pack (sowing) leaves the plant as it is',
      w.rec.set.length === 0);

  w = world(give);
  w.onActivate(CHURN, PERSON);
  yes('a churn is never shown spent', w.rec.set.length === 0);

  w = world(give);
  w.onActivate(DOOR, PERSON);
  yes('a press on anything but a plant or a tree is left alone', w.rec.set.length === 0);

  w = world(function () { return undefined; });
  yes('the handler\'s own answer comes back unchanged', w.onActivate(DOOR, PERSON) === undefined);
}

// ---- cleared at login ----------------------------------------------------

yes('the last picked plant is cleared in the per-session hook',
    /mp\.get\(actorId, PICKED_PROPERTY\)[\s\S]{0,120}mp\.set\(actorId, PICKED_PROPERTY, \{ ref: 0, at: 0 \}\)/.test(src) &&
    src.indexOf('PICKED_PROPERTY, { ref: 0, at: 0 }') < src.indexOf('Their own profession, said back to them'));

// ---- the fork blocks the press ------------------------------------------

const forkFile = path.join(__dirname, '..', '..', 'engine', 'skymp', 'skymp5-client', 'src', 'extensions',
  'objectReferenceEx.ts');
if (!fs.existsSync(path.join(__dirname, '..', '..', 'engine', 'skymp', 'skymp5-client'))) {
  if (process.env.THORNSWOOD_FORK_REQUIRED === '1') {
    yes('engine/skymp is checked out (THORNSWOOD_FORK_REQUIRED is set)', false);
  } else {
    console.log('SKIP  engine/skymp is not checked out here; the nightly fetches it at the pin and runs this');
  }
} else {
  const fork = fs.readFileSync(forkFile, 'utf8');
  const deal = fork.slice(fork.indexOf('static dealWithRef'));
  const blockList = deal.slice(deal.indexOf('} else if (t === FormType.Container'), deal.indexOf('self.blockActivation(true)'));
  yes('the fork blocks activation on Flora', /t === FormType\.Flora/.test(blockList));
  yes('the fork blocks activation on Tree', /t === FormType\.Tree/.test(blockList));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
