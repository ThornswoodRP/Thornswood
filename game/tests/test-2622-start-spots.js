// test-2622-start-spots.js
//
// A new character arrives at the town's start spot, one spot Djinn stood on
// and marked with F8, and not in the inn (#2622).
//
// WHY. Djinn, 17 October: inns are the busiest rooms in the game. New
// characters landed in the middle of other people's scenes, several picks of
// one town stacked on one spot, and anybody who wanted to harass new players
// knew where they appeared.
//
// WHAT IT CHECKS, against CHARGEN in game/gamemode.js (installed from
// game/data/chargen.json):
//   every one of the nine towns has a start spot, at exactly the numbers in
//   Djinn's marks file of 17 October;
//   the eight outdoor ones are in Tamriel (3c:Skyrim.esm), which the mark
//   tool does not write (it writes the exterior cell), so it is checked here;
//   arriveAt sets spawnPoint and locationalData from the start spot, never
//   the inn;
//   the three inn spots Djinn re-marked because the old ones were too close
//   to the door carry his numbers.
// Where Skyrim.esm is on this machine (SKYRIM_ESM, or the dev build's or the
// main install's Data folder) it also reads each marked cell out of it and
// checks the outdoor ones are Tamriel's and Markarth's is Understone Keep.
// Anywhere else that part says SKIP and the rest still runs.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const line = src.split('\n').find(function (l) { return l.indexOf('const CHARGEN = ') === 0; });
yes('CHARGEN is installed in the gamemode', !!line);
const CHARGEN = line ? JSON.parse(line.slice('const CHARGEN = '.length).replace(/;\s*$/, '')) : { towns: {} };
const byKey = {};
for (const d in CHARGEN.towns) { const t = CHARGEN.towns[d]; if (t && t.key) byKey[t.key] = t; }

// Djinn's marks, D:\Thornswood-DevBuild\Game\Data\Platform\thornswood-spots.txt, 17 Oct.
const TAMRIEL = '3c:Skyrim.esm';
const MARKS = {
  whiterun:   { cell: '961b',  desc: TAMRIEL, pos: [19189.1, -12006.5, -4558.4], z: 309.9 },
  solitude:   { cell: '92be',  desc: TAMRIEL, pos: [-73387.2, 94964.1, -11739], z: 12.1 },
  windhelm:   { cell: 'b51d',  desc: TAMRIEL, pos: [135744.9, 24540.5, -12865.3], z: 355.3 },
  riften:     { cell: 'bcd2',  desc: TAMRIEL, pos: [166478.2, -95072.9, 10735.1], z: 89.2 },
  markarth:   { cell: '16df2', desc: '16df2:Skyrim.esm', pos: [-5558.7, -1247.7, 6688], z: 37.3 },
  falkreath:  { cell: '9c81',  desc: TAMRIEL, pos: [-35529, -89918.3, -2946.1], z: 107.3 },
  morthal:    { cell: '93bf',  desc: TAMRIEL, pos: [-41159.1, 63851.4, -13778.6], z: 45.5 },
  dawnstar:   { cell: '8ed5',  desc: TAMRIEL, pos: [25623.4, 100614.3, -13216.9], z: 56.1 },
  winterhold: { cell: '8ec0',  desc: TAMRIEL, pos: [111939, 99023.6, -8742.5], z: 302.4 }
};
const INNS = {
  solitude:  { desc: '16a0e:Skyrim.esm', pos: [504.9, -1075.4, 0], z: 270.1 },
  falkreath: { desc: '3a184:Skyrim.esm', pos: [834.6, -100.6, 0], z: 53.1 },
  dawnstar:  { desc: '13a7f:Skyrim.esm', pos: [2010.3, -155.7, 0], z: 273.1 }
};
const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

for (const key in MARKS) {
  const t = byKey[key], m = MARKS[key];
  yes(key + ' has a start spot', !!(t && t.start));
  if (!t || !t.start) continue;
  yes(key + ' start is ' + m.desc, t.start.desc === m.desc);
  yes(key + ' start is at the marked spot', same(t.start.pos, m.pos) && same(t.start.rot, [0, 0, m.z]));
  yes(key + ' start is not the inn', t.start.desc !== (t.arrival && t.arrival.desc));
}
for (const key in INNS) {
  const a = byKey[key] && byKey[key].arrival, m = INNS[key];
  yes(key + ' inn spot is Djinn\'s new one', !!a && a.desc === m.desc && same(a.pos, m.pos) && same(a.rot, [0, 0, m.z]));
}

// arriveAt, run for real over a stand-in mp.
{
  const a = src.indexOf('\nfunction arriveAt(');
  const b = a < 0 ? -1 : src.indexOf('\n}\n', a);
  yes('arriveAt is in the gamemode', a >= 0 && b > a);
  if (a >= 0 && b > a) {
    const TOWN_BY_KEY = {}, PASSAGES = {};
    for (const d in CHARGEN.towns) { const t = CHARGEN.towns[d]; if (t && t.key) { TOWN_BY_KEY[t.key] = d; PASSAGES[d] = t; } }
    for (const key in MARKS) {
      const sets = {}, said = [];
      const ctx = {
        TOWN_BY_KEY, PASSAGES, String, Date,
        chargenOf: function () { return { stage: 'choosing' }; },
        setChargen: function () {}, closeRaceMenu: function () {}, log: function () {},
        say: function (id, w) { said.push(w); },
        mp: { set: function (id, k, v) { sets[k] = v; } }
      };
      vm.createContext(ctx);
      vm.runInContext(src.slice(a, b + 3) + '\nthis.result = arriveAt(255, ' + JSON.stringify(key) + ');', ctx);
      const m = MARKS[key];
      yes('arriveAt ' + key + ': spawnPoint and locationalData are the start spot',
          ctx.result === true && sets.spawnPoint && sets.spawnPoint.cellOrWorldDesc === m.desc &&
          same(sets.spawnPoint.pos, m.pos) && sets.locationalData && sets.locationalData.cellOrWorldDesc === m.desc);
    }
  }
}

// The marked cells, read out of Skyrim.esm where this machine has it.
{
  const where = [process.env.SKYRIM_ESM, 'D:\\Thornswood-DevBuild\\Game\\Data\\Skyrim.esm',
                 'C:\\Thornswood-DevBuild\\Game\\Data\\Skyrim.esm', 'C:\\Thornswood\\Game\\Data\\Skyrim.esm']
    .filter(Boolean).find(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
  if (!where) {
    console.log('SKIP  no Skyrim.esm on this machine, so the marked cells are not read from it');
  } else {
    const f = fs.readFileSync(where);
    const want = {};
    for (const key in MARKS) want[parseInt(MARKS[key].cell, 16)] = key;
    const found = {};
    (function walk(off, end, world) {
      while (off < end) {
        const type = f.toString('latin1', off, off + 4), size = f.readUInt32LE(off + 4);
        if (type === 'GRUP') {
          const label = f.readUInt32LE(off + 8), gt = f.readInt32LE(off + 12);
          walk(off + 24, off + size, gt === 1 ? label : world);
          off += size;
        } else {
          const id = f.readUInt32LE(off + 12);
          if (type === 'CELL' && want[id]) found[id] = world;
          off += 24 + size;
        }
      }
    })(0, f.length, null);
    for (const id in want) {
      const key = want[id], m = MARKS[key];
      const inTamriel = found[id] === 0x3c;
      yes(key + '\'s marked cell ' + m.cell + ' is ' + (m.desc === TAMRIEL ? 'in Tamriel' : 'an interior') + ' in ' + where,
          id in found && (m.desc === TAMRIEL ? inTamriel : found[id] === null));
    }
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
