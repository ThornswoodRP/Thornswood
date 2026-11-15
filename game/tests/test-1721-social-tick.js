// test-1721-social-tick.js
//
// #1721. The social tick read each person's appearance twice a pass: once for
// the publish test in online(), through the chargen block's publishedForOthers,
// which reads the engine itself outside the tick's memo, and once more for the
// name. Twenty people cost forty reads every 1.5 seconds.
//
// This lifts the real social block and the chargen block's two tests of a
// face (hasStoredAppearance, publishedForOthers), runs the social tick over a
// store that counts every engine read, and checks:
//   - one appearance read per person per pass;
//   - who is listed is exactly who publishedForOthers calls published,
//     including somebody with no face yet and somebody whose read throws;
//   - the names are what they were, the blank and the failed read included;
//   - nothing is held between passes, and outside a pass a read is fresh.
//
// GM points it at another copy of gamemode.js, which is how it was shown to
// fail on the code before the change.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const gm = fs.readFileSync(SRC, 'utf8').replace(/\r/g, '');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function fnOf(head) {
  const a = gm.indexOf(head);
  const b = a < 0 ? -1 : gm.indexOf('\n}\n', a);
  return (a >= 0 && b >= 0) ? gm.slice(a, b + 2) : null;
}

const SOCIAL = (function () {
  const i = gm.indexOf('// ==== thornswood social:');
  const j = gm.indexOf('// ==== end thornswood social ====', i);
  return (i >= 0 && j > i) ? gm.slice(i, j) : null;
})();
const HAS = fnOf('function hasStoredAppearance(a) {');
const PUB = fnOf('function publishedForOthers(actorId) {');
const HANDLE = (function () {
  const i = gm.indexOf('\nglobalThis.__thornswoodChargen = {');
  const j = i < 0 ? -1 : gm.indexOf('\n};\n', i);
  return (i >= 0 && j > i) ? gm.slice(i, j) : null;
})();
yes('the social block, hasStoredAppearance and publishedForOthers are where this reads them', !!(SOCIAL && HAS && PUB));
yes('and the chargen block hands both of them out',
  !!HANDLE && /\n  hasStoredAppearance: hasStoredAppearance,/.test(HANDLE) && /\n  publishedForOthers: publishedForOthers,/.test(HANDLE));
if (!(SOCIAL && HAS && PUB)) { done(); }

// ------------------------------------------------------------ the store --
const PEOPLE = 20;
const store = {};
const reads = {};
let counting = false;
const THROWS = 0xff000100;   // a person whose appearance read throws
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (counting) { reads[key] = (reads[key] || 0) + 1; }
    if (id === 0 && key === 'onlinePlayers') {
      return Object.keys(store).filter(function (k) { return store[k].here; }).map(Number);
    }
    if (id === THROWS && key === 'appearance') { throw new Error('no such form'); }
    const row = store[id];
    if (!row) { return undefined; }
    // The engine hands an appearance back parsed, a fresh object each time.
    const v = row[key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  },
  set: function (id, key, v) {
    if (!store[id]) { store[id] = {}; }
    store[id][key] = v;
  }
};
const ids = [];
function person(id, pid, ap) {
  store[id] = { here: true, profileId: pid, appearance: ap, worldOrCellDesc: 'town:X.esm', pos: [0, 0, 0] };
  ids.push(id);
  return id;
}
for (let i = 0; i < PEOPLE; i++) { person(0xff000001 + i, 101 + i, { name: 'P' + i, raceId: 7 }); }
const NOFACE = person(0xff000200, 900, null);          // still in the race menu
const NOTHING = person(0xff000201, 901, undefined);    // no appearance at all yet
const BLANK = person(0xff000202, 902, { name: '' });   // a face, no name
person(THROWS, 903, null);
const ALL = ids.length;

const g = {};
const hasStoredAppearance = new Function('return ' + HAS)();
const publishedForOthers = new Function('mp', 'hasStoredAppearance', 'return ' + PUB)(mp, hasStoredAppearance);
// The two exports of the chargen block's handle the social block may ask.
g.__thornswoodChargen = { hasStoredAppearance: hasStoredAppearance, publishedForOthers: publishedForOthers };
let clock = 1700000000000;
new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval', 'guard', 'say', 'notify', SOCIAL)(
  g, mp, { now: function () { return clock; } }, { log: function () { } },
  function () { return 1; }, function () { }, function (n, f) { return f; }, function () { }, function () { });
const S = g.__thornswoodSocial;
yes('the social block loads and hands out its tick', !!(S && S.tick));
if (!(S && S.tick)) { done(); }

function onePass() {
  for (const k in reads) { delete reads[k]; }
  counting = true;
  try { S.tick(); } finally { counting = false; }
  clock += S.SOCIAL.nearEvery;
  return Object.assign({}, reads);
}
function nearOf(id) { return (store[id].thornswoodNear || {}).w || {}; }

// ------------------------------------------------------- one read a person --
const r = onePass();
console.log('  one pass, ' + ALL + ' online: ' + (r.appearance || 0) + ' appearance, ' + (r.profileId || 0) +
            ' profile id, ' + (r.onlinePlayers || 0) + ' online lists');
yes('A1 one pass reads each person\'s appearance once (' + (r.appearance || 0) + ' for ' + ALL + ')',
  r.appearance === ALL);
yes('A1 and the online list once, each profile id once', r.onlinePlayers === 1 && (r.profileId || 0) <= ALL);
const r2 = onePass();
yes('A2 and the same again on the next pass: nothing is held between passes, nothing read twice',
  r2.appearance === ALL);

// --------------------------------------------- who is published, unchanged --
const listed = Object.keys(nearOf(ids[0])).map(function (h) { return parseInt(h, 16); }).concat([ids[0]]).sort();
const published = ids.filter(function (id) { return publishedForOthers(id); }).sort();
yes('B1 who is on the near list is exactly who publishedForOthers calls published (' + published.length + ' of ' + ALL + ')',
  JSON.stringify(listed) === JSON.stringify(published));
yes('B2 somebody with no face stored is not listed, nor somebody with no appearance at all',
  !publishedForOthers(NOFACE) && !publishedForOthers(NOTHING) &&
  !nearOf(ids[0])[NOFACE.toString(16)] && !nearOf(ids[0])[NOTHING.toString(16)]);
yes('B3 somebody whose read throws is listed, as publishedForOthers says, and named somebody',
  publishedForOthers(THROWS) === true && !!nearOf(ids[0])[THROWS.toString(16)] &&
  nearOf(ids[0])[THROWS.toString(16)].n === 'somebody');
yes('B4 a face with a blank name is listed and named somebody',
  !!nearOf(ids[0])[BLANK.toString(16)] && nearOf(ids[0])[BLANK.toString(16)].n === 'somebody');
yes('B5 everybody else is listed by their name',
  ids.slice(1, PEOPLE).every(function (id, i) { const row = nearOf(ids[0])[id.toString(16)]; return row && row.n === 'P' + (i + 1); }));

// ----------------------------------------------------- a face that arrives --
store[NOFACE].appearance = { name: 'Late', raceId: 7 };
onePass();
yes('C1 a face stored between passes is listed on the next one, by its name',
  !!nearOf(ids[0])[NOFACE.toString(16)] && nearOf(ids[0])[NOFACE.toString(16)].n === 'Late');
store[ids[2]].appearance = { name: 'Newname', raceId: 7 };
onePass();
yes('C2 a rename shows on the next pass', nearOf(ids[0])[ids[2].toString(16)].n === 'Newname');

// ---------------------------------------------------- outside a pass, fresh --
store[ids[3]].appearance = { name: 'Between', raceId: 7 };
const found = S.findPerson('Between');
yes('D1 outside a pass, finding somebody by a name given since the last pass reads it fresh',
  !!found && found.actorId === ids[3]);
for (const k in reads) { delete reads[k]; }
counting = true;
S.nameOfPerson(ids[4]); S.nameOfPerson(ids[4]);
counting = false;
yes('D2 and outside a pass nothing is held: two asks are two reads', reads.appearance === 2);

// ------------------------------------------------------------ the wiring --
yes('E1 the publish test and the name share one read a pass: online() asks hasStoredAppearance of it, ' +
    'and nothing in the social block calls publishedForOthers',
  /function appearanceOf\(actorId\) \{\s*return memo\('a' \+ actorId,/.test(SOCIAL) &&
  /chargen\.hasStoredAppearance\(seen\.ap\)/.test(SOCIAL) && !/publishedForOthers\(/.test(SOCIAL) &&
  (SOCIAL.match(/mp\.get\([a-zA-Z]+, 'appearance'\)/g) || []).length === 1);

done();
