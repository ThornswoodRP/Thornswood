'use strict';
/*
  test-4655-fish-traps.js

      node game/tests/test-4655-fish-traps.js

  Issue #4655. A woodwright could make a fish trap and nothing in the game
  let anybody set one: placeFishTrap and collectFishTrap had no caller, and
  collecting gave work and no catch. docs/systems/classes/fisher.md says a
  fisher sets up to 3 in water they may fish, the wait is that water's rank,
  and collecting is a catch of that water; setting and collecting are each
  one piece of work.

  This runs the real trap code lifted out of the built game/gamemode.js
  (from FISH_TRAP_DESC to fish()) against a fake mp with a pack, a clock and
  one salmon water, and checks the button: the lock key's line the server
  writes at the water (waterLine), the /trap word that line's key sends,
  and the front drawing that line while the water is under the crosshair.

  Read only. Never connects to anything.
*/
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }

const gm = read('game/gamemode.js');
const a = gm.indexOf('const FISH_TRAP_DESC = ITEMS.fishTrap;');
const b = gm.indexOf('\nfunction fish(actorId, refrId, baseDesc) {', a);
yes('the trap code is in the built gamemode, before fish()', a >= 0 && b > a);

const TRAP = '1549b:Thornswood-Content.esp';
const SALMON = '108e35:Skyrim.esm';
const PEARL = '154a2:Thornswood-Content.esp';
const LONGFIN = '154a5:Thornswood-Content.esp';
const FISH_BY_BASE = {};
FISH_BY_BASE[SALMON] = { produce: '65c9f:Skyrim.esm', name: 'Salmon Meat', from: 'Salmon', rank: 'novice' };
FISH_BY_BASE[PEARL] = { produce: 'pearl:Skyrim.esm', name: 'Pearl', from: 'Pearl Oyster', rank: 'expert' };
FISH_BY_BASE[LONGFIN] = { produce: 'longfin:Skyrim.esm', name: 'Longfin', from: 'Longfin', rank: 'novice' };
const FISH_TUNING = { cooldownMs: { novice: 600000, advanced: 1800000, expert: 3600000, master: 14400000 },
                      yieldByStep: [[1, 1], [1, 2], [1, 3], [2, 4]] };
const ME = 0x14, OTHER = 0x15;
const WATER = 0x10a0, PEARL_WATER = 0x10a1, LONGFIN_WATER = 0x10a2, FAR_WATER = 0x10a3, NOT_WATER = 0x10a4;

function world() {
  const props = {};
  const made = {};
  const packs = {};
  packs[ME] = {};
  packs[OTHER] = {};
  const bases = {};
  bases[WATER] = SALMON; bases[FAR_WATER] = SALMON; bases[PEARL_WATER] = PEARL;
  bases[LONGFIN_WATER] = LONGFIN; bases[NOT_WATER] = '13bbf:Skyrim.esm';
  const st = { now: 1000000, work: [], gathered: [], fishers: [ME], step: 0 };
  const mp = {
    makeProperty: function (name, opts) { made[name] = opts; },
    get: function (id, name) {
      if (name === 'baseDesc') { if (!bases[id]) { throw new Error('no ref'); } return bases[id]; }
      if (name === 'inventory') {
        const p = packs[id] || {};
        return { entries: Object.keys(p).filter(function (k) { return p[k] > 0; })
          .map(function (k) { return { baseId: k, count: p[k] }; }) };
      }
      return props[id + ':' + name];
    },
    set: function (id, name, v) { props[id + ':' + name] = JSON.parse(JSON.stringify(v)); }
  };
  function give(id, desc, n) { packs[id][desc] = (packs[id][desc] || 0) + n; return true; }
  const deps = {
    ITEMS: { fishTrap: TRAP }, mp: mp,
    idOf: function (d) { return d; },
    isFish: function (d) { return Object.prototype.hasOwnProperty.call(FISH_BY_BASE, d); },
    FISH_BY_BASE: FISH_BY_BASE, FISH_TUNING: FISH_TUNING, FISH_TRAP_MAX: 3,
    RANK_LADDER: ['novice', 'advanced', 'expert', 'master'],
    classGate: function (id, verb) { return st.fishers.indexOf(id) >= 0 && verb === 'fish' ? null : 'Only a fisher can fish.'; },
    rankStep: function () { return st.step; },
    rankWord: function (r) { return r === 'expert' ? 'an Expert' : 'a ' + r; },
    takeItem: function (id, d, n) { if (!(packs[id][d] >= n)) { return false; } packs[id][d] -= n; return true; },
    addItem: give,
    addItemsAtomic: function (id, goods) { goods.forEach(function (g) { give(id, g.item, g.count); }); return true; },
    creditWork: function (id, verb) { st.work.push(verb); return null; },
    waitWord: function (s) { return Math.round(s / 60) + ' minutes'; },
    randInt: function (lo) { return lo; },
    economyGathered: function (id, d, n) { st.gathered.push([d, n]); },
    withinResourceReach: function (id, ref) { return ref !== FAR_WATER; },
    toolGate: function () { return null; }
  };
  const names = Object.keys(deps);
  const g = { __thornswoodQuestFishingRefs: {} };
  g.__thornswoodQuestFishingRefs[PEARL_WATER] = PEARL;
  const body = gm.slice(a, b)
    .replace(/\bglobalThis\b/g, 'G')
    .replace(/Date\.now\(\)/g, 'st.now');
  const fn = new Function(names.concat(['G', 'st']).join(','),
    body + '\nreturn { place: placeFishTrap, collect: collectFishTrap, line: waterLine, traps: fishTrapsOf, ' +
    'command: G.__thornswoodTraps && G.__thornswoodTraps.command, TRAP_PROPERTY: TRAP_PROPERTY, ' +
    'WATER_LINE_PROPERTY: WATER_LINE_PROPERTY };');
  const api = fn.apply(null, names.map(function (n) { return deps[n]; }).concat([g, st]));
  return { api: api, st: st, packs: packs, props: props, made: made, give: give,
           waterLine: function (id) { return props[id + ':' + api.WATER_LINE_PROPERTY]; } };
}

if (a >= 0 && b > a) {
  const w = world();
  const t = w.api;
  yes('both properties are made: the traps for the server, the water line for its owner',
      !!w.made[t.TRAP_PROPERTY] && w.made[t.TRAP_PROPERTY].isVisibleByOwner === false &&
      !!w.made[t.WATER_LINE_PROPERTY] && w.made[t.WATER_LINE_PROPERTY].isVisibleByOwner === true &&
      /thornswoodWaterLine/.test(w.made[t.WATER_LINE_PROPERTY].updateOwner));
  yes('/trap is answered (globalThis.__thornswoodTraps.command)', typeof t.command === 'function');

  // A fisher with no trap: the line at the water offers nothing.
  t.line(ME, WATER, SALMON);
  let L = w.waterLine(ME);
  yes('no trap in the pack: the water\'s line offers no key', L && L.hex === WATER.toString(16) && !L.x && !L.w);

  w.give(ME, TRAP, 4);
  t.line(ME, WATER, SALMON);
  L = w.waterLine(ME);
  yes('a trap in the pack: the line offers the lock key to set one',
      L.x === 'trap' && /^Set a fish trap here \(0 of 3 out\)$/.test(L.w));
  t.line(OTHER, WATER, SALMON);
  yes('somebody who is not a fisher gets no key', !w.waterLine(OTHER).x);

  // The key: /trap and the water's id.
  let said = t.command(['/trap', WATER.toString(16)], ME);
  yes('the key sets a trap in the water: ' + said, /^You set a fish trap in the Salmon\. It is ready in 10 minutes\. 1 of 3 are out\.$/.test(said));
  yes('the trap left the pack', w.packs[ME][TRAP] === 3);
  yes('setting it is one piece of work', w.st.work.length === 1 && w.st.work[0] === 'fish');
  yes('the trap is kept with its water and the water\'s wait',
      t.traps(ME).length === 1 && t.traps(ME)[0].hex === WATER.toString(16) &&
      t.traps(ME)[0].base === SALMON && t.traps(ME)[0].waitMs === 600000);
  L = w.waterLine(ME);
  yes('the line now says how long is left, with no key', !L.x && /^Your fish trap here is ready in 10 minutes\.$/.test(L.t));

  said = t.command(['/trap', WATER.toString(16)], ME);
  yes('pressed again before the wait: nothing comes up yet', /^Your fish trap here is ready in 10 minutes\.$/.test(said) &&
      t.traps(ME).length === 1 && w.st.work.length === 1);

  // The wait is the water's rank: novice water, ten minutes.
  w.st.now += 600000;
  t.line(ME, WATER, SALMON);
  L = w.waterLine(ME);
  yes('after the water\'s wait the line offers to take it up', L.x === 'trap' && L.w === 'Take up your fish trap');
  said = t.command(['/trap', WATER.toString(16)], ME);
  yes('collecting gives that water\'s catch: ' + said, /^You take up your fish trap with 1 Salmon Meat in it\.$/.test(said) &&
      w.packs[ME]['65c9f:Skyrim.esm'] === 1);
  yes('and the trap comes back', w.packs[ME][TRAP] === 4 && t.traps(ME).length === 0);
  yes('collecting is one piece of work, and the catch is counted as gathered',
      w.st.work.length === 2 && w.st.gathered.length === 1 && w.st.gathered[0][1] === 1);

  // Up to three at once, one to a water.
  t.command(['/trap', WATER.toString(16)], ME);
  said = t.command(['/trap', WATER.toString(16)], ME);
  yes('a second press at a water with your trap in it does not set another', t.traps(ME).length === 1);
  const fakeTraps = t.traps(ME).concat([{ at: w.st.now, hex: 'aa', base: SALMON, waitMs: 600000 },
                                       { at: w.st.now, hex: 'bb', base: SALMON, waitMs: 600000 }]);
  w.props[ME + ':' + t.TRAP_PROPERTY] = fakeTraps;
  const fourth = t.place(ME, 0x10cc, SALMON);
  yes('a fourth is refused: ' + fourth.line, !fourth.ok && /already have 3 fish traps set/.test(fourth.line));
  t.line(ME, 0x10cc, SALMON);
  yes('and the line at a fourth water offers no key', !w.waterLine(ME).x);

  // The water the person may fish, and only water.
  w.props[ME + ':' + t.TRAP_PROPERTY] = [];
  yes('not in a pearl bed, whose catch is a quest\'s', /does not go in this water/.test(t.place(ME, PEARL_WATER, PEARL).line));
  yes('not in the longfin water either', /does not go in this water/.test(t.place(ME, LONGFIN_WATER, LONGFIN).line));
  yes('/trap on something that is not water is refused', /not a water/.test(t.command(['/trap', NOT_WATER.toString(16)], ME)));
  yes('/trap from too far away is refused', /Come closer/.test(t.command(['/trap', FAR_WATER.toString(16)], ME)));
  yes('/trap with no id is refused', /not a water/.test(t.command(['/trap'], ME)));
  yes('somebody who is not a fisher cannot set one', /Only a fisher/.test(t.place(OTHER, WATER, SALMON).line));
}

// ------------------------------------------------- the route and the front
{
  const tp = read('game/gamemode/teleport.ts');
  yes('teleport.ts sends /trap to the traps block',
      /if \(word === '\/trap'\) \{[\s\S]{0,400}__thornswoodTraps[\s\S]{0,400}trapsApi\.command\(parts, actorId\)/.test(tp));
  const cc = read('game/gamemode/chat-commands.ts');
  yes('/trap is a word the server takes', /'\/trap',/.test(cc));
  const sa = read('game/gamemode/scripted-activators.ts');
  yes('a press on water writes the line after the cast',
      /message = fish\(casterRefrId, refrId, baseDesc\);\s*\n(\s*\/\/.*\n)*\s*waterLine\(casterRefrId, refrId, baseDesc\);/.test(sa));

  const front = read('game/plugins/thornswood-front.js');
  const fa = front.indexOf('  function waterLineNow(hex) {');
  const fb = fa < 0 ? -1 : front.indexOf('\n  }\n', fa);
  yes('the front reads the water line', fa >= 0 && fb > fa);
  if (fa >= 0 && fb > fa) {
    const g = {};
    let now = 5000;
    const lineNow = new Function('globalThis', 'Date', 'WATER_LINE_MS',
      front.slice(fa, fb + 4) + '\nreturn waterLineNow;')(g, { now: function () { return now; } }, 60000);
    g.thornswoodWaterLine = { hex: '10a0', seen: 5000, x: 'trap', w: 'Set a fish trap here (0 of 3 out)', t: '' };
    yes('drawn while that water is under the crosshair', !!lineNow('10a0'));
    yes('not for another water', lineNow('10a1') === null);
    now += 60001;
    yes('not once it is old', lineNow('10a0') === null);
  }
  const ref = front.slice(front.indexOf('  function lockKeyRef() {'), front.indexOf('  function plainWords('));
  yes('the lock key sends trap at the water the line is for',
      /const water = waterLineNow\(hex\);[\s\S]{0,200}verb: water\.x === 'trap' \? 'trap' : ''/.test(ref));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
